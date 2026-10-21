# Architecture and data flow

BTU AI Skills Digital Passport, hackathon MVP. This describes what is built and running today. Parts that are
not built are marked **not built**.

```
 BTU staff                     Worker (Python, holds the issuer key)                        Blockchain (EVM)
 ─────────                     ────────────────────────────────────                         ───────────────
 Skill workbook  ──read──▶  1 read + validate rows ──▶ 2 accept awards by Record ID ─┐       PassportRegistry
 (Excel today;               (header, IDs, email/Passport ID                         │       (admin, issuers,
  Google Sheets               agreement, CONFIRMED rule,                              ▼        records)
  not built)                  duplicates)                          3 render PDF on BTU template     ▲
       ▲                                                             + read back and check          │ 5 register
       │ Q–T status written                                          (worker/pdf)                   │ (hash, version,
       │ to a COPY                                                          │                       │  random ref)
       └──────────────────────── 7 report ◀── 6 CURRENT only after ◀── 4 store as candidate ───────┘
                                                read-back of the       (SHA-256 of final bytes)
                                                chain record
                               SQLite database + PDF storage (DATA_DIR)
                                                 │
            ┌────────────────────────────────────┼─────────────────────────────────┐
            ▼                                    ▼                                 ▼
  Student dashboard (Next.js)          Public verify page /verify          Admin area /admin (staff)
  session login (test passwords;       no login; code + optional PDF;      search, problems, audit log,
  Google sign-in not built)            hash checked on server against      retry queue (worker runs it)
  own PDF only, history, QR            the chain + BTU trust anchor
```

## Components

| Part | Where | What it does |
| --- | --- | --- |
| Source reader | `worker/sources/xlsx.py` | Finds the header row by its 16 column names, reads formula results, produces a source-neutral table. A Google Sheets reader would produce the same table (**not built**). |
| Validation | `worker/validate.py` | Required fields, ID formats (Student ID format configurable), email/Student ID/Passport ID/first-issue agreement across rows and with the database, duplicate Record IDs, badge vs category, future dates, the CONFIRMED rule. Errors and conflicts stop that student's update; nothing is guessed. |
| Sync | `worker/sync.py` | Record ID is the idempotency key. New award → new version for that student only. Same skill twice for a student → `DUPLICATE_SKILL`. Edited after acceptance → warning, accepted skill kept. |
| PDF | `worker/pdf/` | BTU's `Passport_Blank.pdf` (byte-identical) as the template; cover, about page, skill stamps (10/page, repeats), supplement (5/page, repeats), QR + code. `check.py` re-reads the finished bytes and compares every field before anything is stored. |
| Versions | `version_candidates`, `passport_versions` | Candidate (`AWAITING_REGISTRATION`) → `CURRENT` only after registration is confirmed and read back; previous becomes `SUPERSEDED`. Database triggers freeze Passport ID, name, first-issue date and issued files/hashes/codes, and forbid deletes. |
| Registrar | `worker/chain.py` | Re-hashes stored bytes, preflight (chain id, contract, issuer active, trust anchor), gas estimate, send, receipt status, N confirmations, read-back. Crash and pending-tx recovery, never registers twice. |
| Contract | `chain/contracts/PassportRegistry.sol` | `codeKey = sha256(code)`, `pdfSha256`, random `passportRef`, `versionNo` (must increase), issuer, time, block. No personal data. Admin authorises/revokes issuers with a label and `testOnly` flag. |
| Issuer identity | trust anchor JSON | BTU publishes `/.well-known/btu-passport-issuer.json` on its own domain naming chain, registry, admin and issuers, `status: OFFICIAL` or `TEST`. Today only TEST anchors exist. |
| Verifier | `src/lib/verify.ts` (web), `worker/verify.py` (CLI) | Separate results for record, chain confirmations, file hash, issuer, current/superseded. Fails closed. |
| Web app | `src/app` (Next.js 16) | Student login + dashboard + PDF route (session-bound, no IDs in URLs), public `/verify`, staff `/admin` with VIEWER/OPERATOR roles, append-only audit log. |

## Identifiers

| ID | Example | Changes? |
| --- | --- | --- |
| Student ID | `BTU-T-0001` | from BTU's sheet; the key that links a row to a student |
| Passport ID | `BTU-AI-000125` | permanent, one per student, from column G (or assigned with `--assign-new-passport-ids`) |
| Version | `V1`, `V2`, … | +1 per issued update |
| Verification Code | `BTU-HCQD-M17B-4DNV` | new random code per version (12 chars from a 32-symbol alphabet, `secrets`), unique in the database and on-chain |
| Record ID | `REC-0001` | one per awarded skill row; never processed twice |

## Scale: what was measured, and what is an estimate

Measured in this cloud container (shared CPU) with **synthetic** students (`scripts/scale/make_workbook.py`),
one worker process, SQLite, and a **local Hardhat devnet** (instant blocks, 1 confirmation). Full numbers
are in [FINAL-AUDIT.md](FINAL-AUDIT.md#scale).

What carries over to production, and what doesn't:

- **PDF generation + checks** (~0.28 s per passport here; 5,000 first issues including devnet registration took 31 min) is CPU work and carries over. It can run in several
  worker processes, because each student is independent.
- **Registration** on the devnet is near-instant. On a public chain each transaction waits for blocks
  (Polygon PoS ~2 s per block; with 3 confirmations, roughly 6–10 s). The registrar sends and confirms **one
  transaction at a time**, so 5,000 first issues would take roughly 8–14 hours of wall time in one run. Spread
  over a year this is acceptable, but it is the bottleneck. Not measured on a public chain: **estimate**.
  Remedies, not built: send several transactions with consecutive nonces and confirm them together, or register
  one Merkle root per batch.
- **Gas**: one `register` call used 184,740 gas on the devnet. 5,000 issues + 10,000 updates a year ≈ 2.8 billion gas
  in total. The fee depends on the chosen network and its gas price, which was not measured.
- **Storage**: ~220 KB per PDF version. 15,000 versions a year ≈ 3.3 GB a year.
- **Database**: SQLite is fine for one worker and this volume. Several workers writing at once, or several web
  servers, need Postgres (planned, not done).
- **Verification page**: 1,000 PDF uploads (code + file) at concurrency 20 against one Next.js process gave 79
  requests/s, p95 413 ms, while the 5,000-student import ran beside it. The rate limiter keeps counts in memory and trusts `X-Forwarded-For`, so
  production needs a shared limiter behind a proxy that sets that header.
- **Sync** reads the whole sheet each run, and only changed students produce work. A no-change run over 2,500
  students (10,000 rows, with all 5,000 stored PDFs re-hashed) took 41 s.
