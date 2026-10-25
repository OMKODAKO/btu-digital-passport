import { createHash } from "node:crypto";
import fs from "node:fs";
import { createPublicClient, getAddress, http, isAddress, parseAbi, parseAbiItem, type Hex } from "viem";
import { getDb } from "./db";

/**
 * Public verification of one passport version, run on the server only.
 *
 * Each check has its own state, and they are never merged into one "authentic" flag unless every
 * required check passed. Anything that can't be completed (RPC down, trust anchor unreachable) is
 * reported as unavailable, and the overall result fails closed.
 */

export const CODE_PATTERN = /^BTU-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Only the functions the verifier reads; tests check them against chain/build/PassportRegistry.json.
export const REGISTRY_ABI = parseAbi([
  "function admin() view returns (address)",
  "function getRecord(bytes32 codeKey) view returns ((bytes32 pdfSha256, bytes32 passportRef, uint32 versionNo, address issuer, uint64 registeredAt, uint64 blockNumber))",
  "function versionsOf(bytes32 passportRef) view returns (bytes32[])",
  "function issuer(address account) view returns ((bool active, bool testOnly, uint64 authorisedAt, uint64 revokedAt, string label))",
]);
export const REGISTERED_EVENT = parseAbiItem(
  "event VersionRegistered(bytes32 indexed codeKey, bytes32 indexed passportRef, address indexed issuer, uint32 versionNo, bytes32 pdfSha256)",
);

export type RecordState = "FOUND" | "NOT_FOUND" | "UNAVAILABLE";
export type ChainState = "CONFIRMED" | "PENDING" | "NONE" | "UNAVAILABLE";
export type FileState = "MATCH" | "MISMATCH" | "NOT_PROVIDED" | "NOT_CHECKED";
export type IssuerState = "VERIFIED_BTU" | "TEST_ISSUER" | "NOT_VERIFIED" | "UNAVAILABLE";
export type VersionState = "CURRENT" | "SUPERSEDED" | "UNKNOWN";
export type Overall =
  | "AUTHENTIC_CURRENT"
  | "AUTHENTIC_HISTORICAL"
  | "RECORD_VALID_FILE_NOT_CHECKED"
  | "TEST_ISSUER_ONLY"
  | "PENDING_CONFIRMATION"
  | "NOT_VERIFIED"
  | "UNAVAILABLE";

export type VerificationResult = {
  code: string;
  overall: Overall;
  record: RecordState;
  chain: ChainState;
  file: FileState;
  issuer: IssuerState;
  version: VersionState;
  notes: string[];
  evidence: {
    passportId: string | null; // from BTU's records, to match against the document
    versionNo: number | null;
    registeredAt: string | null;
    network: string | null;
    chainId: number | null;
    registry: string | null;
    blockNumber: number | null;
    confirmations: number | null;
    requiredConfirmations: number;
    txHash: string | null;
    issuerAddress: string | null;
    issuerLabel: string | null;
    recordedSha256: string | null;
    uploadedSha256: string | null;
  };
};

type Anchor = {
  status?: string;
  chain_id?: number;
  network?: string;
  registry?: string;
  registry_admin?: string;
  issuers?: { address?: string; label?: string; test_only?: boolean }[];
};

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export function normaliseCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  return CODE_PATTERN.test(code) ? code : null;
}

let anchorCache: { at: number; source: string; version: number; value: Anchor } | null = null;
async function loadAnchor(): Promise<Anchor | null> {
  const source = process.env.PASSPORT_TRUST_ANCHOR ?? "";
  if (!source) return null;
  const remote = source.startsWith("https://");
  let version = 0;
  try {
    version = remote ? 0 : fs.statSync(/* turbopackIgnore: true */ source).mtimeMs; // a changed file is re-read
  } catch {
    return null;
  }
  if (anchorCache && anchorCache.source === source && anchorCache.version === version && Date.now() - anchorCache.at < 60_000)
    return anchorCache.value;
  try {
    const value = remote
      ? ((await (await fetch(source, { signal: AbortSignal.timeout(8000) })).json()) as Anchor)
      : (JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ source, "utf8")) as Anchor);
    anchorCache = { at: Date.now(), source, version, value };
    return value;
  } catch {
    return null;
  }
}

