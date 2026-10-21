import { requireStaff } from "@/lib/auth/staff";
import { latestIssues, type IssueRow } from "@/lib/admin";
import { fmt } from "../../format";

function Rows({ rows, id }: { rows: IssueRow[]; id: string }) {
  if (rows.length === 0) return <p className="muted">None.</p>;
  return (
    <table className="table" data-testid={id}>
      <thead><tr><th>Row</th><th>Record</th><th>Student ID</th><th>Problem</th><th>Message</th></tr></thead>
      <tbody>
        {rows.map((i, n) => (
          <tr key={n} data-code={i.code}>
            <td>{i.sheetRow ?? ""}</td>
            <td className="mono">{i.recordId ?? ""}</td>
            <td className="mono">{i.studentCode ?? ""}</td>
            <td>{i.code}</td>
            <td className="muted">{i.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function IssuesPage() {
  await requireStaff();
  const x = latestIssues();
  if (!x) return <section className="card"><h2>Import problems</h2><p className="muted">No completed import yet.</p></section>;
  return (
    <>
      <p className="muted">
        From the latest import, run {x.run.id} ({x.run.sourceName}, {fmt(x.run.finishedAt)}). Fix these in the sheet; the next import
        picks the changes up.
      </p>
      <section className="card"><h2>Invalid or conflicting Student IDs</h2><Rows rows={x.invalidStudentIds} id="invalid-ids" /></section>
      <section className="card"><h2>Duplicate source records</h2><Rows rows={x.duplicates} id="duplicates" /></section>
      <section className="card"><h2>All errors ({x.errors.length})</h2><Rows rows={x.errors} id="errors" /></section>
      <section className="card"><h2>On hold ({x.holds.length})</h2><Rows rows={x.holds} id="holds" /></section>
      <section className="card"><h2>Warnings ({x.warnings.length})</h2><Rows rows={x.warnings} id="warnings" /></section>
    </>
  );
}
