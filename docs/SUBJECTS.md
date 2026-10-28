# Subject scores and badges

BTU's course API and syllabi are not available to this project, so this part is **simulated**: the
subject list is real (BTU course names and ECTS credits), the syllabi and, later, the grades are not.

## Stage 01 (this branch): subject catalog and simulated syllabi

- `db/migrations/006_subjects.sql` adds `subjects`, `syllabi` and `syllabus_components`. It adds tables
  and triggers only; existing tables and rows are not changed (tested on a database with passports).
- `worker/subjects/catalog.json`: 29 courses from BTU's course list (names and credits only, no grades),
  13 of them marked `passport_relevant` for the AI Skills Digital Passport, each with a skill area for
  the dashboard chart and a logo key for its badge art.
- Every subject has a simulated syllabus v1: quizzes, assignments, project, midterm, final. Each
  component has a **weight** (the weights add up to 100) and its own **raw maximum**.
- Syllabi are append-only: a change is a new syllabus version, so grades keep the weights they were marked under.

```bash
python3 -m worker subjects load    # adds missing subjects and syllabi (a changed syllabus as a new version); never changes existing rows
python3 -m worker subjects list    # the passport subjects and their syllabi
```

## Score and tier (`worker/subjects/scoring.py`)

Each subject has 100 points in total, split across its components (Merabi, 2026-10-25: simpler than weights
on a separate scale). A component's maximum equals its weight, so

```
score = sum of the points earned in every component        (0–100, at most 2 decimals)
```

The code keeps the general form Σ weight × earned / max_points (rounded half up to 2 decimals), which gives
exactly that sum for current syllabi and still scores marks entered under an older syllabus version.

| Score | Badge |
| --- | --- |
| 90–100 | Platinum |
| 70–89.99 | Gold |
| 60–69.99 | Silver |
| below 60 | no badge |

Every subject uses the same split (Merabi, 2026-10-25): **quizzes 15, assignments 20, project 10,
midterm 25, final 30**. Example: 12 + 15 + 8 + 19 + 23 = **77.00 → Gold**.

## Passport subjects

| Subject | ECTS | Area |
| --- | --- | --- |
| Vibe Coding and AI-Agentic Engineering | 3 | AI & ML |
| Artificial Intelligence and Machine Learning | 6 | AI & ML |
| Fundamentals of Artificial Intelligence | 3 | AI & ML |
| Machine Learning (Deep Learning) | 6 | AI & ML |
| Programming (Python) | 6 | Programming |
| Introduction to Programming (Python) | 6 | Programming |
| Data Structures and Algorithms (C, I) | 6 | Programming |
| Introduction to Databases | 6 | Data |
| Probability Theory and Mathematical Statistics | 6 | Data |
| Computer Graphics and Visualization | 3 | Data |
| Linear Algebra (Advanced) | 6 | Math foundations |
| Information Security | 6 | Security |
| Principles of Digital Technologies | 3 | Digital literacy |

## Stage 02: marks and subject results

- `db/migrations/007_grades.sql` adds `grade_entries`: one row per mark (student × syllabus component), on the
  component's own scale. Append-only: a correction is a new row naming the mark it replaces (`supersedes_fk`).
  The database refuses edits, deletes, a mark above the component's maximum, a second "first" mark, a correction
  of another student's mark, and two corrections of one mark.
- Marks are allowed only for passport subjects, and stay under the syllabus version the student was first marked under.
- `worker/subjects/grades.py`: `record_marks()` checks every mark before storing any; the same mark again is a
  no-op; each change is written to the audit log (`GRADES_RECORDED`). `subject_results()` gives per subject
  COMPLETE (score + tier) or IN_PROGRESS (which components are missing; no score, no badge).

```bash
python3 -m worker grades add --student BTU-T-0001 --subject SUBJ-VIBE-CODING \
  "Quizzes=12" "Assignments=15" "Agent project=8" "Midterm exam=19" "Final exam=23"
python3 -m worker grades show --student BTU-T-0001     # SUBJ-VIBE-CODING  77.00  GOLD
```

## Stage 03: staff screens

All in the admin area (`/admin`), sign-in required; viewing needs any staff role, changes need OPERATOR
(checked on the server, refusals written to the audit log as `STUDENT_CREATE_DENIED` / `MARKS_DENIED`).

- **Subjects** tab: the passport subjects (`?all=1` for the whole catalog), each with a **Syllabus** popup
  (components, weights, maximum points, the formula and the badge thresholds; marked *Simulated*).
