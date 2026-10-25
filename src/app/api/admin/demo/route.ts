import { NextResponse } from "next/server";
import { DEMO_LOGIN } from "@/lib/config";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { signInStaff } from "@/lib/auth/signin";
import { isSameOrigin, redirect } from "@/lib/request";

// POST /api/admin/demo  (form: email). Local demo only (PASSPORT_DEMO_LOGIN=1): signs in as a demo staff account
// (is_demo = 1) without a password. Real staff accounts always need Google.
export async function POST(req: Request) {
  if (!DEMO_LOGIN) return new NextResponse("Not found", { status: 404 });
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });
  const email = String((await req.formData()).get("email") ?? "").trim().toLowerCase();
  const row = getDb().prepare("SELECT id, email FROM staff WHERE lower(email) = ? AND active = 1 AND is_demo = 1").get(email) as
    { id: number; email: string } | undefined;
  if (!row) return redirect("/admin/login?error=demo_unknown");
  audit({ kind: "STAFF", ref: row.email }, "STAFF_LOGIN", null, { method: "demo" });
  return signInStaff(redirect("/admin"), row.id);
}
