// Stage 6: the finished student dashboard and the staff admin area, end to end on a local Hardhat
// devnet (real transactions, chain id 31337; not a public network). Run after `npm run build` and
// `cd chain && npm install`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3921;
const RPC_PORT = 8621;
const BASE = `http://127.0.0.1:${PORT}`;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const WORKBOOK = path.resolve(
  process.env.BTU_WORKBOOK ?? "samples/demo/workbook.xlsx",
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s6-"));
const key = () => "0x" + randomBytes(32).toString("hex"); // fresh keys, in memory only
const adminKey = key();
const issuerKey = key();
const rogueKey = key(); // funded but never authorised as an issuer
let env = { ...process.env, DATA_DIR: dataDir };
let server, node;
const accounts = new Map();
const S1 = "btu-t-0001@example.org"; // BTU-AI-000125
const S2 = "btu-t-0002@example.org"; // BTU-AI-000126
const OPERATOR = "ops.demo@staff.example.org";
const VIEWER = "viewer.demo@staff.example.org";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

function run(cmd, args, extraEnv = {}, ok = [0]) {
  const r = spawnSync(cmd, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
  assert.ok(ok.includes(r.status), `${cmd} ${args.join(" ")} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const rpc = async (method, params = []) =>
  (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const address = (k) =>
  run("python3", ["-c", "import sys; from eth_account import Account; print(Account.from_key(sys.argv[1]).address)", k]).trim();
const db = () => new Database(path.join(dataDir, "portal.db"), { readonly: true });
const query = (sql, ...a) => { const d = db(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const current = (pid) =>
  query(`SELECT v.* FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
          WHERE p.passport_id = ? AND v.status = 'CURRENT'`, pid)[0];
const readAccounts = () => {
  for (const line of fs.readFileSync(path.join(dataDir, "dev-credentials.txt"), "utf8").split("\n")) {
    const [email, password] = line.split("\t");
    if (email && password && !email.startsWith("#")) accounts.set(email, password);
  }
};
const flat = (html) => html.replaceAll("<!-- -->", "");

async function waitFor(url, init) {
  for (let i = 0; i < 120; i++) {
    try {
      return await fetch(url, init);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`${url} did not start`);
}

async function signIn(kind, email, password) {
  const res = await fetch(`${BASE}${kind === "staff" ? "/api/admin/login" : "/api/auth/login"}`, {
    method: "POST", body: new URLSearchParams({ email, password }), redirect: "manual",
  });
  const name = kind === "staff" ? "bdp_staff=" : "bdp_session=";
  const cookie = (res.headers.getSetCookie().find((c) => c.startsWith(name)) ?? "").split(";")[0];
  return { status: res.status, location: res.headers.get("location"), cookie };
}
const get = (url, cookie) => fetch(`${BASE}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const retry = (cookie, passport, reason = "test retry", headers = {}) =>
  fetch(`${BASE}/api/admin/retry`, {
    method: "POST", redirect: "manual", body: new URLSearchParams({ passport, reason }),
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
const workerRetry = (extra) => run("python3", ["-m", "worker", "retry"], extra, [0, 1]);

before(async () => {
  node = spawn(path.resolve("chain/node_modules/.bin/hardhat"), ["node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)], {
    cwd: path.resolve("chain"), stdio: "ignore",
  });
  await waitFor(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const admin = address(adminKey);
  const issuer = address(issuerKey);
  for (const a of [admin, issuer, address(rogueKey)]) await rpc("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
  const registry = JSON.parse(run("python3", ["-m", "worker", "chain", "deploy", "--rpc", RPC], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey })).registry;
  run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", issuer,
    "--label", "BTU hackathon TEST issuer"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  const anchorPath = path.join(dataDir, "trust-anchor.json");
  run("python3", ["-m", "worker", "chain", "anchor", "--chain-id", "31337", "--network", "local Hardhat devnet",
    "--registry", registry, "--admin", admin, "--issuer", `${issuer}=BTU hackathon TEST issuer`, "--out", anchorPath]);
  env = { ...env, PASSPORT_CHAIN_RPC_URL: RPC, PASSPORT_CHAIN_ID: "31337", PASSPORT_CHAIN_NETWORK: "local Hardhat devnet",
    PASSPORT_REGISTRY_ADDRESS: registry, PASSPORT_CHAIN_CONFIRMATIONS: "1", PASSPORT_TRUST_ANCHOR: anchorPath };

  run("npx", ["tsx", "scripts/seed.ts"]);
  // student 1 gets a registered V3 (V1, V2 come from the stage 1 seed and are not on a chain)
  const one = path.join(dataDir, "one.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, one, "BTU-T-0001", "REC-0971"]);
  assert.match(run("python3", ["-m", "worker", "import", "--xlsx", one], { PASSPORT_ISSUER_PRIVATE_KEY: issuerKey }),
    /1 issued with blockchain registration/);
  // a sheet with problems: a malformed Student ID, a duplicated Record ID, and a new skill that isn't
  // confirmed yet (no confirmation column + HOLD policy, so only rows not accepted before are held)
  const problems = path.join(dataDir, "problems.xlsx");
  run("python3", ["tests/fixtures/problem_rows.py", one, problems]);
  run("python3", ["-m", "worker", "import", "--xlsx", problems], { PASSPORT_CONFIRMATION_WHEN_ABSENT: "HOLD" });
  run("npx", ["tsx", "scripts/create-staff.ts", OPERATOR, "Demo Operator", "OPERATOR"]);
  run("npx", ["tsx", "scripts/create-staff.ts", VIEWER, "Demo Viewer", "VIEWER"]);
  readAccounts();

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: "ignore" });
  await waitFor(`${BASE}/login`);
});

after(() => {
  server?.kill();
  node?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a student lands on their passport page with every required item", async () => {
  const s = await signIn("student", S1, accounts.get(S1));
  assert.equal(s.location, "/dashboard", "straight to the passport page");
  const v3 = current("BTU-AI-000125");
  assert.equal(v3.version_no, 3);
  const html = flat(await (await get("/dashboard", s.cookie)).text());

  assert.ok(html.includes('data-testid="passport-id">BTU-AI-000125<'), "permanent Passport ID");
  assert.ok(html.includes(`data-testid="verification-code">${v3.verification_code}<`), "current version's code");
  assert.match(html, /data-testid="first-issued">[^<]+</);
  assert.match(html, /data-testid="last-updated">[^<]+</);
  assert.ok(html.includes("Download PDF") && html.includes("/api/passport/pdf?download=1"));
  assert.ok(html.includes('data-testid="demo-record"'), "demo data is labelled");

  // authenticity comes from the real check: on-chain, file matches, but a TEST issuer, so not "Authentic"
  assert.match(html, /data-testid="authenticity" data-overall="TEST_ISSUER_ONLY"/);
  assert.match(html, /data-check="File integrity" data-state="MATCH"/);
  assert.match(html, /data-check="BTU issuer identity" data-state="TEST_ISSUER"/);
  assert.match(html, /data-check="Version status" data-state="CURRENT"/);
  assert.ok(!html.includes("Authentic: this is the current BTU passport"));
  assert.ok(html.includes(`href="/verify/${v3.verification_code}"`), "link to public verification");
  assert.ok(html.includes('data-testid="verify-qr"') && html.includes("<svg"), "QR code");

  // version history with dates and labels
  assert.match(html, /data-version="3" data-status="CURRENT"/);
  assert.match(html, /data-version="2" data-status="SUPERSEDED"/);
  assert.match(html, /data-version="1" data-status="SUPERSEDED"/);

  const pdf = Buffer.from(await (await get("/api/passport/pdf?download=1", s.cookie)).arrayBuffer());
  assert.equal(sha256(pdf), v3.pdf_sha256, "download is exactly the current version");
});

test("an older, unregistered version is shown as superseded and never as authentic", async () => {
  const s = await signIn("student", S1, accounts.get(S1));
  const html = flat(await (await get("/dashboard?v=1", s.cookie)).text());
  assert.match(html, /data-testid="authenticity" data-overall="NOT_REGISTERED"/);
  assert.ok(html.includes("Superseded"));
  assert.ok(!html.includes('data-testid="verify-qr"'));
});

test("student-to-passport isolation: student 2 never sees student 1's passport", async () => {
  const s2 = await signIn("student", S2, accounts.get(S2));
  const v3 = current("BTU-AI-000125");
  const html = await (await get("/dashboard", s2.cookie)).text();
  assert.ok(!html.includes("BTU-AI-000125") && !html.includes(v3.verification_code));
  assert.ok(html.includes("BTU-AI-000126"));
  assert.equal((await get("/api/passport/pdf?v=3", s2.cookie)).status, 404);
  const own = Buffer.from(await (await get("/api/passport/pdf", s2.cookie)).arrayBuffer());
  assert.notEqual(sha256(own), v3.pdf_sha256);
});

test("direct URL access without signing in is refused everywhere", async () => {
  for (const url of ["/admin", "/admin/students", "/admin/students/BTU-T-0001", "/admin/issues", "/admin/audit"]) {
    const res = await get(url);
    assert.equal(res.status, 307, url);
    assert.equal(res.headers.get("location"), "/admin/login", url);
  }
  assert.equal((await get("/dashboard")).headers.get("location"), "/login");
  assert.equal((await get("/api/passport/pdf")).status, 401);
  assert.equal((await retry(null, "BTU-AI-000125")).status, 401);
});

test("a student can't get into the admin area by any request", async () => {
  const s = await signIn("student", S1, accounts.get(S1));
  for (const url of ["/admin", "/admin/students/BTU-T-0001", "/admin/audit"]) {
    assert.equal((await get(url, s.cookie)).headers.get("location"), "/admin/login", url);
  }
  // the student's own session token presented as a staff cookie
  const forged = s.cookie.replace("bdp_session=", "bdp_staff=");
  assert.equal((await get("/admin", forged)).headers.get("location"), "/admin/login");
  assert.equal((await retry(forged, "BTU-AI-000125")).status, 401);
  assert.equal((await retry(`${s.cookie}; role=OPERATOR`, "BTU-AI-000125")).status, 401);
  // student credentials don't work on the staff sign-in
  const attempt = await signIn("staff", S1, accounts.get(S1));
  assert.match(attempt.location, /error=invalid/);
  assert.equal(attempt.cookie, "");
});

test("staff accounts can't use the student dashboard, and student sign-in refuses them", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  assert.equal(op.location, "/admin");
  assert.equal((await get("/dashboard", op.cookie)).headers.get("location"), "/login");
  assert.equal((await get("/api/passport/pdf", op.cookie)).status, 401);
  assert.match((await signIn("student", OPERATOR, accounts.get(OPERATOR))).location, /error=invalid/);
});

test("staff search works only with approved identifiers", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const v3 = current("BTU-AI-000125");
  for (const q of ["BTU-T-0001", "btu-t-0001@example.org", "BTU-AI-000125", v3.verification_code, "btu-t-0001"]) {
    const html = await (await get(`/admin/students?q=${encodeURIComponent(q)}`, op.cookie)).text();
    assert.ok(html.includes('data-testid="hits"') && html.includes("/admin/students/BTU-T-0001"), q);
  }
  for (const q of ["BTU-T", "Giorgi", "%", "example.org"]) {
    const html = await (await get(`/admin/students?q=${encodeURIComponent(q)}`, op.cookie)).text();
    assert.ok(!html.includes('data-testid="hits"'), `no listing for ${q}`);
  }
});

test("the student record shows versions, live chain status, sheet rows and their problems", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const html = flat(await (await get("/admin/students/BTU-T-0001", op.cookie)).text());
  const v3 = current("BTU-AI-000125");
  assert.ok(html.includes(v3.verification_code));
  assert.match(html, /data-version="3" data-state="CURRENT"/);
  assert.match(html, /data-testid="live-chain">confirmed, \d+ confirmations, issuer test issuer</);
  assert.ok(html.includes("not registered (stage 1 seed"), "V1/V2 honestly shown as unregistered");
  assert.match(html, /data-record="REC-0971" data-state="ACCEPTED"/);
  assert.ok(!html.includes("scrypt$") && !html.includes(issuerKey.slice(2)), "no secrets");
  assert.ok(query("SELECT 1 FROM audit_log WHERE action = 'STUDENT_RECORD_VIEWED' AND actor_ref = ?", OPERATOR).length > 0);
});

test("import problems: invalid Student IDs and duplicate records are listed as the import found them", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const html = await (await get("/admin/issues", op.cookie)).text();
  const run = query("SELECT MAX(id) AS id FROM import_runs WHERE status = 'COMPLETED'")[0].id;
  const count = (codes) =>
    query(`SELECT COUNT(*) AS n FROM row_issues WHERE run_fk = ? AND code IN (${codes.map(() => "?").join(",")})`, run, ...codes)[0].n;
  const rows = (id) => {
    const m = html.match(new RegExp(`data-testid="${id}".*?</table>`, "s"));
    return m ? (m[0].match(/data-code=/g) ?? []).length : 0;
  };
  const dupCodes = ["DUPLICATE_RECORD_ID", "DUPLICATE_SKILL", "RECORD_OWNER_CHANGED"];
  const idCodes = ["INVALID_STUDENT_ID", "IDENTITY_CONFLICT", "EMAIL_CONFLICT", "DATABASE_CONFLICT", "PASSPORT_ID_CONFLICT", "INVALID_PASSPORT_ID"];
  assert.ok(count(dupCodes) > 0 && count(idCodes) > 0, "the BTU test workbook has both kinds of problem");
  assert.equal(rows("duplicates"), count(dupCodes));
  assert.equal(rows("invalid-ids"), count(idCodes));
});

test("a VIEWER can look but can't retry, and the denied attempt is audited", async () => {
  const vw = await signIn("staff", VIEWER, accounts.get(VIEWER));
  const html = await (await get("/admin/students/BTU-T-0001", vw.cookie)).text();
  assert.ok(html.includes('data-testid="staff-role">VIEWER<'));
  assert.ok(!html.includes('data-testid="retry-button"'));
  const before = query("SELECT COUNT(*) AS n FROM retry_requests")[0].n;
  assert.equal((await retry(vw.cookie, "BTU-AI-000125")).status, 403);
  assert.equal(query("SELECT COUNT(*) AS n FROM retry_requests")[0].n, before);
  assert.ok(query("SELECT 1 FROM audit_log WHERE action = 'RETRY_DENIED' AND actor_ref = ?", VIEWER).length > 0);
});

test("a cross-site retry post is refused", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  assert.equal((await retry(op.cookie, "BTU-AI-000125", "x", { origin: "https://evil.example" })).status, 403);
});

test("failed update recovery: generation fails, the old version stays, a staff retry fixes it", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const s2 = await signIn("student", S2, accounts.get(S2));
  const v2 = current("BTU-AI-000126");
  const wb = path.join(dataDir, "s2.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, wb, "BTU-T-0002", "REC-0972"]);
  // the BTU template assets are unavailable, so the PDF can't be generated
  assert.match(run("python3", ["-m", "worker", "import", "--xlsx", wb],
    { PASSPORT_ISSUER_PRIVATE_KEY: issuerKey, PASSPORT_ASSETS_DIR: path.join(dataDir, "missing") }), /generation failures 1/);

  assert.equal(current("BTU-AI-000126").pdf_sha256, v2.pdf_sha256, "previous valid passport still current");
  const dash = await (await get("/dashboard", s2.cookie)).text();
  assert.ok(dash.includes('data-testid="update-failed"'));
  const overview = await (await get("/admin", op.cookie)).text();
  assert.ok(overview.includes("BTU-AI-000126") && overview.includes("Accepted skills not in a version yet"));

  const sources = query("SELECT record_id, state FROM source_records ORDER BY record_id");
  const awards = query("SELECT COUNT(*) AS n FROM skill_awards")[0].n;

  // queue a retry; a second one while it is open is refused
  const res = await retry(op.cookie, "BTU-AI-000126", "assets restored");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/admin/students/BTU-T-0002?retry=queued");
  assert.equal((await retry(op.cookie, "BTU-AI-000126", "again")).status, 409);

  const out = workerRetry({ PASSPORT_ISSUER_PRIVATE_KEY: issuerKey });
  assert.match(out, /"state": "DONE"/);
  const v3 = current("BTU-AI-000126");
  assert.equal(v3.version_no, 3);
  assert.ok(v3.chain_tx_hash, "registered on the chain");
  assert.deepEqual(query("SELECT record_id, state FROM source_records ORDER BY record_id"), sources, "no source record changed state");
  assert.equal(query("SELECT COUNT(*) AS n FROM skill_awards")[0].n, awards, "no skill was added or confirmed by the retry");

  const html = flat(await (await get("/dashboard", s2.cookie)).text());
  assert.ok(!html.includes('data-testid="update-failed"'));
  assert.match(html, /data-version="3" data-status="CURRENT"/);
  assert.match(html, /data-version="2" data-status="SUPERSEDED"/);
  assert.equal((await retry(op.cookie, "BTU-AI-000126", "nothing left")).status, 409, "nothing to retry now");

  const actions = query("SELECT action FROM audit_log a JOIN passports p ON p.id = a.passport_fk WHERE p.passport_id = 'BTU-AI-000126' ORDER BY a.id").map((r) => r.action);
  for (const a of ["GENERATION_FAILED", "RETRY_REQUESTED", "VERSION_GENERATED", "VERSION_ISSUED", "RETRY_DONE"]) assert.ok(actions.includes(a), a);
});

test("a retry whose registration fails keeps the current version and can be retried again", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const s2 = await signIn("student", S2, accounts.get(S2));
  const wb = path.join(dataDir, "s2b.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", path.join(dataDir, "s2.xlsx"), wb, "BTU-T-0002", "REC-0973"]);
  assert.match(run("python3", ["-m", "worker", "import", "--xlsx", wb]), /1 waiting for registration/); // no issuer key
  const v3 = current("BTU-AI-000126");

  assert.equal((await retry(op.cookie, "BTU-AI-000126", "register V4")).status, 303);
  // signed with a key the registry never authorised: preflight refuses, nothing is issued
  assert.match(workerRetry({ PASSPORT_ISSUER_PRIVATE_KEY: rogueKey }), /"state": "FAILED"/);
  assert.equal(current("BTU-AI-000126").id, v3.id, "V3 is still the valid passport");
  const html = flat(await (await get("/dashboard", s2.cookie)).text());
  assert.ok(html.includes('data-testid="awaiting-registration"'));
  assert.ok(html.includes("V3 remains your valid passport"));
  const admin = flat(await (await get("/admin/students/BTU-T-0002", op.cookie)).text());
  assert.match(admin, /data-state="FAILED"/);
  assert.match(admin, /data-version="4" data-state="AWAITING_REGISTRATION"/);

  assert.equal((await retry(op.cookie, "BTU-AI-000126", "with the right key")).status, 303);
  assert.match(workerRetry({ PASSPORT_ISSUER_PRIVATE_KEY: issuerKey }), /"state": "DONE"/);
  assert.equal(current("BTU-AI-000126").version_no, 4);
});

