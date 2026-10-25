# BTU AI Skills Digital Passport (hackathon MVP)

One permanent Digital Passport per student. Verified skills come from BTU's skill sheet. Each update produces a new
multi-page PDF on BTU's template, which is registered on a blockchain before it becomes current. Anyone can verify a
passport with its code and the PDF, without an account.

**Status (final audit, 2026-10-21).** The full flow works end to end and is covered by automated tests, but with
these limits. Sign-in uses test passwords: **BTU Google sign-in is not built**. The source is the Excel workbook:
**the Google Sheets reader is not built**. The blockchain is a **local Hardhat devnet**, and the issuer is a
**TEST issuer** with no BTU authorisation. Full PASS / FAIL / BLOCKED list with evidence:
[docs/FINAL-AUDIT.md](docs/FINAL-AUDIT.md).

| Document | What's in it |
| --- | --- |
| [docs/FINAL-AUDIT.md](docs/FINAL-AUDIT.md) | Requirements checklist with evidence, test results, scale tests, what BTU must still provide |
| [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) | The 8-minute hackathon demo, step by step |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, identifiers, capacity analysis |
| [chain/README.md](chain/README.md) | Contract, registrar, issuer identity model, public test network and production setup |

## Quick start / სწრაფი დაწყება

### ქართულად

გჭირდება **Node.js 22+**, **Python 3.10+** და **Git** (macOS, Linux; Windows-ზე გამოიყენე WSL ან Git Bash).
არანაირი გასაღები, საფულე ან Google ანგარიში არ არის საჭირო: ყველაფერი შენს კომპიუტერზე, ლოკალურ ტესტ-ბლოკჩეინზე მუშაობს.

```bash
git clone https://github.com/OMKODAKO/btu-digital-passport.git
cd btu-digital-passport
npm run quickstart
```

პირველად 3–5 წუთი სჭირდება (ინსტალაცია, build, 18 დემო სტუდენტის პასპორტი ბლოკჩეინზე). ბოლოს ტერმინალში
დაიბეჭდება ტესტ-ლოგინები და გაიხსნება **http://localhost:3000**.

| რა | სად | შესვლა |
| --- | --- | --- |
| სტუდენტის პასპორტი | http://localhost:3000/login | მაგ. `btu-t-0001@example.org` + პაროლი ტერმინალიდან |
| ადმინის პანელი | http://localhost:3000/admin/login | `ops.demo@staff.example.org` + პაროლი ტერმინალიდან |
| საჯარო ვერიფიკაცია | http://localhost:3000/verify | ლოგინი არ სჭირდება: კოდი სტუდენტის დაფიდან + PDF |

ყველა პაროლი ინახება `data-demo/dev-credentials.txt`-ში. ახალი უნარის დამატება (V2 ბლოკჩეინზე): მეორე ტერმინალში
`npm run demo:add-skill`. გაჩერება: Ctrl+C. ხელახლა გაშვება: ისევ `npm run quickstart`. ნულიდან დაწყება: წაშალე
`data-demo/` და გაუშვი `npm run quickstart`. კომპიუტერის გადატვირთვის შემდეგ ლოკალური ბლოკჩეინი ცარიელდება, ამიტომ
`quickstart` ძველ დემოს გადაიტანს `data-demo-old-…`-ში და ახალს შექმნის, ახალი პაროლებით.

**კომპიუტერის გარეშე (ბრაუზერში):** GitHub-ზე რეპოში **Code → Codespaces → Create codespace**, ტერმინალში
`npm run quickstart`, შემდეგ Ports ჩანართში გახსენი 3000 პორტი.

### English

Needs **Node.js 22+**, **Python 3.10+** and **Git** (macOS, Linux; on Windows use WSL or Git Bash). No keys, wallet
or Google account: everything runs on your machine against a throwaway local test chain.

```bash
git clone https://github.com/OMKODAKO/btu-digital-passport.git
cd btu-digital-passport
npm run quickstart
```

