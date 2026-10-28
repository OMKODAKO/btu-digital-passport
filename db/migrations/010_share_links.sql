-- Public passport links for a CV: one permanent, unguessable token per passport. /p/<token> shows the passport's
-- current issued version to anyone, read-only and without signing in. The token is random (not the Passport ID,
-- which is sequential and easy to guess), and a row is never changed or removed, so a link printed in a CV keeps
-- working and always shows the latest valid version.
CREATE TABLE passport_share_links (
  passport_fk  INTEGER PRIMARY KEY REFERENCES passports(id),
  token        TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);
CREATE TRIGGER passport_share_links_no_update BEFORE UPDATE ON passport_share_links
BEGIN SELECT RAISE(ABORT, 'passport_share_links is append-only'); END;
CREATE TRIGGER passport_share_links_no_delete BEFORE DELETE ON passport_share_links
BEGIN SELECT RAISE(ABORT, 'passport_share_links is append-only'); END;
