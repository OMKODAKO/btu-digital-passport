import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { LOCAL_CHAIN_ID } from "@/lib/explorer";
import { fmtTime, localChain, RESTARTED, txKind, UNREACHABLE, type BlockWithTxs } from "@/lib/local-chain";

export const metadata = { title: "Local blockchain block" };
export const dynamic = "force-dynamic";

/** One block of the LOCAL test chain (Hardhat devnet) and its transactions, read live from the node. */
export default async function LocalBlock({ params }: { params: Promise<{ n: string }> }) {
  const chain = localChain();
  const { n } = await params;
  if (!chain || !/^\d{1,12}$/.test(n)) notFound();
  const number = BigInt(n);

  let block: BlockWithTxs | null = null;
  let latest: bigint | null = null;
  let error: string | null = null;
  try {
    const chainId = await chain.client.getChainId();
    if (chainId !== LOCAL_CHAIN_ID) throw new Error(`chain ${chainId}`);
    latest = await chain.client.getBlockNumber();
    if (number > latest) error = RESTARTED;
    else block = await chain.client.getBlock({ blockNumber: number, includeTransactions: true });
  } catch {
    error = UNREACHABLE;
  }

  return (
    <>
      <AppHeader area="public" home="/verify">
        <a className="appbar-link" href="/verify">Verify a passport</a>
      </AppHeader>
      <main className="page narrow">
        <header className="page-head">
          <p className="eyebrow">Local test chain · ლოკალური სატესტო ბლოკჩეინი</p>
          <h1>Block {n}</h1>
          <p className="muted"><a href="/chain">All blocks</a></p>
        </header>

        {error && <p className="alert error" role="alert" data-testid="block-error">{error}</p>}

        {block && (
          <>
            <section className="card facts" data-testid="local-block">
              <dl>
                <div><dt>Time</dt><dd>{fmtTime(block.timestamp)}</dd></div>
                <div><dt>Confirmations</dt><dd>{latest !== null ? (latest - number + 1n).toString() : "unknown"}</dd></div>
                <div><dt>Block hash</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{block.hash}</dd></div>
                <div><dt>Parent</dt><dd>{number > 0n ? <a href={`/chain/block/${number - 1n}`}>block {(number - 1n).toString()}</a> : "none (first block)"}</dd></div>
                <div><dt>Gas used</dt><dd>{block.gasUsed.toString()}</dd></div>
              </dl>
            </section>
            <section className="card" style={{ marginTop: 16 }}>
              <h2>Transactions ({block.transactions.length})</h2>
              {block.transactions.length === 0 ? (
                <p className="muted">This block has no transactions.</p>
              ) : (
                <table className="table" data-testid="block-txs">
                  <thead><tr><th>Transaction</th><th>What</th><th>From</th></tr></thead>
                  <tbody>
                    {block.transactions.map((tx) => (
                      <tr key={tx.hash}>
                        <td className="mono" style={{ overflowWrap: "anywhere" }}><a href={`/chain/tx/${tx.hash}`}>{tx.hash}</a></td>
                        <td>{txKind(tx, chain.registry)}</td>
                        <td className="mono" style={{ overflowWrap: "anywhere" }}>{tx.from}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="fine" style={{ display: "flex", gap: 16 }}>
                {number > 0n && <a href={`/chain/block/${number - 1n}`}>← Block {(number - 1n).toString()}</a>}
                {latest !== null && number < latest && <a href={`/chain/block/${number + 1n}`}>Block {(number + 1n).toString()} →</a>}
              </p>
            </section>
          </>
        )}
      </main>
    </>
  );
}
