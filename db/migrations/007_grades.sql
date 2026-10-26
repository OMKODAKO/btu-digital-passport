-- Migration 007 (subject stage 02): students' marks per syllabus component.
-- Adds tables, indexes and triggers only; no existing table or row is changed.
-- Marks are entered by hand (or by the synthetic data generator) until a BTU grades API exists.
-- Append-only: a correction is a new row that names the row it replaces, so every earlier mark
-- (and therefore every score a passport version was built from) stays readable.

CREATE TABLE grade_entries (
  id            INTEGER PRIMARY KEY,
  student_fk    INTEGER NOT NULL REFERENCES students(id),
  component_fk  INTEGER NOT NULL REFERENCES syllabus_components(id),
  points        REAL NOT NULL CHECK (points >= 0),     -- on the component's own scale (0..max_points)
  source        TEXT NOT NULL CHECK (source IN ('MANUAL', 'SYNTHETIC', 'BTU_API')),
  entered_by    TEXT NOT NULL,                          -- staff email, 'cli' or 'synthetic-generator'
  entered_at    TEXT NOT NULL,
  supersedes_fk INTEGER REFERENCES grade_entries(id),   -- the mark this one corrects, if any
  note          TEXT
);
CREATE INDEX grade_entries_student ON grade_entries(student_fk, component_fk);
-- A mark is corrected at most once: the next correction corrects the correction.
CREATE UNIQUE INDEX grade_entries_one_correction ON grade_entries(supersedes_fk) WHERE supersedes_fk IS NOT NULL;

CREATE TRIGGER grade_entries_within_max BEFORE INSERT ON grade_entries
WHEN NEW.points > (SELECT max_points FROM syllabus_components WHERE id = NEW.component_fk)
BEGIN SELECT RAISE(ABORT, 'a mark cannot exceed the component''s maximum'); END;
CREATE TRIGGER grade_entries_corrects_same_mark BEFORE INSERT ON grade_entries
WHEN NEW.supersedes_fk IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM grade_entries g WHERE g.id = NEW.supersedes_fk
    AND g.student_fk = NEW.student_fk AND g.component_fk = NEW.component_fk)
BEGIN SELECT RAISE(ABORT, 'a correction must replace a mark of the same student and component'); END;
CREATE TRIGGER grade_entries_first_or_correction BEFORE INSERT ON grade_entries
WHEN NEW.supersedes_fk IS NULL AND EXISTS (
  SELECT 1 FROM grade_entries g WHERE g.student_fk = NEW.student_fk AND g.component_fk = NEW.component_fk)
BEGIN SELECT RAISE(ABORT, 'this component already has a mark; enter a correction'); END;
CREATE TRIGGER grade_entries_no_update BEFORE UPDATE ON grade_entries
BEGIN SELECT RAISE(ABORT, 'a mark is never changed; enter a correction'); END;
CREATE TRIGGER grade_entries_no_delete BEFORE DELETE ON grade_entries
BEGIN SELECT RAISE(ABORT, 'a mark is never deleted; enter a correction'); END;
