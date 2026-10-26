import TierBadge from "@/components/TierBadge";
import { requireStaff } from "@/lib/auth/staff";
import { courseRows, ectsLabel, KINDS } from "@/lib/subjects";

const KIND_LABEL = { QUIZ: "Quizzes", ASSIGNMENT: "Assignments", PROJECT: "Project", MIDTERM: "Midterm", FINAL: "Final" };

export default async function CourseResults() {
  await requireStaff();
  const rows = courseRows();
  return (
    <section className="card">
      <div className="toolbar">
        <h2>Course results</h2>
        <a className="button small" href="/api/admin/courses" data-testid="courses-csv">Download CSV</a>
      </div>
      <p className="muted">One line per student per course, with the latest marks. Totals are out of 100.</p>
      {rows.length === 0 ? (
        <p className="muted" data-testid="no-courses">No marks entered yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table" data-testid="courses">
            <thead>
              <tr>
                <th>Student ID</th><th>Name</th><th>Program</th><th>Course</th><th>ECTS</th>
                {KINDS.map((k) => <th key={k}>{KIND_LABEL[k]}</th>)}
                <th>Total</th><th>Badge</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId + r.subjectCode} data-row={`${r.studentId}:${r.subjectCode}`}>
                  <td><a href={`/admin/students/${encodeURIComponent(r.studentId)}#subjects`}>{r.studentId}</a></td>
                  <td>{r.firstName} {r.lastName}</td>
                  <td>{[r.program, r.educationLevel].filter(Boolean).join(", ") || "—"}</td>
                  <td>{r.subjectEn}</td>
                  <td>{ectsLabel(r.subjectCode, r.credits)}</td>
                  {KINDS.map((k) => <td key={k} className="mono">{k in r.points ? (r.points[k] ?? "…") : "—"}</td>)}
                  <td className="mono" data-testid="total">{r.total ?? "…"}</td>
                  <td>{r.resultStatus === "COMPLETE" ? <TierBadge tier={r.tier} /> : <span className="pill">Pending</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine">… not marked yet · — not part of that course&apos;s syllabus.</p>
    </section>
  );
}
