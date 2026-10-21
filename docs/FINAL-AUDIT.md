# Final audit: BTU AI Skills Digital Passport MVP

Audited on 2026-10-21 against the assignment (`ჰაკათონის დავალების აღწერა.docx`) on a clean copy of the code, a
fresh database and a local Hardhat devnet. Every PASS below comes from a test or command that was run for this
audit; nothing is taken from earlier stage reports.

**Status words.** PASS: works and was shown here. FAIL: built but does not meet the requirement. BLOCKED: cannot be
done without something from BTU or outside the project (credentials, approvals, assets). Where a step is BLOCKED, the
closest working equivalent was run and is labelled as such.

## Automated test results (this audit)

| Suite | Command | Result |
| --- | --- | --- |
| Worker (Python): import, validation, PDF, chain, verifier | `npm run test:worker` | **68 passed, 0 failed** (93 s) |
| Web, stages 1–6 + final end-to-end | `npm run build && npm test` | **49 passed, 0 failed, 2 skipped** (the 2 skipped only take screenshots, and run when `SCREENSHOT_DIR` is set) |
| Final 16-step end-to-end | `npm run test:e2e` | **7 tests, 7 passed** (35 s); evidence in [evidence/e2e-evidence.json](evidence/e2e-evidence.json) |

The end-to-end test (`tests/e2e.test.mjs`) starts its own devnet, deploys the registry, authorises a TEST issuer,
imports BTU's workbook into an **empty** database (18 passports, V1 each, all registered on-chain), then runs the
16 steps below over HTTP, the worker CLI and raw JSON-RPC.

## The required end-to-end workflow

| # | Step | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Student signs in with an authorised BTU Google account | **BLOCKED** | Google sign-in is not built, and there is no Google OAuth client or BTU domain. Equivalent run: test-password sign-in for `btu-t-0001@example.org` → 303 to `/dashboard` with a session cookie. |
| 2 | A non-BTU account is rejected | **BLOCKED** (equivalent PASS) | Needs Google's verified hosted-domain claim. Equivalent added in this audit: `STUDENT_EMAIL_DOMAINS` (example.org for the test data). `outsider@gmail.com` is refused, and so is a real student record moved to `@gmail.com`, even with the correct password. Screenshot: [02-other-domain-refused.png](evidence/screenshots/02-other-domain-refused.png) |
| 3 | Student mapped to the correct Students record | PASS | `btu-t-0001@example.org` → BTU-T-0001 → BTU-AI-000125; no other Passport ID appears on the page |
| 4 | Taken directly to their dashboard | PASS | Login answers `303 Location: /dashboard` |
| 5 | Existing multi-page PDF appears and downloads | PASS | PDF.js viewer present; download `BTU-AI-000125_V1.pdf`, 4 pages, SHA-256 equals the stored record. [05-dashboard-V1.png](evidence/screenshots/05-dashboard-V1.png), [V1.pdf](evidence/V1.pdf) |
| 6 | A new CONFIRMED skill is added to the Google Sheets source | **BLOCKED** (equivalent PASS) | The Google Sheets reader is not built. Equivalent: `tests/fixtures/confirmed_rows.py` writes a **copy** of the workbook with a `Verification Status` column and 5 new rows. [workbook-with-new-skill.xlsx](evidence/workbook-with-new-skill.xlsx) |
| 7 | Sync detects the new skill and links it to the correct student | PASS | 1 new award (REC-0901 → BTU-T-0001). PENDING and REJECTED rows are held (`NOT_CONFIRMED`). Malformed Student ID → `INVALID_STUDENT_ID`; unknown Student ID using another student's email → `EMAIL_CONFLICT`. BTU-AI-000126 and 000127 are unchanged. [import report](evidence/reports/) |
| 8 | New PDF version without changing Passport ID or first-issue date | PASS | V2 cover: BTU-AI-000125, 15.09.2026, `VERSION V2`, new verification code. Database triggers block any change to these fields |
| 9 | Exact final PDF hashed with SHA-256 | PASS | SHA-256 of the stored bytes = `passport_versions.pdf_sha256` = the downloaded file = the hash in the transaction input |
| 10 | Version registered on-chain with a verifiable issuer identity | PASS on the local devnet, TEST issuer | Receipt status 1. Sender = the issuer authorised in the registry and named in the trust anchor. Local Hardhat devnet only, and the issuer is a **TEST** issuer with no BTU authorisation |
| 11 | New version becomes current only after issuance succeeds | PASS | Sync without the issuer key: V2 generated, `1 waiting for registration`, V1 still current, no transaction sent. With the key: registered, confirmed, read back, then V2 CURRENT and V1 SUPERSEDED. [11-dashboard-V2-waiting.png](evidence/screenshots/11-dashboard-V2-waiting.png) |
| 12 | Student sees the latest version on the next visit | PASS | Dashboard shows V2's code and V1 in the history; the download is V2. [12-dashboard-V2-current.png](evidence/screenshots/12-dashboard-V2-current.png) |
| 13 | Exact PDF passes public verification without login | PASS (issuer = TEST) | `POST /api/verify` with no cookie: record FOUND, chain CONFIRMED, file MATCH, version CURRENT, issuer TEST_ISSUER. No name, email or Student ID in the response. [13-verify-exact-V2.png](evidence/screenshots/13-verify-exact-V2.png) |
| 14 | Modified PDF fails the integrity check | PASS | Cover text added (re-saved PDF) and a one-byte change both give file MISMATCH → "Not verified". Unknown code → NOT_FOUND. [14-verify-modified-V2.png](evidence/screenshots/14-verify-modified-V2.png), [V2-modified.pdf](evidence/V2-modified.pdf) |
| 15 | Previous version verifiable as authentic historical, marked superseded | PASS | V1 code + V1 PDF: FOUND, CONFIRMED, MATCH, SUPERSEDED. V1's file checked against V2's code → MISMATCH. [15-verify-V1-historical.png](evidence/screenshots/15-verify-V1-historical.png) |
| 16 | Re-running sync doesn't duplicate skills or make versions | PASS | Two more runs: 0 new awards, 0 versions, 0 candidates, block number unchanged (no transaction) |

