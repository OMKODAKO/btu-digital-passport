import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PassportBook from "@/components/PassportBook";
import TierBadge from "@/components/TierBadge";
import { txUrl } from "@/lib/explorer";
import { bookForVersion, claimsFor, type Claim } from "@/lib/passport-book";
import { readVersionPdf } from "@/lib/passports";
import { passportForToken } from "@/lib/share";
import { verifyVersion } from "@/lib/verify";

export const dynamic = "force-dynamic";

// A CV link is for the people the student sends it to, not for search engines.
export const metadata: Metadata = {
  title: "BTU AI Skills Digital Passport",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const MARK: Record<Claim["state"], string> = { ok: "✓", pending: "◷", partial: "◐", failed: "✕", none: "–", unknown: "?" };

/**
 * The public passport link a student puts in a CV (/p/<token>, see src/lib/share.ts). No sign-in and nothing to
 * change: it always shows the passport's current issued version as the booklet (from the data embedded in that
 * version's PDF, so it shows exactly what BTU issued), the same live verification claims as the dashboard, and a
 * button to the public verification page. No email, student number or older versions are shown.
 */
export default async function PublicPassport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = passportForToken(token);
  if (!found) notFound();
  const { student, passport } = found;
  const current = passport.current;
  const pdf = current ? readVersionPdf(current) : null;
  const book = current && pdf?.ok ? bookForVersion({ student, passport, version: current, pdf: pdf.bytes }) : null;
  const verification = current?.chainTxHash ? await verifyVersion(current.verificationCode, pdf?.ok ? pdf.bytes : null) : null;
  const claims = current ? claimsFor(current, !!pdf?.ok, verification) : [];
  const chainUrl = current ? txUrl(current.chainId, current.chainTxHash) : null;
  // only this version: the links to older versions belong to the student's own dashboard
  const shown = book && {
    ...book,
    versions: book.versions.filter((v) => v.selected).map((v) => ({ ...v, href: `/p/${token}` })),
  };

  return (
    <>
      <AppHeader area="public" home="/">
        <a className="appbar-link" href="/verify">Verify a passport</a>
      </AppHeader>
      <main className="page" data-testid="public-passport">
        <header className="page-head">
          <p className="eyebrow">Verified AI skills · BTU Digital Passport</p>
          <h1>{shown ? shown.holder.fullName : `${passport.holderFirstName} ${passport.holderLastName}`}</h1>
          {shown && (shown.holder.program || shown.holder.level) && (
            <p className="muted">{[shown.holder.program, shown.holder.level].filter(Boolean).join(" · ")}</p>
          )}
        </header>

        {!current || !shown ? (
          <section className="card notice" data-testid="public-unavailable">
            <h2>This passport can&apos;t be shown right now</h2>
            <p className="muted">
              {!current
                ? "No version of this passport is issued at the moment."
                : "The issued document could not be read or failed its integrity check, so nothing is shown in its place."}
            </p>
          </section>
        ) : (
          <div className="passport-stage">
            <section className="passport-main" aria-label="Passport">
              <PassportBook data={shown} />
              <section className="card pp-skills" data-testid="public-skills" aria-labelledby="pp-skills">
                <h2 id="pp-skills">AI skills · AI უნარები</h2>
                <ul>
                  {shown.skills.map((k) => (
                    <li key={k.id}>
                      <span>
                        <strong>{k.name}</strong>
                        <span className="muted">{k.meta}</span>
                      </span>
                      <span className="pp-level">
                        {k.score && <span className="mono">{k.score} / 100</span>}
                        {k.tier ? <TierBadge tier={k.tier} /> : <span className="pill">{k.level}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
            <aside className="passport-side">
              <div className="companion">
                <section className="cp-section" aria-label="Passport details">
                  <dl className="cp-facts">
                    <div className="cp-wide">
                      <dt>Passport ID</dt>
                      <dd className="mono" data-testid="passport-id">{passport.passportId}</dd>
                    </div>
                    <div>
                      <dt>Version</dt>
                      <dd>V{current.versionNo} <span className="cp-chip is-current">Current</span></dd>
                    </div>
                    <div>
                      <dt>Issued</dt>
                      <dd>{formatDate(current.issuedAt)}</dd>
                    </div>
                    <div className="cp-wide">
                      <dt>Verification code</dt>
                      <dd className="mono" data-testid="verification-code">{current.verificationCode}</dd>
                    </div>
                  </dl>
                </section>
                <section className="cp-section" data-testid="authenticity" data-overall={verification?.overall ?? "NOT_REGISTERED"} aria-labelledby="pp-verify">
                  <h2 id="pp-verify" className="cp-h">Verification</h2>
                  <ul className="cp-claims" data-testid="claims">
                    {claims.map((c) => (
                      <li key={c.key} data-claim={c.key} data-state={c.state}>
                        <span className={`cp-mark cp-${c.state}`} aria-hidden="true">{MARK[c.state]}</span>
                        <span>
                          <strong>{c.label}</strong>
                          <span className="cp-claim-text">{c.text}</span>
                          {c.key === "chain" && current.chainTxHash && (
                            <span className="cp-claim-text">
                              Transaction{" "}
                              {chainUrl ? (
                                <a className="mono" href={chainUrl} target="_blank" rel="noopener">{short(current.chainTxHash)}</a>
                              ) : (
                                <span className="mono">{short(current.chainTxHash)}</span>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <a className="button primary pp-verify" href={`/verify/${current.verificationCode}`} data-testid="public-verify">
                    Verify this passport · გადაამოწმე
                  </a>
                  <p className="cp-fine">
                    The check runs again on the public verification page against the blockchain record. You can also upload a
                    copy of the PDF there to check that it is the document BTU issued. No account is needed.
                  </p>
                </section>
              </div>
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
