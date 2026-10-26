import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { STAFF_COOKIE, STAFF_SESSION_HOURS } from "../config";
import { getDb } from "../db";
import { getDummyHash, verifyPassword } from "./password";

/**
 * Staff sign-in and role checks for the admin area.
 *
 * Staff accounts, credentials and sessions are separate tables from the student ones, under a
 * separate cookie. A student session token is never found in staff_sessions, and the role is read
 * from the database on every request, so nothing a browser sends (a URL, a form field, a cookie
 * value it edits) can give a student or a VIEWER the OPERATOR role.
 */

export type Role = "VIEWER" | "OPERATOR";
export type Staff = { id: number; email: string; displayName: string; role: Role; isDemo: boolean };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const staffCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function verifyStaffCredentials(email: string, password: string): Promise<number | null> {
  const row = getDb()
    .prepare(
      `SELECT s.id, c.password_hash FROM staff s JOIN staff_credentials c ON c.staff_fk = s.id
        WHERE s.email = ? AND s.active = 1`,
    )
    .get(email.trim()) as { id: number; password_hash: string } | undefined;
  if (!row) {
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? row.id : null;
}

export function createStaffSession(staffFk: number): string {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  getDb()
    .prepare("INSERT INTO staff_sessions (token_sha256, staff_fk, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), staffFk, now.toISOString(), new Date(now.getTime() + STAFF_SESSION_HOURS * 3600e3).toISOString());
  return token;
}

export function deleteStaffSession(token: string): void {
  getDb().prepare("DELETE FROM staff_sessions WHERE token_sha256 = ?").run(sha256(token));
}

/** The signed-in staff member, from the staff session cookie only; null for anyone else. */
export const getCurrentStaff = cache(async (): Promise<Staff | null> => {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id, s.email, s.display_name AS displayName, s.role, s.is_demo AS isDemo
         FROM staff_sessions x JOIN staff s ON s.id = x.staff_fk
        WHERE x.token_sha256 = ? AND x.expires_at > ? AND s.active = 1`,
    )
    .get(sha256(token), new Date().toISOString()) as (Omit<Staff, "isDemo"> & { isDemo: number }) | undefined;
  return row ? { ...row, isDemo: row.isDemo === 1 } : null;
});

/** view: any staff. retry and manage (add students, enter marks): OPERATOR only. */
export const can = (staff: Staff | null, action: "view" | "retry" | "manage") =>
  !!staff && (action === "view" || staff.role === "OPERATOR");

/** For admin pages: the signed-in staff member, or a redirect to the staff sign-in page. */
export async function requireStaff(): Promise<Staff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/admin/login");
  return staff;
}
