import path from "node:path";

// Everything private (database, stored PDFs, generated test passwords) lives in DATA_DIR,
// which is outside the public web root and ignored by git.
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const DB_PATH = path.join(DATA_DIR, "portal.db");
export const STORAGE_DIR = path.join(DATA_DIR, "storage");
export const MIGRATIONS_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), "db", "migrations");

export const SESSION_COOKIE = "bdp_session";
export const SESSION_HOURS = 8;

export const STAFF_COOKIE = "bdp_staff";
export const STAFF_SESSION_HOURS = 4;

// Student sign-in is limited to these email domains (comma-separated). BTU's test data uses
// example.org; production would be BTU's own domain. Empty: no domain limit.
export const STUDENT_EMAIL_DOMAINS = (process.env.STUDENT_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
