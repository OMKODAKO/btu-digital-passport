import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import PassportFrame from "@/components/PassportFrame";
import PassportStickers from "@/components/PassportStickers";
import { getCurrentStudent } from "@/lib/auth/session";
import { DEMO_LOGIN, GOOGLE_LOGIN, PASSWORD_LOGIN } from "@/lib/config";
import { getDb } from "@/lib/db";

const ERRORS: Record<string, string> = {
  missing: "Enter both your email and your password.",
  invalid: "The email or password is incorrect. Check both and try again.",
  locked: "Too many failed attempts for this email. Wait 15 minutes and try again.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in didn't complete. Try again.",
  google_unverified: "Google hasn't verified this account's email address.",
  google_domain: "Sign in with your BTU Google account.",
  google_unknown: "No passport for this account at this stage: no BTU student record uses this Google account's email address.",
  google_linked: "This student record is already linked to a different Google account.",
  demo_unknown: "That student isn't in the demo any more.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedout?: string }>;
}) {
  if (await getCurrentStudent()) redirect("/dashboard");
  const { error, signedout } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.google_failed) : null;
  const demoStudents = DEMO_LOGIN
    ? (getDb()
        .prepare("SELECT student_id AS id, first_name || ' ' || last_name AS name FROM students ORDER BY last_name, first_name LIMIT 1000")
        .all() as { id: string; name: string }[])
    : [];

  return (
    <>
    <AppHeader area="public" home="/">
      <a className="appbar-link" href="/verify">Verify a passport</a>
    </AppHeader>
    <PassportFrame>
      <div className="lp-sheet pp-auth">
      <section className="pp-auth-intro">
        <p className="lp-who">Students · სტუდენტები</p>
        <h1 className="lp-title pp-auth-title"><strong>Your AI skills,</strong> verified by BTU</h1>
        <hr className="lp-rule" />
        <p className="lp-lead">
          შენი უნიკალური პასპორტი: ყოველი უნარი, რომელსაც BTU-ში დაეუფლები, აქ შტამპად ემატება. ნახე, ჩამოტვირთე და გაუზიარე ნებისმიერს, ნამდვილობას კი ბლოკჩეინი დაადასტურებს.
        </p>
        <PassportStickers className="pp-auth-art" />
      </section>
      <div className="pp-login">
        <h2 className="pp-login-title">Sign in</h2>

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
          <a className="button primary google" href="/api/auth/google?as=student" data-testid="google-login">
            Sign in with Google
          </a>
        )}

        {DEMO_LOGIN && (
          <form method="post" action="/api/auth/demo" className="form" data-testid="demo-login">
            <label htmlFor="student">Demo: open any student&apos;s passport, no password</label>
            <select id="student" name="student" required defaultValue="">
              <option value="" disabled>Choose a student…</option>
              {demoStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.id}</option>
              ))}
            </select>
            <button type="submit" className="button">Open as this student</button>
            <p className="fine">Local demo only. A real deployment signs students in with Google.</p>
            {!GOOGLE_LOGIN && (
              <p className="fine" data-testid="google-setup-hint">
                Google sign-in is off on this copy. To switch it on, run <code>npm run google:setup</code> and restart.
              </p>
            )}
          </form>
        )}

        {PASSWORD_LOGIN && (
          <form method="post" action="/api/auth/login" className="form">
            <label htmlFor="email">Email</label>
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
        <p className="fine">
          Checking someone&apos;s passport? <a href="/verify">Verify a passport</a> (no account needed).
        </p>
      </div>
      </div>
    </PassportFrame>
    </>
  );
}
