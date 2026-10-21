import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, deleteSession } from "@/lib/auth/session";
import { SESSION_COOKIE } from "@/lib/config";
import { isSameOrigin, redirect } from "@/lib/request";

// POST /api/auth/logout: ends the session on the server and clears the cookie.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse("Forbidden", { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  const res = redirect("/login?signedout=1");
  res.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
