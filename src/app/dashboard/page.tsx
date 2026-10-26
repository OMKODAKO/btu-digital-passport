import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import AppHeader from "@/components/AppHeader";
import PassportBook from "@/components/PassportBook";
import { getCurrentStudent } from "@/lib/auth/session";
import { txUrl } from "@/lib/explorer";
import { bookForVersion, claimsFor } from "@/lib/passport-book";
import {
  getPassportForStudent,
  getPendingInfo,
  getUnresolvedFailure,
  getWaitingVersion,
  readVersionPdf,
} from "@/lib/passports";
import { verifyVersion } from "@/lib/verify";
import CompanionPanel from "./CompanionPanel";
import PdfDocument from "./PdfDocument";
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
  // The booklet shows the data embedded in this version's PDF, read from the bytes that just passed the
  // integrity check, so it can't show anything the download doesn't contain.
  const claims = selected ? claimsFor(selected, !!pdf?.ok, verification) : null;
  const book = passport && selected && pdf?.ok && claims ? bookForVersion({ student, passport, version: selected, pdf: pdf.bytes, claims }) : null;
  const demo = student.source === "BTU_TEST_DATA" || student.source === "SEED_SYNTHETIC";

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
        <div className="passport-stage">
          <section className="passport-main" aria-labelledby="viewer-title">
            <div className="viewer-bar">
              <p className="viewer-title" id="viewer-title">
                Passport <span className="mono">{passport.passportId}</span> · V{selected.versionNo}
                {selected.status !== "CURRENT" && " (superseded)"}
              </p>
              {pdf?.ok && (
                <>
                  <a className="button" href={pdfUrl} target="_blank" rel="noopener">
                    Open in new tab
                  </a>
                  <a className="button primary" href={downloadUrl}>
                    Download PDF
                  </a>
                </>
              )}
            </div>
            {pdf?.ok ? (
              book ? (
                <>
                  <PassportBook data={book} />
                  <PdfDocument src={pdfUrl} title={`Passport ${passport.passportId} V${selected.versionNo}`} />
                </>
              ) : (
                <div className="card viewer">
                  <PdfViewer src={pdfUrl} title={`Passport ${passport.passportId} V${selected.versionNo}`} />
                </div>
              )
            ) : (
              <section className="card notice" data-testid="pdf-unavailable">
                <h2>{pdf?.reason === "integrity" ? "This PDF failed its integrity check" : "The PDF file is missing"}</h2>
                <p className="muted">
                  Your passport record exists, but its PDF can&apos;t be shown right now. No other document is shown in its
                  place. Please contact BTU.
                </p>
              </section>
            )}
          </section>
          <aside className="passport-side">
            <CompanionPanel
              passport={passport}
              selected={selected}
              verification={verification}
              claims={claims!}
              verifyPath={verifyPath!}
              qr={qr}
              chainUrl={chainUrl}
              chainQr={chainQr}
            />
          </aside>
        </div>
      )}
    </main>
    </>
  );
}
