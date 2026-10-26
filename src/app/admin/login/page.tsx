import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PassportFrame from "@/components/PassportFrame";
import { getCurrentStaff } from "@/lib/auth/staff";
import { DEMO_LOGIN, GOOGLE_LOGIN, PASSWORD_LOGIN } from "@/lib/config";
import { getDb } from "@/lib/db";

export const metadata = { title: "BTU passport admin: sign in" };

const ERRORS: Record<string, string> = {
  missing: "Enter both your email and your password.",
  invalid: "The email or password is incorrect.",
  locked: "Too many failed attempts for this email. Wait 15 minutes and try again.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in didn't complete. Try again.",
  google_unverified: "Google hasn't verified this account's email address.",
  google_domain: "Sign in with your BTU Google account.",
  google_unknown: "This Google account isn't on the staff list.",
  google_linked: "This staff record is already linked to a different Google account.",
  demo_unknown: "That demo staff account doesn't exist.",
};

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string; signedout?: string }> }) {
  if (await getCurrentStaff()) redirect("/admin");
  const { error, signedout } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.google_failed) : null;
  const demoStaff = DEMO_LOGIN
    ? (getDb().prepare("SELECT email, display_name AS name, role FROM staff WHERE active = 1 AND is_demo = 1 ORDER BY role DESC, email")
        .all() as { email: string; name: string; role: string }[])
    : [];
  return (
    <>
    <AppHeader area="staff" home="/admin/login" />
    <PassportFrame>
      <div className="lp-sheet pp-auth">
      <section className="pp-auth-intro">
        <p className="lp-who">BTU staff · პერსონალი</p>
        <h1 className="lp-title pp-auth-title"><strong>Passport</strong> administration</h1>
        <hr className="lp-rule" />
        <p className="lp-lead">სტუდენტები, საგნები, ქულები და პასპორტების გაცემა ერთ ადგილას. მხოლოდ BTU-ის უფლებამოსილი პერსონალისთვის.</p>
      </section>
      <div className="pp-login">
        <h2 className="pp-login-title">Staff sign-in</h2>
        <p className="muted">For authorised BTU staff. Student accounts can&apos;t sign in here.</p>
        {message && (
          <p className="alert error" role="alert">
            {message}
          </p>
        )}
        {signedout && !message && (
          <p className="alert info" role="status">
            You have been signed out.
          </p>
        )}
        {GOOGLE_LOGIN && (
          <a className="button primary google" href="/api/auth/google?as=staff" data-testid="google-login">
            Sign in with Google
          </a>
        )}
        {DEMO_LOGIN && demoStaff.length > 0 && (
          <div className="form" data-testid="demo-login">
            <label>Demo: sign in as a demo staff account, no password</label>
            <div className="demo-staff">
              {demoStaff.map((s) => (
                <form key={s.email} method="post" action="/api/admin/demo">
                  <input type="hidden" name="email" value={s.email} />
                  <button type="submit" className="button">{s.name} · {s.role}</button>
                </form>
              ))}
            </div>
            <p className="fine">Local demo only. Real staff sign in with Google, using the email on the staff list.</p>
          </div>
        )}
        {PASSWORD_LOGIN && (
          <form method="post" action="/api/admin/login" className="form">
            <label htmlFor="email">Staff email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit" className="button primary">
              Sign in
            </button>
          </form>
        )}
        {!GOOGLE_LOGIN && !DEMO_LOGIN && !PASSWORD_LOGIN && (
          <p className="alert info" role="status">Sign-in isn&apos;t set up on this server yet (Google sign-in needs its client ID).</p>
        )}
      </div>
      </div>
    </PassportFrame>
    </>
  );
}
