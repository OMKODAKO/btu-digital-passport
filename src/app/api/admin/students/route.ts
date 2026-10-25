import { NextResponse } from "next/server";
import { can, getCurrentStaff } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { putFlash } from "@/lib/flash";
import { isSameOrigin, redirect } from "@/lib/request";
import { createStudent, StudentError } from "@/lib/students";

// POST /api/admin/students  (form: firstName, lastName, email?, studentId?, program?, educationLevel?, status?, createLogin?)
// Adds one synthetic student. OPERATOR role only, checked here on the server. A new test password is
// handed to the next page through a one-time flash, never in the URL, and never written to the audit log.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return text(403, "Forbidden");
  const staff = await getCurrentStaff();
  if (!staff) return text(401, "Staff sign-in required.");
  if (!can(staff, "manage")) {
    audit({ kind: "STAFF", ref: staff.email }, "STUDENT_CREATE_DENIED", null, { role: staff.role });
    return text(403, "Your role can view records but not add students.");
  }
  const f = await req.formData();
  const field = (k: string) => String(f.get(k) ?? "");
  try {
    const s = await createStudent(
      { firstName: field("firstName"), lastName: field("lastName"), email: field("email"), studentId: field("studentId"),
        program: field("program"), educationLevel: field("educationLevel"), status: field("status") },
      f.get("createLogin") === "on",
    );
    audit({ kind: "STAFF", ref: staff.email }, "STUDENT_CREATED", null, { student: s.studentId, login: !!s.password });
    const flash = s.password ? `&created=${putFlash(`${s.email}\t${s.password}`)}` : "";
    return redirect(`/admin/students/${encodeURIComponent(s.studentId)}?new=1${flash}`);
  } catch (e) {
    if (!(e instanceof StudentError)) throw e;
    return redirect(`/admin/students/new?error=${encodeURIComponent(e.message)}`);
  }
}

function text(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
