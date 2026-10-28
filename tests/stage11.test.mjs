// The public passport link for a CV (/p/<token>): one permanent random token per passport, shown on the student's
// dashboard; the page needs no sign-in, shows the current version's booklet and verification claims, links to the
// public verification page, and shows no email, student number or older versions. Run after `npm run build`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3927;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s11-"));
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
const flat = async (res) => (await res.text()).replaceAll("<!-- -->", "");
async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { return await fetch(url); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`${url} did not start`);
}
const linkOf = (html) => /data-testid="share-link"[\s\S]*?value="([^"]*\/p\/([A-Za-z0-9_-]{22}))"/.exec(html);

before(async () => {
  run("npx", ["tsx", "scripts/seed.ts"]);
  run("python3", ["-m", "worker", "import", "--xlsx", path.resolve("samples/demo/workbook.xlsx")]);
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

test("the dashboard shows one permanent, unguessable link for the CV", async () => {
  const html = await flat(await fetch(`${BASE}/dashboard`, { headers: { cookie } }));
  const m = linkOf(html);
  assert.ok(m, "the link is on the dashboard");
  const [, , token] = m;
  const pid = query(`SELECT p.passport_id FROM passports p JOIN students s ON s.id = p.student_fk WHERE s.student_id = ?`, S1.id)[0].passport_id;
  assert.ok(!token.includes(pid) && !token.includes(S1.id), "the token is not the Passport ID or student number");
  const again = linkOf(await flat(await fetch(`${BASE}/dashboard`, { headers: { cookie } })));
  assert.equal(again[2], token, "the link never changes");
  assert.equal(query("SELECT COUNT(*) AS n FROM passport_share_links")[0].n, 1, "one token for the one passport viewed");
});

test("the link opens the current passport without signing in, with its skills and a way to verify it", async () => {
  const [, , token] = linkOf(await flat(await fetch(`${BASE}/dashboard`, { headers: { cookie } })));
  const res = await fetch(`${BASE}/p/${token}`, { redirect: "manual" }); // no cookie
  assert.equal(res.status, 200);
  const html = await flat(res);
  const cur = query(`SELECT v.version_no, v.verification_code FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
                       JOIN students s ON s.id = p.student_fk WHERE s.student_id = ? AND v.status = 'CURRENT'`, S1.id)[0];
  assert.ok(html.includes('data-testid="public-passport"') && html.includes('data-testid="passport-book"'), "the booklet");
  assert.ok(html.includes('data-testid="public-skills"') && html.includes('data-testid="claims"'), "skills and the verification claims");
  assert.ok(html.includes(`href="/verify/${cur.verification_code}"`) && html.includes('data-testid="public-verify"'), "verify button");
  assert.ok(!html.includes(S1.email) && !html.includes(S1.id), "no email or student number");
  assert.ok(!html.includes("/dashboard") && !html.includes("/api/passport/pdf"), "nothing from the signed-in area");
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
});

test("anything that isn't an existing token is not found", async () => {
  for (const t of ["AAAAAAAAAAAAAAAAAAAAAA", "BTU-AI-000125", "x".repeat(200), "..%2F..%2Fportal.db"]) {
    assert.equal((await fetch(`${BASE}/p/${t}`)).status, 404, t);
  }
});

test("links can't be changed or removed", () => {
  const d = new Database(path.join(dataDir, "portal.db"));
  try {
    assert.throws(() => d.prepare("UPDATE passport_share_links SET token = 'x'").run(), /append-only/);
    assert.throws(() => d.prepare("DELETE FROM passport_share_links").run(), /append-only/);
  } finally { d.close(); }
});
