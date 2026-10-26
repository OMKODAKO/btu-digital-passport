// Sign-in without passwords: the one-click local demo sign-in and Google sign-in (OpenID Connect).
// Google itself isn't reachable from a test, so a small local server stands in for Google's token endpoint
// (GOOGLE_TOKEN_URL); everything on the portal's side runs as it would against Google. Run after `npm run build`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PLAIN = 3923;   // no sign-in method switched on (what a server gets by default)
const DEMO = 3924;    // demo sign-in + Google
const GOOGLE = 3925;  // the stand-in token endpoint
const BASE = `http://127.0.0.1:${DEMO}`;
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s8-"));
const env = { ...process.env, DATA_DIR: dataDir, PASSPORT_PASSWORD_LOGIN: "", PASSPORT_DEMO_LOGIN: "", GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "", PUBLIC_BASE_URL: "" };
const OPERATOR = "ops.demo@staff.example.org";
const S1 = { id: "BTU-T-0001", email: "btu-t-0001@example.org", name: "Giorgi" };
let plain, demo, google, claims, lastTokenRequest;

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { env, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
};
const query = (sql, ...a) => {
  const d = new Database(path.join(dataDir, "portal.db"), { readonly: true });
  try { return d.prepare(sql).all(...a); } finally { d.close(); }
};
const start = (port, extra) =>
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"],
    { env: { ...env, ...extra }, stdio: "ignore" });
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`${url} did not start`);
}
const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "").split(";")[0];
const get = (base, url, cookie) => fetch(`${base}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const post = (base, url, form, headers = {}) =>
  fetch(`${base}${url}`, { method: "POST", redirect: "manual", body: new URLSearchParams(form), headers });
const flat = async (res) => (await res.text()).replaceAll("<!-- -->", "");
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (c) => `${b64url({ alg: "RS256" })}.${b64url(c)}.sig`;

/** Starts Google sign-in, plays Google's part, and returns the portal's answer to the callback. */
async function googleSignIn(as, makeClaims, { state } = {}) {
  const startRes = await get(BASE, `/api/auth/google?as=${as}`);
  assert.equal(startRes.status, 303);
  const consent = new URL(startRes.headers.get("location"));
  const flowCookie = cookieOf(startRes, "bdp_google");
  const flow = JSON.parse(Buffer.from(flowCookie.split("=")[1], "base64url").toString());
  claims = makeClaims(flow);
  const q = new URLSearchParams({ code: "one-time-code", state: state ?? consent.searchParams.get("state") });
  const res = await get(BASE, `/api/auth/google/callback?${q}`, flowCookie);
  return { consent, flow, res };
}
const goodClaims = (email, sub, extra = {}) => (flow) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 300, nonce: flow.nonce,
  sub, email, email_verified: true, ...extra,
});

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  run("npx", ["tsx", "scripts/create-staff.ts", OPERATOR, "Demo Operator", "OPERATOR"]);
  google = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastTokenRequest = Object.fromEntries(new URLSearchParams(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "x", id_token: idToken(claims) }));
    });
  }).listen(GOOGLE, "127.0.0.1");
  plain = start(PLAIN, {});
  demo = start(DEMO, { PASSPORT_DEMO_LOGIN: "1", GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_TOKEN_URL: `http://127.0.0.1:${GOOGLE}/token`, PUBLIC_BASE_URL: BASE });
  await waitFor(`http://127.0.0.1:${PLAIN}/login`);
  await waitFor(`${BASE}/login`);
});

