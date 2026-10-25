-- Google sign-in: which Google account (its stable "sub" id) belongs to which student or staff member.
-- The first Google sign-in with a verified email that matches a student or staff record links the two; from then
-- on only that Google account can sign in as that person, even if someone later gets a Google account with the
-- same email address. Rows are never changed or removed by the app.
CREATE TABLE google_identities (
  google_sub    TEXT PRIMARY KEY,
  account_kind  TEXT NOT NULL CHECK (account_kind IN ('STUDENT', 'STAFF')),
  account_fk    INTEGER NOT NULL,
  email         TEXT NOT NULL,
  linked_at     TEXT NOT NULL,
  UNIQUE (account_kind, account_fk)
);
CREATE TRIGGER google_identities_no_update BEFORE UPDATE ON google_identities
BEGIN SELECT RAISE(ABORT, 'google_identities is append-only'); END;
CREATE TRIGGER google_identities_no_delete BEFORE DELETE ON google_identities
BEGIN SELECT RAISE(ABORT, 'google_identities is append-only'); END;
