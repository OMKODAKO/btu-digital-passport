-- Migration 006 (subject stage 01): BTU subject catalog and simulated syllabi.
-- Adds tables and triggers only; no existing table or row is changed.
-- BTU's course API is not available, so syllabi are SIMULATED (simulated = 1) and labelled as such.
-- A subject's score is out of 100: each syllabus component carries a weight (the weights of one
-- syllabus add up to 100) and its own raw maximum, e.g. quizzes marked out of 20 that count for 10%.

CREATE TABLE subjects (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,          -- our stable key, e.g. SUBJ-VIBE-CODING
  name_ka           TEXT NOT NULL UNIQUE,          -- the course name as BTU writes it
  name_en           TEXT NOT NULL,
  credits           INTEGER NOT NULL CHECK (credits > 0),   -- ECTS, from BTU's course list
  passport_relevant INTEGER NOT NULL CHECK (passport_relevant IN (0, 1)),
  skill_area        TEXT,                          -- grouping for the dashboard chart (relevant subjects)
  logo_key          TEXT,                          -- which subject mark the badge art uses (later stage)
  source            TEXT NOT NULL,                 -- where the row came from, e.g. BTU_COURSE_LIST_2026-10-25
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One syllabus per subject version. A change to a syllabus is a new version, never an edit, so
-- grades entered against a version keep the weights they were marked under.
CREATE TABLE syllabi (
  id          INTEGER PRIMARY KEY,
  subject_fk  INTEGER NOT NULL REFERENCES subjects(id),
  version     INTEGER NOT NULL CHECK (version >= 1),
  simulated   INTEGER NOT NULL DEFAULT 1 CHECK (simulated IN (0, 1)),
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (subject_fk, version)
);

CREATE TABLE syllabus_components (
  id          INTEGER PRIMARY KEY,
  syllabus_fk INTEGER NOT NULL REFERENCES syllabi(id),
  position    INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('QUIZ', 'ASSIGNMENT', 'PROJECT', 'MIDTERM', 'FINAL')),
  label       TEXT NOT NULL,
  weight      REAL NOT NULL CHECK (weight > 0 AND weight <= 100),   -- share of the 100-point score
  max_points  REAL NOT NULL CHECK (max_points > 0),                 -- raw scale the component is marked on
  UNIQUE (syllabus_fk, position),
  UNIQUE (syllabus_fk, label)
);

-- The catalog and syllabi are reference data: rows are added, never changed or removed.
-- (Relevance or names are fixed by a later migration if BTU corrects them.)
CREATE TRIGGER subjects_no_delete BEFORE DELETE ON subjects
BEGIN SELECT RAISE(ABORT, 'subjects are never deleted'); END;
CREATE TRIGGER syllabi_no_update BEFORE UPDATE ON syllabi
BEGIN SELECT RAISE(ABORT, 'a syllabus is never changed; add a new version'); END;
CREATE TRIGGER syllabi_no_delete BEFORE DELETE ON syllabi
BEGIN SELECT RAISE(ABORT, 'a syllabus is never deleted'); END;
CREATE TRIGGER syllabus_components_no_update BEFORE UPDATE ON syllabus_components
BEGIN SELECT RAISE(ABORT, 'a syllabus component is never changed; add a new syllabus version'); END;
CREATE TRIGGER syllabus_components_no_delete BEFORE DELETE ON syllabus_components
BEGIN SELECT RAISE(ABORT, 'a syllabus component is never deleted'); END;
