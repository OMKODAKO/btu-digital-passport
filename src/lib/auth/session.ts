import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_HOURS } from "../config";
import { getDb } from "../db";

export type SessionStudent = {
  id: number;
  studentId: string;
  firstName: string;
  lastName: string;
  email: string;
  program: string | null;
  educationLevel: string | null;
  source: string; // BTU_TEST_DATA or SEED_SYNTHETIC: demo records, not real institutional data
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** Creates a server-side session for an already-authenticated student and returns the cookie token. */
export function createSession(studentFk: number, authMethod: "password" | "google" | "demo"): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  getDb()
    .prepare(
      "INSERT INTO sessions (token_sha256, student_fk, auth_method, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(sha256(token), studentFk, authMethod, now.toISOString(), expires.toISOString());
  return token;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_sha256 = ?").run(sha256(token));
}

/**
 * The signed-in student, taken only from the session cookie.
 * Nothing the browser sends in a URL, form or header can change who this is.
 */
export const getCurrentStudent = cache(async (): Promise<SessionStudent | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id, s.student_id AS studentId, s.first_name AS firstName,
              s.last_name AS lastName, s.email, s.program,
              s.education_level AS educationLevel, s.source
         FROM sessions x JOIN students s ON s.id = x.student_fk
        WHERE x.token_sha256 = ? AND x.expires_at > ?`,
    )
    .get(sha256(token), new Date().toISOString()) as SessionStudent | undefined;
  return row ?? null;
});
