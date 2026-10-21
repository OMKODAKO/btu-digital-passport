-- Migration 001 (stage 1): students, test-account passwords, sessions, passports, versions.
-- Written with IF NOT EXISTS so it is safe on databases created before migrations existed.

CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY,
  student_id  TEXT NOT NULL UNIQUE,                 -- 'BTU-T-0001', from BTU's test data
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  source      TEXT NOT NULL CHECK (source IN ('BTU_TEST_DATA', 'SEED_SYNTHETIC')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Password sign-in for test accounts. Kept apart from students so other
-- sign-in methods (Google) can be added as their own table later.
CREATE TABLE IF NOT EXISTS auth_credentials (
  student_fk     INTEGER PRIMARY KEY REFERENCES students(id),
  password_hash  TEXT NOT NULL,                     -- scrypt, see src/lib/auth/password.ts
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Only the SHA-256 of a session token is stored; the token itself lives in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
  token_sha256  TEXT PRIMARY KEY,
  student_fk    INTEGER NOT NULL REFERENCES students(id),
  auth_method   TEXT NOT NULL,                      -- 'password' now, 'google' later
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_student ON sessions(student_fk);

CREATE TABLE IF NOT EXISTS passports (
  id                 INTEGER PRIMARY KEY,
  passport_id        TEXT NOT NULL UNIQUE,          -- 'BTU-AI-000125', permanent
  student_fk         INTEGER NOT NULL UNIQUE REFERENCES students(id),
  holder_first_name  TEXT NOT NULL,
  holder_last_name   TEXT NOT NULL,
  first_issued_on    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_versions (
  id                 INTEGER PRIMARY KEY,
  passport_fk        INTEGER NOT NULL REFERENCES passports(id),
  version_no         INTEGER NOT NULL,
  verification_code  TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL CHECK (status IN ('CURRENT', 'SUPERSEDED')),
  issued_at          TEXT NOT NULL,
  pdf_storage_key    TEXT NOT NULL UNIQUE,          -- path inside DATA_DIR/storage
  pdf_sha256         TEXT NOT NULL UNIQUE,          -- hash of the exact stored bytes
  chain_tx_hash      TEXT,                          -- NULL: not registered on a blockchain yet
  UNIQUE (passport_fk, version_no)
);
-- At most one current version per passport.
CREATE UNIQUE INDEX IF NOT EXISTS one_current_version
  ON passport_versions(passport_fk) WHERE status = 'CURRENT';
