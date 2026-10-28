/**
 * Switches on Google sign-in for the local demo in one step:
 *   npm run google:setup
 *
 * It asks for the OAuth client from Google Cloud Console (see docs/GOOGLE-SIGNIN.md) and your Google address, then:
 *   - writes DATA_DIR/google.env (only readable by you; the folder is ignored by git), which quickstart loads;
 *   - lets students with your address's domain sign in (STUDENT_EMAIL_DOMAINS);
 *   - gives a demo student your Google address, so "Sign in with Google" opens that student's passport;
 *   - gives you a demo staff account (OPERATOR) for the admin area, when you ask for one.
 * The secret is typed without echo and is never printed. Each answer can also come from the environment
 * (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SETUP_EMAIL, SETUP_STUDENT = a Student ID or "none", SETUP_STAFF = yes/no).
 * Demo data only: it refuses to run against a database that isn't the demo's.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DATA_DIR } from "../src/lib/config";
import { getDb } from "../src/lib/db";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ask(question: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve(""); // not a terminal: same as pressing Enter
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // print the prompt, then swallow the echo of what is typed
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(a.trim());
    }),
  );
}
const answer = async (env: string, question: string, hidden = false) => process.env[env]?.trim() || ask(question, hidden);

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  if (!fs.existsSync(path.join(DATA_DIR, "demo.env")))
    throw new Error(`${DATA_DIR} is not a demo folder (no demo.env). Run \`npm run quickstart\` once first, or set DATA_DIR.`);
  const db = getDb();
  const envFile = path.join(DATA_DIR, "google.env");
  const old = readEnvFile(envFile);
  const demoDomains = (readEnvFile(path.join(DATA_DIR, "demo.env")).STUDENT_EMAIL_DOMAINS ?? "example.org")
    .split(",").map((d) => d.trim()).filter(Boolean);

  console.log("Google sign-in for the local demo. The steps for getting a client are in docs/GOOGLE-SIGNIN.md.\n");
  const clientId = (await answer("GOOGLE_CLIENT_ID", `Client ID${old.GOOGLE_CLIENT_ID ? " (Enter keeps the current one)" : ""}: `)) || old.GOOGLE_CLIENT_ID;
  if (!clientId?.endsWith(".apps.googleusercontent.com")) throw new Error("That doesn't look like a client ID (it ends in .apps.googleusercontent.com).");
  const secret = (await answer("GOOGLE_CLIENT_SECRET", `Client secret${old.GOOGLE_CLIENT_SECRET ? " (Enter keeps the current one)" : ""}: `, true)) || old.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("The client secret is needed.");
  const email = (await answer("SETUP_EMAIL", "Your Google address (e.g. you@gmail.com): ")).toLowerCase();
  if (!EMAIL.test(email)) throw new Error(`${email || "(empty)"} isn't an email address.`);
  const domain = email.slice(email.lastIndexOf("@") + 1);

  // google.env: keep any other settings already in it (e.g. GOOGLE_HOSTED_DOMAIN), replace the ones set here
  const domains = [...new Set([...demoDomains, ...(old.STUDENT_EMAIL_DOMAINS ?? "").split(","), domain].map((d) => d.trim()).filter(Boolean))];
  const settings = { ...old, GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: secret, STUDENT_EMAIL_DOMAINS: domains.join(",") };
  fs.writeFileSync(envFile, "# Google sign-in for this demo (npm run google:setup). Never commit this file.\n" +
    Object.entries(settings).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  console.log(`\nSaved ${envFile}. Students with @${domain} addresses may now sign in.`);

  // the student who signs in with this Google account
  const mine = db.prepare("SELECT student_id AS id, first_name || ' ' || last_name AS name FROM students WHERE lower(email) = ?")
    .get(email) as { id: string; name: string } | undefined;
  if (mine) {
    console.log(`${email} already belongs to student ${mine.name} (${mine.id}).`);
  } else {
    const students = db.prepare(
      `SELECT s.id AS fk, s.student_id AS id, s.first_name || ' ' || s.last_name AS name, s.email
         FROM students s
        WHERE NOT EXISTS (SELECT 1 FROM google_identities g WHERE g.account_kind = 'STUDENT' AND g.account_fk = s.id)
        ORDER BY s.student_id`,
    ).all() as { fk: number; id: string; name: string; email: string }[];
    if (!process.env.SETUP_STUDENT) {
      console.log("\nWhich demo student should open when you sign in with Google?");
      for (const s of students) console.log(`  ${s.id}  ${s.name}  (${s.email})`);
    }
    const pick = (await answer("SETUP_STUDENT", "Student ID (Enter for the first one, \"none\" to skip): ")) || students[0]?.id;
    if (pick && pick.toLowerCase() !== "none") {
      // records kept in step with a Google Sheet are matched by email there, so they keep the sheet's address
      if (fs.existsSync(path.join(DATA_DIR, "sheet")))
        throw new Error(`${DATA_DIR} follows a Google Sheet, which matches students by email. Add a row with ${email} to the sheet ` +
          `(or use Add student in the admin area) instead, then run this again with "none".`);
      const s = students.find((x) => x.id.toLowerCase() === pick.toLowerCase());
      if (!s) throw new Error(`${pick} isn't a demo student that can still be linked to Google.`);
      if (db.prepare("SELECT 1 FROM staff WHERE lower(email) = ?").get(email))
        throw new Error(`${email} is a staff account; a student needs a different address.`);
      db.transaction(() => {
        db.prepare("UPDATE students SET email = ? WHERE id = ?").run(email, s.fk);
        db.prepare("INSERT INTO audit_log (at, actor_kind, actor_ref, action, details) VALUES (?, 'SYSTEM', 'google-setup', 'STUDENT_EMAIL_CHANGED', ?)")
          .run(new Date().toISOString().slice(0, 19) + "Z", JSON.stringify({ student_id: s.id, from: s.email, to: email }));
      })();
      console.log(`Student ${s.name} (${s.id}) now uses ${email}; signing in with Google opens their passport.`);
    }
  }

  // staff: the same address can't be both, so this is offered only when it isn't a student's
  const isStudent = !!db.prepare("SELECT 1 FROM students WHERE lower(email) = ?").get(email);
  const isStaff = !!db.prepare("SELECT 1 FROM staff WHERE lower(email) = ?").get(email);
  if (isStaff) console.log(`${email} already has a staff account.`);
  else if (!isStudent && /^y/i.test(await answer("SETUP_STAFF", `Make ${email} a demo staff member (OPERATOR) for the admin area? [y/N] `))) {
    db.transaction(() => {
      db.prepare("INSERT INTO staff (email, display_name, role, is_demo) VALUES (?, ?, 'OPERATOR', 1)").run(email, email.split("@")[0]);
      db.prepare("INSERT INTO audit_log (at, actor_kind, actor_ref, action, details) VALUES (?, 'SYSTEM', 'google-setup', 'STAFF_CREATED', ?)")
        .run(new Date().toISOString().slice(0, 19) + "Z", JSON.stringify({ email, role: "OPERATOR", demo: true }));
    })();
    console.log(`${email} is now a demo OPERATOR: use "Sign in with Google" on /admin/login.`);
  }

  const port = process.env.PORT || "3000";
  console.log(`\nIn Google Cloud Console, the client's Authorised redirect URI must be:
  http://localhost:${port}/api/auth/google/callback
Restart the demo (Ctrl+C, then PORT=${port} npm run quickstart) and open http://localhost:${port}/login — use localhost, not 127.0.0.1.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
