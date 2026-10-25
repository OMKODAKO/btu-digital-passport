// Stage 1 acceptance tests. Run after `npm run build`:  npm test
// Each run seeds a fresh database in a temporary folder and starts the production server on it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;
const REGISTRY = path.resolve(process.env.SEED_REGISTRY ?? "tests/fixtures/seed/registry.json");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-test-"));
const env = { ...process.env, DATA_DIR: dataDir, SEED_REGISTRY: REGISTRY };
let server;
const accounts = new Map(); // email -> password
const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).passports;
const byEmail = (email) => Object.values(registry).find((p) => p.email === email);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const S1 = "btu-t-0001@example.org"; // Giorgi Kapanadze, BTU-AI-000125, V1 + V2
const S2 = "btu-t-0002@example.org"; // Mariam Beridze, BTU-AI-000126, V1 + V2
const NO_PASSPORT = "demo.nopassport@example.org";

before(async () => {
  const seed = spawnSync("npx", ["tsx", "scripts/seed.ts"], { env, encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  for (const line of fs.readFileSync(path.join(dataDir, "dev-credentials.txt"), "utf8").split("\n")) {
    const [email, password] = line.split("\t");
    if (email && password && !email.startsWith("#")) accounts.set(email, password);
  }
  // Start the Next.js binary directly (not through npx) so that kill() stops the server itself.
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

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    body: new URLSearchParams({ email, password }),
    redirect: "manual",
  });
  const cookie = (res.headers.getSetCookie().find((c) => c.startsWith("bdp_session=")) ?? "").split(";")[0];
  return { status: res.status, location: new URL(res.headers.get("location"), BASE).href, cookie };
}
const get = (url, cookie) => fetch(`${BASE}${url}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const currentHash = (p) => p.versions.find((v) => v.status === "current").pdf_sha256;

for (const [n, email] of [[1, S1], [2, S2]]) {
  test(`${n}. test student ${n} can sign in and sees their own PDF`, async () => {
    const expected = byEmail(email);
    const s = await login(email, accounts.get(email));
    assert.equal(s.status, 303);
    assert.equal(new URL(s.location).pathname, "/dashboard");
    assert.match(s.cookie, /^bdp_session=.+/);

    const page = await get("/dashboard", s.cookie);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(expected.passport_id), "dashboard shows the student's Passport ID");
    assert.ok(html.includes(`${expected.first_name} ${expected.last_name}`) ||
              html.includes(expected.first_name), "dashboard shows the student's name");
    assert.ok(html.includes('data-testid="pdf-viewer"'), "dashboard includes the embedded PDF viewer");

    const pdf = await get("/api/passport/pdf", s.cookie);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(sha256(Buffer.from(await pdf.arrayBuffer())), currentHash(expected), "exact bytes of their current PDF");

    const dl = await get("/api/passport/pdf?download=1", s.cookie);
    assert.match(dl.headers.get("content-disposition"), new RegExp(`attachment; filename="${expected.passport_id}_V2.pdf"`));
    assert.equal(sha256(Buffer.from(await dl.arrayBuffer())), currentHash(expected));
  });
}

test("3. an incorrect password is rejected", async () => {
  const s = await login(S1, "wrong-password-123");
  assert.equal(s.status, 303);
  assert.equal(new URL(s.location).pathname + new URL(s.location).search, "/login?error=invalid");
  assert.equal(s.cookie, "", "no session cookie");
  const page = await get(s.location.replace(/^https?:\/\/[^/]+/, ""));
  assert.ok((await page.text()).includes("The email or password is incorrect"));
});

test("4. an unknown email is rejected", async () => {
  const s = await login("nobody@example.org", accounts.get(S1));
  assert.equal(new URL(s.location).search, "?error=invalid");
  assert.equal(s.cookie, "");
  const empty = await login(S1, "");
  assert.equal(new URL(empty.location).search, "?error=missing");
});

test("5. student 1 cannot reach student 2's PDF by changing the URL or request", async () => {
  const s1 = await login(S1, accounts.get(S1));
  const own = new Set(byEmail(S1).versions.map((v) => v.pdf_sha256));
  const s2Hashes = new Set(byEmail(S2).versions.map((v) => v.pdf_sha256));
  const s2 = byEmail(S2);
  const attempts = [
    `/api/passport/pdf?passport_id=${s2.passport_id}`,
    `/api/passport/pdf?student_id=${s2.student_id}`,
    `/api/passport/pdf?email=${encodeURIComponent(S2)}`,
    `/api/passport/pdf?path=passports/${s2.passport_id}/${path.basename(s2.versions[0].pdf_path)}`,
    `/api/passport/pdf?v=1`,
    `/api/passport/pdf?v=2`,
    `/api/passport/pdf?v=3`,
    `/api/passport/pdf?v=../../${s2.passport_id}`,
    `/api/passport/pdf/${s2.passport_id}`,
    `/dashboard?v=1&passport_id=${s2.passport_id}`,
  ];
  for (const url of attempts) {
    const res = await fetch(`${BASE}${url}`, {
      headers: { cookie: s1.cookie, "x-student-id": s2.student_id, "x-passport-id": s2.passport_id },
      redirect: "manual",
    });
    const body = Buffer.from(await res.arrayBuffer());
    if (res.headers.get("content-type") === "application/pdf") {
      const h = sha256(body);
      assert.ok(own.has(h), `${url} returned a PDF that is not student 1's`);
      assert.ok(!s2Hashes.has(h), `${url} leaked student 2's PDF`);
    } else {
      // The attacker's own query string is echoed back in the page's router data, so look for
      // student 2's data that was never in the request: their surname and verification codes.
      const text = body.toString("latin1");
      for (const secret of [s2.last_name, ...s2.versions.map((v) => v.verification_code)]) {
        assert.ok(!text.includes(secret), `${url} reveals student 2's ${secret}`);
      }
    }
  }
  // Explicit expectations for the two version numbers student 1 does not have
  assert.equal((await get("/api/passport/pdf?v=3", s1.cookie)).status, 404);
  // A login form posted from another site is refused
  const cross = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", body: new URLSearchParams({ email: S1, password: accounts.get(S1) }),
    headers: { origin: "https://evil.example" }, redirect: "manual",
  });
  assert.equal(cross.status, 403);
});

