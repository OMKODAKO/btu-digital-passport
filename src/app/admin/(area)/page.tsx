import { requireStaff } from "@/lib/auth/staff";
import { overview, SOURCE_LABEL } from "@/lib/admin";
import { fmt } from "../format";

export default async function AdminHome() {
  await requireStaff();
  const o = overview();
  const issue = (sev: string) => o.lastRunIssues.find((i) => i.severity === sev)?.n ?? 0;
  const state = (s: string) => o.sourceStates.find((i) => i.state === s)?.n ?? 0;
  return (
    <>
      <section className="card">
        <h2>Status</h2>
        <dl className="stats">
          <div><dt>Students</dt><dd>{o.students}</dd></div>
          <div><dt>Passports</dt><dd>{o.passports}</dd></div>
          <div><dt>Current versions</dt><dd>{o.currentVersions}</dd></div>
          <div><dt>Current, registered on chain</dt><dd>{o.registeredCurrent}</dd></div>
          <div><dt>Waiting for registration</dt><dd data-testid="stat-waiting">{o.waiting}</dd></div>
          <div><dt>Registration errors</dt><dd>{o.registrationErrors}</dd></div>
          <div><dt>Need generation</dt><dd data-testid="stat-generation">{o.needsGeneration}</dd></div>
          <div><dt>Retries queued</dt><dd>{o.openRetries}</dd></div>
        </dl>
        <p className="fine">
          Source rows: {state("ACCEPTED")} accepted, {state("HELD")} held, {state("INVALID")} invalid.
          {o.lastRunId && ` Last import (run ${o.lastRunId}): ${issue("ERROR")} errors, ${issue("HOLD")} holds, ${issue("WARNING")} warnings.`}{" "}
          Data: {o.sources.map((s) => `${s.n} ${SOURCE_LABEL[s.source] ?? s.source}`).join(", ")}.
        </p>
      </section>

      <section className="card">
        <h2>Needs attention</h2>
        {o.attention.length === 0 ? (
          <p className="muted">Nothing is waiting or failed.</p>
        ) : (
          <table className="table" data-testid="attention">
            <thead><tr><th>Passport</th><th>Student</th><th>Problem</th></tr></thead>
            <tbody>
              {o.attention.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.passportId}</td>
                  <td><a href={`/admin/students/${encodeURIComponent(a.studentId)}`}>{a.studentId}</a></td>
                  <td>
                    {a.needsGeneration && "Accepted skills not in a version yet. "}
                    {a.waitingVersion !== null &&
                      (a.registrationError
                        ? `V${a.waitingVersion}: registration failed ${a.attempts}× (${a.registrationError.slice(0, 80)})`
                        : `V${a.waitingVersion} waiting for blockchain registration`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent imports</h2>
        <table className="table">
          <thead><tr><th>Run</th><th>Source</th><th>Finished</th><th>Status</th><th>Result</th></tr></thead>
          <tbody>
            {o.runs.map((r) => {
              const s = r.summary ? (JSON.parse(r.summary) as Record<string, number | string>) : {};
              return (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.sourceType === "XLSX" ? "Excel file" : "Google Sheet"}: {r.sourceName}</td>
                  <td>{r.finishedAt ? fmt(r.finishedAt) : "running"}</td>
                  <td>{r.status}</td>
                  <td className="muted">
                    {r.status === "COMPLETED"
                      ? `${s.rows_valid} valid, ${s.rows_held} held, ${s.rows_invalid} invalid; ${s.versions_generated} versions generated, ${s.generation_failures} generation failures, ${s.issuance_failures} issuance failures`
                      : String(s.error ?? "")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
