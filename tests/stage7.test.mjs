// Subject stage 03: the staff screens for synthetic students, marks and the simulated syllabus.
// No blockchain and no Google Sheet: the stage 1 seed, the subject catalog and a temporary data folder.
// Run after `npm run build`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3922;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s7-"));
const env = { ...process.env, DATA_DIR: dataDir, PASSPORT_ISSUANCE_MODE: "local-demo" };
const OPERATOR = "ops.demo@staff.example.org";
const VIEWER = "viewer.demo@staff.example.org";
const ST = "BTU-T-0001";
const VIBE = "SUBJ-VIBE-CODING"; // points out of 100: Quizzes 10, Assignments 20, Agent project 30, Midterm exam 15, Final exam 25
const FULL = { c1: "8", c2: "15", c3: "24", c4: "10", c5: "20" }; // 77.00, Gold
const PASSPORT_TABLES = ["passports", "passport_versions", "version_source_records", "skill_awards", "catalog_skills", "source_records"];
const accounts = new Map();
let server, ops, viewer, before_;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { env, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const query = (sql, ...a) => {
  const d = new Database(path.join(dataDir, "portal.db"), { readonly: true });
  try { return d.prepare(sql).all(...a); } finally { d.close(); }
};
const tables = () => new Set(query("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
const snapshot = () => Object.fromEntries(PASSPORT_TABLES.filter((t) => tables().has(t)).map((t) => [t, query(`SELECT * FROM ${t} ORDER BY 1`)]));
const readAccounts = () => {
  for (const line of fs.readFileSync(path.join(dataDir, "dev-credentials.txt"), "utf8").split("\n")) {
    const [email, password] = line.split("\t");
    if (email && password && !email.startsWith("#")) accounts.set(email, password);
  }
};
const flat = (html) => html.replaceAll("<!-- -->", "");

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`${url} did not start`);
}
async function signIn(kind, email, password) {
  const res = await fetch(`${BASE}${kind === "staff" ? "/api/admin/login" : "/api/auth/login"}`, {
    method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual",
  });
  const name = kind === "staff" ? "bdp_staff=" : "bdp_session=";
  return { location: res.headers.get("location"), cookie: (res.headers.getSetCookie().find((c) => c.startsWith(name)) ?? "").split(";")[0] };
}
const get = (url, cookie) => fetch(`${BASE}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const page = async (url, cookie) => flat(await (await get(url, cookie)).text());
const post = (url, cookie, form, headers = {}) =>
  fetch(`${BASE}${url}`, { method: "POST", redirect: "manual", body: new URLSearchParams(form), headers: { ...(cookie ? { cookie } : {}), ...headers } });
const marks = (cookie, form, student = ST, subject = VIBE) => post("/api/admin/marks", cookie, { student, subject, ...form });
const entries = () => query("SELECT * FROM grade_entries ORDER BY id");

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  run("python3", ["-m", "worker", "subjects", "load"]);
  run("npx", ["tsx", "scripts/create-staff.ts", OPERATOR, "Demo Operator", "OPERATOR"]);
  run("npx", ["tsx", "scripts/create-staff.ts", VIEWER, "Demo Viewer", "VIEWER"]);
  readAccounts();
  before_ = snapshot();
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: "ignore" });
  await waitFor(`${BASE}/login`);
  ops = (await signIn("staff", OPERATOR, accounts.get(OPERATOR))).cookie;
  viewer = (await signIn("staff", VIEWER, accounts.get(VIEWER))).cookie;
  assert.ok(ops && viewer, "staff signed in");
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("the subjects page lists the passport subjects with their simulated syllabus", async () => {
  const html = await page("/admin/subjects", viewer);
  assert.ok(html.includes('data-testid="subjects"'));
  assert.ok(html.includes("Vibe Coding") && html.includes("Agent project"));
  assert.ok(html.includes('data-testid="syllabus-open"') && html.includes("<dialog"), "syllabus popup");
  assert.ok(html.includes("Simulated"));
  assert.ok(!html.includes("Calculus I"), "only passport subjects by default");
  assert.ok((await page("/admin/subjects?all=1", viewer)).includes("Calculus I"), "the whole catalog on request");
  assert.equal((await get("/admin/subjects")).headers.get("location"), "/admin/login");
});

test("an operator adds a student; the test password is shown once and works", async () => {
  assert.ok((await page("/admin/students", ops)).includes('data-testid="add-student"'));
  assert.ok((await page("/admin/students/new", ops)).includes('data-testid="new-student"'));
  const res = await post("/api/admin/students", ops, {
    firstName: "Nino", lastName: "Testadze", program: "Computer Science and Artificial Intelligence",
    educationLevel: "Master's", status: "Active", createLogin: "on" });
  assert.equal(res.status, 303);
  const loc = res.headers.get("location");
  const [, id] = loc.match(/^\/admin\/students\/(BTU-T-\d+)\?new=1&created=/);
  const row = query("SELECT * FROM students WHERE student_id = ?", id)[0];
  assert.deepEqual([row.first_name, row.last_name, row.education_level, row.source, row.email],
    ["Nino", "Testadze", "Master's", "SEED_SYNTHETIC", `${id.toLowerCase()}@example.org`]);

  const html = await page(loc, ops);
  const password = html.match(/data-testid="new-password">([^<]+)</)[1];
  assert.ok(password.length >= 12);
  assert.ok(!loc.includes(password), "never in the URL");
  assert.ok(!(await page(loc, ops)).includes(password), "shown only once");
  const audit = query("SELECT * FROM audit_log WHERE action = 'STUDENT_CREATED'");
  assert.equal(audit.length, 1);
  assert.ok(!JSON.stringify(audit).includes(password), "not in the audit log");

  const s = await signIn("student", row.email, password);
  assert.equal(s.location, "/dashboard");
  assert.equal((await get("/dashboard", s.cookie)).status, 200);
});

test("bad student details are refused and nothing is stored", async () => {
  const count = query("SELECT COUNT(*) AS n FROM students")[0].n;
  for (const [form, msg] of [
    [{ firstName: "", lastName: "X" }, "First and last name are required"],
    [{ firstName: "A", lastName: "B", studentId: "X-1" }, "Student ID must look like"],
    [{ firstName: "A", lastName: "B", studentId: ST }, "already exists"],
    [{ firstName: "A", lastName: "B", educationLevel: "PhD?" }, "education level"],
    [{ firstName: "A", lastName: "B", email: "not-an-email" }, "doesn't look valid"],
  ]) {
    const res = await post("/api/admin/students", ops, form);
    assert.equal(res.status, 303, msg);
    const loc = res.headers.get("location");
    assert.ok(loc.startsWith("/admin/students/new?error="), msg);
    assert.ok((await page(loc, ops)).includes(msg), msg);
  }
  assert.equal(query("SELECT COUNT(*) AS n FROM students")[0].n, count);
});

test("a viewer, a student, a signed-out visitor and a cross-site form can't add students or marks", async () => {
  const count = query("SELECT COUNT(*) AS n FROM students")[0].n;
  assert.equal((await post("/api/admin/students", viewer, { firstName: "V", lastName: "W" })).status, 403);
  assert.equal((await marks(viewer, FULL)).status, 403);
  assert.equal(query("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('STUDENT_CREATE_DENIED', 'MARKS_DENIED')")[0].n, 2);
  assert.ok(!(await page("/admin/students", viewer)).includes('data-testid="add-student"'));
  assert.ok(!(await page(`/admin/students/${ST}/marks/${VIBE}`, viewer)).includes('data-testid="marks-form"'));

  const student = await signIn("student", "btu-t-0001@example.org", accounts.get("btu-t-0001@example.org"));
  assert.equal((await marks(student.cookie, FULL)).status, 401);
  assert.equal((await marks(student.cookie.replace("bdp_session=", "bdp_staff="), FULL)).status, 401);
  assert.equal((await marks(null, FULL)).status, 401);
  assert.equal((await post("/api/admin/students", ops, { firstName: "X", lastName: "Y" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post("/api/admin/marks", ops, { student: ST, subject: VIBE, ...FULL }, { origin: "https://evil.example" })).status, 403);
  assert.equal(entries().length, 0, "no marks stored");
  assert.equal(query("SELECT COUNT(*) AS n FROM students")[0].n, count);
});

test("an operator enters marks; the score and badge match the worker's", async () => {
  // the subject picker on the student page leads to the marks form
  const go = await get(`/admin/students/${ST}/marks/go?subject=${VIBE}`, ops);
  assert.equal(go.headers.get("location"), `/admin/students/${ST}/marks/${VIBE}`);
  const form = await page(`/admin/students/${ST}/marks/${VIBE}`, ops);
  assert.ok(form.includes('data-testid="marks-form"') && form.includes('data-testid="syllabus-open"'));

  const res = await marks(ops, { ...FULL, c5: "" });          // final exam not marked yet
  assert.equal(res.headers.get("location"), `/admin/students/${ST}?marks=4#subjects`);
  let html = await page(res.headers.get("location"), ops);
  assert.ok(html.includes("Missing: Final exam") && html.includes("4 mark(s) saved."));

  await marks(ops, FULL);
  html = await page(`/admin/students/${ST}`, ops);
  assert.ok(html.includes('data-testid="score">77.00<'));
  assert.match(html, /data-testid="tier"[^>]*>[^<]*Gold/);
  assert.match(run("python3", ["-m", "worker", "grades", "show", "--student", ST]), /77\.00/, "same score from the worker");
  assert.deepEqual(entries().map((e) => [e.source, e.entered_by]), Array(5).fill(["MANUAL", OPERATOR]));
});

