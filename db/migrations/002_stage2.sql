-- Migration 002 (stage 2): workbook import, awarded skills, version contents, sync status.
-- Adds tables and columns only; no existing row is changed or removed.

ALTER TABLE students ADD COLUMN program TEXT;
ALTER TABLE students ADD COLUMN education_level TEXT;
ALTER TABLE students ADD COLUMN student_status TEXT;

-- One row per import of a workbook (later: per Google Sheets sync).
CREATE TABLE import_runs (
  id            INTEGER PRIMARY KEY,
  source_type   TEXT NOT NULL CHECK (source_type IN ('XLSX', 'GOOGLE_SHEETS')),
  source_name   TEXT NOT NULL,                   -- file name or sheet id
  source_sha256 TEXT,                            -- hash of the file read
  sheet_name    TEXT,
  header_row    INTEGER,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  summary_json  TEXT
);

-- Latest known state of every source record, keyed by the sheet's Record ID.
CREATE TABLE source_records (
  record_id      TEXT PRIMARY KEY,               -- 'REC-0001'
  student_code   TEXT,                           -- Student ID as written in the sheet
  sheet_row      INTEGER NOT NULL,
  raw_json       TEXT NOT NULL,                  -- the A–P values exactly as read
  fingerprint    TEXT NOT NULL,                  -- SHA-256 of the normalised A–P values
  state          TEXT NOT NULL CHECK (state IN ('ACCEPTED', 'INVALID', 'HELD')),
  first_seen_run INTEGER NOT NULL REFERENCES import_runs(id),
  last_seen_run  INTEGER NOT NULL REFERENCES import_runs(id)
);

-- Every problem found in a run, traceable to its sheet row and Record ID.
CREATE TABLE row_issues (
  id           INTEGER PRIMARY KEY,
  run_fk       INTEGER NOT NULL REFERENCES import_runs(id),
  sheet_row    INTEGER,
  record_id    TEXT,
  student_code TEXT,
  severity     TEXT NOT NULL CHECK (severity IN ('ERROR', 'HOLD', 'WARNING')),
  code         TEXT NOT NULL,                    -- e.g. MISSING_FIELD, IDENTITY_CONFLICT
  message      TEXT NOT NULL
);
CREATE INDEX row_issues_run ON row_issues(run_fk);

-- Skill catalog, derived from the sheet (one definition per Skill ID).
CREATE TABLE catalog_skills (
  skill_id       TEXT PRIMARY KEY,               -- 'SKL-001'
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  badge_code     TEXT NOT NULL,
  description    TEXT NOT NULL,
  first_seen_run INTEGER NOT NULL REFERENCES import_runs(id)
);

-- What passports are built from. A row is written once and never edited or deleted.
CREATE TABLE skill_awards (
  id                 INTEGER PRIMARY KEY,
  record_id          TEXT NOT NULL UNIQUE REFERENCES source_records(record_id),
  student_fk         INTEGER NOT NULL REFERENCES students(id),
  skill_id           TEXT NOT NULL REFERENCES catalog_skills(skill_id),
  skill_name         TEXT NOT NULL,
  skill_category     TEXT NOT NULL,
  badge_code         TEXT NOT NULL,
  description        TEXT NOT NULL,
  date_earned        TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  accepted_run       INTEGER NOT NULL REFERENCES import_runs(id),
  accepted_at        TEXT NOT NULL,
  UNIQUE (student_fk, skill_id)
);

-- Which source records each passport version contains.
CREATE TABLE version_source_records (
  version_fk INTEGER NOT NULL REFERENCES passport_versions(id),
  record_id  TEXT NOT NULL,
  PRIMARY KEY (version_fk, record_id)
);

-- Attempts to generate a new version that did not finish. The previous version stays current.
CREATE TABLE generation_failures (
  id              INTEGER PRIMARY KEY,
  run_fk          INTEGER NOT NULL REFERENCES import_runs(id),
  passport_fk     INTEGER NOT NULL REFERENCES passports(id),
  record_ids_json TEXT NOT NULL,
  error           TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- The system's values for the sheet's columns Q–T, per Record ID.
CREATE TABLE sheet_status (
  record_id      TEXT PRIMARY KEY,
  sync_status    TEXT NOT NULL CHECK (sync_status IN ('SYNCED', 'PENDING BLOCKCHAIN', 'NOT SYNCED', 'FAILED')),
  synced_version TEXT,                           -- only when the version is officially issued
  synced_at      TEXT,                           -- only when the version is officially issued
  notes          TEXT,
  run_fk         INTEGER NOT NULL REFERENCES import_runs(id),
  updated_at     TEXT NOT NULL
);

-- History is never deleted, even by mistake.
CREATE TRIGGER passport_versions_no_delete BEFORE DELETE ON passport_versions
BEGIN SELECT RAISE(ABORT, 'passport versions are never deleted'); END;
CREATE TRIGGER skill_awards_no_delete BEFORE DELETE ON skill_awards
BEGIN SELECT RAISE(ABORT, 'skill awards are never deleted'); END;
CREATE TRIGGER skill_awards_no_update BEFORE UPDATE ON skill_awards
BEGIN SELECT RAISE(ABORT, 'skill awards are never edited'); END;
CREATE TRIGGER version_records_no_delete BEFORE DELETE ON version_source_records
BEGIN SELECT RAISE(ABORT, 'version contents are never deleted'); END;
