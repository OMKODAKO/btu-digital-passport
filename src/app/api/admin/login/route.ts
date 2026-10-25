import { NextResponse } from "next/server";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/auth/credentials";
import { createStaffSession, staffCookieOptions, verifyStaffCredentials } from "@/lib/auth/staff";
import { audit } from "@/lib/audit";
import { cookieOptions, deleteSession } from "@/lib/auth/session";
import { SESSION_COOKIE, STAFF_COOKIE, STAFF_SESSION_HOURS } from "@/lib/config";
import { cookies } from "next/headers";
import { isSameOrigin, redirect } from "@/lib/request";
import { PASSWORD_LOGIN } from "@/lib/config";

// POST /api/admin/login  (form fields: email, password). Staff accounts only; student logins don't work here.
export async function POST(req: Request) {
  const back = (error: string) => redirect(`/admin/login?error=${error}`);
  // Passwords are switched off (Google and the local demo sign-in replace them); only the tests turn them on.
  if (!PASSWORD_LOGIN) return new NextResponse("Not found", { status: 404 });
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const password = String(form.get("password") ?? "");
  if (!email || !password) return back("missing");
  const key = `staff:${email}`;
  if (isLockedOut(key)) return back("locked");

  const staffFk = await verifyStaffCredentials(email, password);
  if (staffFk === null) {
    recordFailure(key);
    audit({ kind: "SYSTEM", ref: null }, "STAFF_LOGIN_FAILED", null, { email: email.slice(0, 100) });
    return back("invalid");
  }
  clearFailures(key);
  audit({ kind: "STAFF", ref: email.toLowerCase() }, "STAFF_LOGIN");
  const res = redirect("/admin");
  res.cookies.set(STAFF_COOKIE, createStaffSession(staffFk), { ...staffCookieOptions, maxAge: STAFF_SESSION_HOURS * 3600 });
  // One role per browser: signing in as staff ends any student session here.
  const studentToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (studentToken) {
    deleteSession(studentToken);
    res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  }
  return res;
}
