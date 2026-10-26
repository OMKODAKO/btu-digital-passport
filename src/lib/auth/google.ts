import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_HOSTED_DOMAIN } from "../config";
import { getDb } from "../db";
import { allowedDomain } from "./credentials";

/**
 * Google sign-in with OpenID Connect (authorization code flow with PKCE), written against Google's documented
 * endpoints so no extra library is needed.
 *
 * Who signs in is decided only from the ID token that this server fetches from Google's token endpoint over TLS
 * with the client secret (OpenID Connect Core 3.1.3.7 allows TLS server validation in place of checking the
 * token's signature in that case). Nothing the browser sends names the account: the callback carries only a
 * one-time code, and the state, nonce and PKCE verifier it must match live in an httpOnly cookie.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Tests point this at a local stand-in for Google; a real deployment leaves it unset.
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type Audience = "student" | "staff";
export type Flow = { state: string; nonce: string; verifier: string; as: Audience };
export type GoogleUser = { sub: string; email: string };

export class GoogleError extends Error {
  constructor(public code: "failed" | "unverified" | "domain" | "unknown" | "linked") {
    super(code);
  }
}

const b64url = (b: Buffer) => b.toString("base64url");
const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function newFlow(as: Audience): Flow {
  return { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), as };
}
export const encodeFlow = (f: Flow) => Buffer.from(JSON.stringify(f)).toString("base64url");
export function decodeFlow(v: string | undefined): Flow | null {
  try {
    const f = JSON.parse(Buffer.from(v ?? "", "base64url").toString("utf8"));
    return f && typeof f.state === "string" && typeof f.nonce === "string" && typeof f.verifier === "string" &&
      (f.as === "student" || f.as === "staff") ? f : null;
  } catch {
    return null;
  }
}

/** Google's consent page for this flow. */
export function authorizationUrl(flow: Flow, redirectUri: string): string {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: b64url(sha256(flow.verifier)),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (GOOGLE_HOSTED_DOMAIN) q.set("hd", GOOGLE_HOSTED_DOMAIN);
  return `${AUTH_URL}?${q}`;
}

export function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Exchanges the one-time code and checks the ID token; returns the verified Google account. */
export async function verifiedUser(code: string, flow: Flow, redirectUri: string): Promise<GoogleUser> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri,
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) throw new GoogleError("failed");
  const idToken = ((await res.json().catch(() => ({}))) as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string") throw new GoogleError("failed");

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    throw new GoogleError("failed");
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!ISSUERS.includes(String(claims.iss)) || !aud.includes(GOOGLE_CLIENT_ID) ||
      typeof claims.exp !== "number" || claims.exp * 1000 < Date.now() ||
      typeof claims.nonce !== "string" || !sameState(claims.nonce, flow.nonce) ||
      typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string") {
    throw new GoogleError("failed");
  }
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleError("unverified");
  if (GOOGLE_HOSTED_DOMAIN && String(claims.hd ?? "").toLowerCase() !== GOOGLE_HOSTED_DOMAIN) throw new GoogleError("domain");
  return { sub: claims.sub, email: claims.email.trim().toLowerCase() };
}

/**
 * The student or staff record this Google account signs in as. The first sign-in links the Google account to the
 * record whose email matches; after that the link decides, so a different Google account with the same email
 * (or a record whose email changes) can't take it over.
 */
export function linkedAccount(as: Audience, user: GoogleUser): number {
  const db = getDb();
  const kind = as === "student" ? "STUDENT" : "STAFF";
  const exists = (fk: number) =>
    as === "student"
      ? !!db.prepare("SELECT 1 FROM students WHERE id = ?").get(fk)
      : !!db.prepare("SELECT 1 FROM staff WHERE id = ? AND active = 1").get(fk);

  return db.transaction(() => {
    const link = db.prepare("SELECT account_kind AS kind, account_fk AS fk FROM google_identities WHERE google_sub = ?")
      .get(user.sub) as { kind: string; fk: number } | undefined;
    if (link) {
      if (link.kind !== kind || !exists(link.fk)) throw new GoogleError("unknown");
      return link.fk;
    }
    const row = (as === "student"
      ? allowedDomain(user.email) ? db.prepare("SELECT id FROM students WHERE lower(email) = ?").get(user.email) : undefined
      : db.prepare("SELECT id FROM staff WHERE lower(email) = ? AND active = 1").get(user.email)) as { id: number } | undefined;
    if (!row) throw new GoogleError(as === "student" && !allowedDomain(user.email) ? "domain" : "unknown");
    if (db.prepare("SELECT 1 FROM google_identities WHERE account_kind = ? AND account_fk = ?").get(kind, row.id)) {
      throw new GoogleError("linked");
    }
    db.prepare("INSERT INTO google_identities (google_sub, account_kind, account_fk, email, linked_at) VALUES (?, ?, ?, ?, ?)")
      .run(user.sub, kind, row.id, user.email, new Date().toISOString());
    return row.id;
  })();
}

/** Where Google sends the browser back: PUBLIC_BASE_URL when set (it must match the URI registered with Google). */
export function redirectUri(req: Request): string {
  const base = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}
