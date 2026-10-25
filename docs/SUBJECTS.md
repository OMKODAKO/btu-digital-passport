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
python3 -m worker subjects load    # adds missing subjects and syllabi; never changes existing rows
python3 -m worker subjects list    # the passport subjects and their syllabi
```

## Score and tier (`worker/subjects/scoring.py`)

```
score = Σ weight × earned / max_points        (0–100, rounded half up to 2 decimals)
```

| Score | Badge |
| --- | --- |
| 90–100 | Platinum |
| 70–89.99 | Gold |
| 60–69.99 | Silver |
| below 60 | no badge |

Example (Vibe Coding): quizzes 15/20 (10%), assignments 30/40 (20%), project 80/100 (30%),
midterm 21/30 (15%), final 40/50 (25%) → 7.5 + 15 + 24 + 10.5 + 20 = **77.00 → Gold**.

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
  "Quizzes=15" "Assignments=30" "Agent project=80" "Midterm exam=21" "Final exam=40"
python3 -m worker grades show --student BTU-T-0001     # SUBJ-VIBE-CODING  77.00  GOLD
```

## Next stages

3. Staff UI: add a student, enter grades, syllabus popup.
4. Synthetic data generator.
5. Subject badges (subject logo × silver/gold/platinum) under the skills on the PDF; new passport versions.
6. Dashboard skills chart and verify page.
7. Live rollout after a backup of the live data.
