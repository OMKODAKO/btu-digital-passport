// `npm run google:setup`: writes the demo's google.env and gives a demo student (and optionally staff) a Google address.
// The answers come from the environment here; on a terminal the script asks for them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s10-"));
const base = { ...process.env, DATA_DIR: dataDir, GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", SETUP_EMAIL: "",
  SETUP_STUDENT: "", SETUP_STAFF: "" };
const setup = (extra) => spawnSync("npx", ["tsx", "scripts/google-setup.ts"], { env: { ...base, ...extra }, encoding: "utf8", input: "" });
const query = (sql, ...a) => {
  const d = new Database(path.join(dataDir, "portal.db"), { readonly: true });
  try { return d.prepare(sql).all(...a); } finally { d.close(); }
};
const ID = "1234-abc.apps.googleusercontent.com";

test("refuses a folder that isn't a demo", () => {
  const r = setup({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: "s", SETUP_EMAIL: "me@gmail.com", SETUP_STUDENT: "none" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a demo folder/);
  assert.ok(!fs.existsSync(path.join(dataDir, "google.env")));
});

test("writes google.env, links a demo student and a staff account, never prints the secret", () => {
  assert.equal(spawnSync("npx", ["tsx", "scripts/seed.ts"], { env: base, encoding: "utf8" }).status, 0);
  fs.writeFileSync(path.join(dataDir, "demo.env"), "STUDENT_EMAIL_DOMAINS=example.org\n");

  const bad = setup({ GOOGLE_CLIENT_ID: "nope", GOOGLE_CLIENT_SECRET: "s", SETUP_EMAIL: "me@gmail.com" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /client ID/);

  const r = setup({ GOOGLE_CLIENT_ID: ID, GOOGLE_CLIENT_SECRET: "GOCSPX-top-secret", SETUP_EMAIL: "Me@Gmail.com",
    SETUP_STUDENT: "BTU-T-0002" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes("GOCSPX-top-secret"));
  const file = path.join(dataDir, "google.env");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const env = fs.readFileSync(file, "utf8");
  assert.match(env, new RegExp(`^GOOGLE_CLIENT_ID=${ID}$`, "m"));
  assert.match(env, /^GOOGLE_CLIENT_SECRET=GOCSPX-top-secret$/m);
  assert.match(env, /^STUDENT_EMAIL_DOMAINS=example.org,gmail.com$/m);
  assert.deepEqual(query("SELECT student_id FROM students WHERE email = 'me@gmail.com'"), [{ student_id: "BTU-T-0002" }]);
  assert.equal(query("SELECT 1 FROM audit_log WHERE action = 'STUDENT_EMAIL_CHANGED'").length, 1);
  // the address is a student's now, so no staff account is made with it
  assert.equal(query("SELECT 1 FROM staff WHERE email = 'me@gmail.com'").length, 0);

  // run again: Enter keeps the stored client, the student stays, and another address can become staff
  const again = setup({ SETUP_EMAIL: "boss@btu.edu.ge", SETUP_STUDENT: "none", SETUP_STAFF: "yes" });
  assert.equal(again.status, 0, again.stderr);
  const env2 = fs.readFileSync(file, "utf8");
  assert.match(env2, /^GOOGLE_CLIENT_SECRET=GOCSPX-top-secret$/m);
  assert.match(env2, /^STUDENT_EMAIL_DOMAINS=example.org,gmail.com,btu.edu.ge$/m);
  assert.deepEqual(query("SELECT role, active FROM staff WHERE email = 'boss@btu.edu.ge'"), [{ role: "OPERATOR", active: 1 }]);
  assert.deepEqual(query("SELECT student_id FROM students WHERE email = 'me@gmail.com'"), [{ student_id: "BTU-T-0002" }]);

  // records that follow a Google Sheet are matched by email there, so their addresses aren't changed
  fs.mkdirSync(path.join(dataDir, "sheet"));
  const sheet = setup({ SETUP_EMAIL: "other@gmail.com", SETUP_STUDENT: "BTU-T-0003" });
  assert.notEqual(sheet.status, 0);
  assert.match(sheet.stderr, /follows a Google Sheet/);
  assert.equal(query("SELECT 1 FROM students WHERE email = 'other@gmail.com'").length, 0);
});
