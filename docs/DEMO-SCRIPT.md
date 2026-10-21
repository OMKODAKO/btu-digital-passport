# Hackathon demo script (about 8 minutes)

Everything runs on one laptop: a **local Hardhat devnet** (not a public test network), the worker, and the web app.
Say this at the start: *"Blockchain records are on a local test chain, and the issuer is a BTU TEST issuer. BTU has
not authorised an official issuer yet. Sign-in uses test passwords, and the source is the Excel workbook: Google
sign-in and the Google Sheets reader are not built."*

## Before the demo (once, ~2 minutes)

```bash
npm install && (cd chain && npm install) && pip install -r worker/requirements.txt
npm run build
npm run demo:setup        # devnet, registry, TEST issuer, imports BTU's workbook: 18 passports V1 registered on-chain
npm run demo:start        # http://localhost:3000   (keep this terminal open)
```

Open `data-demo/dev-credentials.txt` for the passwords. Keep two browser windows: a normal one (student) and a
private one (employer, no login). To rehearse again from zero: move `data-demo/` away and run `demo:setup` again.

## The script

| # | Do | Show / say | Status |
| --- | --- | --- | --- |
| 1 | Sign in as `btu-t-0001@example.org` with its test password | "BTU Google sign-in would sit here. Today: test passwords." | BLOCKED (Google), equivalent works |
| 2 | Sign in as `someone@gmail.com` | Refused. Only `STUDENT_EMAIL_DOMAINS` (example.org for the test data) may sign in | BLOCKED (Google hosted-domain check), equivalent works |
| 3–4 | Student 1 signs in | Lands straight on the dashboard: Giorgi Kapanadze, Passport ID **BTU-AI-000125**, first issued 15 Sept 2026 | PASS |
| 5 | Scroll the PDF, click **Download PDF** | 4-page PDF on BTU's template; V1 with its verification code | PASS |
| 6 | Terminal: `bash scripts/demo-add-skill.sh --hold` | "BTU staff add a CONFIRMED skill." A **copy** of the workbook gets a Verification Status column and new rows: one CONFIRMED skill for BTU-T-0001, a PENDING and a REJECTED row, a malformed Student ID, and an unknown Student ID using another student's email | BLOCKED (Google Sheets), equivalent works |
| 7 | Read the output | 1 new award (BTU-T-0001 only). PENDING and REJECTED held (`NOT_CONFIRMED`). Bad Student IDs: `INVALID_STUDENT_ID`, `EMAIL_CONFLICT`; no other passport changes | PASS |
| 11 | Reload the dashboard | "An update is waiting for blockchain registration": V2 exists, but **V1 is still current**, because the run had no issuer key | PASS |
| 8–10 | Terminal: `bash scripts/demo-add-skill.sh` | `1 issued with blockchain registration`. Dashboard: V2 current, same Passport ID and first-issue date, new code, block and transaction shown | PASS (TEST issuer) |
| 12 | Reload the dashboard | V2 current, V1 under history; the skill is on pages 3 and 4 | PASS |
| 13 | Private window: `http://localhost:3000/verify`, enter V2's code, upload the downloaded V2 PDF | "Document authentic and current…; issued by BTU's hackathon TEST issuer". Hash, block, transaction, issuer shown; no name or email | PASS (issuer = TEST) |
| 14 | Terminal: `python3 scripts/demo-tamper.py ~/Downloads/BTU-AI-000125_V2.pdf modified.pdf` (or edit it in any PDF editor), then upload `modified.pdf` with V2's code | "Not verified": file integrity ✗, hashes differ. Also try `BTU-0000-0000-0000`: not found | PASS |
| 15 | Enter V1's code (from the dashboard history) and upload the V1 PDF | "Document authentic, historical version (superseded, not current)" | PASS |
| 16 | Terminal: `bash scripts/demo-add-skill.sh` again | `awards: 0 new`, `versions generated 0`, no transaction | PASS |

Optional, 1 minute: sign in at `/admin/login` as `ops.demo@staff.example.org` to show import problems, the student
record with on-chain status, and the audit log.

## Closing line

"The whole flow works end to end and is covered by an automated test (`npm run test:e2e`). Before real use
BTU needs to provide: Google sign-in and Sheets credentials, an official issuer key and trust anchor on BTU's
domain, a public network choice, and the missing design assets."
