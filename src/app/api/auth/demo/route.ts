import { NextResponse } from "next/server";
import { DEMO_LOGIN } from "@/lib/config";
import { getDb } from "@/lib/db";
import { signInStudent } from "@/lib/auth/signin";
import { isSameOrigin, redirect } from "@/lib/request";

// POST /api/auth/demo  (form: student = Student ID). Local demo only (PASSPORT_DEMO_LOGIN=1): signs in as that
// student without a password. Off everywhere else, where this route doesn't exist.
export async function POST(req: Request) {
  if (!DEMO_LOGIN) return new NextResponse("Not found", { status: 404 });
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });
  const studentId = String((await req.formData()).get("student") ?? "").trim().toUpperCase();
  const row = getDb().prepare("SELECT id FROM students WHERE student_id = ?").get(studentId) as { id: number } | undefined;
  if (!row) return redirect("/login?error=demo_unknown");
  return signInStudent(redirect("/dashboard"), row.id, "demo");
}
