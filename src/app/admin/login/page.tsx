import { redirect } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { getCurrentStaff } from "@/lib/auth/staff";

export const metadata = { title: "BTU passport admin: sign in" };

const ERRORS: Record<string, string> = {
  missing: "Enter both your email and your password.",
  invalid: "The email or password is incorrect.",
  locked: "Too many failed attempts for this email. Wait 15 minutes and try again.",
};

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ error?: string; signedout?: string }> }) {
  if (await getCurrentStaff()) redirect("/admin");
  const { error, signedout } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.invalid) : null;
  return (
    <>
    <AppHeader area="staff" home="/admin/login" />
    <main className="auth auth-staff">
      <div className="card login">
        <p className="eyebrow">BTU staff</p>
        <h1>Passport administration</h1>
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
        <form method="post" action="/api/admin/login" className="form">
          <label htmlFor="email">Staff email</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit" className="button primary">
            Sign in
          </button>
        </form>
        <p className="fine">Prototype: demo staff accounts only. BTU single sign-on for staff isn&apos;t connected yet.</p>
      </div>
    </main>
    </>
  );
}