test("held and rejected skills stay as they are: no admin route can confirm a skill", async () => {
  const held = query("SELECT record_id, state FROM source_records WHERE state IN ('HELD', 'INVALID')");
  assert.ok(held.some((r) => r.record_id === "REC-0983" && r.state === "HELD"), "the unconfirmed skill is still held");
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const page = flat(await (await get("/admin/students/BTU-T-0003", op.cookie)).text());
  assert.match(page, /data-record="REC-0983" data-state="HELD"/);
  assert.ok(!page.includes('data-testid="retry-button"'), "nothing to retry: a held skill isn't a failure");
  const awarded = new Set(query("SELECT record_id FROM skill_awards").map((r) => r.record_id));
  for (const r of held) assert.ok(!awarded.has(r.record_id), r.record_id);
  // the only state-changing admin endpoints are sign-in, sign-out, retry, and (subject stage 03) adding a
  // synthetic student and entering subject marks; none of them touches sheet records, skills or versions
  const routes = fs.readdirSync(path.resolve("src/app/api/admin")).sort();
  assert.deepEqual(routes, ["login", "logout", "marks", "retry", "students"]);
  for (const [route, libs] of [["retry", []], ["students", ["src/lib/students.ts"]], ["marks", ["src/lib/subjects.ts"]]]) {
    for (const f of [`src/app/api/admin/${route}/route.ts`, ...libs]) {
      const src = fs.readFileSync(path.resolve(f), "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
      assert.ok(!/source_records|skill_awards|passport_versions/.test(src), f);
    }
  }
});

test("the audit log records issuance and staff actions, can't be edited, and holds no secrets", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const html = await (await get("/admin/audit", op.cookie)).text();
  for (const a of ["STAFF_LOGIN", "VERSION_ISSUED", "IMPORT_COMPLETED", "RETRY_REQUESTED", "RETRY_FAILED", "RETRY_DONE", "STAFF_CREATED"]) {
    assert.ok(html.includes(`data-action="${a}"`), a);
  }
  const d = new Database(path.join(dataDir, "portal.db"));
  assert.throws(() => d.prepare("UPDATE audit_log SET action = 'X'").run(), /never changed/);
  assert.throws(() => d.prepare("DELETE FROM audit_log").run(), /never deleted/);
  const dump = JSON.stringify(d.prepare("SELECT * FROM audit_log").all());
  d.close();
  for (const secret of [accounts.get(OPERATOR), accounts.get(VIEWER), accounts.get(S1), issuerKey.slice(2), rogueKey.slice(2)]) {
    assert.ok(!dump.includes(secret));
  }
});