test("a correction keeps the old mark; the same marks again change nothing", async () => {
  const before = entries().length;
  assert.equal((await marks(ops, FULL)).headers.get("location"), `/admin/students/${ST}?marks=0#subjects`);
  assert.equal(entries().length, before);

  await marks(ops, { c5: "25", note: "re-marked" });
  const all = entries();
  assert.equal(all.length, before + 1);
  const finals = all.filter((e) => e.component_fk === all.at(-1).component_fk);
  assert.deepEqual(finals.map((e) => e.points), [20, 25]);
  assert.equal(finals[1].supersedes_fk, finals[0].id);
  assert.equal(finals[1].note, "re-marked");
  const html = await page(`/admin/students/${ST}`, ops);
  assert.ok(html.includes('data-testid="score">82.00<'));
  assert.match(run("python3", ["-m", "worker", "grades", "show", "--student", ST]), /82\.00/);
  const comma = await marks(ops, { c1: "5,5" }, "BTU-T-0002");   // a decimal comma is accepted
  assert.equal(comma.headers.get("location"), "/admin/students/BTU-T-0002?marks=1#subjects");
});

test("bad marks are refused with a message and nothing is stored", async () => {
  const before = entries().length;
  for (const [form, msg, subject] of [
    [{ c1: "11" }, "outside 0–10"],
    [{ c1: "-1" }, "outside"],
    [{ c1: "2.345" }, "more than two decimals"],
    [{ c1: "abc" }, "is not a number"],
    [{ c1: "" }, "Enter at least one mark"],
    [{ c1: "5" }, "does not count toward the passport", "SUBJ-CALCULUS-1"],
    [{ c1: "5" }, "No subject", "SUBJ-NOPE"],
  ]) {
    const res = await marks(ops, form, ST, subject ?? VIBE);
    assert.equal(res.status, 303, msg);
    const loc = res.headers.get("location");
    assert.ok(loc.includes("?error="), msg);
    assert.ok(decodeURIComponent(loc).includes(msg), msg);
  }
  assert.equal((await marks(ops, FULL, "BTU-T-9999")).status, 404);
  assert.equal(entries().length, before);
});

