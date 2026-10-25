import SyllabusDialog from "@/components/SyllabusDialog";
import TierBadge from "@/components/TierBadge";
import { can, requireStaff } from "@/lib/auth/staff";
import { getDb } from "@/lib/db";
import { markSheet, studentResults } from "@/lib/subjects";
import { redirect } from "next/navigation";

export default async function EnterMarks({ params, searchParams }: {
  params: Promise<{ studentId: string; subject: string }>; searchParams: Promise<{ error?: string; subject?: string }>;
}) {
  const staff = await requireStaff();
  const p = await params;
  const studentId = decodeURIComponent(p.studentId);
  const code = decodeURIComponent(p.subject);
  const { error, subject: chosen } = await searchParams;
  // "go" is the target of the subject picker on the student page (a plain GET form)
  if (code === "go" && chosen) redirect(`/admin/students/${encodeURIComponent(studentId)}/marks/${encodeURIComponent(chosen)}`);
  const student = getDb()
    .prepare("SELECT id, first_name AS firstName, last_name AS lastName FROM students WHERE student_id = ?")
    .get(studentId) as { id: number; firstName: string; lastName: string } | undefined;
  const sheet = student ? markSheet(student.id, code) : null;
  if (!student || !sheet || !sheet.subject.passportRelevant) {
    return (
      <section className="card notice">
        <h2>Nothing to mark here</h2>
        <p className="muted">No such student or passport subject. <a href={`/admin/students/${encodeURIComponent(studentId)}`}>Back</a></p>
      </section>
    );
  }
  const { subject, marks } = sheet;
  const result = studentResults(student.id).find((r) => r.subject.code === code);
  const allowed = can(staff, "manage");
  return (
    <section className="card">
      <div className="toolbar">
        <h2>{subject.nameEn}</h2>
        <SyllabusDialog name={subject.nameEn} version={subject.syllabusVersion} simulated={subject.simulated}
          components={subject.components.map(({ kind, label, weight, maxPoints }) => ({ kind, label, weight, maxPoints }))} />
      </div>
      <p className="muted">
        {student.firstName} {student.lastName} · <a href={`/admin/students/${encodeURIComponent(studentId)}#subjects`}>{studentId}</a>
        {result && <> · now {result.status === "COMPLETE" ? <>{result.score} <TierBadge tier={result.tier} /></> : "in progress"}</>}
      </p>
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      {allowed ? (
        <form method="post" action="/api/admin/marks" data-testid="marks-form">
          <input type="hidden" name="student" value={studentId} />
          <input type="hidden" name="subject" value={code} />
          <div className="marks">
            {subject.components.map((c) => (
              <div key={c.label} style={{ display: "contents" }}>
                <label htmlFor={`c${c.position}`}>
                  {c.label} <span className="hint">· {c.weight}% · out of {c.maxPoints}</span>
                </label>
                <input id={`c${c.position}`} name={`c${c.position}`} inputMode="decimal" defaultValue={marks[c.label] ?? ""}
                  placeholder={`0–${c.maxPoints}`} />
              </div>
            ))}
          </div>
          <div className="form">
            <label htmlFor="note">Note (optional, kept with a correction)</label>
            <input id="note" name="note" maxLength={300} placeholder="e.g. re-marked final exam" />
          </div>
          <p className="fine">
            Leave a field empty to leave it unmarked. Changing a saved mark stores a correction; the old mark stays in the history.
          </p>
          <button type="submit" className="button primary" style={{ marginTop: 14 }}>Save marks</button>
        </form>
      ) : (
        <p className="fine">Your role ({staff.role}) can view marks but can&apos;t enter them.</p>
      )}
    </section>
  );
}
