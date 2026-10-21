/**
 * Gives an existing student record a test login:  npm run create-login -- btu-t-0099@example.org
 *
 * The workbook has no passwords, and knowing an email is not a login. This creates a random
 * password for a student who already exists in the database (from the seed or a workbook import),
 * stores only its scrypt hash, and appends it to DATA_DIR/dev-credentials.txt. Existing logins are
 * never changed.
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { DATA_DIR } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) throw new Error("Usage: npm run create-login -- <student email>");
  const db = getDb();
  const s = db.prepare("SELECT id, student_id FROM students WHERE email = ?").get(email) as
    | { id: number; student_id: string }
    | undefined;
  if (!s) throw new Error(`No student with email ${email}. Import or seed the student first.`);
  if (db.prepare("SELECT 1 FROM auth_credentials WHERE student_fk = ?").get(s.id)) {
    console.log(`${email} (${s.student_id}) already has a login; nothing changed.`);
    return;
  }
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from({ length: 16 }, () => abc[randomInt(abc.length)]);
  const password = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
  db.prepare("INSERT INTO auth_credentials (student_fk, password_hash) VALUES (?, ?)").run(s.id, await hashPassword(password));
  const file = path.join(DATA_DIR, "dev-credentials.txt");
  fs.appendFileSync(file, `${email}\t${password}\n`, { mode: 0o600 });
  console.log(`Login created for ${email} (${s.student_id}); password written to ${file}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
