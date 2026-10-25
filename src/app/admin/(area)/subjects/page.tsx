import SyllabusDialog from "@/components/SyllabusDialog";
import { requireStaff } from "@/lib/auth/staff";
import { listSubjects } from "@/lib/subjects";

export default async function Subjects({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireStaff();
  const all = (await searchParams).all === "1";
  const subjects = listSubjects(all);
  return (
    <section className="card">
      <div className="toolbar">
        <h2>{all ? "All BTU subjects" : "Passport subjects"}</h2>
        <a className="button small" href={all ? "/admin/subjects" : "/admin/subjects?all=1"}>
          {all ? "Only passport subjects" : "Show all subjects"}
        </a>
      </div>
      <p className="muted">
        Subjects from BTU&apos;s course list. Only those marked for the passport take marks and badges. Each syllabus is
        simulated, because BTU&apos;s syllabi aren&apos;t available here.
      </p>
      {subjects.length === 0 ? (
        <p className="alert info" data-testid="no-subjects">
          The subject catalog isn&apos;t loaded yet. Run <code>python3 -m worker subjects load</code>.
        </p>
      ) : (
        <table className="table" data-testid="subjects">
          <thead><tr><th>Subject</th><th>Area</th><th>ECTS</th><th>Syllabus</th>{all && <th>Passport</th>}</tr></thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.code} data-code={s.code}>
                <td>{s.nameEn}<div className="fine" lang="ka" style={{ margin: 0 }}>{s.nameKa}</div></td>
                <td>{s.skillArea ?? "—"}</td>
                <td>{s.credits}</td>
                <td>
                  <SyllabusDialog name={s.nameEn} version={s.syllabusVersion} simulated={s.simulated}
                    components={s.components.map(({ kind, label, weight, maxPoints }) => ({ kind, label, weight, maxPoints }))} />
                </td>
                {all && <td>{s.passportRelevant ? <span className="pill ok">Yes</span> : <span className="pill">No</span>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