function passportIdFor(code: string): string | null {
  try {
    const row = getDb()
      .prepare(
        `SELECT p.passport_id AS id FROM passport_versions v JOIN passports p ON p.id = v.passport_fk
          WHERE v.verification_code = ?`,
      )
      .get(code) as { id: string } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function verifyVersion(code: string, upload: Uint8Array | null): Promise<VerificationResult> {
  const required = Math.max(1, Number(process.env.PASSPORT_CHAIN_CONFIRMATIONS ?? 3) || 3);
  const r: VerificationResult = {
    code,
    overall: "UNAVAILABLE",
    record: "UNAVAILABLE",
    chain: "UNAVAILABLE",
    file: upload ? "NOT_CHECKED" : "NOT_PROVIDED",
    issuer: "UNAVAILABLE",
    version: "UNKNOWN",
    notes: [],
    evidence: {
      passportId: null, versionNo: null, registeredAt: null, network: null, chainId: null, registry: null,
      blockNumber: null, confirmations: null, requiredConfirmations: required, txHash: null, issuerAddress: null,
      issuerLabel: null, recordedSha256: null, uploadedSha256: upload ? sha256(upload) : null,
    },
  };

  const anchor = await loadAnchor();
  const rpc = process.env.PASSPORT_CHAIN_RPC_URL ?? "";
  const registry = anchor?.registry ?? process.env.PASSPORT_REGISTRY_ADDRESS ?? "";
  if (!anchor) r.notes.push("BTU's issuer statement (trust anchor) could not be loaded, so the issuer can't be checked.");
  if (!rpc || !isAddress(registry)) {
    r.notes.push("The blockchain connection is not configured.");
    return finish(r);
  }
  r.evidence.registry = getAddress(registry);
  r.evidence.network = anchor?.network ?? process.env.PASSPORT_CHAIN_NETWORK ?? null;

  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 1 }) });
  const codeKey = `0x${sha256(code)}` as Hex;
  try {
    const chainId = await client.getChainId();
    r.evidence.chainId = chainId;
    const expected = anchor?.chain_id ?? Number(process.env.PASSPORT_CHAIN_ID ?? 0);
    if (chainId !== Number(expected)) {
      r.notes.push("The blockchain endpoint is on a different network than BTU's issuer statement names.");
      return finish(r);
    }
    const contract = { address: r.evidence.registry as Hex, abi: REGISTRY_ABI } as const;
    const rec = await client.readContract({ ...contract, functionName: "getRecord", args: [codeKey] });
    if (rec.registeredAt === 0n) {
      r.record = "NOT_FOUND";
      r.chain = "NONE";
      r.file = upload ? "NOT_CHECKED" : "NOT_PROVIDED";
      r.notes.push("No issued passport version has this verification code.");
      return finish(r);
    }
    r.record = "FOUND";
    r.evidence.versionNo = rec.versionNo;
    r.evidence.registeredAt = new Date(Number(rec.registeredAt) * 1000).toISOString();
    r.evidence.blockNumber = Number(rec.blockNumber);
    r.evidence.recordedSha256 = rec.pdfSha256.slice(2);
    r.evidence.issuerAddress = rec.issuer;
    r.evidence.passportId = passportIdFor(code);

    // file integrity: SHA-256 of the uploaded bytes, computed here
    if (upload) r.file = r.evidence.uploadedSha256 === r.evidence.recordedSha256 ? "MATCH" : "MISMATCH";

    // confirmations
    const head = await client.getBlockNumber();
    const confs = Number(head - rec.blockNumber + 1n);
    r.evidence.confirmations = confs;
    r.chain = confs >= required ? "CONFIRMED" : "PENDING";
    try {
      const logs = await client.getLogs({
        address: contract.address, event: REGISTERED_EVENT, args: { codeKey },
        fromBlock: BigInt(process.env.PASSPORT_REGISTRY_FROM_BLOCK ?? 0), toBlock: "latest",
      });
      r.evidence.txHash = logs[0]?.transactionHash ?? null;
    } catch {
      r.evidence.txHash = null; // evidence detail only; the record itself was read from the contract
    }

    // current or superseded, from the chain
    const versions = await client.readContract({ ...contract, functionName: "versionsOf", args: [rec.passportRef] });
    r.version = versions.length && versions[versions.length - 1].toLowerCase() === codeKey ? "CURRENT" : "SUPERSEDED";

    // issuer identity
    const iss = await client.readContract({ ...contract, functionName: "issuer", args: [rec.issuer] });
    r.evidence.issuerLabel = iss.label;
    if (anchor) {
      const admin = await client.readContract({ ...contract, functionName: "admin" });
      const listed = anchor.issuers?.find((i) => same(i.address, rec.issuer));
      const authorisedThen =
        iss.authorisedAt !== 0n && iss.authorisedAt <= rec.registeredAt &&
        (iss.revokedAt === 0n || rec.registeredAt < iss.revokedAt);
      if (!same(admin, anchor.registry_admin) || !listed || !authorisedThen) {
        r.issuer = "NOT_VERIFIED";
        r.notes.push("The record was not written by an issuer that BTU's issuer statement and registry authorise.");
      } else if (anchor.status === "OFFICIAL" && !iss.testOnly && listed.test_only === false) {
        r.issuer = "VERIFIED_BTU";
      } else {
        r.issuer = "TEST_ISSUER";
        r.notes.push("Issued by a TEST issuer. Official BTU issuer verification is still pending.");
      }
    }
  } catch {
    r.notes.push("The blockchain could not be reached or read; the checks below could not all be completed.");
    if (r.record !== "FOUND") r.record = "UNAVAILABLE";
    r.chain = "UNAVAILABLE";
    r.version = "UNKNOWN";
    if (r.issuer !== "NOT_VERIFIED") r.issuer = "UNAVAILABLE";
  }
  return finish(r);
}

function finish(r: VerificationResult): VerificationResult {
  if (r.record === "NOT_FOUND" || r.file === "MISMATCH" || r.issuer === "NOT_VERIFIED") r.overall = "NOT_VERIFIED";
  else if (r.record === "UNAVAILABLE" || r.chain === "UNAVAILABLE" || r.issuer === "UNAVAILABLE" || r.version === "UNKNOWN")
    r.overall = "UNAVAILABLE";
  else if (r.chain === "PENDING") r.overall = "PENDING_CONFIRMATION";
  else if (r.issuer === "TEST_ISSUER") r.overall = "TEST_ISSUER_ONLY";
  else if (r.file === "NOT_PROVIDED") r.overall = "RECORD_VALID_FILE_NOT_CHECKED";
  else if (r.file === "MATCH") r.overall = r.version === "CURRENT" ? "AUTHENTIC_CURRENT" : "AUTHENTIC_HISTORICAL";
  else r.overall = "UNAVAILABLE";
  if (r.version === "SUPERSEDED") r.notes.push("A later version of this passport exists; this one is historical, not current.");
  return r;
}
