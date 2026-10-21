/**
 * Creates a demo staff account for the admin area:
 *   npm run create-staff -- staff-ops@example.org "Demo Operator" OPERATOR
 *   npm run create-staff -- staff-view@example.org "Demo Viewer" VIEWER
 *
 * VIEWER can look at records; OPERATOR can also queue retries. The password is random, only its
 * scrypt hash is stored, and it is appended to DATA_DIR/dev-credentials.txt. The account is marked
 * as a demo account. An existing account is never changed. Real BTU staff should sign in through
 * BTU's identity provider instead (not connected in this prototype).
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { DATA_DIR } from "../src/lib/config";
import { getDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

async function main() {
  const [email, name, role] = process.argv.slice(2).map((a) => a?.trim());
  if (!email || !name || !["VIEWER", "OPERATOR"].includes(role ?? ""))
    throw new Error('Usage: npm run create-staff -- <email> "<display name>" VIEWER|OPERATOR');
  const db = getDb();
  if (db.prepare("SELECT 1 FROM students WHERE email = ?").get(email))
    throw new Error(`${email} is a student account; staff accounts must be separate.`);
  if (db.prepare("SELECT 1 FROM staff WHERE email = ?").get(email)) {
    console.log(`${email} already has a staff account; nothing changed.`);
    return;
  }
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = Array.from({ length: 20 }, () => abc[randomInt(abc.length)]);
  const password = [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join("")).join("-");
  const hash = await hashPassword(password);
  db.transaction(() => {
    const id = db.prepare("INSERT INTO staff (email, display_name, role, is_demo) VALUES (?, ?, ?, 1)").run(email, name, role).lastInsertRowid;
    db.prepare("INSERT INTO staff_credentials (staff_fk, password_hash) VALUES (?, ?)").run(id, hash);
    db.prepare("INSERT INTO audit_log (at, actor_kind, actor_ref, action, details) VALUES (?, 'SYSTEM', 'create-staff', 'STAFF_CREATED', ?)")
      .run(new Date().toISOString().slice(0, 19) + "Z", JSON.stringify({ email, role, demo: true }));
  })();
  const file = path.join(DATA_DIR, "dev-credentials.txt");
  fs.appendFileSync(file, `${email}\t${password}\n`, { mode: 0o600 });
  console.log(`Demo staff account ${email} (${role}) created; password written to ${file}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
