// Public block explorers, so anyone can open a passport version's registration transaction.
// Safe for client components: no server-only imports. The local Hardhat devnet has no public explorer, so its
// links open the portal's own page (/chain/tx/<hash>), which reads the transaction live from that devnet.
const EXPLORERS: Record<number, string> = {
  1: "https://etherscan.io",
  11155111: "https://sepolia.etherscan.io",
  137: "https://polygonscan.com",
  80002: "https://amoy.polygonscan.com",
};

export const LOCAL_CHAIN_ID = 31337;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The explorer page of a transaction (a relative portal page on the local devnet), or null for an unknown chain or a malformed hash. */
export function txUrl(chainId: number | null | undefined, txHash: string | null | undefined): string | null {
  if (chainId === LOCAL_CHAIN_ID) return txHash && TX_HASH.test(txHash) ? `/chain/tx/${txHash}` : null;
  const base = chainId ? EXPLORERS[chainId] : undefined;
  return base && txHash && TX_HASH.test(txHash) ? `${base}/tx/${txHash}` : null;
}
