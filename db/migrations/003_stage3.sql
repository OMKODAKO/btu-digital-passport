-- Migration 003 (stage 3): issuance candidates and frozen passport identity.
-- Only adds tables, columns and triggers; existing passports and versions are kept as they are.
--
-- A new version is first a *candidate*: its PDF is rendered, read back and checked, stored, and
-- hashed from its final bytes. It enters passport_versions (and becomes CURRENT) only when the
-- issuance steps succeed: blockchain registration, or local-demo mode, which is explicitly opted
-- into and leaves chain_tx_hash empty. passport_versions therefore holds issued versions only,
-- and the web app never sees a candidate's PDF.

CREATE TABLE version_candidates (
  id                     INTEGER PRIMARY KEY,
  passport_fk            INTEGER NOT NULL REFERENCES passports(id),
  version_no             INTEGER NOT NULL,
  verification_code      TEXT NOT NULL UNIQUE,
  state                  TEXT NOT NULL CHECK (state IN ('AWAITING_REGISTRATION', 'ISSUED', 'VOID')),
  generated_at           TEXT NOT NULL,             -- the issue date printed in the PDF
  pdf_storage_key        TEXT NOT NULL UNIQUE,
  pdf_sha256             TEXT NOT NULL UNIQUE,      -- of the exact stored bytes
  pdf_check_json         TEXT NOT NULL,             -- result of the read-back check
  registration_attempts  INTEGER NOT NULL DEFAULT 0,
  last_registration_error TEXT,
  issued_version_fk      INTEGER REFERENCES passport_versions(id),
  void_reason            TEXT,
  UNIQUE (passport_fk, version_no)
);
-- At most one candidate waits per passport; a newer change replaces (voids) the older one.
CREATE UNIQUE INDEX one_waiting_candidate ON version_candidates(passport_fk) WHERE state = 'AWAITING_REGISTRATION';

CREATE TABLE candidate_records (
  candidate_fk INTEGER NOT NULL REFERENCES version_candidates(id),
  record_id    TEXT NOT NULL,
  PRIMARY KEY (candidate_fk, record_id)
);

ALTER TABLE passport_versions ADD COLUMN activated_at TEXT;     -- when it became CURRENT (NULL for stage 1 seed)
ALTER TABLE passport_versions ADD COLUMN candidate_fk INTEGER REFERENCES version_candidates(id);

CREATE TRIGGER candidates_no_delete BEFORE DELETE ON version_candidates
BEGIN SELECT RAISE(ABORT, 'version candidates are never deleted'); END;
CREATE TRIGGER candidate_records_no_delete BEFORE DELETE ON candidate_records
BEGIN SELECT RAISE(ABORT, 'candidate contents are never deleted'); END;
CREATE TRIGGER candidates_frozen BEFORE UPDATE ON version_candidates
WHEN NEW.passport_fk IS NOT OLD.passport_fk OR NEW.version_no IS NOT OLD.version_no
  OR NEW.verification_code IS NOT OLD.verification_code OR NEW.pdf_storage_key IS NOT OLD.pdf_storage_key
  OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256 OR NEW.generated_at IS NOT OLD.generated_at
  OR OLD.state <> 'AWAITING_REGISTRATION'
BEGIN SELECT RAISE(ABORT, 'a candidate''s file and code are fixed, and an issued or void candidate is final'); END;

-- Passport ID, holder name and first-issue date are fixed at first issuance.
CREATE TRIGGER passports_identity_frozen BEFORE UPDATE ON passports
WHEN NEW.passport_id IS NOT OLD.passport_id OR NEW.student_fk IS NOT OLD.student_fk
  OR NEW.holder_first_name IS NOT OLD.holder_first_name OR NEW.holder_last_name IS NOT OLD.holder_last_name
  OR NEW.first_issued_on IS NOT OLD.first_issued_on
BEGIN SELECT RAISE(ABORT, 'Passport ID, holder name and first-issue date never change'); END;
CREATE TRIGGER passports_no_delete BEFORE DELETE ON passports
BEGIN SELECT RAISE(ABORT, 'passports are never deleted'); END;

-- An issued version's file, code and number never change; status only moves CURRENT -> SUPERSEDED.
CREATE TRIGGER passport_versions_frozen BEFORE UPDATE ON passport_versions
WHEN NEW.passport_fk IS NOT OLD.passport_fk OR NEW.version_no IS NOT OLD.version_no
  OR NEW.verification_code IS NOT OLD.verification_code OR NEW.pdf_storage_key IS NOT OLD.pdf_storage_key
  OR NEW.pdf_sha256 IS NOT OLD.pdf_sha256 OR NEW.issued_at IS NOT OLD.issued_at
  OR (OLD.chain_tx_hash IS NOT NULL AND NEW.chain_tx_hash IS NOT OLD.chain_tx_hash)
  OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'CURRENT' AND NEW.status = 'SUPERSEDED'))
BEGIN SELECT RAISE(ABORT, 'issued versions are immutable; status may only go from CURRENT to SUPERSEDED'); END;
