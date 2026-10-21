import { STUDENT_EMAIL_DOMAINS } from "../config";
import { getDb } from "../db";
import { getDummyHash, verifyPassword } from "./password";

/**
 * Password sign-in provider for the stage 1 test accounts.
 * Returns the internal student id, or null if the email or password is wrong.
 * A future Google provider returns the same thing from a verified ID token,
 * and both hand the result to createSession().
 */
export async function verifyCredentials(email: string, password: string): Promise<number | null> {
  if (!allowedDomain(email)) {
    await verifyPassword(password, await getDummyHash()); // same time and answer as a wrong password
    return null;
  }
  const row = getDb()
    .prepare(
      `SELECT s.id, c.password_hash
         FROM students s JOIN auth_credentials c ON c.student_fk = s.id
        WHERE s.email = ?`,
    )
    .get(email.trim()) as { id: number; password_hash: string } | undefined;

  if (!row) {
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? row.id : null;
}

/** True when the email's domain is one students may sign in with (any domain if none are configured). */
export function allowedDomain(email: string): boolean {
  if (STUDENT_EMAIL_DOMAINS.length === 0) return true;
  const at = email.trim().lastIndexOf("@");
  return at > 0 && STUDENT_EMAIL_DOMAINS.includes(email.trim().slice(at + 1).toLowerCase());
}

// Simple in-memory limit on failed attempts per email, per server process.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, number[]>();

export function isLockedOut(email: string): boolean {
  const now = Date.now();
  const recent = (failures.get(email.toLowerCase()) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(email.toLowerCase(), recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(email: string): void {
  const key = email.toLowerCase();
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}

export function clearFailures(email: string): void {
  failures.delete(email.toLowerCase());
}
