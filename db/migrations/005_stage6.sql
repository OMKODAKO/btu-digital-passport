-- Migration 005 (stage 6): staff accounts with roles, staff sessions, admin retry requests, audit log.
-- Adds tables and triggers only. Staff are kept apart from students: a student account or session
-- can never be used as a staff one.

CREATE TABLE staff (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  -- VIEWER: read-only monitoring. OPERATOR: VIEWER + may request retries of failed processing.
  role         TEXT NOT NULL CHECK (role IN ('VIEWER', 'OPERATOR')),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_demo      INTEGER NOT NULL DEFAULT 1 CHECK (is_demo IN (0, 1)),   -- created by the demo script, not by BTU IT
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE staff_credentials (
  staff_fk      INTEGER PRIMARY KEY REFERENCES staff(id),
  password_hash TEXT NOT NULL,                     -- scrypt, same scheme as student test logins
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Separate from student sessions, under its own cookie. Only the token's SHA-256 is stored.
CREATE TABLE staff_sessions (
  token_sha256 TEXT PRIMARY KEY,
  staff_fk     INTEGER NOT NULL REFERENCES staff(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

-- A staff request to retry a passport's failed generation or registration. The web app only records
-- the request; the worker (which alone holds the issuer key) carries it out with `python3 -m worker retry`.
-- A retry only uses skills already accepted from the sheet; it never changes a source record's state.
CREATE TABLE retry_requests (
  id           INTEGER PRIMARY KEY,
  passport_fk  INTEGER NOT NULL REFERENCES passports(id),
  requested_by INTEGER NOT NULL REFERENCES staff(id),
  requested_at TEXT NOT NULL,
  reason       TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('REQUESTED', 'RUNNING', 'DONE', 'FAILED', 'NOTHING_TO_DO')),
  started_at   TEXT,
  finished_at  TEXT,
  result_json  TEXT
);
-- One open request per passport, so double clicks or parallel staff can't queue the same work twice.
CREATE UNIQUE INDEX one_open_retry ON retry_requests(passport_fk) WHERE state IN ('REQUESTED', 'RUNNING');

-- Append-only record of issuance, updates and staff actions.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('STAFF', 'WORKER', 'SYSTEM')),
  actor_ref   TEXT,                                -- staff email, or 'worker'
  action      TEXT NOT NULL,                       -- e.g. VERSION_ISSUED, RETRY_REQUESTED, STAFF_LOGIN
  passport_fk INTEGER REFERENCES passports(id),
  details     TEXT                                 -- JSON; never passwords, tokens or keys
);
CREATE INDEX audit_log_passport ON audit_log(passport_fk);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit entries are never changed'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit entries are never deleted'); END;
CREATE TRIGGER retry_requests_no_delete BEFORE DELETE ON retry_requests
BEGIN SELECT RAISE(ABORT, 'retry requests are never deleted'); END;
