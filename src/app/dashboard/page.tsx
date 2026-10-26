import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import AppHeader from "@/components/AppHeader";
import Checks, { headline } from "@/components/Checks";
import PassportBook from "@/components/PassportBook";
import { getCurrentStudent } from "@/lib/auth/session";
import { txUrl } from "@/lib/explorer";
import { bookForStudent } from "@/lib/passport-book";
import {
  getPassportForStudent,
  getPendingInfo,
  getUnresolvedFailure,
  getVersionSkills,
  getWaitingVersion,
  readVersionPdf,
} from "@/lib/passports";
import { verifyVersion } from "@/lib/verify";
import PdfViewer from "./PdfViewer";

export const dynamic = "force-dynamic";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const student = await getCurrentStudent();
  if (!student) redirect("/login");

  const passport = getPassportForStudent(student.id);
  const { v } = await searchParams;
  const selected = passport
    ? v === undefined
      ? passport.current
      : (passport.versions.find((x) => String(x.versionNo) === v) ?? null)
    : null;
  const pdf = selected ? readVersionPdf(selected) : null;
  const skills = selected ? getVersionSkills(student.id, selected.versionNo) : [];
  const pending = passport ? null : getPendingInfo(student.id);
  const failure = passport ? getUnresolvedFailure(student.id) : null;
  const waiting = passport ? getWaitingVersion(student.id) : null;
  const query = selected && selected !== passport?.current ? `?v=${selected.versionNo}` : "";
  const pdfUrl = `/api/passport/pdf${query}`;
  const downloadUrl = `/api/passport/pdf${query ? `${query}&` : "?"}download=1`;

  // Authenticity comes only from a real check: the same server-side verifier as the public page, run
  // on this version's code and the exact stored bytes. Unregistered versions are not checked at all.
  const verification = selected?.chainTxHash ? await verifyVersion(selected.verificationCode, pdf?.ok ? pdf.bytes : null) : null;
  const verifyPath = selected ? `/verify/${selected.verificationCode}` : null;
  let qr: string | null = null;
  if (verifyPath && selected?.chainTxHash) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const base = process.env.PUBLIC_BASE_URL ?? (host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null);
    if (base) qr = await QRCode.toString(`${base.replace(/\/$/, "")}${verifyPath}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  }
  // The student's own QR to this version's registration transaction on the public explorer. It can't be
  // printed in the PDF itself: the transaction records the PDF's hash, so it only exists after the PDF.
  const chainUrl = selected ? txUrl(selected.chainId, selected.chainTxHash) : null;
  // (a local-devnet link is a page of this portal on this computer, which a phone can't open: no QR for it)
  const chainQr = chainUrl?.startsWith("https://") ? await QRCode.toString(chainUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  const lastUpdated = passport?.current?.issuedAt ?? null;
  const demo = student.source === "BTU_TEST_DATA" || student.source === "SEED_SYNTHETIC";
  const book = passport && selected ? bookForStudent({ student, passport, version: selected, sheetSkills: skills }) : null;

  return (
    <>
      <AppHeader area="student" home="/dashboard">
        <span className="appbar-user">
          {student.firstName} {student.lastName}
          {demo && (
            <span className="pill" data-testid="demo-record">
              {student.source === "BTU_TEST_DATA" ? "BTU test data" : "Demo data"}
            </span>
          )}
        </span>
        <form method="post" action="/api/auth/logout">
          <button type="submit" className="button ghost">
            Sign out
          </button>
        </form>
      </AppHeader>
    <main className="page">
      <header className="page-head">
        <p className="eyebrow">My Digital Passport · ჩემი პასპორტი</p>
        <h1>
          {student.firstName} {student.lastName}
        </h1>
        <p className="muted">
          {[student.program, student.educationLevel].filter(Boolean).join(" · ")}
          {student.program || student.educationLevel ? " · " : ""}
          {student.studentId} · {student.email}
        </p>
      </header>

      {!passport && (
        <section className="card notice" data-testid="no-passport">
          <h2>Your passport has not been generated yet</h2>
          {pending && pending.awards > 0 ? (
            <p className="muted" data-testid="pending-awards">
              Pending: BTU has recorded {pending.awards} confirmed AI skill{pending.awards === 1 ? "" : "s"} for you,
              and your passport is waiting to be issued. Check back later.
            </p>
          ) : (
            <p className="muted">
              BTU creates your Digital Passport once at least one confirmed AI skill is recorded for you. Check back
              later.
            </p>
          )}
          {pending && pending.held > 0 && (
            <p className="fine">
              {pending.held} skill record{pending.held === 1 ? " is" : "s are"} on hold until BTU completes them.
            </p>
          )}
        </section>
      )}

      {passport && !passport.current && (
        <section className="card notice" data-testid="no-issued-version">
          <h2>Your passport is being issued</h2>
          <p className="muted">
            {waiting
              ? `Your passport V${waiting.versionNo} has been generated and is waiting for blockchain registration. It will appear here once it is officially issued.`
              : "Your passport has been created but no version has been issued yet. Check back later."}
          </p>
        </section>
      )}

      {passport && passport.current && waiting && (
        <section className="card notice" data-testid="awaiting-registration">
          <h2>An update is waiting for blockchain registration</h2>
          <p className="muted">
            V{waiting.versionNo} with your new skills was generated on {formatDate(waiting.generatedAt)}. Until it is
            registered and issued, V{passport.current.versionNo} remains your valid passport.
          </p>
        </section>
      )}

      {passport && passport.current && !selected && (
        <section className="card notice">
          <h2>That version was not found</h2>
          <p className="muted">
            <a href="/dashboard">Show your current passport</a>
          </p>
        </section>
      )}

      {passport && failure && passport.current && (
        <section className="card notice" data-testid="update-failed">
          <h2>A newer update couldn&apos;t be generated yet</h2>
          <p className="muted">
            New skills were recorded for you, but generating the updated PDF failed. Your current passport, V
            {passport.current.versionNo}, is unchanged and still the latest version. BTU will retry.
          </p>
        </section>
      )}

      {passport && selected && (
        <>
          {book && (
            <section className="card book-card" aria-labelledby="book-heading" data-testid="dashboard-book">
              <div className="book-card-head">
                <h2 id="book-heading">Your passport booklet · V{selected.versionNo}</h2>
                <p className="muted">Open and turn the pages. The official document is the PDF below.</p>
              </div>
              <PassportBook data={book} homeHref="/" homeLabel="Home" />
            </section>
          )}
          <div className="passport-layout">
            <div className="passport-main">
          {pdf?.ok ? (
            <section className="card viewer">
              <div className="viewer-bar">
                <p className="viewer-title">
                  Passport <span className="mono">{passport.passportId}</span> · V{selected.versionNo}
                  {selected.status !== "CURRENT" && " (superseded)"}
                </p>
                <a className="button" href={pdfUrl} target="_blank" rel="noopener">
                  Open in new tab
                </a>
                <a className="button primary" href={downloadUrl}>
                  Download PDF
                </a>
              </div>
              <PdfViewer src={pdfUrl} title={`Passport ${passport.passportId} V${selected.versionNo}`} />
            </section>
          ) : (
            <section className="card notice" data-testid="pdf-unavailable">
              <h2>{pdf?.reason === "integrity" ? "This PDF failed its integrity check" : "The PDF file is missing"}</h2>
              <p className="muted">
                Your passport record exists, but its PDF can&apos;t be shown right now. No other document is shown in its
                place. Please contact BTU.
              </p>
            </section>
          )}

            </div>
            <aside className="passport-side">
          <section className="card facts" aria-label="Passport details">
            <dl>
              <div>
                <dt>Passport ID</dt>
                <dd data-testid="passport-id">{passport.passportId}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>
                  V{selected.versionNo}{" "}
                  <span className={`pill ${selected.status === "CURRENT" ? "ok" : ""}`}>
                    {selected.status === "CURRENT" ? "Current" : "Superseded"}
                  </span>
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
              <div>
                <dt>Verification code</dt>
                <dd className="mono" data-testid="verification-code">{selected.verificationCode}</dd>
              </div>
            </dl>
            {selected.chainTxHash && (
              <p className="fine" data-testid="chain-record">
                Registered on {selected.chainNetwork ?? "a blockchain"}, block {selected.chainBlockNumber}, transaction{" "}
                {chainUrl ? (
                  <a className="mono" href={chainUrl} target="_blank" rel="noopener" data-testid="tx-link">
                    {selected.chainTxHash.slice(0, 10)}…{selected.chainTxHash.slice(-6)}
                  </a>
                ) : (
                  <span className="mono">{selected.chainTxHash.slice(0, 10)}…{selected.chainTxHash.slice(-6)}</span>
                )}
                .
                {selected.chainIssuerTestOnly !== 0 &&
                  " Issued by a test issuer: official BTU issuer verification is still pending."}
              </p>
            )}
            {chainUrl && chainQr && (
              <div className="verifyrow" data-testid="chain-qr-block">
                <div className="qr" data-testid="chain-qr" role="img" aria-label="QR code for this version's blockchain transaction" dangerouslySetInnerHTML={{ __html: chainQr }} />
                <p className="muted">
                  Scan to see V{selected.versionNo} of your passport on the public blockchain explorer:{" "}
                  <a href={chainUrl} target="_blank" rel="noopener">open the transaction</a>. It shows the PDF&apos;s
                  SHA-256 and the issuer; no name or email is stored there.
                </p>
              </div>
            )}
            {!selected.chainTxHash && (
              <p className="fine">
                Prototype document: this version is not registered on a blockchain yet, so it cannot be publicly
                verified.
              </p>
            )}
          </section>

          <section className="card status-block" data-testid="authenticity" data-overall={verification?.overall ?? "NOT_REGISTERED"}>
            <h2>Authenticity</h2>
            {verification ? (
              <>
                <p className={`verdict-line ${headline(verification).tone}`}>
                  <strong>{headline(verification).title}</strong>
                </p>
                <Checks result={verification} stored />
                <p className="fine">Checked just now against the blockchain record and BTU&apos;s issuer statement.</p>
              </>
            ) : (
              <p className="muted">
                Not registered on a blockchain, so this version can&apos;t be verified. It is not shown as authentic.
              </p>
            )}
            {verification && verifyPath && (
              <div className="verifyrow">
                {qr && <div className="qr" data-testid="verify-qr" role="img" aria-label="QR code for the public verification page" dangerouslySetInnerHTML={{ __html: qr }} />}
                <p className="muted">
                  Anyone can check this version, with no account, on the{" "}
                  <a href={verifyPath} data-testid="verify-link">public verification page</a>. Share the code or the PDF;
                  your email and other details are never shown there.
                </p>
              </div>
            )}
          </section>

          {skills.length > 0 && (
            <section className="card">
              <h2>Skills in V{selected.versionNo}</h2>
              <ul className="skills" data-testid="skills">
                {skills.map((k) => (
                  <li key={k.recordId}>
                    <span className="skill-name">{k.name}</span>
                    <span className="muted">
                      {k.category} · {k.badgeCode} · earned {formatDate(k.dateEarned)}
                    </span>
                    {k.description && <span className="skill-desc">{k.description}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {passport.versions.length > 0 && (
            <section className="card">
              <h2>Version history</h2>
              <ul className="versions" data-testid="history">
                {passport.versions.map((ver) => (
                  <li key={ver.versionNo} data-version={ver.versionNo} data-status={ver.status}>
                    <a href={ver.status === "CURRENT" ? "/dashboard" : `/dashboard?v=${ver.versionNo}`}>
                      V{ver.versionNo}
                    </a>{" "}
                    <span className="muted">
                      issued {formatDate(ver.issuedAt)} ·{" "}
                      {ver.status === "CURRENT" ? <span className="pill ok">current</span> : <span className="pill">superseded</span>}
                      {txUrl(ver.chainId, ver.chainTxHash) ? (
                        <>
                          {" · "}
                          <a href={txUrl(ver.chainId, ver.chainTxHash)!} target="_blank" rel="noopener" data-testid="history-tx-link">
                            transaction
                          </a>
                        </>
                      ) : ver.chainTxHash ? (
                        ""
                      ) : (
                        " · not registered on a blockchain"
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
            </aside>
          </div>
        </>
      )}
    </main>
    </>
  );
}
