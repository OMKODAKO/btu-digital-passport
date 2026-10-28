import { notFound } from "next/navigation";
import { createPublicClient, getAddress, http, isAddress, parseEventLogs, type Hex } from "viem";
import AppHeader from "@/components/AppHeader";
import { getDb } from "@/lib/db";
import { LOCAL_CHAIN_ID } from "@/lib/explorer";
import { REGISTRY_ABI, REGISTERED_EVENT } from "@/lib/verify";

export const metadata = { title: "Local blockchain transaction" };
export const dynamic = "force-dynamic";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * A transaction on the LOCAL test chain (Hardhat devnet), read live from that chain. A devnet has no public
 * explorer such as Etherscan, so this page stands in for one: everything shown comes from the chain node itself
 * (transaction, receipt, block, the registry's VersionRegistered events and the issuer entry), and is then compared
 * with the PDF hashes the portal stored. It exists only while the portal is configured for the local devnet.
 */
export default async function LocalTransaction({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const rpc = process.env.PASSPORT_CHAIN_RPC_URL ?? "";
  const registry = process.env.PASSPORT_REGISTRY_ADDRESS ?? "";
  if (Number(process.env.PASSPORT_CHAIN_ID ?? 0) !== LOCAL_CHAIN_ID || !rpc || !TX_HASH.test(hash)) notFound();

  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000, retryCount: 1 }) });
  let data: Awaited<ReturnType<typeof read>> | null = null;
  let error: string | null = null;
  async function read() {
    const chainId = await client.getChainId();
    if (chainId !== LOCAL_CHAIN_ID) throw new Error(`the node answers for chain ${chainId}, not the local devnet`);
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: hash as Hex }),
      client.getTransactionReceipt({ hash: hash as Hex }),
    ]);
    const [block, latest] = await Promise.all([client.getBlock({ blockNumber: receipt.blockNumber }), client.getBlockNumber()]);
    const events = parseEventLogs({ abi: [REGISTERED_EVENT], logs: receipt.logs }).filter(
      (e) => isAddress(registry) && getAddress(e.address) === getAddress(registry),
    );
    const issuer = isAddress(registry)
      ? await client.readContract({ address: getAddress(registry), abi: REGISTRY_ABI, functionName: "issuer", args: [tx.from] })
      : null;
    return { chainId, tx, receipt, block, confirmations: Number(latest - receipt.blockNumber) + 1, events, issuer };
  }
  try {
    data = await read();
  } catch (e) {
    error = e instanceof Error && /could not be found|not found/i.test(e.message)
      ? "This transaction isn't on the local test chain. The devnet may have been restarted since (it keeps nothing across a reboot)."
      : "The local test chain can't be reached right now. Is the devnet running?";
  }

  // which stored passport versions this transaction registered, and whether their PDF hashes match the chain
  const stored = getDb()
    .prepare(
      `SELECT p.passport_id AS passportId, v.version_no AS versionNo, v.pdf_sha256 AS pdfSha256
         FROM passport_versions v JOIN passports p ON p.id = v.passport_fk WHERE lower(v.chain_tx_hash) = lower(?)`,
    )
    .all(hash) as { passportId: string; versionNo: number; pdfSha256: string }[];
  const storedByHash = new Map(stored.map((s) => [s.pdfSha256.toLowerCase(), s]));

  return (
    <>
    <AppHeader area="public" home="/verify">
      <a className="appbar-link" href="/verify">Verify a passport</a>
    </AppHeader>
    <main className="page narrow">
      <header className="page-head">
        <p className="eyebrow">Local test chain · ლოკალური სატესტო ბლოკჩეინი</p>
        <h1>Blockchain transaction</h1>
        <p className="muted">
          Read live from the local Hardhat devnet (chain {LOCAL_CHAIN_ID}) that this demo runs on. It is a real chain on
          this computer, but not a public one, so Etherscan can&apos;t show it. On Sepolia the same link opens Etherscan.
        </p>
      </header>
      <p className="muted"><a href="/chain" data-testid="local-tx-all-blocks">All blocks</a></p>
      <p className="mono" data-testid="local-tx-hash" style={{ overflowWrap: "anywhere" }}>{hash}</p>

      {error && <p className="alert error" role="alert" data-testid="local-tx-error">{error}</p>}

      {data && (
        <>
          <section className="card facts" data-testid="local-tx">
            <dl>
              <div><dt>Status</dt><dd>{data.receipt.status === "success" ? <span className="pill ok">success</span> : <span className="pill">reverted</span>}</dd></div>
              <div><dt>Confirmations</dt><dd>{data.confirmations}</dd></div>
              <div><dt>Block</dt><dd><a href={`/chain/block/${data.receipt.blockNumber}`} data-testid="local-tx-block">{data.receipt.blockNumber.toString()}</a></dd></div>
              <div><dt>Time</dt><dd>{new Date(Number(data.block.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC</dd></div>
              <div><dt>From (issuer)</dt><dd className="mono">{data.tx.from}</dd></div>
              <div><dt>Issuer entry</dt><dd>{data.issuer ? `${data.issuer.label || "no label"}${data.issuer.testOnly && !/test/i.test(data.issuer.label) ? " · TEST issuer" : ""}${data.issuer.active ? "" : " · not active"}` : "unknown"}</dd></div>
              <div><dt>To (registry contract)</dt><dd className="mono">{data.tx.to ?? "contract creation"}</dd></div>
              <div><dt>Gas used</dt><dd>{data.receipt.gasUsed.toString()}</dd></div>
            </dl>
          </section>

          <section className="card" style={{ marginTop: 16 }}>
            <h2>Passport versions registered</h2>
            {data.events.length === 0 ? (
              <p className="muted">This transaction registered no passport version.</p>
            ) : (
              <table className="table" data-testid="local-tx-events">
                <thead><tr><th>Passport</th><th>Version</th><th>PDF SHA-256 on the chain</th><th>Stored PDF</th></tr></thead>
                <tbody>
                  {data.events.map((e, i) => {
                    const onChain = e.args.pdfSha256.slice(2).toLowerCase();
                    const match = storedByHash.get(onChain);
                    return (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>{match?.passportId ?? "not in this portal"}</td>
                        <td>V{e.args.versionNo}</td>
                        <td className="mono" style={{ overflowWrap: "anywhere" }}>{onChain}</td>
                        <td>{match ? <span className="pill ok" data-testid="local-tx-match">matches</span> : <span className="pill">no stored PDF</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="fine">
              Only hashes and a random passport reference are on the chain; no name or email. To check a PDF file
              itself, use <a href="/verify">Verify a passport</a> with its code.
            </p>
          </section>
        </>
      )}
    </main>
    </>
  );
}
