import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { getPassportForStudent, type Passport } from "./passports";

/**
 * The public passport link a student puts in a CV: /p/<token>. One permanent token per passport, 128 random bits
 * (22 base64url characters), made the first time the student sees their passport. Only the token is ever in the
 * link: the Passport ID is sequential, so it would let anyone walk through every passport.
 */
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export const sharePath = (token: string) => `/p/${token}`;

/** This student's link token, created on first use; null while the student has no issued version to show. */
export function shareTokenFor(studentFk: number): string | null {
  const db = getDb();
  const p = db
    .prepare(
      `SELECT p.id, l.token FROM passports p LEFT JOIN passport_share_links l ON l.passport_fk = p.id
        WHERE p.student_fk = ? AND EXISTS (SELECT 1 FROM passport_versions v WHERE v.passport_fk = p.id AND v.status = 'CURRENT')`,
    )
    .get(studentFk) as { id: number; token: string | null } | undefined;
  if (!p) return null;
  if (p.token) return p.token;
  db.prepare("INSERT OR IGNORE INTO passport_share_links (passport_fk, token, created_at) VALUES (?, ?, ?)").run(
    p.id,
    randomBytes(16).toString("base64url"),
    new Date().toISOString(),
  );
  // (two first views at once: the first insert wins and both read the same token)
  return (db.prepare("SELECT token FROM passport_share_links WHERE passport_fk = ?").get(p.id) as { token: string }).token;
}

/** The passport behind a public link, or null for anything that isn't an existing token. */
export function passportForToken(token: string): { student: { id: number; source: string }; passport: Passport } | null {
  if (!TOKEN.test(token)) return null;
  const row = getDb()
    .prepare(
      `SELECT s.id, s.source FROM passport_share_links l JOIN passports p ON p.id = l.passport_fk
         JOIN students s ON s.id = p.student_fk WHERE l.token = ?`,
    )
    .get(token) as { id: number; source: string } | undefined;
  if (!row) return null;
  const passport = getPassportForStudent(row.id);
  return passport ? { student: row, passport } : null;
}
