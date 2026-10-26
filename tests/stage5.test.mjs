// Stage 5: the public verification page and API, end to end on a local Hardhat devnet (real
// transactions, chain id 31337; not a public network). Run after `npm run build` and `cd chain && npm install`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const PORT = 3920;
const RPC_PORT = 8620;
const BASE = `http://127.0.0.1:${PORT}`;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const WORKBOOK = path.resolve(
  process.env.BTU_WORKBOOK ?? "samples/demo/workbook.xlsx",
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s5-"));
const key = () => "0x" + randomBytes(32).toString("hex"); // fresh keys, in memory only
const adminKey = key();
const issuerKey = key();
const rogueKey = key();
let env = { ...process.env, PASSPORT_PASSWORD_LOGIN: "1", DATA_DIR: dataDir };
let server, node, registry, admin, issuer, anchorPath;
let v3, v4; // student 1's versions: V3 superseded by V4

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const rpc = async (method, params = []) =>
  (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const address = (k) =>
  run("python3", ["-c", "import sys; from eth_account import Account; print(Account.from_key(sys.argv[1]).address)", k]).trim();
const pdfOf = (v) => fs.readFileSync(path.join(dataDir, "storage", v.pdf_storage_key));

function writeAnchor(official) {
  fs.writeFileSync(anchorPath, JSON.stringify({
    schema: "btu-passport-issuer/1", issuer_name: "Business and Technology University (BTU)",
    status: official ? "OFFICIAL" : "TEST", chain_id: 31337, network: "local Hardhat devnet",
    registry, registry_admin: admin,
    issuers: [{ address: issuer, label: "BTU hackathon TEST issuer", test_only: !official }],
  }));
}

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

async function verify(code, pdf, filename = "passport.pdf") {
  const form = new FormData();
  form.set("code", code);
  if (pdf) form.set("pdf", new Blob([pdf], { type: "application/pdf" }), filename);
  const res = await fetch(`${BASE}/api/verify`, { method: "POST", body: form });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

before(async () => {
  node = spawn(path.resolve("chain/node_modules/.bin/hardhat"), ["node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)], {
    cwd: path.resolve("chain"), stdio: "ignore",
  });
  await waitFor(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  admin = address(adminKey);
  issuer = address(issuerKey);
  for (const a of [admin, issuer, address(rogueKey)]) await rpc("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
  registry = JSON.parse(run("python3", ["-m", "worker", "chain", "deploy", "--rpc", RPC], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey })).registry;
  run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", issuer,
    "--label", "BTU hackathon TEST issuer"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  anchorPath = path.join(dataDir, "trust-anchor.json");
  writeAnchor(false);
  env = { ...env, PASSPORT_CHAIN_RPC_URL: RPC, PASSPORT_CHAIN_ID: "31337", PASSPORT_CHAIN_NETWORK: "local Hardhat devnet",
    PASSPORT_REGISTRY_ADDRESS: registry, PASSPORT_CHAIN_CONFIRMATIONS: "1", PASSPORT_TRUST_ANCHOR: anchorPath };

  // seed (stage 1), then two updates for student 1, each registered on-chain: V3, then V4
  run("npx", ["tsx", "scripts/seed.ts"]);
  const one = path.join(dataDir, "one.xlsx");
  const two = path.join(dataDir, "two.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, one, "BTU-T-0001", "REC-0961"]);
  run("python3", ["tests/fixtures/add_skill_row.py", one, two, "BTU-T-0001", "REC-0962"]);
  for (const wb of [one, two]) {
    assert.match(run("python3", ["-m", "worker", "import", "--xlsx", wb], { PASSPORT_ISSUER_PRIVATE_KEY: issuerKey }),
      /1 issued with blockchain registration/);
  }
  const db = new Database(path.join(dataDir, "portal.db"), { readonly: true });
  [v3, v4] = db.prepare(`SELECT v.* FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
                          WHERE p.passport_id = 'BTU-AI-000125' AND v.version_no IN (3, 4) ORDER BY v.version_no`).all();
  db.close();
  assert.equal(v3.status, "SUPERSEDED");
  assert.equal(v4.status, "CURRENT");

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: "ignore" });
  await waitFor(`${BASE}/login`);
});

after(() => {
  server?.kill();
  node?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("the page is public: no login, no cookies, and the QR route pre-fills the code", async () => {
  const page = await fetch(`${BASE}/verify`, { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.equal(page.headers.getSetCookie().length, 0);
  assert.match(await page.text(), /Verify a passport/);
  const qr = await fetch(`${BASE}/verify/${v4.verification_code}`, { redirect: "manual" });
  assert.equal(qr.status, 200);
  assert.ok((await qr.text()).includes(v4.verification_code));
});

test("1. the exact issued PDF passes every check, but a TEST issuer is never shown as BTU", async () => {
  const { status, body } = await verify(v4.verification_code, pdfOf(v4));
  assert.equal(status, 200);
  assert.deepEqual([body.record, body.chain, body.file, body.version], ["FOUND", "CONFIRMED", "MATCH", "CURRENT"]);
  assert.equal(body.issuer, "TEST_ISSUER");
  assert.equal(body.overall, "TEST_ISSUER_ONLY", "not reported as authentic while the issuer is a test issuer");
  assert.equal(body.evidence.uploadedSha256, createHash("sha256").update(pdfOf(v4)).digest("hex"));
  assert.equal(body.evidence.txHash, v4.chain_tx_hash);
  assert.equal(body.evidence.passportId, "BTU-AI-000125");
  const text = JSON.stringify(body);
  for (const secret of ["example.org", "Kapanadze", "Giorgi", "BTU-T-0001", dataDir, "storage"]) {
    assert.ok(!text.includes(secret), `response must not contain ${secret}`);
  }
});

test("1b. (local fixture) with a registry and issuer configured as OFFICIAL, the same checks give Authentic", async () => {
  run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", issuer,
    "--label", "BTU hackathon TEST issuer", "--official"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  writeAnchor(true);
  try {
    const cur = await verify(v4.verification_code, pdfOf(v4));
    assert.equal(cur.body.issuer, "VERIFIED_BTU");
    assert.equal(cur.body.overall, "AUTHENTIC_CURRENT");
    const old = await verify(v3.verification_code, pdfOf(v3));
    assert.equal(old.body.overall, "AUTHENTIC_HISTORICAL");
    const codeOnly = await verify(v4.verification_code, null);
    assert.equal(codeOnly.body.overall, "RECORD_VALID_FILE_NOT_CHECKED", "no file, no claim about a document");
  } finally {
    writeAnchor(false);
    run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", issuer,
      "--label", "BTU hackathon TEST issuer"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  }
});

test("2. a modified PDF fails the file-integrity check", async () => {
  const changed = Buffer.concat([pdfOf(v4), Buffer.from("\n%edited")]);
  const { body } = await verify(v4.verification_code, changed);
  assert.equal(body.record, "FOUND");
  assert.equal(body.file, "MISMATCH");
  assert.equal(body.overall, "NOT_VERIFIED");
  const other = await verify(v4.verification_code, pdfOf(v3)); // a real passport, but not this version
  assert.equal(other.body.file, "MISMATCH");
});

test("3. an unknown verification code is rejected, and a malformed one is refused", async () => {
  const { body } = await verify("BTU-0000-0000-0000", pdfOf(v4));
  assert.deepEqual([body.record, body.chain, body.overall], ["NOT_FOUND", "NONE", "NOT_VERIFIED"]);
  assert.equal(body.evidence.passportId, null);
  for (const bad of ["", "hello", "BTU-AAAA-AAAA", "BTU-IIII-LLLL-OOOO", `${v4.verification_code}x`]) {
    assert.equal((await verify(bad, null)).status, 400, bad);
  }
  assert.equal((await verify(` ${v4.verification_code.toLowerCase()} `, null)).body.record, "FOUND", "case and spaces tolerated");
});

test("4. a superseded PDF is authentic as a historical version, never shown as current", async () => {
  const { body } = await verify(v3.verification_code, pdfOf(v3));
  assert.deepEqual([body.record, body.file, body.version], ["FOUND", "MATCH", "SUPERSEDED"]);
  assert.notEqual(body.overall, "AUTHENTIC_CURRENT");
  assert.ok(body.notes.some((n) => n.includes("historical, not current")));
});

test("5. a record from an issuer BTU does not list does not pass as BTU", async () => {
  // the registry admin authorises an extra address that BTU's trust anchor doesn't name
  run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", address(rogueKey),
    "--label", "Business and Technology University (BTU)"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  const fake = path.join(dataDir, "fake.pdf");
  fs.writeFileSync(fake, Buffer.concat([pdfOf(v4), Buffer.from("\n%forged")]));
  const code = "BTU-R0GE-0000-0001";
  run("python3", ["tests/fixtures/rogue_register.py", RPC, registry, code, fake], { ROGUE_KEY: rogueKey });
  const { body } = await verify(code, fs.readFileSync(fake));
  assert.deepEqual([body.record, body.file], ["FOUND", "MATCH"], "the forger's own record and file agree");
  assert.equal(body.issuer, "NOT_VERIFIED");
  assert.equal(body.overall, "NOT_VERIFIED");
});

test("uploads are validated: size limit and PDF type", async () => {
  const big = Buffer.alloc(10 * 1024 * 1024 + 10, 0x25);
  assert.equal((await verify(v4.verification_code, big)).status, 413);
  assert.equal((await verify(v4.verification_code, Buffer.from("not a pdf at all"), "x.pdf")).status, 400);
  const res = await fetch(`${BASE}/api/verify`, { method: "POST", body: JSON.stringify({ code: v4.verification_code }),
    headers: { "content-type": "application/json" } });
  assert.equal(res.status, 415);
});

test("the verifier's contract interface matches the compiled contract", () => {
  const abi = JSON.parse(fs.readFileSync("chain/build/PassportRegistry.json", "utf8")).abi;
  const outNames = (fn) => abi.find((x) => x.name === fn).outputs[0].components?.map((c) => c.name) ?? [];
  assert.deepEqual(outNames("getRecord"), ["pdfSha256", "passportRef", "versionNo", "issuer", "registeredAt", "blockNumber"]);
  assert.deepEqual(outNames("issuer"), ["active", "testOnly", "authorisedAt", "revokedAt", "label"]);
  assert.ok(abi.some((x) => x.type === "event" && x.name === "VersionRegistered"));
});

test("screenshots of the page (only when SCREENSHOT_DIR is set)", { skip: !process.env.SCREENSHOT_DIR }, async () => {
  const { chromium } = await import(path.join(process.env.PLAYWRIGHT_MODULE_DIR ?? spawnSync("npm", ["root", "-g"], { encoding: "utf8" }).stdout.trim(), "playwright/index.mjs"));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
  const cases = [
    ["verify-exact-pdf", v4.verification_code, pdfOf(v4)],
    ["verify-modified-pdf", v4.verification_code, Buffer.concat([pdfOf(v4), Buffer.from("\n%edited")])],
    ["verify-superseded", v3.verification_code, pdfOf(v3)],
  ];
  for (const [name, code, pdf] of cases) {
    const file = path.join(dataDir, `${name}.pdf`);
    fs.writeFileSync(file, pdf);
    await page.goto(`${BASE}/verify`);
    await page.fill("#code", code);
    await page.setInputFiles("#pdf", file);
    await page.click("button[type=submit]");
    await page.waitForSelector("[data-testid=verdict]");
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`), fullPage: true });
  }
  await browser.close();
});

test("6. when the blockchain is unreachable the result is honestly unavailable, never authentic", async () => {
  node.kill();
  await new Promise((r) => setTimeout(r, 1000));
  const { status, body } = await verify(v4.verification_code, pdfOf(v4));
  assert.equal(status, 200);
  assert.equal(body.overall, "UNAVAILABLE");
  assert.equal(body.chain, "UNAVAILABLE");
  assert.equal(body.issuer, "UNAVAILABLE");
  assert.notEqual(body.file, "MATCH", "no hash comparison without the on-chain record");
});