test("screenshots of the dashboard and admin pages (only when SCREENSHOT_DIR is set)", { skip: !process.env.SCREENSHOT_DIR }, async () => {
  const { chromium } = await import(path.join(process.env.PLAYWRIGHT_MODULE_DIR ?? spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim(), "playwright/index.mjs"));
  const browser = await chromium.launch();
  const shoot = async (cookie, pages) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    const [name, value] = cookie.split("=");
    await ctx.addCookies([{ name, value, url: BASE }]);
    const page = await ctx.newPage();
    for (const [file, url] of pages) {
      await page.goto(`${BASE}${url}`);
      await page.waitForTimeout(1500); // PDF preview renders in the browser
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${file}.png`), fullPage: true });
    }
    await ctx.close();
  };
  await shoot((await signIn("student", S2, accounts.get(S2))).cookie, [["dashboard-student", "/dashboard"]]);
  await shoot((await signIn("staff", OPERATOR, accounts.get(OPERATOR))).cookie, [
    ["admin-overview", "/admin"], ["admin-student", "/admin/students/BTU-T-0002"], ["admin-issues", "/admin/issues"], ["admin-audit", "/admin/audit"],
  ]);
  await browser.close();
});

test("signing out of the admin area ends the staff session", async () => {
  const op = await signIn("staff", OPERATOR, accounts.get(OPERATOR));
  const out = await fetch(`${BASE}/api/admin/logout`, { method: "POST", headers: { cookie: op.cookie }, redirect: "manual" });
  assert.equal(out.headers.get("location"), "/admin/login?signedout=1");
  assert.equal((await get("/admin", op.cookie)).headers.get("location"), "/admin/login");
});