## Assignment compliance

| Requirement | Status | Evidence and limits |
| --- | --- | --- |
| Students, Skills Catalog and Verified Skills data | PASS for BTU's supplied file | The supplied workbook is one sheet holding all three: identity (A–I), skill catalog fields (K–O, stored in `skills`, with a check that one Skill ID always has the same definition) and award records (J, P). The assignment text describes three separate registers, but no such file was supplied. A three-tab layout would need a small reader change. |
| CONFIRMED-only processing | PASS (mechanism); BTU decision open | With a `Verification Status` column, only `CONFIRMED` rows are issued; PENDING and REJECTED are held (step 7, worker tests). **BTU's workbook has no such column.** Its own note says every A–P row is already verified, so the default `PASSPORT_CONFIRMATION_WHEN_ABSENT=AWARDED` follows that note, and `HOLD` issues nothing until the column exists. BTU must say which rule applies. |
| Invalid Student ID handling | PASS | Malformed ID → error, row not applied. Unknown ID with another student's email or Passport ID → conflict, and nothing for that student changes. Note: a conflict holds **all** of the affected student's rows until it is fixed (safe, but it blocks their other updates). A well-formed new Student ID with new details is treated as a new student, and without a Passport ID it waits as pending. The Student ID format is now configurable (`PASSPORT_STUDENT_ID_PATTERN`); it was fixed at `BTU-T-` + 4 digits, which allowed at most 9,999 students. |
| Idempotent sync | PASS | Record ID is the key; step 16; 500- and 5,000-student re-runs (below). Same skill under a new Record ID → `DUPLICATE_SKILL` (checked by hand in this audit). |
| Permanent Passport ID and original issue date | PASS | Step 8; triggers in `003_stage3.sql` refuse updates; worker tests. |
| Multi-page PDF on the official template | PASS, with missing BTU assets | BTU's `Passport_Blank.pdf` is used byte-identical. Variable skill counts flow onto repeated pages (sample with 23 skills = 10 pages). Missing from BTU: **Gilroy font files** (Outfit/Noto Sans Georgian used instead), a **design for overflow pages** (labelled "TEMPORARY LAYOUT"), **separate stamp artwork** (clipped from the filled example). |
| Unique Verification Code per version | PASS | Random 12-symbol code per version (`secrets`), `UNIQUE` in the database, and the contract refuses a reused code key. |
| Exact PDF hash verification | PASS | Steps 9, 13, 14; the server hashes the uploaded bytes. |
| Verifiable BTU issuer identity | PASS for the hackathon criterion (BTU **test** identity); official identity **BLOCKED** | The registry admin authorises issuers. BTU's trust anchor names the registry, the admin and the issuers. The verifier checks all three and whether the issuer was authorised at the time of the record. A rogue issuer is refused (stage 5 test), and an OFFICIAL anchor yields "Authentic" (local fixture test). The assignment allows a BTU test identity. **No BTU authorisation, BTU domain, multisig or official key exists**, so nothing is shown as an official BTU issuance. |
| Blockchain network, independently checkable | PASS on a local devnet; **public test network not used** | Real EVM transactions on a local Hardhat node, by Merabi's choice (no public testnet, no wallet key). The assignment allows a testnet "if the result can be checked independently". A judge **cannot** check a local devnet from their own machine, so this is the main gap against the blockchain criterion. Moving to Polygon Amoy needs network access and a funded test wallet (`chain/README.md`). |
| No personal data on-chain | PASS | Only the code hash, PDF hash, a random passport reference, and the version number are stored. A worker test scans transaction input and logs. |
| Public verification without login | PASS | Steps 13–15; no cookies set or read; 30 requests per 5 min per client. |
| Historical version verification | PASS | Step 15. |
| Public page shows only what is needed | PASS | Passport ID, version, chain evidence and hashes. No name: **Merabi's decision is still open** (showing the name would let an employer match it to the PDF). |
| Secure student access | PASS for isolation; BTU login **BLOCKED** | Server-side sessions, scrypt passwords, no IDs in PDF URLs. Ten altered-URL attempts and a cross-site post are refused, and an old cookie fails after sign-out (stage 1 tests). Missing: BTU Google/SSO sign-in. |
| Failure keeps the current version | PASS | Worker tests (render failure, reverted transaction, RPC down, crash after registration) and step 11. |
| Secrets kept out of code | PASS | `.env.example` has no secrets. Keys are read from the environment only. The demo's throwaway devnet keys live in the git-ignored `data-demo/`. No 32-byte hex key appears in tracked files. |
| Optional: QR code, admin panel, error log, Excel import | PASS | The QR points to `VERIFY_BASE_URL/<code>`. The default is a placeholder BTU domain, so set it for the demo; `demo:setup` does. |
| Optional: notifications to students | Not built | |
| Scalability, at least 5,000 passports a year | **Partly shown**, not proven | See below. Measured with synthetic data on a local chain; the public-chain throughput is an estimate. |

