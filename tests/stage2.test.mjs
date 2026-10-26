// Stage 2 end-to-end: seed (stage 1 accounts and PDFs) → import the real BTU workbook →
// add a skill → the student's dashboard shows the new version, and nobody else's.
// Run after `npm run build`:  npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3918;
const BASE = `http://127.0.0.1:${PORT}`;
const WORKBOOK = path.resolve(
  process.env.BTU_WORKBOOK ?? "samples/demo/workbook.xlsx",
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s2-"));
const env = { ...process.env, PASSPORT_PASSWORD_LOGIN: "1", DATA_DIR: dataDir };
const accounts = new Map();
let server;
let newSkillName;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const importWorkbook = (file, extraEnv) => run("python3", ["-m", "worker", "import", "--xlsx", file], extraEnv);
const db = () => new Database(path.join(dataDir, "portal.db"), { readonly: true });

function readAccounts() {
  for (const line of fs.readFileSync(path.join(dataDir, "dev-credentials.txt"), "utf8").split("\n")) {
    const [email, password] = line.split("\t");
    if (email && password && !email.startsWith("#")) accounts.set(email, password);
  }
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ email, password: password ?? "" }),
    redirect: "manual",
  });
  const cookie = (res.headers.getSetCookie().find((c) => c.startsWith("bdp_session=")) ?? "").split(";")[0];
  return { location: res.headers.get("location"), cookie };
}
const get = (url, cookie) => fetch(`${BASE}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  readAccounts();
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], {
    env,
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/login`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("server did not start");
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("importing the real workbook over the stage 1 data adds 60 skills and no new versions", () => {
  const out = importWorkbook(WORKBOOK);
  assert.match(out, /header on row 4/);
  assert.match(out, /valid 60, held 0, invalid 0; students with valid rows 18/);
  assert.match(out, /awards: 60 new/);
  assert.match(out, /versions generated 0/);
  const d = db();
  assert.equal(d.prepare("SELECT COUNT(*) n FROM passport_versions").get().n, 26, "stage 1 versions kept");
  d.close();
  const again = importWorkbook(WORKBOOK);
  assert.match(again, /awards: 0 new, 60 unchanged/);
  assert.match(again, /versions generated 0/);
});

test("a new skill makes V3, which waits for blockchain registration while V2 stays valid", async () => {
  const edited = path.join(dataDir, "with-new-skill.xlsx");
  newSkillName = run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, edited, "BTU-T-0001", "REC-0901"]).trim();
  const out = importWorkbook(edited);
  assert.match(out, /versions generated 1/);
  assert.match(out, /1 waiting for registration/);

  const s1 = await login("btu-t-0001@example.org", accounts.get("btu-t-0001@example.org"));
  const html = await (await get("/dashboard", s1.cookie)).text();
  assert.ok(html.includes('data-testid="awaiting-registration"'));
  assert.ok(html.replaceAll("<!-- -->", "").includes("V2 remains your valid passport"));
  assert.equal((await get("/api/passport/pdf?v=3", s1.cookie)).status, 404, "an unissued version is never served");
  const d = db();
  const v2 = d
    .prepare(`SELECT v.pdf_sha256 FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
              WHERE p.passport_id = 'BTU-AI-000125' AND v.status = 'CURRENT'`)
    .get();
  d.close();
  assert.equal(sha256(Buffer.from(await (await get("/api/passport/pdf", s1.cookie)).arrayBuffer())), v2.pdf_sha256);
});

test("issued (local-demo mode) V3 shows on that student's dashboard only", async () => {
  const edited = path.join(dataDir, "with-new-skill.xlsx");
  assert.match(importWorkbook(edited, { PASSPORT_ISSUANCE_MODE: "local-demo" }), /1 issued unregistered/);

  const d = db();
  const v3 = d
    .prepare(`SELECT v.* FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
              WHERE p.passport_id = 'BTU-AI-000125' AND v.status = 'CURRENT'`)
    .get();
  d.close();
  assert.equal(v3.version_no, 3);

  const s1 = await login("btu-t-0001@example.org", accounts.get("btu-t-0001@example.org"));
  const html = await (await get("/dashboard", s1.cookie)).text();
  assert.ok(html.includes(v3.verification_code), "dashboard shows V3's code");
  assert.ok(html.includes(newSkillName), "new skill listed");
  const pdf = Buffer.from(await (await get("/api/passport/pdf", s1.cookie)).arrayBuffer());
  assert.equal(sha256(pdf), v3.pdf_sha256, "student 1 gets exactly V3");
  assert.equal((await get("/api/passport/pdf?v=2", s1.cookie)).status, 200, "previous version still available");

  // Student 2 has no V3 of their own and can never reach student 1's
  const s2 = await login("btu-t-0002@example.org", accounts.get("btu-t-0002@example.org"));
  assert.equal((await get("/api/passport/pdf?v=3", s2.cookie)).status, 404);
  const own = Buffer.from(await (await get("/api/passport/pdf", s2.cookie)).arrayBuffer());
  assert.notEqual(sha256(own), v3.pdf_sha256);
  const html2 = await (await get("/dashboard", s2.cookie)).text();
  assert.ok(!html2.includes(v3.verification_code) && !html2.includes("BTU-AI-000125"));
});

