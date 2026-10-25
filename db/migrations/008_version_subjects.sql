-- Migration 008 (subject stage 05): which subject badges each passport version certifies.
-- Adds tables and triggers only; no existing table or row is changed.
-- A candidate records the badges it was rendered with; issuing it copies them to the version, the same way
-- candidate_records -> version_source_records works for sheet skills. Both are append-only.

CREATE TABLE candidate_subjects (
  candidate_fk     INTEGER NOT NULL REFERENCES version_candidates(id),
  subject_code     TEXT NOT NULL,
  syllabus_version INTEGER NOT NULL,
  score            TEXT NOT NULL,                                   -- "77.00", out of 100
  tier             TEXT NOT NULL CHECK (tier IN ('SILVER', 'GOLD', 'PLATINUM')),
  PRIMARY KEY (candidate_fk, subject_code)
);
CREATE TABLE version_subjects (
  version_fk       INTEGER NOT NULL REFERENCES passport_versions(id),
  subject_code     TEXT NOT NULL,
  syllabus_version INTEGER NOT NULL,
  score            TEXT NOT NULL,
  tier             TEXT NOT NULL CHECK (tier IN ('SILVER', 'GOLD', 'PLATINUM')),
  PRIMARY KEY (version_fk, subject_code)
);

CREATE TRIGGER candidate_subjects_no_update BEFORE UPDATE ON candidate_subjects
BEGIN SELECT RAISE(ABORT, 'a candidate''s subject badges are never changed'); END;
CREATE TRIGGER candidate_subjects_no_delete BEFORE DELETE ON candidate_subjects
BEGIN SELECT RAISE(ABORT, 'a candidate''s subject badges are never deleted'); END;
CREATE TRIGGER version_subjects_no_update BEFORE UPDATE ON version_subjects
BEGIN SELECT RAISE(ABORT, 'a version''s subject badges are never changed'); END;
CREATE TRIGGER version_subjects_no_delete BEFORE DELETE ON version_subjects
BEGIN SELECT RAISE(ABORT, 'a version''s subject badges are never deleted'); END;
