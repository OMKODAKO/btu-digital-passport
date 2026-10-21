import { can, requireStaff } from "@/lib/auth/staff";
import { SOURCE_LABEL, studentDetail } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { verifyVersion } from "@/lib/verify";
import AuditTable from "../../AuditTable";
import { day, fmt } from "../../../format";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default async function StudentRecord({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ retry?: string }>;
}) {
  const staff = await requireStaff();
  const { studentId } = await params;
  const d = studentDetail(decodeURIComponent(studentId));
  if (!d) {
    return (
      <section className="card notice">
        <h2>No such student</h2>
        <p className="muted"><a href="/admin/students">Search again</a></p>
      </section>
    );
  }
  audit({ kind: "STAFF", ref: staff.email }, "STUDENT_RECORD_VIEWED", d.passport?.id ?? null, { student: d.student.studentId });
  const { student, passport } = d;
  // live chain status of each issued version (code-only check: record, confirmations, issuer, current/superseded)
  const live = new Map(
    await Promise.all(
      d.versions.filter((v) => v.txHash).map(async (v) => [v.versionNo, await verifyVersion(v.verificationCode, null)] as const),
    ),
  );
  const { retry } = await searchParams;

  return (
    <>
      <section className="card facts">
        <h2>
          {student.firstName} {student.lastName} <span className="pill">{SOURCE_LABEL[student.source] ?? student.source}</span>
        </h2>
        <dl>
          <div><dt>Student ID</dt><dd data-testid="student-id">{student.studentId}</dd></div>
          <div><dt>BTU email</dt><dd>{student.email}</dd></div>
          <div><dt>Program</dt><dd>{[student.program, student.educationLevel].filter(Boolean).join(", ") || "not given"}</dd></div>
          <div><dt>Status</dt><dd>{student.status ?? "not given"}</dd></div>
          <div><dt>Passport ID</dt><dd className="mono">{passport?.passportId ?? "none yet"}</dd></div>
          <div><dt>First issued</dt><dd>{passport ? day(passport.firstIssuedOn) : "not yet"}</dd></div>
        </dl>
      </section>

      {passport && (
        <section className="card" data-testid="retry-card">
          <h2>Retry failed processing</h2>
          {retry === "queued" && <p className="alert info" role="status">Retry queued. The worker will carry it out on its next run.</p>}
          {d.retry.reasons.length > 0 ? (
            <ul className="plain">{d.retry.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          ) : (
            <p className="muted">Nothing has failed or is waiting for this passport.</p>
          )}
          {d.retry.open && <p className="muted">A retry is already queued for this passport.</p>}
          {can(staff, "retry") ? (
            d.retry.eligible && (
              <form method="post" action="/api/admin/retry" className="searchbar">
                <input type="hidden" name="passport" value={passport.passportId} />
                <input name="reason" required maxLength={300} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
                <button type="submit" className="button primary" data-testid="retry-button">Queue retry</button>
              </form>
            )
          ) : (
            <p className="fine">Your role ({staff.role}) can view records but can&apos;t queue retries.</p>
          )}
          <p className="fine">
            A retry regenerates and registers this passport only from skills already accepted from the sheet. It never
            changes a skill&apos;s status, and the current version stays valid until a new one is issued.
          </p>
          {d.retries.length > 0 && (
            <table className="table">
              <thead><tr><th>Requested</th><th>By</th><th>Reason</th><th>State</th><th>Result</th></tr></thead>
              <tbody>
                {d.retries.map((r) => (
                  <tr key={r.id} data-testid="retry-row" data-state={r.state}>
                    <td>{fmt(r.requestedAt)}</td><td>{r.requestedBy}</td><td>{r.reason}</td><td>{r.state}</td>
                    <td className="muted">{r.result ? Object.entries(JSON.parse(r.result)).map(([k, v]) => `${k}: ${v}`).join("; ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {passport && (
        <section className="card">
          <h2>Versions and blockchain status</h2>
          <table className="table" data-testid="versions">
            <thead><tr><th>Version</th><th>Status</th><th>Issued</th><th>Verification code</th><th>Blockchain</th></tr></thead>
            <tbody>
              {d.candidates.map((c) => (
                <tr key={`c${c.versionNo}`} data-version={c.versionNo} data-state={c.state}>
                  <td>V{c.versionNo}</td>
                  <td>{c.state === "VOID" ? "void (never issued)" : "waiting for registration"}</td>
                  <td>generated {fmt(c.generatedAt)}</td>
                  <td className="muted">not issued</td>
                  <td className="muted">
                    {c.state === "VOID"
                      ? c.voidReason
                      : `${c.attempts} attempt${c.attempts === 1 ? "" : "s"}${c.txSubmitted ? `, tx ${short(c.txSubmitted)} sent` : ""}${c.lastError ? `; last error: ${c.lastError}` : ""}`}
                  </td>
                </tr>
              ))}
              {d.versions.map((v) => {
                const r = live.get(v.versionNo);
                return (
                  <tr key={v.versionNo} data-version={v.versionNo} data-state={v.status}>
                    <td>V{v.versionNo}</td>
                    <td>{v.status === "CURRENT" ? <span className="pill ok">current</span> : "superseded"}</td>
                    <td>{fmt(v.issuedAt)}</td>
                    <td className="mono">{v.verificationCode}</td>
                    <td className="muted">
                      {v.txHash ? (
                        <>
                          {v.network}, block {v.blockNumber}, tx <span className="mono">{short(v.txHash)}</span>
                          {v.issuerTestOnly !== 0 ? ", test issuer" : ""}. Now:{" "}
                          <span data-testid="live-chain">{r ? `${r.chain.toLowerCase()}, ${r.evidence.confirmations ?? "?"} confirmations, issuer ${r.issuer.toLowerCase().replace("_", " ")}` : "not checked"}</span>
                        </>
                      ) : (
                        "not registered (stage 1 seed or local-demo issuance)"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2>Skill records from the sheet</h2>
        {d.records.length === 0 ? (
          <p className="muted">No source rows for this Student ID.</p>
        ) : (
          <table className="table" data-testid="records">
            <thead><tr><th>Record</th><th>Row</th><th>Skill</th><th>State</th><th>Sheet status at last import (Q–S)</th><th>Problems at last import</th></tr></thead>
            <tbody>
              {d.records.map((r) => {
                const issues = JSON.parse(r.issues ?? "[]") as string[];
                return (
                  <tr key={r.recordId} data-record={r.recordId} data-state={r.state}>
                    <td className="mono">{r.recordId}</td>
                    <td>{r.sheetRow}</td>
                    <td>{r.skillName ?? ""}</td>
                    <td>{r.state === "ACCEPTED" ? `accepted${r.dateEarned ? `, earned ${day(r.dateEarned)}` : ""}` : r.state.toLowerCase()}</td>
                    <td>{r.syncStatus ?? ""}{r.syncedVersion ? ` (${r.syncedVersion})` : ""}</td>
                    <td className="muted">{issues.length ? issues.join(" · ") : "none"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="fine">Held and invalid rows can only be fixed in the sheet; this page can&apos;t confirm a skill. The sheet status is refreshed by the next import, not by a retry.</p>
      </section>

      {d.failures.length > 0 && (
        <section className="card">
          <h2>Generation failures</h2>
          <table className="table">
            <thead><tr><th>When</th><th>Run</th><th>Records</th><th>Error</th></tr></thead>
            <tbody>
              {d.failures.map((f) => (
                <tr key={f.at + f.runId}>
                  <td>{fmt(f.at)}</td><td>{f.runId}</td><td className="mono">{(JSON.parse(f.records) as string[]).join(", ")}</td>
                  <td className="muted">{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {passport && (
        <section className="card">
          <h2>Audit log for this passport</h2>
          <AuditTable entries={d.audit} />
        </section>
      )}
    </>
  );
}
