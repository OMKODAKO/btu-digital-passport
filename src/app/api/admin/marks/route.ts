import { NextResponse } from "next/server";
import { can, getCurrentStaff } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isSameOrigin, redirect } from "@/lib/request";
import { MarkError, markSheet, recordMarks } from "@/lib/subjects";

// POST /api/admin/marks  (form: student, subject, note?, and c<position> = points for each component to record)
// Records a student's marks in one passport subject. OPERATOR role only. Marks are append-only: a different
// mark for an already marked component is stored as a correction; an empty field leaves that component as it is.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return text(403, "Forbidden");
  const staff = await getCurrentStaff();
  if (!staff) return text(401, "Staff sign-in required.");
  const f = await req.formData();
  const studentId = String(f.get("student") ?? "");
  const code = String(f.get("subject") ?? "");
  if (!can(staff, "manage")) {
    audit({ kind: "STAFF", ref: staff.email }, "MARKS_DENIED", null, { role: staff.role, student: studentId, subject: code });
    return text(403, "Your role can view records but not enter marks.");
  }
  const student = getDb().prepare("SELECT id FROM students WHERE student_id = ?").get(studentId) as { id: number } | undefined;
  if (!student) return text(404, "No such student.");
  const back = `/admin/students/${encodeURIComponent(studentId)}/marks/${encodeURIComponent(code)}`;
  try {
    const sheet = markSheet(student.id, code);
    if (!sheet) throw new MarkError(`No subject ${code}.`);
    const marks: Record<string, number> = {};
    for (const c of sheet.subject.components) {
      const raw = String(f.get(`c${c.position}`) ?? "").trim().replace(",", ".");
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new MarkError(`${c.label}: "${raw}" is not a number.`);
      marks[c.label] = n;
    }
    const note = String(f.get("note") ?? "").trim().slice(0, 300) || null;
    const r = recordMarks(student.id, code, marks, staff.email, note);
    if (r.added.length || r.corrected.length) {
      audit({ kind: "STAFF", ref: staff.email }, "GRADES_RECORDED", null, {
        student: studentId, subject: code, added: r.added, corrected: r.corrected, note });
    }
    return redirect(`/admin/students/${encodeURIComponent(studentId)}?marks=${r.added.length + r.corrected.length}#subjects`);
  } catch (e) {
    if (!(e instanceof MarkError)) throw e;
    return redirect(`${back}?error=${encodeURIComponent(e.message)}`);
  }
}

function text(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