## Scale

All runs used synthetic students (`scripts/scale/make_workbook.py`), one worker process, SQLite, and the local
devnet with 1 confirmation, in a shared cloud container. The devnet confirms instantly, so these numbers measure our
pipeline, **not** a public blockchain.

The 5,000-student update run was stopped at Merabi's request (2026-10-21); the update and re-run were measured on 2,500 students instead.

| Test | Result |
| --- | --- |
| 500 students, first issue (1,500 rows) | 500 PDFs generated, checked, stored, registered and issued in **181 s** (0.36 s each) |
| 500 updates (one extra skill each, 2,000 rows) | 500 new versions registered in **224 s** |
| Re-run with no changes, 500 students | **4.8 s**, 0 new awards, 0 versions |
| 5,000 students, first issue (15,000 rows) | 5,000 passports generated, checked, registered and issued in **1,867 s (31 min, 0.37 s each)**; 0 failures. Storage 1.1 GB, database 31 MB |
| 2,500 students, first issue (7,500 rows) | 2,500 passports issued in **898 s (15 min, 0.36 s each)**; 0 failures |
| 2,500 updates, one extra skill each (10,000 rows) | 2,500 new versions (V2) registered and issued in **1,123 s (19 min, 0.45 s each)**; 0 failures. Storage 1.1 GB for 5,000 versions, database 24 MB |
| Re-run with no changes, 2,500 students | **41 s**: 0 new awards, 0 versions, 0 transactions (includes re-hashing all 5,000 stored PDFs) |
| Public verifier: 1,000 requests, each uploading a PDF, concurrency 20 | 1,000/1,000 correct, **79 requests/s**, p50 227 ms, p95 413 ms (one Next.js process, with the import running beside it) |
| Gas per registration | 184,740 |
| Storage | ~220 KB per PDF version |