- **Students → Add student**: first and last name required; Student ID and email default to the next free
  `BTU-T-NNNN` and `<id>@example.org`; program, education level, status. No password: the student signs in with the Google
  account that uses this email (or, in the local demo, from the list on the sign-in page). A test password is made
  only when `PASSPORT_PASSWORD_LOGIN=1` (the automated tests). Stored with source `SEED_SYNTHETIC`, so the demo banner stays.
- **Student page → Subject results**: score, badge and missing components per subject, and *Enter marks* for
  any passport subject. The marks form follows the student's syllabus version; an empty field is left unmarked;
  a changed mark is stored as a correction (`MANUAL`, entered by the staff email, optional note). The web uses the
  same rules and exact arithmetic as the worker, and `tests/stage7.test.mjs` checks both give the same score.

Nothing in stage 03 changes passports, versions, sheet records or skills; badges reach the PDF in stage 05.

## Stage 05: subject badges on the passport

- A completed passport subject with a score of 60+ is a badge: Silver 60+, Gold 70+, Platinum 90+.
- Subject badges are printed after the sheet skills, like skills (Merabi, 2026-10-25): a card on the Verified
  AI Skillset page (stamp, course name, score out of 100, tier, ECTS) and a row in the AI Skill Supplement table
  (course name, the course's short description from `catalog.json`, "BTU course · ECTS · score", date of the
  last mark). The badge art is drawn in `worker/pdf/subject_badges.py` in the style of BTU's stamps: subject
  icon + tier, one colour per tier (13 icons x 3 tiers). The skillset page says the syllabi and marks are
  simulated demo data.
- `passport-data.json` in the PDF lists the badges (`subject_badges`) only for versions that have any, so every
  earlier version's data is unchanged.
- Versions: migration 008 records each candidate's and version's badges (`candidate_subjects`,
  `version_subjects`, append-only). `sync.generate_if_needed` makes the next version when the student's current
  badges differ from the newest version's (new badge, other score or tier, or a badge corrected away), keeping
  every sheet skill. An import without marks makes no new versions.
- `python3 -m worker subjects publish [--assign-new-passport-ids] [--watch SECONDS]` (`npm run badges`) does this
  for every marked student and issues the new version like an import does. The quickstart runs it every 10 s in
  the background on the local demo data, so marks entered in the admin reach the PDF on their own.

## Sheet skills as courses

Merabi asked, on 2026-10-26, for the 16 skills of BTU's skill sheet (hackathon test data) to be offered as courses
next to the BTU subjects, each with its own badge.

- **Catalog:** they are catalog entries with code = their Skill ID (`SKL-001` … `SKL-016`). The name, category,
  badge code and description are copied from the sheet; the Georgian names were translated here.
- **Marks and badges:** they use the same 100-point split and tiers as every subject. The badge stamp shows the
  skill's category (for example AI APPLIED SKILL) where a BTU course shows SUBJECT BADGE. The card and the supplement
  row also show the category's badge code (BDG-AI-001/002/003).
- **ECTS:** the sheet gives no ECTS, so none is shown. The stored `credits` value 1 is only a placeholder that the
  database requires.
- **No overlap with sheet records:** the sheet's own skill records are unchanged and still come only from the sheet.
- **A held skill with a score is shown once (2026-10-28):** when a student holds a sheet skill and its course is
  marked, the passport shows that skill with its score and tier, not a second badge card. Its stamp is BTU's
  category stamp printed in the tier's ink (Silver grey, Gold, Platinum blue steel with a third rim), on the PDF's
  Verified AI Skillset and Supplement pages and in the dashboard booklet. The ink stamps are made by
  `scripts/make-stamps.py` (`public/stamps/*-silver|gold|platinum.png` and `worker/pdf/assets/tier-stamps/`).
  A course the student does not hold as a sheet skill is still printed as its own badge after the skills.

## Demo marks for the skills students already have

BTU's grades are not connected, so `python3 -m worker grades demo` gives every skill a student already holds
(SKL-001 … SKL-016) a random SYNTHETIC mark for each syllabus component. The tier is drawn first (Silver 35 %,
Gold 45 %, Platinum 20 %), then a score inside it, split over the components in half points. The marks are seeded
per student and skill (same marks on every run) and a skill that already has any mark is left alone. `--dry-run`
prints them without recording. `--redraw` also gives a fresh draw to skills whose current marks are all from this
command (entered as corrections, so the old marks stay on record; a skill with any other mark is never touched). `python3 -m worker subjects publish` then issues the new passport versions.
`npm run quickstart` runs both for the demo. On a database whose versions go to a public test chain (Sepolia),
every changed passport becomes a new on-chain version, so run it there only on purpose.

## Next stages

4. Synthetic data generator.
6. Dashboard skills chart and verify page.
7. Live rollout after a backup of the live data.
