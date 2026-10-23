// Public block explorers, so anyone can open a passport version's registration transaction.
// Safe for client components: no server-only imports. Chains without a public explorer (a local
// devnet) get no link.
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  137: "https://polygonscan.com",
  80002: "https://amoy.polygonscan.com",
};

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The explorer page of a transaction, or null for an unknown chain or a malformed hash. */
export function txUrl(chainId: number | null | undefined, txHash: string | null | undefined): string | null {
  const base = chainId ? EXPLORERS[chainId] : undefined;
  return base && txHash && TX_HASH.test(txHash) ? `${base}/tx/${txHash}` : null;
}