Capacity analysis for 5,000 new passports + ~10,000 updates a year:
- The PDF pipeline (~0.3 s per passport here) is not a constraint, even on one process.
- The registrar registers one version at a time and waits for its confirmations. On a public chain with ~2 s blocks
  and 3 confirmations this is an **estimated** 6–10 s per version: 5,000 at once would take roughly 8–14 hours.
  That is fine for a yearly batch run overnight, but it hasn't been measured. Pipelined nonces or Merkle-batch
  registration would remove it (not built).
- SQLite and one worker are enough for this volume. Several workers or web servers need Postgres (not done).
- The verifier's rate limiter is in memory and trusts `X-Forwarded-For`, so it can be bypassed directly. In
  production it must sit behind a proxy that sets that header, with a shared store.

## What this audit changed

| Change | Why |
| --- | --- |
| `tests/e2e.test.mjs`, `tests/fixtures/confirmed_rows.py` | The 16 steps as one automated test from an empty database, with every version on-chain. The earlier tests each covered part of the flow, and all of them started from the seeded prototype PDFs (V1–V2, not registered). |
| `STUDENT_EMAIL_DOMAINS` (`src/lib/auth/credentials.ts`, `config.ts`) | Any email in the database could sign in. Now only allowed domains can, with the same answer and timing as a wrong password. |
| `headline()` in `src/components/Checks.tsx` | With a TEST issuer, the exact current PDF, a historical PDF and a code-only check all showed the same headline ("Not verified as an official BTU issuance"). Now the headline says which result it is, and still says it comes from a TEST issuer. The `overall` value in the API is unchanged and still fails closed. |
| `PASSPORT_STUDENT_ID_PATTERN` (`worker/validate.py`) | Student IDs were limited to `BTU-T-` + exactly 4 digits, so at most 9,999 students. The default is now 4 or more digits, and BTU can set the real format. |
| `VERIFY_BASE_URL`, `STUDENT_EMAIL_DOMAINS` in `.env.example` | The QR code in every PDF used a placeholder domain, and the variable wasn't documented. |
| `scripts/demo-setup.sh`, `demo-add-skill.sh`, `demo-tamper.py`, `npm run demo:*` | A repeatable demo from an empty folder. |
| `scripts/scale/` | Synthetic workbook generator and verifier load test. |

## What BTU (or the team) still has to provide

1. **Google sign-in**: an OAuth client (client ID and secret) for BTU's Google Workspace and the allowed domain. The
   code has one place for it (`createSession(studentId, "google")`), but the provider is not written.
2. **Google Sheets**: the team's copy of the sheet, plus a service account with read access (and write access for
   Q–T). A reader that produces the same table as `worker/sources/xlsx.py` is not written.
3. **CONFIRMED rule**: whether the real sheet will have a `Verification Status` column.
4. **Issuer identity**: a BTU-controlled admin (multisig), an issuer key in KMS/HSM, the trust anchor published with
   `status: OFFICIAL` on BTU's domain, and the network choice.
5. **Public network for the demo, if wanted**: network access to an Amoy RPC and a funded **test** wallet.
6. **Design assets**: Gilroy font files, an overflow-page design, separate stamp artwork, the real verification domain.
7. **Decision**: whether the public verification page should show the student's name.
