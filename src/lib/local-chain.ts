/**
 * The local test chain (Hardhat devnet) the demo runs on, for the portal's own block explorer pages (/chain,
 * /chain/block/<n>, /chain/tx/<hash>). A devnet has no public explorer such as Etherscan, so these pages read
 * blocks and transactions live from the node. They exist only while the portal is configured for the local devnet.
 */
import { createPublicClient, getAddress, http, isAddress, toFunctionSelector, type Block, type Transaction } from "viem";
import { LOCAL_CHAIN_ID } from "./explorer";

export type LocalChain = { client: ReturnType<typeof createPublicClient>; registry: `0x${string}` | null };

/** The devnet's client, or null when the portal is not on the local devnet (the pages then answer 404). */
export function localChain(): LocalChain | null {
  const rpc = process.env.PASSPORT_CHAIN_RPC_URL ?? "";
  if (Number(process.env.PASSPORT_CHAIN_ID ?? 0) !== LOCAL_CHAIN_ID || !rpc) return null;
  const registry = process.env.PASSPORT_REGISTRY_ADDRESS ?? "";
  return {
    client: createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 1 }) }),
    registry: isAddress(registry) ? getAddress(registry) : null,
  };
}

export const UNREACHABLE = "The local test chain can't be reached right now. Is the devnet running?";
export const RESTARTED =
  "This isn't on the local test chain. The devnet may have been restarted since (it keeps nothing across a reboot).";

export const fmtTime = (seconds: bigint) =>
  new Date(Number(seconds) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
export const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** What a transaction did, in a few words: a passport registration, a call to the registry, or something else. */
export function txKind(tx: Pick<Transaction, "to" | "input">, registry: string | null): string {
  if (!tx.to) return "contract deployment";
  if (registry && getAddress(tx.to) === getAddress(registry)) {
    return REGISTER_SELECTORS.has(tx.input.slice(0, 10)) ? "passport registration" : "registry administration";
  }
  return tx.input === "0x" ? "transfer" : "contract call";
}

// PassportRegistry.register / registerBatch
const REGISTER_SELECTORS = new Set<string>([
  toFunctionSelector("register(bytes32,bytes32,uint32,bytes32)"),
  toFunctionSelector("registerBatch(bytes32[],bytes32[],uint32[],bytes32[])"),
]);

export type BlockWithTxs = Block<bigint, true>;
