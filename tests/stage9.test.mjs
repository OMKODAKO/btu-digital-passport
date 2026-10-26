// The passport booklet on the dashboard: built from the data embedded in the selected version's own PDF (so the
// booklet, the download and "Open in new tab" are always the same version), with the four verification claims kept
// apart and nothing shown as verified that wasn't checked. The page turning itself runs in the browser; this test
// covers what the server renders. Run after `npm run build`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3926;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s9-"));
const env = { ...process.env, DATA_DIR: dataDir, PASSPORT_PASSWORD_LOGIN: "", PASSPORT_DEMO_LOGIN: "1", GOOGLE_CLIENT_ID: "",
  PUBLIC_BASE_URL: "", PASSPORT_ISSUANCE_MODE: "local-demo" };
const S1 = { id: "BTU-T-0001", email: "btu-t-0001@example.org" };
let server, cookie;

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { env, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const query = (sql, ...a) => {
  const d = new Database(path.join(dataDir, "portal.db"), { readonly: true });
  try { return d.prepare(sql).all(...a); } finally { d.close(); }
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const flat = async (res) => (await res.text()).replaceAll("<!-- -->", "");
const get = (url) => fetch(`${BASE}${url}`, { headers: { cookie }, redirect: "manual" });
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`${url} did not start`);
}
/** the booklet's HTML only (it ends where the folded PDF starts) */
const booklet = (html) => html.slice(html.indexOf('data-testid="passport-book"'), html.indexOf('class="pdf-fold"'));
const versions = () =>
  query(`SELECT v.version_no, v.status, v.pdf_sha256, v.verification_code FROM passport_versions v
           JOIN passports p ON p.id = v.passport_fk JOIN students s ON s.id = p.student_fk
          WHERE s.student_id = ? ORDER BY v.version_no`, S1.id);

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  run("python3", ["-m", "worker", "import", "--xlsx", path.resolve("samples/demo/workbook.xlsx")]); // the skill records
  run("python3", ["-m", "worker", "subjects", "load"]);
  run("python3", ["-m", "worker", "grades", "add", "--student", S1.id, "--subject", "SUBJ-VIBE-CODING",
    "Quizzes=14", "Assignments=19", "Agent project=9", "Midterm exam=22", "Final exam=27"]);
  run("python3", ["-m", "worker", "subjects", "publish"]);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"],
    { env, stdio: "ignore" });
  await waitFor(`${BASE}/login`);
  const form = new FormData();
  form.set("student", S1.id);
  const res = await fetch(`${BASE}/api/auth/demo`, { method: "POST", body: form, redirect: "manual" });
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookie, "signed in");
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("the dashboard shows the current version as a closed booklet with every page, beside the PDF actions", async () => {
  const all = versions();
  const cur = all.find((v) => v.status === "CURRENT");
  assert.ok(all.length >= 2 && cur.version_no === all.length, "the subject badge made a new current version");
  const html = await flat(await get("/dashboard"));
  const book = booklet(html);
  assert.ok(book.includes('data-state="closed-front"') && book.includes('data-testid="book-cover"'), "starts closed");
  for (const page of ["Identity", "Academic journey", "Skills", "Evidence", "Verification", "Version record"]) assert.ok(book.includes(page), page);
  assert.ok(book.includes(`V${cur.version_no}`) && book.includes(cur.verification_code));
  // the subject badge, its score and the marks that make it, kept apart from the confirmed skill records
  assert.ok(book.includes("Vibe Coding and AI-Agentic Engineering"), "subject"); assert.ok(book.includes("91.00"), "score"); assert.ok(book.includes("Platinum"), "tier");
  assert.ok(book.includes("14 / 15") && book.includes('data-testid="book-evidence-project"'), "marks are the evidence");
  assert.ok(book.includes("Confirmed skills · BTU skill records"));
  assert.ok(!book.includes(S1.email) && !book.includes(S1.id), "no email or student number in the booklet");
  // the actions still serve exactly this version, and the PDF itself is still on the page
  assert.ok(html.includes('href="/api/passport/pdf"') && html.includes('href="/api/passport/pdf?download=1"'));
  assert.ok(html.includes('data-testid="pdf-viewer"'));
  const pdf = Buffer.from(await (await get("/api/passport/pdf?download=1")).arrayBuffer());
  assert.equal(sha256(pdf), cur.pdf_sha256, "the download is the version the booklet shows");
});

test("an unregistered version claims nothing it can't show: four separate claims, none of them a pass", async () => {
  const html = await flat(await get("/dashboard"));
  for (const [key, state] of [["record", "none"], ["integrity", "partial"], ["chain", "none"], ["official", "none"]]) {
    assert.ok(html.includes(`data-claim="${key}" data-state="${state}"`), `${key} is ${state}`);
  }
  assert.ok(!/data-claim="[a-z]+" data-state="ok"/.test(html), "no claim is shown as verified");
  assert.match(html, /data-testid="authenticity" data-overall="NOT_REGISTERED"/);
});

test("an older version shows that version's own data, not the current one", async () => {
  const v1 = versions()[0];
  const html = await flat(await get("/dashboard?v=1"));
  const book = booklet(html);
  assert.ok(book.includes("Superseded version") && book.includes(v1.verification_code));
  assert.ok(!book.includes("91.00"), "V1 was issued before the subject badge");
  assert.ok(html.includes('href="/api/passport/pdf?v=1&amp;download=1"'));
  const pdf = Buffer.from(await (await get("/api/passport/pdf?v=1&download=1")).arrayBuffer());
  assert.equal(sha256(pdf), v1.pdf_sha256);
});
