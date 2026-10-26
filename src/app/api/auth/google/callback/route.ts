import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GOOGLE_COOKIE, GOOGLE_LOGIN } from "@/lib/config";
import { audit } from "@/lib/audit";
import { decodeFlow, GoogleError, linkedAccount, redirectUri, sameState, verifiedUser } from "@/lib/auth/google";
import { signInStaff, signInStudent } from "@/lib/auth/signin";
import { redirect } from "@/lib/request";

// GET /api/auth/google/callback?code&state: Google sends the browser back here after the account is chosen.
export async function GET(req: Request) {
  if (!GOOGLE_LOGIN) return new NextResponse("Google sign-in is not configured.", { status: 404 });
  const q = new URL(req.url).searchParams;
  const flow = decodeFlow((await cookies()).get(GOOGLE_COOKIE)?.value);
  const loginPage = flow?.as === "staff" ? "/admin/login" : "/login";
  const back = (code: string) => {
    const res = redirect(`${loginPage}?error=google_${code}`);
    res.cookies.set(GOOGLE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return res;
  };
  if (!flow || !sameState(q.get("state") ?? "", flow.state)) return back("failed");
  if (q.get("error")) return back("cancelled");
  const code = q.get("code");
  if (!code) return back("failed");

  try {
    const user = await verifiedUser(code, flow, redirectUri(req));
    const fk = linkedAccount(flow.as, user);
    if (flow.as === "staff") {
      audit({ kind: "STAFF", ref: user.email }, "STAFF_LOGIN", null, { method: "google" });
      // The staff cookie is SameSite=Strict, so a browser doesn't send it on a redirect that is still part of the
      // trip back from Google. A small page that moves on by itself makes the next request a same-site one.
      const res = new NextResponse(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/admin"><title>Signing in</title>' +
          '<p style="font-family:sans-serif">Signed in. <a href="/admin">Continue to the admin area</a></p>',
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      );
      res.cookies.set(GOOGLE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
      return signInStaff(res, fk);
    }
    const res = redirect("/dashboard");
    res.cookies.set(GOOGLE_COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
    return signInStudent(res, fk, "google");
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    if (flow.as === "staff") audit({ kind: "SYSTEM", ref: null }, "STAFF_LOGIN_FAILED", null, { method: "google", reason: e.code });
    return back(e.code);
  }
}
