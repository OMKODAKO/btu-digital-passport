import { NextResponse } from "next/server";
import { clearFailures, isLockedOut, recordFailure, verifyCredentials } from "@/lib/auth/credentials";
import { cookieOptions, createSession } from "@/lib/auth/session";
import { deleteStaffSession, staffCookieOptions } from "@/lib/auth/staff";
import { SESSION_COOKIE, SESSION_HOURS, STAFF_COOKIE } from "@/lib/config";
import { cookies } from "next/headers";
import { isSameOrigin, redirect } from "@/lib/request";
import { PASSWORD_LOGIN } from "@/lib/config";

// POST /api/auth/login  (form fields: email, password)
// Success: session cookie + redirect to /dashboard. Failure: back to /login with an error code.
export async function POST(req: Request) {
  const back = (error: string) => redirect(`/login?error=${error}`);
  // Passwords are switched off (Google and the local demo sign-in replace them); only the tests turn them on.
  if (!PASSWORD_LOGIN) return new NextResponse("Not found", { status: 404 });
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });

  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return back("missing");
  if (isLockedOut(email)) return back("locked");

  const studentFk = await verifyCredentials(email, password);
  if (studentFk === null) {
    recordFailure(email);
    return back("invalid");
  }

  clearFailures(email);
  const res = redirect("/dashboard");
  res.cookies.set(SESSION_COOKIE, createSession(studentFk, "password"), {
    ...cookieOptions,
    maxAge: SESSION_HOURS * 3600,
  });
  // One role per browser: signing in as a student ends any staff session here.
  const staffToken = (await cookies()).get(STAFF_COOKIE)?.value;
  if (staffToken) {
    deleteStaffSession(staffToken);
    res.cookies.set(STAFF_COOKIE, "", { ...staffCookieOptions, maxAge: 0 });
  }
  return res;
}