test("a failed update is shown as failed, and the previous PDF stays current", async () => {
  const edited = path.join(dataDir, "with-skill-for-0002.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, edited, "BTU-T-0002", "REC-0902"]);
  // BTU's template assets are unavailable, so PDF generation fails
  const out = importWorkbook(edited, { PASSPORT_ASSETS_DIR: path.join(dataDir, "no-such-assets") });
  assert.match(out, /generation failures 1/);
  const s2 = await login("btu-t-0002@example.org", accounts.get("btu-t-0002@example.org"));
  const html = await (await get("/dashboard", s2.cookie)).text();
  assert.ok(html.includes('data-testid="update-failed"'));
  assert.ok(html.includes("V2"), "still on V2");
  const d = db();
  const cur = d
    .prepare(`SELECT v.version_no, v.pdf_sha256 FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
              WHERE p.passport_id = 'BTU-AI-000126' AND v.status = 'CURRENT'`)
    .get();
  d.close();
  assert.equal(cur.version_no, 2);
  assert.equal(sha256(Buffer.from(await (await get("/api/passport/pdf", s2.cookie)).arrayBuffer())), cur.pdf_sha256);

  // the next import with working assets generates V3; it waits for registration, so V2 stays current
  assert.match(importWorkbook(edited), /versions generated 1/);
  const html2 = await (await get("/dashboard", s2.cookie)).text();
  assert.ok(!html2.includes('data-testid="update-failed"'));
  assert.ok(html2.includes('data-testid="awaiting-registration"'));
  assert.ok(html2.includes("Current"));
});

test("a workbook student without a login can't sign in until a login is created for them", async () => {
  const edited = path.join(dataDir, "new-student.xlsx");
  run("python3", ["-c", `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1]); ws = wb["Passport Skill Records"]
ws.insert_rows(65)
vals = ["BTU-T-0099", "Test", "Newcomer", "btu-t-0099@example.org", "Information Technologies", "Bachelor's",
        None, None, "Active", "REC-0903", "SKL-001", "AI Literacy", "AI Skill", "BDG-AI-001",
        ws.cell(5, 15).value, "2026-10-20", "NOT SYNCED"]
for c, v in enumerate(vals, 1): ws.cell(65, c).value = v
wb.save(sys.argv[2])`, WORKBOOK, edited]);
  const out = importWorkbook(edited);
  assert.match(out, /PASSPORT_PENDING/);
  const attempt = await login("btu-t-0099@example.org", "anything");
  assert.match(attempt.location, /error=invalid/, "knowing the email is not enough");

  run("npx", ["tsx", "scripts/create-login.ts", "btu-t-0099@example.org"]);
  readAccounts();
  const s = await login("btu-t-0099@example.org", accounts.get("btu-t-0099@example.org"));
  const html = await (await get("/dashboard", s.cookie)).text();
  assert.ok(html.includes("Your passport has not been generated yet"));
  assert.ok(html.includes('data-testid="pending-awards"'), "pending state explains the recorded skill");
  assert.equal((await get("/api/passport/pdf", s.cookie)).status, 404, "no fallback document");
});

test("a new passport's first version waits for registration and nothing is served before it is issued", async () => {
  const edited = path.join(dataDir, "new-passport.xlsx");
  run("python3", ["-c", `
import openpyxl, sys, datetime
wb = openpyxl.load_workbook(sys.argv[1]); ws = wb["Passport Skill Records"]
ws.insert_rows(65)
vals = ["BTU-T-0098", "Sample", "Firstissue", "btu-t-0098@example.org", "Information Technologies", "Bachelor's",
        "BTU-AI-000900", datetime.date(2026, 10, 1), "Active", "REC-0904", "SKL-001", "AI Literacy", "AI Skill", "BDG-AI-001",
        ws.cell(5, 15).value, "2026-10-20", "NOT SYNCED"]
for c, v in enumerate(vals, 1): ws.cell(65, c).value = v
wb.save(sys.argv[2])`, WORKBOOK, edited]);
  const out = importWorkbook(edited);
  assert.match(out, /passports created 1, versions generated 1/);
  assert.match(out, /0 issued with blockchain registration/);
  run("npx", ["tsx", "scripts/create-login.ts", "btu-t-0098@example.org"]);
  readAccounts();
  const s = await login("btu-t-0098@example.org", accounts.get("btu-t-0098@example.org"));
  const html = (await (await get("/dashboard", s.cookie)).text()).replaceAll("<!-- -->", "");
  assert.ok(html.includes('data-testid="no-issued-version"'));
  assert.ok(html.includes("V1 has been generated and is waiting for blockchain registration"));
  assert.equal((await get("/api/passport/pdf", s.cookie)).status, 404);
  assert.equal((await get("/api/passport/pdf?v=1", s.cookie)).status, 404);
});
