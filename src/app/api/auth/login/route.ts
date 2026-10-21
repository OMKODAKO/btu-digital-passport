import { NextResponse } from "next/server";
import { clearFailures, isLockedOut, recordFailure, verifyCredentials } from "@/lib/auth/credentials";
import { cookieOptions, createSession } from "@/lib/auth/session";
import { SESSION_COOKIE, SESSION_HOURS } from "@/lib/config";
import { isSameOrigin, redirect } from "@/lib/request";

// POST /api/auth/login  (form fields: email, password)
// Success: session cookie + redirect to /dashboard. Failure: back to /login with an error code.
export async function POST(req: Request) {
  const back = (error: string) => redirect(`/login?error=${error}`);
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
  return res;
}
