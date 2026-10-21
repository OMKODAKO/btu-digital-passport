-- Migration 004 (stage 4): blockchain registration details. Adds columns and triggers only.

-- Opaque per-passport reference used on-chain instead of anything personal (random 32 bytes, hex).
-- Set once, at the first registration, and never changed.
ALTER TABLE passports ADD COLUMN chain_ref TEXT;
CREATE UNIQUE INDEX passports_chain_ref ON passports(chain_ref) WHERE chain_ref IS NOT NULL;
CREATE TRIGGER passports_chain_ref_frozen BEFORE UPDATE OF chain_ref ON passports
WHEN OLD.chain_ref IS NOT NULL AND NEW.chain_ref IS NOT OLD.chain_ref
BEGIN SELECT RAISE(ABORT, 'a passport''s chain reference never changes'); END;

-- A transaction already sent for a waiting candidate, so a retry checks it before sending another.
ALTER TABLE version_candidates ADD COLUMN chain_tx_submitted TEXT;
ALTER TABLE version_candidates ADD COLUMN chain_tx_submitted_at TEXT;

-- Audit record of the registration, copied from the confirmed receipt and the on-chain read-back.
ALTER TABLE passport_versions ADD COLUMN chain_id INTEGER;
ALTER TABLE passport_versions ADD COLUMN chain_network TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_contract TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_block_number INTEGER;
ALTER TABLE passport_versions ADD COLUMN chain_block_hash TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_issuer TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_issuer_label TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_issuer_test_only INTEGER;
ALTER TABLE passport_versions ADD COLUMN chain_registered_at TEXT;
ALTER TABLE passport_versions ADD COLUMN chain_confirmations INTEGER;
