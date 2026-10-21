import { requireStaff } from "@/lib/auth/staff";
import { searchStudents, SOURCE_LABEL } from "@/lib/admin";

export default async function FindStudent({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff();
  const q = String((await searchParams).q ?? "").slice(0, 120);
  const hits = q ? searchStudents(q) : [];
  return (
    <section className="card">
      <h2>Find a student</h2>
      <form method="get" className="searchbar">
        <input name="q" defaultValue={q} placeholder="Student ID, BTU email, Passport ID or verification code"
          aria-label="Identifier" autoComplete="off" spellCheck={false} />
        <button type="submit" className="button primary">Search</button>
      </form>
      <p className="fine">Exact identifiers only, so the search can&apos;t be used to browse people.</p>
      {q && hits.length === 0 && <p className="muted" data-testid="no-hits">No student matches that identifier.</p>}
      {hits.length > 0 && (
        <table className="table" data-testid="hits">
          <thead><tr><th>Student ID</th><th>Name</th><th>Passport ID</th><th>Matched by</th><th>Data</th></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.studentId + h.matchedBy}>
                <td><a href={`/admin/students/${encodeURIComponent(h.studentId)}`}>{h.studentId}</a></td>
                <td>{h.name}</td>
                <td className="mono">{h.passportId ?? "none yet"}</td>
                <td>{h.matchedBy}</td>
                <td><span className="pill">{SOURCE_LABEL[h.source] ?? h.source}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