The first run takes 3–5 minutes: it installs the web app, the local chain tooling and the Python worker (in `.venv/`),
builds the app, starts a local Hardhat devnet, deploys the registry with a TEST issuer, imports the demo workbook
(`samples/demo/workbook.xlsx`, BTU's fictional hackathon test data) and registers 18 passports (V1) on-chain. It then
prints the test logins and serves **http://localhost:3000**.

| What | Where | Sign in |
| --- | --- | --- |
| Student passport | http://localhost:3000/login | e.g. `btu-t-0001@example.org` + the password printed in the terminal |
| Staff admin area | http://localhost:3000/admin/login | `ops.demo@staff.example.org` + the printed password |
| Public verification | http://localhost:3000/verify | no sign-in: a code from a student dashboard + the PDF |

All passwords are generated fresh and kept in `data-demo/dev-credentials.txt`. More:

- `npm run demo:add-skill` (second terminal): adds a CONFIRMED skill for BTU-T-0001, V2 is registered and becomes current.
- Stop with Ctrl+C; run `npm run quickstart` again to restart. To start from zero, delete `data-demo/`.
- The devnet keeps nothing across a reboot, so `quickstart` then moves the old demo to `data-demo-old-…` and makes a
  new one, with new passwords.
- **No computer at hand:** on GitHub, **Code → Codespaces → Create codespace**, run `npm run quickstart` in its
  terminal, and open port 3000 from the Ports tab.
- Full walkthrough: [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md). Manual steps (what `quickstart` runs):
  `npm ci`, `(cd chain && npm ci)`, `python3 -m venv .venv && .venv/bin/pip install -r worker/requirements.txt`,
  `npm run build`, `npm run demo:setup`, `npm run demo:start`.

Everything the demo writes (database, PDFs, throwaway devnet keys, passwords) goes to `data-demo/`, which is
git-ignored. Never commit it.

Tests (after `npm run quickstart`): `source .venv/bin/activate`, then `npm run build && npm test` (web, 59 pass;
the tests start the built app, so without a build they all fail) and `npm run test:worker` (Python, 104 pass).

Subject scores and badges (in progress): [docs/SUBJECTS.md](docs/SUBJECTS.md).

## Setup reference

**Environment.** Copy `.env.example` to `.env.local` and adjust. It holds no secrets: private keys are only read
from the environment (`PASSPORT_ISSUER_PRIVATE_KEY`, `PASSPORT_ADMIN_PRIVATE_KEY`) or a secret manager.
Key variables: `DATA_DIR` (database + PDFs), `STUDENT_EMAIL_DOMAINS` (allowed sign-in domains),
`PASSPORT_ISSUANCE_MODE`, the `PASSPORT_CHAIN_*` settings, `PASSPORT_TRUST_ANCHOR`, `VERIFY_BASE_URL` (printed in the
PDF's QR code) and `PUBLIC_BASE_URL`.

**Database.** SQLite at `DATA_DIR/portal.db`. `npm run migrate` applies `db/migrations/001…005` in order and records
them; the web app and worker also apply them on start. Moving to Postgres is planned, not done.

**Data source.**
- Excel (works): `npm run import -- "<workbook.xlsx>"`. The worker reads sheet "Passport Skill Records", writes Q–T to a
  **copy**, and saves a report in `DATA_DIR/reports`. Run it on a schedule (cron) for automatic sync.
- Google Sheets (**not built**). To add it: share the team's copy of the sheet with a Google Cloud service account
  (Sheets API enabled, read access; write access for Q–T), keep its JSON key in a secret manager, and write a reader
  that returns the same `SourceTable` as `worker/sources/xlsx.py`. Validation, sync, PDF and chain code don't change.

**Sign-in.** Test passwords today (`npm run create-login -- <email>`; staff: `npm run create-staff`). Google sign-in
(**not built**) needs an OAuth client for BTU's Google Workspace. Check the verified `hd`/email domain, then call
`createSession(studentId, "google")`.

**Blockchain and issuer.** See [chain/README.md](chain/README.md): deploy, `set-issuer`, write the trust anchor, set
`PASSPORT_ISSUER_PRIVATE_KEY` for the worker. `scripts/demo-setup.sh` does all of this on the local devnet. A public
test network (Polygon Amoy) needs RPC access and a funded test wallet. An official BTU issuer needs BTU's
multisig admin, a KMS-held issuer key, and the trust anchor on BTU's domain.

## Tests

```bash
npm run test:worker              # 68 Python tests (starts its own devnets)
npm run build && npm test        # 51 web tests incl. the final end-to-end (2 screenshot tests skip without SCREENSHOT_DIR)
npm run test:e2e                 # only the 16-step end-to-end; EVIDENCE_DIR=... keeps PDFs, reports and a JSON log
```

Scale tools: `python3 scripts/scale/make_workbook.py <BTU workbook> out.xlsx 5000` (synthetic students) and
`node scripts/scale/load_verify.mjs <base> <code> <pdf> [N] [C]`. Results are in the audit.

---

# Stage notes (history)

The sections below were written stage by stage. They are kept for detail. Where they disagree with the
documents above, the documents above are current.

Stage 1 note: students sign in with a test email and password and land on their own passport dashboard.

## Run it locally (stage 1 path: seeds the old prototype PDFs, which are not on a chain)

Needs Node.js 22 or newer. The seed reads `../passport-generator/out/` when it exists, else its copy in `tests/fixtures/seed/`.

```bash
npm install
npm run seed      # creates data/portal.db, copies the PDFs, writes data/dev-credentials.txt
npm run build
npm start         # http://localhost:3000
```

`npm run dev` works too. To seed from somewhere else: `SEED_REGISTRY=/path/to/registry.json npm run seed`.

## Test accounts

`npm run seed` creates one account per student in the passport generator's registry, plus one synthetic
account with no passport. Each gets a random password, saved only in `data/dev-credentials.txt`
(ignored by git). Running the seed again never changes existing accounts or passwords.

| Email | Passport | Shows |
| --- | --- | --- |
| btu-t-0001@example.org | BTU-AI-000125, Giorgi Kapanadze | V2 current, V1 in history |
| btu-t-0002@example.org | BTU-AI-000126, Mariam Beridze | V2 current, V1 in history |
| btu-t-0003 … 0014, 0021 … 0024@example.org | BTU-AI-000127 … 000142 | 18 students in total |
| demo.nopassport@example.org | none (synthetic, labelled SEED_SYNTHETIC) | "not generated yet" message |

All names and emails are BTU's fictional hackathon test data.

## How it fits together

| Path | What it does |
| --- | --- |
| `db/migrations/` | `001_stage1.sql` (students, logins, sessions, passports, versions) and `002_stage2.sql` (import runs, source rows, skills, awards, statuses) |
| `src/lib/auth/password.ts` | scrypt password hashing (N=2^17, r=8, p=1), constant-time compare |
| `src/lib/auth/credentials.ts` | password sign-in provider: email + password → student id; failed-attempt limit |
| `src/lib/auth/session.ts` | server-side sessions; the cookie holds a random token, the database only its SHA-256 |
| `src/lib/passports.ts` | finds the passport for a student id; reads a PDF and checks it against its recorded SHA-256 |
| `src/app/api/auth/login`, `logout` | form POST endpoints; refuse cross-site posts |
| `src/app/api/passport/pdf` | streams the signed-in student's own PDF (inline or download) |
| `src/app/login`, `src/app/dashboard` | the two pages; `PdfViewer.tsx` renders pages with PDF.js |
| `scripts/seed.ts` | idempotent seed from `passport-generator/out/registry.json` |
| `tests/stage1.test.mjs`, `tests/stage2.test.mjs` | web acceptance tests |
| `worker/` | Python import worker (stage 2) and PDF generator + issuance (stage 3), below |

**Adding Google sign-in later:** write a provider that turns a verified Google ID token into a student id
(like `verifyCredentials` does for passwords) and call `createSession(studentId, "google")`.
The dashboard and PDF route only ever call `getCurrentStudent()`, so they don't change.

## Security rules this stage follows

- The student is identified only from the server-side session. The PDF route has no student, passport
  or file parameter; the only choice the browser has is a version number of its own passport.
- Passwords are stored as scrypt hashes; none are hard-coded. Wrong email and wrong password give the
  same message and take the same time, so the form doesn't reveal which accounts exist.
- Cookies are httpOnly, SameSite=Lax, and Secure in production. Signing out deletes the session on
  the server, so an old cookie stops working.
- PDFs live in `data/storage`, outside the web root. Each one is re-hashed before it's sent; a missing
  or changed file gives a clear message, never another document.
- PDF responses are `Cache-Control: private, no-store`; pages can't be framed by other sites.

## Tests

```bash
npm run build && npm test
```

Each run seeds a fresh database in a temporary folder and starts the production server on it.

1. Test student 1 signs in and gets exactly their current PDF (SHA-256 compared with the registry)
2. Same for test student 2
3. Wrong password rejected, no session cookie
4. Unknown email and empty password rejected
5. Student 1 cannot get student 2's PDF through 10 altered URLs, query parameters or headers; a cross-site login post is refused
6. After sign-out, the old cookie no longer opens the dashboard or the PDF
7. No-passport account and a deleted PDF file each show a clear message; a modified PDF file is refused
8. Every one of the 18 accounts sees only its own Passport ID and PDF
9. The browser bundle contains no password hashes or database code

## Known limits of stage 1 (still true)

- SQLite file database for local use; moving to Postgres/Supabase is planned.
- The PDFs come from the generator prototype and are **not registered on a blockchain**; the dashboard
  says so. BTU's cover design includes a "Blockchain verified" sticker, which is not yet true for these files.
- The failed-attempt limit is kept in memory, so it resets when the server restarts.

## Stage 2: importing the BTU workbook

The Python worker reads the workbook, validates every row, records skills by Record ID, generates a new
passport version only when a student's verified skills really changed, and writes the status columns
(Q–T) to a **copy** of the workbook. The original file is never modified.

```bash
pip install -r worker/requirements.txt          # openpyxl, pymupdf, qrcode
npm run migrate                                 # applies db/migrations (the web app does this too)
npm run seed                                    # once: stage 1 accounts and existing PDFs
npm run import -- "../AI DIGITAL PASSPORT/BTU AI Skills Digital Passport Hackathon_Test Data.xlsx"
npm run create-login -- btu-t-0099@example.org  # only for a new student who has no login yet
```

`npm run import` prints a summary and writes `data/reports/import-run-N.json` (every row issue, with its
row number) and `data/exports/<workbook> - synced run N.xlsx` (the copy with Q–T filled in).
Options: `--no-write-back`, `--sheet NAME`, `--output FILE`, `--assign-new-passport-ids`
(off by default: a student without a Passport ID in column G stays *pending* instead of getting one invented).
Running the same import again changes nothing.

**Rules the import follows**

- The header row is found by its 16 column names (row 4 in BTU's file); title, note and empty rows are skipped.
- Record ID is the key. A Record ID seen before is never added twice; if its content changes later
  the change is reported and the issued skill is kept. Skills and versions are never deleted (database triggers enforce it).
- Email ↔ Student ID ↔ Passport ID ↔ First Issued must agree across rows and with the database; a conflict
  holds the student's rows and is reported, nothing is guessed.
- A new version gets a new random Verification Code (`BTU-XXXX-XXXX-XXXX`); the previous PDF is kept and
  stays downloadable. A version becomes current only after its PDF is rendered, stored and re-hashed.
  If anything fails, the previous version stays current and the dashboard says the update failed.
- **Confirmation:** the workbook has no "confirmed" column, and "Passport Sync Status" is an output, so it is
  not used as approval. If a column named `Verification Status` exists, only rows whose value is in
  `PASSPORT_CONFIRMED_VALUES` (default `CONFIRMED`) are issued. Without it, `PASSPORT_CONFIRMATION_WHEN_ABSENT`
  decides: `AWARDED` (default, every complete valid row counts) or `HOLD`.

**Status columns written to the copy**

| Q value | Meaning |
| --- | --- |
| `PENDING BLOCKCHAIN` | in a generated passport version; R and S stay empty until stage 3 registers it on-chain |
| `NOT SYNCED` | valid but held (pending Passport ID, not confirmed, or waiting) |
| `FAILED` | invalid, conflicting, or generation failed; column T gives the reason |
| `SYNCED` | only after an on-chain registration, which doesn't exist yet, so the worker never writes it |

`SYNCED` values already in the workbook (BTU's notes call them simulated) are kept as they are and
listed in the report, unless the row now fails.

**Tests**

```bash
npm run test:worker     # Python tests (29 for stage 2, 22 for stage 3, 17 for stage 4): header, grouping, email mapping, duplicates, repeat imports, conflicts,
                        # missing PDFs, new skill → new version, statuses, failure keeps the old version
npm run build && npm test   # 44 web tests (2 screenshot tests run only with SCREENSHOT_DIR): stage 1's 9 + import over seed, new version visible only to its owner,
                            # failed update shown with old PDF current, pending student without a login
```

Set `BTU_WORKBOOK` (and `SEED_REGISTRY` for the web tests) if the folders aren't in their default places.

**Not done yet:** Google Sheets (the reader produces a source-neutral table, so a Sheets reader can be added
beside `worker/sources/xlsx.py`), blockchain registration and public verification.

## Stage 3: PDF generation and versions

The import (stage 2) now drives the PDF generator in `worker/pdf/`, which uses BTU's own
`Passport_Blank.pdf` as the template (copied to `worker/pdf/assets/template.pdf`, byte-identical).

**The document.** Cover (name, surname, first-issue date, Passport ID, version, issue date, verification
code), the static About page, *Verified AI Skillset* (one stamp card per skill, 10 per page, repeated) and
*AI Skill Supplement* (stamp, skill, description, earned through, badge code, record ID, date; 5 rows per
page, repeated; QR code and verification code on its last page). Text shrinks to fit its cell. If it still
doesn't fit, the cell says "(continued on page N)" and the full text goes on a continuation page. BTU's
design has no such page, so it uses the supplement background with a printed
"TEMPORARY LAYOUT" label. A passport with no skills says "No confirmed AI skills recorded yet".

**Checks before anything is stored.** `worker/pdf/check.py` opens the finished bytes and confirms the page count,
the Passport ID on every page, the name, dates and code on the cover, the code on the last supplement page,
the exact text of every table cell, the full text of continued entries, the metadata, and that the
embedded `passport-data.json` equals the certified data. A file that fails is discarded. The SHA-256 is
computed from those same final bytes, and the stored copy is re-hashed.

**Versions.**

| Where | State | Meaning |
| --- | --- | --- |
| `version_candidates` | `AWAITING_REGISTRATION` | generated, checked and stored; not issued; never shown or served |
| | `ISSUED` | became a passport version |
| | `VOID` | replaced by a newer candidate before it was issued; file and record kept |
| `passport_versions` | `CURRENT` | the latest valid version (at most one per passport) |
| | `SUPERSEDED` | an earlier issued version; file and metadata kept unchanged |

A candidate becomes `CURRENT` only after the issuance steps succeed: registration of its PDF hash on a
blockchain (`PASSPORT_ISSUANCE_MODE=blockchain`, the default; stage 4 below). Without blockchain settings
there is no registrar, so new versions wait and the previous version stays current; the dashboard says
an update is waiting. For demonstrations, `PASSPORT_ISSUANCE_MODE=local-demo`
issues right after the checks, with no chain transaction. Those versions show "not registered on a
blockchain", and their rows stay `PENDING BLOCKCHAIN`, never `SYNCED`.

Database triggers keep the Passport ID, holder name and first-issue date fixed, keep issued files, hashes
and codes unchangeable, allow status only to go from CURRENT to SUPERSEDED, and forbid deleting passports,
versions or candidates.

```bash
python3 -m worker.samples --out samples/stage3   # synthetic sample passports + PNG previews + manifest.json
PASSPORT_ISSUANCE_MODE=local-demo npm run import -- "<workbook>"   # demo only: issue without a chain
```

**Missing BTU assets (temporary substitutes in use):**
- Gilroy font files: the template uses Gilroy, but only embedded subsets are present. The added text uses Outfit
  (OFL) for Latin and Noto Sans Georgian for Georgian.
- A design for pages that hold text too long for the table: a labelled temporary layout is used.
- Separate stamp artwork: the three stamps are clipped from BTU's filled example PDF.
- The verification URL in the QR code (`https://passport.btu.edu.ge/verify/...`) is a placeholder until BTU confirms the domain.
- The template's cover sticker says "Blockchain verified". This is true for versions issued in blockchain mode only.

## Stage 4: blockchain registration and BTU issuer identity

Contract, registrar, verifier, issuer model, setup and production requirements: see [chain/README.md](chain/README.md).

```bash
cd chain && npm install && cd ..                 # local devnet + compiler (tests need it)
npm run test:worker                              # includes 17 stage 4 tests on a local Hardhat chain
npm run build && npm test                        # includes the stage 4 end-to-end web test
```

The dashboard shows each registered version's network, block and transaction. While the issuer is a test issuer,
it adds "Issued by a test issuer: official BTU issuer verification is still pending".
Tested on a local Hardhat devnet only. The public test network (Polygon Amoy) needs network access and a funded test wallet.

## Stage 5: public verification

**Route:** `/verify` (form) and `/verify/<code>` (where each passport's QR code points; the code is pre-filled and
checked at once). API: `POST /api/verify` (multipart form: `code`, optional `pdf`). No login, no cookies.

The server checks each item separately (`src/lib/verify.ts`) and shows each result:

| Check | States |
| --- | --- |
| Issuance record (by code, on the registry BTU's trust anchor names) | found · not found · unavailable |
| Blockchain record | confirmed (≥ `PASSPORT_CHAIN_CONFIRMATIONS`) · pending · none · unavailable |
| File integrity: SHA-256 of the uploaded bytes, computed on the server | match · mismatch · not provided · not checked |
| BTU issuer identity: registry admin and issuer must match the trust anchor | verified BTU · test issuer · not verified · unavailable |
| Version status, from the chain | current · superseded · unknown |

The headline says "Authentic" only when the record is found and confirmed, the issuer is verified as BTU, and the
uploaded file matches. A superseded version is shown as "Authentic historical version", never as current.
A code-only check says the record is valid, without any claim about a document. Otherwise it says "Not verified",
"Not verified as an official BTU issuance: issued by a test issuer", "Not yet verifiable", or "Verification could
not be completed". If anything can't be checked, the result fails closed.

Uploads: PDF only (`%PDF-` header), at most 10 MB, read with a hard byte cap, and never stored. The service allows
30 requests per 5 minutes per client. Responses show only the Passport ID, version, network, contract, transaction,
issuer and hashes: no name, email or student number.

Server settings: `PASSPORT_CHAIN_RPC_URL`, `PASSPORT_TRUST_ANCHOR` (the registry address is taken from it),
`PASSPORT_CHAIN_CONFIRMATIONS`, optional `PASSPORT_REGISTRY_FROM_BLOCK` (for transaction lookup on public chains).
Screenshots: `docs/verify-*.png`.

## Stage 6: student dashboard and admin area

**Student dashboard** (`/dashboard`; sign-in goes straight there). It shows:
- an embedded preview of the current valid PDF, with a download button;
- the permanent Passport ID and the current version's verification code;
- the first-issue date and the last-updated date;
- the authenticity status, from a real check of this version: the same server-side verifier as `/verify`, run on the stored PDF bytes. Each check is shown on its own;
- the version history, with issue dates and current/superseded labels;
- a link and a QR code to `/verify/<code>`. The QR uses `PUBLIC_BASE_URL`, or this host if that isn't set.

Versions that aren't registered on a blockchain are labelled as such and are never shown as authentic. Demo records carry a "BTU test data" or "Demo data" label.
Sign-in is still the stage 1 test-password login. **BTU Google sign-in is not connected.**

**Admin area** (`/admin`, sign in at `/admin/login`). It is for staff accounts. These are separate from students, with their own tables, sessions and cookie (`bdp_staff`, SameSite=Strict, 4 h).
The role is read from the database on every request, so editing a URL, a form or a cookie can't raise it. A student session is never accepted as a staff one.

| Page | What it shows |
| --- | --- |
| Overview | Counts, passports that need attention (missing generation, waiting or failed registration), recent imports |
| Find a student | Exact Student ID, BTU email, Passport ID or verification code. Partial text finds nothing, so the search can't be used to list people |
| Student record | Profile, versions with stored and live chain status, waiting or void versions with their registration errors, every sheet row with its state and import problems, generation failures, retries, that passport's audit log |
| Import problems | From the latest import: invalid or conflicting Student IDs, duplicate source records, all errors, holds, warnings |
| Audit log | Imports, generation, issuance, registration failures, retries, staff sign-ins, record views and denied actions. Append-only: database triggers refuse edits and deletes. Starts with stage 6 |

Roles: **VIEWER** can look at everything above. **OPERATOR** can also queue a **retry** for one passport (`POST /api/admin/retry`). The role check, a same-origin check and a reason are required, and one open retry per passport is allowed.

How a retry works:
- The web app only records the request. The worker, which alone holds the issuer key, carries it out with `npm run retry` (`python3 -m worker retry`).
- It regenerates the passport from skills **already accepted** from the sheet and registers the waiting version. The registrar's existing-record and pending-transaction checks stop it registering anything twice.
- It never reads the sheet or changes a source record or skill award, so a held or rejected skill can't become confirmed.
- If it fails, the previous version stays current and the failure is recorded.

The sheet's Q–T values are refreshed by the next import. The sheet (the Excel workbook today) stays the source of truth.

Demo staff accounts:

```bash
npm run create-staff -- ops.demo@staff.example.org "Demo Operator" OPERATOR
npm run create-staff -- viewer.demo@staff.example.org "Demo Viewer" VIEWER    # passwords go to data/dev-credentials.txt
```

Tests (`tests/stage6.test.mjs`, 17 tests, on the local Hardhat devnet) cover:
- the dashboard contents;
- student/admin separation both ways, including a forged staff cookie;
- refusing direct URL access;
- search limits;
- VIEWER denial;
- cross-site posts;
- failed-generation recovery by retry;
- failed-registration recovery;
- held skills staying held;
- the audit log's immutability and absence of secrets;
- staff sign-out.

Still needed before real use:
- BTU Google (or SSO) sign-in for students and staff, with staff roles assigned by BTU IT;
- the Google Sheets reader;
- a scheduler for `worker retry` and imports;
- a persistent rate limiter;
- HTTPS, and `PUBLIC_BASE_URL` set to BTU's domain;
- official BTU issuer setup (see `chain/README.md`).
