import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { allowedDomain } from "./auth/credentials";
import { hashPassword } from "./auth/password";
import { DATA_DIR } from "./config";
import { getDb } from "./db";

/**
 * Staff-entered synthetic students (BTU's student API is not available). They are stored with the
 * SEED_SYNTHETIC source, so the admin area keeps labelling the environment as demo data. The Student ID
 * and the email are given the next free BTU-T-NNNN number when left empty, the same scheme the sheet
 * watcher uses, so a later sheet import never hands the same number to someone else.
 */

export const EDUCATION_LEVELS = ["Bachelor's", "Master's", "Doctoral"];
export const STUDENT_STATUSES = ["Active", "Graduate"];
const STUDENT_ID = /^BTU-T-\d{4,}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class StudentError extends Error {}

export type NewStudent = {
  firstName: string; lastName: string; email?: string; studentId?: string;
  program?: string; educationLevel?: string; status?: string;
};

export function nextStudentId(): string {
  const ids = getDb().prepare("SELECT student_id AS id FROM students WHERE student_id LIKE 'BTU-T-%'").all() as { id: string }[];
  const max = Math.max(0, ...ids.map((r) => Number(r.id.slice(6))).filter(Number.isFinite));
  return `BTU-T-${String(max + 1).padStart(4, "0")}`;
}

/** Validates and inserts one student; with createLogin, also a random test password (returned once). */
export async function createStudent(input: NewStudent, createLogin: boolean) {
  const clean = (v: string | undefined, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  const firstName = clean(input.firstName, 80);
  const lastName = clean(input.lastName, 80);
  const program = clean(input.program, 160) || null;
  const educationLevel = clean(input.educationLevel, 40) || null;
  const status = clean(input.status, 40) || "Active";
  let studentId = clean(input.studentId, 20).toUpperCase();
  let email = clean(input.email, 160).toLowerCase();

  if (!firstName || !lastName) throw new StudentError("First and last name are required.");
  if (educationLevel && !EDUCATION_LEVELS.includes(educationLevel)) throw new StudentError("Choose an education level from the list.");
  if (!STUDENT_STATUSES.includes(status)) throw new StudentError("Choose a student status from the list.");
  if (studentId && !STUDENT_ID.test(studentId)) throw new StudentError("Student ID must look like BTU-T-0123.");
  if (email && !EMAIL.test(email)) throw new StudentError("That email address doesn't look valid.");

  const db = getDb();
  const password = createLogin ? makePassword() : null;
  const hash = password ? await hashPassword(password) : null;
  const row = db.transaction(() => {
    studentId ||= nextStudentId();
    email ||= `${studentId.toLowerCase()}@example.org`;
    if (password && !allowedDomain(email)) {
      throw new StudentError(`Students can't sign in with ${email.split("@")[1]} addresses here; use an allowed domain or skip the login.`);
    }
    if (db.prepare("SELECT 1 FROM students WHERE student_id = ?").get(studentId)) throw new StudentError(`${studentId} already exists.`);
    if (db.prepare("SELECT 1 FROM students WHERE email = ?").get(email)) throw new StudentError(`${email} already belongs to a student.`);
    const id = Number(
      db.prepare(
        `INSERT INTO students (student_id, first_name, last_name, email, source, program, education_level, student_status)
         VALUES (?, ?, ?, ?, 'SEED_SYNTHETIC', ?, ?, ?)`,
      ).run(studentId, firstName, lastName, email, program, educationLevel, status).lastInsertRowid,
    );
    if (hash) db.prepare("INSERT INTO auth_credentials (student_fk, password_hash) VALUES (?, ?)").run(id, hash);
    return { id, studentId, email };
  })();
  if (password) {
    // the same file `npm run create-login` and the sheet watcher keep, so logins stay in one place
    fs.appendFileSync(path.join(DATA_DIR, "dev-credentials.txt"), `${row.email}\t${password}\n`, { mode: 0o600 });
  }
  return { ...row, password };
}

function makePassword(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from({ length: 16 }, () => abc[randomInt(abc.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}
