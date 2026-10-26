// The interactive passport booklet: the public demo at /passport uses only its isolated fixture, the landing page
// links to it, and a signed-in student's dashboard shows a booklet built from their own records (subject marks as
// evidence, sheet skills, the version's status) without their email. The page-turning itself runs in the browser
// and is checked there; this test covers what the server renders. Run after `npm run build`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3926;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s9-"));
const env = { ...process.env, DATA_DIR: dataDir, PASSPORT_PASSWORD_LOGIN: "", PASSPORT_DEMO_LOGIN: "1", GOOGLE_CLIENT_ID: "",
  PUBLIC_BASE_URL: "" };
const S1 = { id: "BTU-T-0001", email: "btu-t-0001@example.org" };
let server;

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { env, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
};
const flat = async (res) => (await res.text()).replaceAll("<!-- -->", "");
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`${url} did not start`);
}
/** the HTML of the element that starts at data-testid="…" up to the next marker */
const between = (html, from, to) => html.slice(html.indexOf(from), to ? html.indexOf(to, html.indexOf(from)) : undefined);

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  run("python3", ["-m", "worker", "subjects", "load"]);
  run("python3", ["-m", "worker", "grades", "add", "--student", S1.id, "--subject", "SUBJ-VIBE-CODING",
    "Quizzes=14", "Assignments=19", "Agent project=9", "Midterm exam=22", "Final exam=27"]);
  run("python3", ["-m", "worker", "grades", "add", "--student", S1.id, "--subject", "SUBJ-PYTHON", "Quizzes=11"]);
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"],
    { env, stdio: "ignore" });
  await waitFor(`${BASE}/passport`);
});

after(() => {
  server?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("the demo booklet starts closed, is labelled as demo on every page and shows no real record", async () => {
  const res = await fetch(`${BASE}/passport`);
  assert.equal(res.status, 200);
  const html = await flat(res);
  assert.ok(html.includes('data-testid="passport-book"') && html.includes('data-state="closed-front"'));
  assert.ok(html.includes('data-testid="book-cover"') && html.includes("Open your passport"));
  assert.equal(html.split('data-testid="book-demo-label"').length - 1, 6, "the demo label is on all six pages");
  assert.ok(html.includes("Demo passport · fictional data") && html.includes("Nika Demo-Beridze"));
  for (const real of ["BTU-AI-", "BTU-T-", "@example.org", "/verify/"]) assert.ok(!html.includes(real), `no ${real} in the demo`);
  for (const page of ["Identity", "Academic journey", "Skills", "Evidence", "Achievements &amp; verification", "About this passport"]) {
    assert.ok(html.includes(page), page);
  }
  assert.ok(html.includes("Academic grade evidence") && html.includes("Practical project evidence"));
  assert.ok(html.includes('aria-label="Next page"') && html.includes('aria-label="Previous page"') && html.includes("Close passport"));
});

test("the landing page links to the demo booklet and still offers sign-in and verification", async () => {
  const html = await flat(await fetch(`${BASE}/`));
  assert.ok(html.includes('href="/passport"') && html.includes('data-testid="open-demo-book"'));
  assert.ok(html.includes('href="/verify"') && html.includes('href="/login"'));
});

test("the dashboard booklet is built from the student's own records, labelled as test data, without their email", async () => {
  const login = await fetch(`${BASE}/api/auth/demo`, { method: "POST", redirect: "manual", body: new URLSearchParams({ student: S1.id }) });
  const cookie = (login.headers.getSetCookie().find((c) => c.startsWith("bdp_session=")) ?? "").split(";")[0];
  const html = await flat(await fetch(`${BASE}/dashboard`, { headers: { cookie } }));
  assert.ok(html.includes('data-testid="dashboard-book"'), "booklet on the dashboard");
  assert.ok(html.includes('data-testid="authenticity"') && html.includes('data-testid="history"'), "the rest of the dashboard is still there");
  const book = between(html, 'data-testid="dashboard-book"', 'class="passport-layout"');
  assert.ok(book.includes("BTU-AI-000125"), "passport reference");
  assert.ok(book.includes("BTU test data"), "test records are labelled");
  assert.ok(!book.includes(S1.email) && !book.includes(S1.id), "no email or student number in the booklet");
  // subject results: Vibe Coding complete (14+19+9+22+27 = 91 -> Platinum), Python in progress
  assert.ok(book.includes("Vibe Coding and AI-Agentic Engineering") && book.includes("91.00"));
  assert.ok(book.includes("Platinum") && book.includes("Programming (Python)") && book.includes("In progress"));
  assert.ok(book.includes("9 / 10") && book.includes("Agent project"), "the first skill's marks are its evidence");
  assert.ok(book.includes("BTU grade record · SUBJ-VIBE-CODING"), "evidence names its source");
  assert.ok(!book.includes("Illustrative") && !book.includes("fictional"), "no demo fixture wording in a student's booklet");
  assert.ok(book.includes("hackathon test data"), "the notes page says what kind of record it is");
  assert.ok(book.includes("Study year") && book.includes("Not recorded"), "missing data is said, not invented");
});