test("6. signing out blocks further access, even with the old cookie", async () => {
  const s = await login(S1, accounts.get(S1));
  assert.equal((await get("/dashboard", s.cookie)).status, 200);
  const out = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie: s.cookie }, redirect: "manual" });
  assert.equal(out.status, 303);
  assert.match(out.headers.getSetCookie().join(";"), /bdp_session=;/);
  const page = await get("/dashboard", s.cookie);
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location"), BASE).pathname, "/login");
  assert.equal((await get("/api/passport/pdf", s.cookie)).status, 401);
  assert.equal((await get("/dashboard")).status, 307, "no cookie at all is redirected too");
});

test("7. a missing passport or missing PDF gives a clear message, never another document", async () => {
  const demo = await login(NO_PASSPORT, accounts.get(NO_PASSPORT));
  const html = await (await get("/dashboard", demo.cookie)).text();
  assert.ok(html.includes("Your passport has not been generated yet"));
  assert.ok(!html.includes("pdf-viewer"));
  const pdf = await get("/api/passport/pdf", demo.cookie);
  assert.equal(pdf.status, 404);
  assert.notEqual(pdf.headers.get("content-type"), "application/pdf");

  // Remove student 2's stored current PDF and check nothing else is served instead.
  const s2 = byEmail(S2);
  const cur = s2.versions.find((v) => v.status === "current");
  const stored = path.join(dataDir, "storage", "passports", s2.passport_id, `V${cur.version}-${cur.verification_code}.pdf`);
  fs.renameSync(stored, `${stored}.moved`);
  try {
    const s = await login(S2, accounts.get(S2));
    const page = await (await get("/dashboard", s.cookie)).text();
    assert.ok(page.includes("The PDF file is missing"));
    assert.ok(!page.includes("pdf-viewer"));
    const r = await get("/api/passport/pdf", s.cookie);
    assert.equal(r.status, 404);
    assert.notEqual(r.headers.get("content-type"), "application/pdf");

    // A file whose bytes changed is refused too (integrity check against the recorded hash).
    fs.writeFileSync(stored, Buffer.concat([fs.readFileSync(`${stored}.moved`), Buffer.from("\n%tampered")]));
    const t = await get("/api/passport/pdf", s.cookie);
    assert.equal(t.status, 500);
    assert.notEqual(t.headers.get("content-type"), "application/pdf");
    fs.rmSync(stored);
  } finally {
    fs.renameSync(`${stored}.moved`, stored);
  }
});

test("extra: every seeded account sees only its own passport", async () => {
  for (const p of Object.values(registry)) {
    const s = await login(p.email, accounts.get(p.email));
    const html = await (await get("/dashboard", s.cookie)).text();
    assert.ok(html.includes(p.passport_id), p.email);
    const others = Object.values(registry).filter((o) => o.passport_id !== p.passport_id);
    for (const o of others) assert.ok(!html.includes(o.passport_id), `${p.email} page mentions ${o.passport_id}`);
    const pdf = Buffer.from(await (await get("/api/passport/pdf", s.cookie)).arrayBuffer());
    assert.equal(sha256(pdf), currentHash(p), p.email);
  }
});

test("extra: no password hashes or server paths in the browser bundle", () => {
  const dir = path.resolve(".next/static");
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js"));
  for (const f of files) {
    const js = fs.readFileSync(path.join(dir, f), "utf8");
    for (const needle of ["scrypt$", "auth_credentials", "password_hash", "dev-credentials", "better-sqlite3"]) {
      assert.ok(!js.includes(needle), `${f} contains ${needle}`);
    }
  }
});
