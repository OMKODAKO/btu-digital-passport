import { NextResponse } from "next/server";
import { GOOGLE_COOKIE, GOOGLE_LOGIN } from "@/lib/config";
import { authorizationUrl, encodeFlow, newFlow, redirectUri } from "@/lib/auth/google";

// GET /api/auth/google?as=student|staff: starts Google sign-in. The state, nonce and PKCE verifier go into a
// short-lived httpOnly cookie that only the callback reads.
export async function GET(req: Request) {
  if (!GOOGLE_LOGIN) return new NextResponse("Google sign-in is not configured.", { status: 404 });
  const as = new URL(req.url).searchParams.get("as") === "staff" ? "staff" : "student";
  const flow = newFlow(as);
  const res = NextResponse.redirect(authorizationUrl(flow, redirectUri(req)), 303);
  res.cookies.set(GOOGLE_COOKIE, encodeFlow(flow), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && redirectUri(req).startsWith("https:"),
    path: "/api/auth/google", maxAge: 600,
  });
  return res;
}
