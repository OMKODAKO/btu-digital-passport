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
