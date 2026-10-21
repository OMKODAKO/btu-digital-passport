import { redirect } from "next/navigation";
import { getCurrentStudent } from "@/lib/auth/session";

const ERRORS: Record<string, string> = {
  missing: "Enter both your email and your password.",
  invalid: "The email or password is incorrect. Check both and try again.",
  locked: "Too many failed attempts for this email. Wait 15 minutes and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signedout?: string }>;
}) {
  if (await getCurrentStudent()) redirect("/dashboard");
  const { error, signedout } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.invalid) : null;

  return (
    <main className="center">
      <div className="card login">
        <p className="eyebrow">BTU</p>
        <h1>AI Skills Digital Passport</h1>
        <p className="muted">Sign in to view and download your passport.</p>

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

        <form method="post" action="/api/auth/login" className="form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <button type="submit" className="button primary">
            Sign in
          </button>
        </form>
        <p className="fine">Prototype: test accounts only. BTU Google sign-in comes in a later stage.</p>
        <p className="fine">
          Checking someone&apos;s passport? <a href="/verify">Verify a passport</a> (no account needed).
        </p>
      </div>
    </main>
  );
}
