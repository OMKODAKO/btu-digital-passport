import { can, requireStaff } from "@/lib/auth/staff";
import { EDUCATION_LEVELS, nextStudentId, STUDENT_STATUSES } from "@/lib/students";

export default async function NewStudent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requireStaff();
  if (!can(staff, "manage")) {
    return (
      <section className="card notice">
        <h2>Add a student</h2>
        <p className="fine">Your role ({staff.role}) can view records but can&apos;t add students.</p>
      </section>
    );
  }
  const { error } = await searchParams;
  const next = nextStudentId();
  return (
    <section className="card">
      <h2>Add a student</h2>
      <p className="muted">
        For the demo: BTU&apos;s student records aren&apos;t available, so students added here are labelled synthetic.
      </p>
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      <form method="post" action="/api/admin/students" className="form" data-testid="new-student">
        <div className="formgrid">
          <div className="form"><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" required maxLength={80} /></div>
          <div className="form"><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" required maxLength={80} /></div>
          <div className="form">
            <label htmlFor="studentId">Student ID</label>
            <input id="studentId" name="studentId" placeholder={`${next} (automatic)`} maxLength={20} />
          </div>
          <div className="form">
            <label htmlFor="email">BTU email</label>
            <input id="email" name="email" type="email" placeholder={`${next.toLowerCase()}@example.org (automatic)`} maxLength={160} />
          </div>
          <div className="form"><label htmlFor="program">Program</label>
            <input id="program" name="program" placeholder="e.g. Computer Science and Artificial Intelligence" maxLength={160} /></div>
          <div className="form"><label htmlFor="educationLevel">Education level</label>
            <select id="educationLevel" name="educationLevel" defaultValue="Bachelor's">
              <option value="">Not given</option>
              {EDUCATION_LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select></div>
          <div className="form"><label htmlFor="status">Student status</label>
            <select id="status" name="status" defaultValue="Active">
              {STUDENT_STATUSES.map((l) => <option key={l}>{l}</option>)}
            </select></div>
        </div>
        <label className="check"><input type="checkbox" name="createLogin" defaultChecked /> Create a test login (the password is shown once)</label>
        <div><button type="submit" className="button primary" style={{ width: "auto" }}>Add student</button></div>
      </form>
    </section>
  );
}
