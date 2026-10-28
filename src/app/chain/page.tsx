import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { LOCAL_CHAIN_ID } from "@/lib/explorer";
import { fmtTime, localChain, short, txKind, UNREACHABLE, type BlockWithTxs } from "@/lib/local-chain";

export const metadata = { title: "Local blockchain explorer" };
export const dynamic = "force-dynamic";

const PER_PAGE = 20;

/**
 * Every block of the LOCAL test chain (Hardhat devnet), newest first, with its transactions, read live from the node:
 * the devnet's stand-in for a public explorer such as Etherscan. ?before=<n> pages back through older blocks.
 */
export default async function LocalChainExplorer({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const chain = localChain();
  if (!chain) notFound();
  const { before } = await searchParams;

  let latest: bigint | null = null;
  let blocks: BlockWithTxs[] = [];
  let error: string | null = null;
  try {
    const chainId = await chain.client.getChainId();
    if (chainId !== LOCAL_CHAIN_ID) throw new Error(`chain ${chainId}`);
    latest = await chain.client.getBlockNumber();
    const top = before && /^\d+$/.test(before) ? (BigInt(before) - 1n < latest ? BigInt(before) - 1n : latest) : latest;
    const numbers: bigint[] = [];
    for (let n = top; n >= 0n && numbers.length < PER_PAGE; n--) numbers.push(n);
    blocks = await Promise.all(numbers.map((n) => chain.client.getBlock({ blockNumber: n, includeTransactions: true })));
  } catch {
    error = UNREACHABLE;
  }
  const oldest = blocks.at(-1)?.number ?? null;
  const txCount = blocks.reduce((n, b) => n + b.transactions.length, 0);

  return (
    <>
      <AppHeader area="public" home="/verify">
        <a className="appbar-link" href="/verify">Verify a passport</a>
      </AppHeader>
      <main className="page">
        <header className="page-head">
          <p className="eyebrow">Local test chain · ლოკალური სატესტო ბლოკჩეინი</p>
          <h1>All blocks</h1>
          <p className="muted">
            Every block of the local Hardhat devnet (chain {LOCAL_CHAIN_ID}) that this demo runs on, newest first, read live
            from the chain. It is a real chain on this computer but not a public one, so Etherscan can&apos;t show it; on
            Sepolia the portal&apos;s links open Etherscan instead.
          </p>
        </header>

        {error && <p className="alert error" role="alert" data-testid="chain-error">{error}</p>}

        {latest !== null && (
          <section className="card facts" data-testid="chain-summary">
            <dl>
              <div><dt>Latest block</dt><dd>{latest.toString()}</dd></div>
              <div><dt>Chain ID</dt><dd>{LOCAL_CHAIN_ID}</dd></div>
              <div><dt>Passport registry</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{chain.registry ?? "not configured"}</dd></div>
              <div><dt>Shown</dt><dd>blocks {oldest?.toString()}–{blocks[0]?.number?.toString()} · {txCount} transaction{txCount === 1 ? "" : "s"}</dd></div>
            </dl>
          </section>
        )}

        {blocks.length > 0 && (
          <section className="card" style={{ marginTop: 16 }}>
            <table className="table" data-testid="chain-blocks">
              <thead><tr><th>Block</th><th>Time</th><th>Transactions</th></tr></thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.number!.toString()} data-testid="chain-block-row">
                    <td><a href={`/chain/block/${b.number}`}>{b.number!.toString()}</a></td>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtTime(b.timestamp)}</td>
                    <td>
                      {b.transactions.length === 0 ? (
                        <span className="muted">none</span>
                      ) : (
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                          {b.transactions.map((tx) => (
                            <li key={tx.hash}>
                              <a className="mono" href={`/chain/tx/${tx.hash}`} data-testid="chain-tx-link">{short(tx.hash)}</a>{" "}
                              <span className="muted">· {txKind(tx, chain.registry)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine" style={{ display: "flex", gap: 16 }}>
              {before && <a href="/chain">Newest blocks</a>}
              {oldest !== null && oldest > 0n && <a href={`/chain?before=${oldest}`} data-testid="chain-older">Older blocks</a>}
            </p>
          </section>
        )}
      </main>
    </>
  );
}
