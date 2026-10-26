import Checks, { headline } from "@/components/Checks";
import { txUrl } from "@/lib/explorer";
import type { Claim } from "@/lib/passport-book";
import type { Passport, PassportVersion } from "@/lib/passports";
import type { VerificationResult } from "@/lib/verify";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

const MARK: Record<Claim["state"], string> = { ok: "✓", pending: "◷", partial: "◐", failed: "✕", none: "–", unknown: "?" };

/**
 * The quiet column beside the booklet: the record's facts, then the four verification claims as separate lines
 * (record found, document unchanged, transaction confirmed, official BTU issuer), each from the live check, then
 * the versions. Detail that only some readers need (every check, QR codes) is folded away rather than removed.
 */
export default function CompanionPanel(props: {
  passport: Passport;
  selected: PassportVersion;
  verification: VerificationResult | null;
  claims: Claim[];
  verifyPath: string;
  qr: string | null;
  chainUrl: string | null;
  chainQr: string | null;
}) {
  const { passport, selected, verification, claims, verifyPath, qr, chainUrl, chainQr } = props;
  const current = selected.status === "CURRENT";
  const lastUpdated = passport.current?.issuedAt ?? null;
  const tone = verification ? headline(verification).tone : "none";

  return (
    <div className="companion">
      <section className="cp-section" aria-label="Passport details">
        <dl className="cp-facts">
          <div className="cp-wide">
            <dt>Passport ID</dt>
            <dd className="mono" data-testid="passport-id">{passport.passportId}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              V{selected.versionNo}{" "}
              <span className={`cp-chip ${current ? "is-current" : ""}`}>{current ? "Current" : "Superseded"}</span>
            </dd>
          </div>
          <div>
            <dt>Version issued</dt>
            <dd>{formatDate(selected.issuedAt)}</dd>
          </div>
          <div>
            <dt>First issued</dt>
            <dd data-testid="first-issued">{formatDate(passport.firstIssuedOn)}</dd>
          </div>
          {lastUpdated && (
            <div>
              <dt>Last updated</dt>
              <dd data-testid="last-updated">{formatDate(lastUpdated)}</dd>
            </div>
          )}
          <div className="cp-wide">
            <dt>Verification code</dt>
            <dd className="mono" data-testid="verification-code">{selected.verificationCode}</dd>
          </div>
        </dl>
      </section>

      <section className="cp-section" data-testid="authenticity" data-overall={verification?.overall ?? "NOT_REGISTERED"} aria-labelledby="cp-verify">
        <h2 id="cp-verify" className="cp-h">Verification</h2>
        <ul className="cp-claims" data-testid="claims">
          {claims.map((c) => (
            <li key={c.key} data-claim={c.key} data-state={c.state}>
              <span className={`cp-mark cp-${c.state}`} aria-hidden="true">{MARK[c.state]}</span>
              <span>
                <strong>{c.label}</strong>
                <span className="cp-claim-text">{c.text}</span>
              </span>
            </li>
          ))}
        </ul>
        {verification ? (
          <p className={`cp-summary cp-tone-${tone}`}>{headline(verification).title}</p>
        ) : (
          <p className="cp-summary">
            Not registered on a blockchain, so this version can&apos;t be verified. It is not shown as authentic.
          </p>
        )}
        {selected.chainTxHash && (
          <p className="cp-fine" data-testid="chain-record">
            Registered on {selected.chainNetwork ?? "a blockchain"}, block {selected.chainBlockNumber}, transaction{" "}
            {chainUrl ? (
              <a className="mono" href={chainUrl} target="_blank" rel="noopener" data-testid="tx-link">{short(selected.chainTxHash)}</a>
            ) : (
              <span className="mono">{short(selected.chainTxHash)}</span>
            )}
            .
            {selected.chainIssuerTestOnly !== 0 && " Issued by a test issuer: official BTU issuer verification is still pending."}
          </p>
        )}
        {verification && (
          <details className="cp-more">
            <summary>All checks</summary>
            <Checks result={verification} stored />
            <p className="cp-fine">Checked just now against the blockchain record and BTU&apos;s issuer statement.</p>
          </details>
        )}
        {verification && (
          <details className="cp-more">
            <summary>Share and verify</summary>
            <div className="cp-share">
              {qr && <div className="qr" data-testid="verify-qr" role="img" aria-label="QR code for the public verification page" dangerouslySetInnerHTML={{ __html: qr }} />}
              <p className="cp-fine">
                Anyone can check this version, with no account, on the{" "}
                <a href={verifyPath} data-testid="verify-link">public verification page</a>. Your email and other details are
                never shown there.
              </p>
            </div>
            {chainUrl && chainQr && (
              <div className="cp-share" data-testid="chain-qr-block">
                <div className="qr" data-testid="chain-qr" role="img" aria-label="QR code for this version's blockchain transaction" dangerouslySetInnerHTML={{ __html: chainQr }} />
                <p className="cp-fine">
                  The <a href={chainUrl} target="_blank" rel="noopener">transaction on the public explorer</a> shows the PDF&apos;s SHA-256
                  and the issuer; no name or email is stored there.
                </p>
              </div>
            )}
          </details>
        )}
      </section>

      <section className="cp-section" aria-labelledby="cp-versions">
        <h2 id="cp-versions" className="cp-h">Versions</h2>
        <ul className="cp-versions" data-testid="history">
          {passport.versions.map((ver) => {
            const tx = txUrl(ver.chainId, ver.chainTxHash);
            const here = ver.versionNo === selected.versionNo;
            return (
              <li key={ver.versionNo} data-version={ver.versionNo} data-status={ver.status} aria-current={here ? "page" : undefined}>
                <a href={ver.status === "CURRENT" ? "/dashboard" : `/dashboard?v=${ver.versionNo}`}>V{ver.versionNo}</a>
                <span className="cp-v-meta">
                  {formatDate(ver.issuedAt)} · {ver.status === "CURRENT" ? "current" : "superseded"}
                  {tx ? (
                    <>
                      {" · "}
                      <a href={tx} target="_blank" rel="noopener" data-testid="history-tx-link">transaction</a>
                    </>
                  ) : ver.chainTxHash ? "" : " · not registered on a blockchain"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