after(() => {
  plain?.kill();
  demo?.kill();
  google?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("by default there are no passwords and no back doors: the forms are gone and every sign-in route is off", async () => {
  const P = `http://127.0.0.1:${PLAIN}`;
  for (const page of ["/login", "/admin/login"]) {
    const html = await flat(await get(P, page));
    assert.ok(!/type="password"/.test(html), `${page} has no password field`);
    assert.ok(!html.includes('data-testid="demo-login"') && !html.includes('data-testid="google-login"'), page);
  }
  assert.equal((await post(P, "/api/auth/login", { email: S1.email, password: "x" })).status, 404);
  assert.equal((await post(P, "/api/admin/login", { email: OPERATOR, password: "x" })).status, 404);
  assert.equal((await post(P, "/api/auth/demo", { student: S1.id })).status, 404);
  assert.equal((await post(P, "/api/admin/demo", { email: OPERATOR })).status, 404);
  assert.equal((await get(P, "/api/auth/google?as=student")).status, 404);
});

test("demo sign-in: pick a student, no password; the dashboard is that student's", async () => {
  const html = await flat(await get(BASE, "/login"));
  assert.ok(!/type="password"/.test(html));
  assert.ok(html.includes('data-testid="demo-login"') && html.includes(`value="${S1.id}"`));
  const res = await post(BASE, "/api/auth/demo", { student: S1.id });
  assert.equal(res.headers.get("location"), "/dashboard");
  const cookie = cookieOf(res, "bdp_session");
  const dash = await flat(await get(BASE, "/dashboard", cookie));
  assert.ok(dash.includes("BTU-AI-000125") && dash.includes(S1.name));
  assert.equal(query("SELECT auth_method FROM sessions ORDER BY rowid DESC LIMIT 1")[0].auth_method, "demo");

  assert.equal((await post(BASE, "/api/auth/demo", { student: "BTU-T-9999" })).headers.get("location"), "/login?error=demo_unknown");
  assert.equal((await post(BASE, "/api/auth/demo", { student: S1.id }, { origin: "https://evil.example" })).status, 403);
});

test("demo staff sign-in works only for demo staff accounts", async () => {
  const html = await flat(await get(BASE, "/admin/login"));
  assert.ok(html.includes(`value="${OPERATOR}"`) && !/type="password"/.test(html));
  const res = await post(BASE, "/api/admin/demo", { email: OPERATOR });
  assert.equal(res.headers.get("location"), "/admin");
  const admin = await get(BASE, "/admin", cookieOf(res, "bdp_staff"));
  assert.equal(admin.status, 200);

  const d = new Database(path.join(dataDir, "portal.db"));
  d.prepare("INSERT INTO staff (email, display_name, role, is_demo) VALUES ('real.person@btu.edu.ge', 'Real', 'OPERATOR', 0)").run();
  d.close();
  const real = await post(BASE, "/api/admin/demo", { email: "real.person@btu.edu.ge" });
  assert.equal(real.headers.get("location"), "/admin/login?error=demo_unknown");
  assert.equal(cookieOf(real, "bdp_staff"), "");
});

test("Google: the consent request carries state, nonce and a PKCE challenge, and the callback signs the student in", async () => {
  const { consent, flow, res } = await googleSignIn("student", goodClaims(S1.email, "google-sub-1"));
  assert.equal(consent.origin + consent.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(consent.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(consent.searchParams.get("redirect_uri"), `${BASE}/api/auth/google/callback`);
  assert.equal(consent.searchParams.get("nonce"), flow.nonce);
  assert.equal(consent.searchParams.get("code_challenge"), createHash("sha256").update(flow.verifier).digest("base64url"));
  assert.equal(lastTokenRequest.code_verifier, flow.verifier, "the verifier goes only to the token endpoint");
  assert.equal(lastTokenRequest.client_secret, "test-secret");

  assert.equal(res.headers.get("location"), "/dashboard");
  const dash = await flat(await get(BASE, "/dashboard", cookieOf(res, "bdp_session")));
  assert.ok(dash.includes("BTU-AI-000125"));
  assert.deepEqual(query("SELECT google_sub, account_kind, email FROM google_identities"),
    [{ google_sub: "google-sub-1", account_kind: "STUDENT", email: S1.email }]);
  // the same Google account again: signed in through the stored link
  assert.equal((await googleSignIn("student", goodClaims(S1.email, "google-sub-1"))).res.headers.get("location"), "/dashboard");
});

test("Google: anything that doesn't check out is refused", async () => {
  const refused = async (as, make, opts) => (await googleSignIn(as, make, opts)).res.headers.get("location");
  assert.equal(await refused("student", goodClaims(S1.email, "s"), { state: "forged" }), "/login?error=google_failed");
  assert.equal(await refused("student", (f) => ({ ...goodClaims(S1.email, "s")(f), nonce: "replayed" })), "/login?error=google_failed");
  assert.equal(await refused("student", (f) => ({ ...goodClaims(S1.email, "s")(f), aud: "someone-else" })), "/login?error=google_failed");
  assert.equal(await refused("student", (f) => ({ ...goodClaims(S1.email, "s")(f), iss: "https://evil.example" })), "/login?error=google_failed");
  assert.equal(await refused("student", (f) => ({ ...goodClaims(S1.email, "s")(f), exp: 1000 })), "/login?error=google_failed");
  assert.equal(await refused("student", goodClaims(S1.email, "s", { email_verified: false })), "/login?error=google_unverified");
  assert.equal(await refused("student", goodClaims("nobody@example.org", "s2")), "/login?error=google_unknown");
  // another Google account with the same email can't take over a record already linked to someone
  assert.equal(await refused("student", goodClaims(S1.email, "google-sub-other")), "/login?error=google_linked");
  // a callback without the flow cookie (e.g. a link someone was sent) does nothing
  const bare = await get(BASE, "/api/auth/google/callback?code=x&state=y");
  assert.equal(bare.headers.get("location"), "/login?error=google_failed");
  assert.equal(query("SELECT COUNT(*) AS n FROM google_identities")[0].n, 1);
});

test("Google for staff: only emails on the staff list, and the staff cookie works on the next page", async () => {
  const { res } = await googleSignIn("staff", goodClaims(OPERATOR, "google-staff-1"));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /url=\/admin/);
  assert.equal((await get(BASE, "/admin", cookieOf(res, "bdp_staff"))).status, 200);
  const stranger = await googleSignIn("staff", goodClaims(S1.email, "google-sub-1"));
  assert.equal(stranger.res.headers.get("location"), "/admin/login?error=google_unknown");
  const actions = query("SELECT details FROM audit_log WHERE action = 'STAFF_LOGIN'").map((r) => JSON.parse(r.details ?? "{}").method);
  assert.ok(actions.includes("google") && actions.includes("demo"));
});

test("adding a student offers no password, and Google links can't be edited", async () => {
  const res = await post(BASE, "/api/admin/demo", { email: OPERATOR });
  const html = await flat(await get(BASE, "/admin/students/new", cookieOf(res, "bdp_staff")));
  assert.ok(!html.includes('name="createLogin"') && html.includes("No password is needed"));
  const d = new Database(path.join(dataDir, "portal.db"));
  assert.throws(() => d.prepare("UPDATE google_identities SET account_fk = 2").run(), /append-only/);
  assert.throws(() => d.prepare("DELETE FROM google_identities").run(), /append-only/);
  d.close();
});
