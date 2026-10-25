import path from "node:path";

// Everything private (database, stored PDFs, generated test passwords) lives in DATA_DIR,
// which is outside the public web root and ignored by git.
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const DB_PATH = path.join(DATA_DIR, "portal.db");
export const STORAGE_DIR = path.join(DATA_DIR, "storage");
export const MIGRATIONS_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "db", "migrations");

// Browsers keep cookies per host, not per port: two copies of the portal on localhost (e.g. the live one on
// :3000 and a test copy on :3100) would overwrite each other's sign-in. A test copy sets its own prefix.
const COOKIE_PREFIX = (process.env.PASSPORT_COOKIE_PREFIX ?? "bdp").replace(/[^A-Za-z0-9_]/g, "") || "bdp";
export const SESSION_COOKIE = `${COOKIE_PREFIX}_session`;
export const SESSION_HOURS = 8;

export const STAFF_COOKIE = `${COOKIE_PREFIX}_staff`;
export const STAFF_SESSION_HOURS = 4;

// Student sign-in is limited to these email domains (comma-separated). BTU's test data uses
// example.org; production would be BTU's own domain. Empty: no domain limit.
export const STUDENT_EMAIL_DOMAINS = (process.env.STUDENT_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Sign-in methods. Merabi asked for no passwords: the forms are gone unless PASSPORT_PASSWORD_LOGIN=1, which only
// the automated tests (and copies that still rely on the old test logins) set.
export const PASSWORD_LOGIN = process.env.PASSPORT_PASSWORD_LOGIN === "1";
// Demo sign-in: pick any demo student, or a demo staff account, with one click. For a local demo only:
// quickstart sets it and starts the app on 127.0.0.1, so no other computer can reach it. Never set it on a server.
export const DEMO_LOGIN = process.env.PASSPORT_DEMO_LOGIN === "1";
// Google sign-in (OpenID Connect). Needs an OAuth client from Google Cloud Console; the redirect URI to register is
// <PUBLIC_BASE_URL>/api/auth/google/callback. GOOGLE_HOSTED_DOMAIN (e.g. btu.edu.ge) admits only that Workspace.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
export const GOOGLE_HOSTED_DOMAIN = (process.env.GOOGLE_HOSTED_DOMAIN ?? "").trim().toLowerCase();
export const GOOGLE_LOGIN = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
export const GOOGLE_COOKIE = `${COOKIE_PREFIX}_google`;