test("staff find a student by name", async () => {
  for (const q of ["Testadze", "nino test", "Testadze Nino"]) {
    const html = await page(`/admin/students?q=${encodeURIComponent(q)}`, viewer);
    assert.ok(html.includes('data-testid="hits"') && html.includes("Nino Testadze") && html.includes(">Name<"), q);
  }
  assert.ok(!(await page("/admin/students?q=%25%25%25", viewer)).includes('data-testid="hits"'), "% is not a wildcard");
});

test("course results: one line per student per course, on the page and as CSV", async () => {
  const html = await page("/admin/courses", viewer);
  assert.ok(html.includes(`data-row="${ST}:${VIBE}"`) && html.includes(`data-row="BTU-T-0002:${VIBE}"`));
  assert.ok(html.includes('data-testid="total">82.00<'));
  const res = await get("/api/admin/courses", viewer);
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  const lines = (await res.text()).replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines.length, 3, "header + two student-course lines");
  assert.match(lines[0], /^"Student ID","First name"/);
  const one = lines.find((l) => l.startsWith(`"${ST}"`));
  assert.ok(one.includes(`"${VIBE}"`) && one.includes('"8","15","24","10","25","82.00","Gold","Complete"'), one);
  assert.equal((await get("/api/admin/courses")).status, 401);
  assert.equal(query("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'COURSE_RESULTS_EXPORTED'")[0].n, 1);
});

test("existing passports, versions and skills are untouched", () => {
  assert.deepEqual(snapshot(), before_);
});
