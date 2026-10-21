import { NextResponse } from "next/server";
import { can, getCurrentStaff } from "@/lib/auth/staff";
import { passportFkById, retryEligibility } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isSameOrigin, redirect } from "@/lib/request";

// POST /api/admin/retry  (form fields: passport, reason)
// Records a retry request for one passport. OPERATOR role only, checked here on the server.
// The worker carries it out (`python3 -m worker retry`), using skills already accepted from the
// sheet; nothing here changes a source record, a skill award or an issued version.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return text(403, "Forbidden");
  const staff = await getCurrentStaff();
  if (!staff) return text(401, "Staff sign-in required.");

  const form = await req.formData();
  const passportId = String(form.get("passport") ?? "");
  const reason = String(form.get("reason") ?? "").trim().slice(0, 300);
  const fk = passportFkById(passportId);

  if (!can(staff, "retry")) {
    audit({ kind: "STAFF", ref: staff.email }, "RETRY_DENIED", fk, { role: staff.role });
    return text(403, "Your role can view records but not retry processing.");
  }
  if (fk === null) return text(404, "No such passport.");
  if (!reason) return text(400, "Give a short reason for the retry.");

  const check = retryEligibility(fk);
  if (!check.eligible) {
    return text(409, check.open ? "A retry for this passport is already queued." : "Nothing to retry for this passport.");
  }
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO retry_requests (passport_fk, requested_by, requested_at, reason, state) VALUES (?, ?, ?, ?, 'REQUESTED')",
    ).run(fk, staff.id, new Date().toISOString().slice(0, 19) + "Z", reason);
  } catch {
    return text(409, "A retry for this passport is already queued."); // the unique index caught a double submit
  }
  audit({ kind: "STAFF", ref: staff.email }, "RETRY_REQUESTED", fk, { reason, because: check.reasons });
  const { student_id } = db
    .prepare("SELECT s.student_id FROM passports p JOIN students s ON s.id = p.student_fk WHERE p.id = ?")
    .get(fk) as { student_id: string };
  return redirect(`/admin/students/${encodeURIComponent(student_id)}?retry=queued`);
}

function text(status: number, message: string) {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
