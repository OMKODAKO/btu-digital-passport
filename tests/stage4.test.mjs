// Stage 4 end-to-end on a local Hardhat devnet (real transactions, chain id 31337; not a public network):
// deploy the registry, authorise a TEST issuer, import with the issuer key in the environment, then
// check the dashboard and the command-line verifier. Run after `npm run build` and `cd chain && npm install`.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 3919;
const RPC_PORT = 8619;
const BASE = `http://127.0.0.1:${PORT}`;
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const WORKBOOK = path.resolve(
  process.env.BTU_WORKBOOK ?? "samples/demo/workbook.xlsx",
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdp-s4-"));
const key = () => "0x" + randomBytes(32).toString("hex"); // fresh keys, held in memory only
const adminKey = key();
const issuerKey = key();
let env = { ...process.env, PASSPORT_PASSWORD_LOGIN: "1", DATA_DIR: dataDir };
let server, node, registry, anchorPath;
const accounts = new Map();

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { env: { ...env, ...extraEnv }, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const rpc = async (method, params = []) =>
  (await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const address = (k) => run("python3", ["-c", "import sys; from eth_account import Account; print(Account.from_key(sys.argv[1]).address)", k]).trim();

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

before(async () => {
  node = spawn(path.resolve("chain/node_modules/.bin/hardhat"), ["node", "--hostname", "127.0.0.1", "--port", String(RPC_PORT)], {
    cwd: path.resolve("chain"), stdio: "ignore",
  });
  await waitFor(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
  const admin = address(adminKey);
  const issuer = address(issuerKey);
  for (const a of [admin, issuer]) await rpc("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
  registry = JSON.parse(run("python3", ["-m", "worker", "chain", "deploy", "--rpc", RPC], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey })).registry;
  run("python3", ["-m", "worker", "chain", "set-issuer", "--rpc", RPC, "--registry", registry, "--issuer", issuer,
    "--label", "BTU hackathon TEST issuer"], { PASSPORT_ADMIN_PRIVATE_KEY: adminKey });
  anchorPath = path.join(dataDir, "trust-anchor.json");
  run("python3", ["-m", "worker", "chain", "anchor", "--chain-id", "31337", "--network", "local Hardhat devnet",
    "--registry", registry, "--admin", admin, "--issuer", `${issuer}=BTU hackathon TEST issuer`, "--out", anchorPath]);
  env = { ...env, PASSPORT_CHAIN_RPC_URL: RPC, PASSPORT_CHAIN_ID: "31337", PASSPORT_CHAIN_NETWORK: "local Hardhat devnet",
    PASSPORT_REGISTRY_ADDRESS: registry, PASSPORT_CHAIN_CONFIRMATIONS: "1", PASSPORT_TRUST_ANCHOR: anchorPath };

  run("npx", ["tsx", "scripts/seed.ts"]);
  for (const line of fs.readFileSync(path.join(dataDir, "dev-credentials.txt"), "utf8").split("\n")) {
    const [email, password] = line.split("\t");
    if (email && password && !email.startsWith("#")) accounts.set(email, password);
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: "ignore" });
  await waitFor(`${BASE}/login`);
});

after(() => {
  server?.kill();
  node?.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", redirect: "manual",
    body: new URLSearchParams({ email, password: accounts.get(email) }) });
  return (res.headers.getSetCookie().find((c) => c.startsWith("bdp_session=")) ?? "").split(";")[0];
}

test("a new version is registered on-chain, confirmed, read back, then shown as current", async () => {
  const edited = path.join(dataDir, "new-skill.xlsx");
  run("python3", ["tests/fixtures/add_skill_row.py", WORKBOOK, edited, "BTU-T-0001", "REC-0951"]);
  // without the issuer key there is no registrar: V3 waits
  let out = run("python3", ["-m", "worker", "import", "--xlsx", edited]);
  assert.match(out, /1 waiting for registration/);
  // with it, the waiting version is registered and issued
  out = run("python3", ["-m", "worker", "import", "--xlsx", edited], { PASSPORT_ISSUER_PRIVATE_KEY: issuerKey });
  assert.match(out, /1 issued with blockchain registration/);
  assert.doesNotMatch(out, new RegExp(issuerKey.slice(2)), "the key is never printed");

  const cookie = await login("btu-t-0001@example.org");
  const html = (await (await fetch(`${BASE}/dashboard`, { headers: { cookie } })).text()).replaceAll("<!-- -->", "");
  assert.ok(html.includes('data-testid="chain-record"'));
  assert.ok(html.includes('data-claim="chain"') && html.includes('data-testid="chain-record">Transaction'));
  assert.ok(html.includes('data-claim="official" data-state="pending"'), "test issuer: official BTU issuance is pending");
  const code = html.match(/BTU-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/)[0];
  const pdf = path.join(dataDir, "downloaded.pdf");
  fs.writeFileSync(pdf, Buffer.from(await (await fetch(`${BASE}/api/passport/pdf`, { headers: { cookie } })).arrayBuffer()));

  const verdict = JSON.parse(run("python3", ["-m", "worker", "verify", "--code", code, "--pdf", pdf]));
  assert.equal(verdict.status, "VALID");
  assert.equal(verdict.version_no, 3);
  assert.equal(verdict.latest_version, true);
  assert.equal(verdict.official_btu_issuer, false);

  fs.appendFileSync(pdf, "\n%changed");
  const r = spawnSync("python3", ["-m", "worker", "verify", "--code", code, "--pdf", pdf], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).status, "HASH_MISMATCH");
});
