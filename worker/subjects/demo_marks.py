"""Random marks for the skills students already have (BTU test data and the demo only).

BTU's grades are not connected, so to show scores and badge tiers on the test passports every skill a student
holds from the skill sheet (SKL-001..016, offered as courses in catalog.json) gets a simulated mark for each
component of its syllabus (quizzes 15, assignments 20, project 10, midterm 25, final 30). The tier is drawn
first, so the three tiers are spread over the students with Platinum the rarest:

    Silver 35 %   Gold 45 %   Platinum 20 %

then a score inside that tier's range, split over the components with a little noise (marks in half points).
Marks are entered with source SYNTHETIC through grades.record_marks, so they are append-only and audited like
any other. The random generator is seeded per student and skill, so a rerun gives the same marks, and a skill
that already has a mark of any kind is left alone: running this twice, or after a real mark, changes nothing.
With redraw=True (`grades demo --redraw`) skills whose current marks are all this command's own SYNTHETIC marks
get a fresh draw, entered as corrections (the old marks stay on record); a skill with any other mark is left alone.
`subjects publish` then issues the new passport versions.
"""
from __future__ import annotations

import random

from .grades import latest_entries, record_marks, student_syllabus
from .scoring import TIERS

TIER_ODDS = (("SILVER", 0.35), ("GOLD", 0.45), ("PLATINUM", 0.20))
TIER_RANGE = {"SILVER": (60.0, 69.5), "GOLD": (70.0, 89.5), "PLATINUM": (90.0, 100.0)}
assert {t for t, _ in TIERS} == set(TIER_RANGE)
NOTE = "Simulated demo mark: BTU grades are not connected"


def _pick_tier(rng: random.Random) -> str:
    x, acc = rng.random(), 0.0
    for tier, p in TIER_ODDS:
        acc += p
        if x < acc:
            return tier
    return TIER_ODDS[-1][0]


def random_marks(components, rng: random.Random) -> dict[str, float]:
    """label -> points (half points) for components with label and max_points, summing to a score in a random tier."""
    low, high = TIER_RANGE[_pick_tier(rng)]
    target = rng.uniform(low, high) / 100
    tops = {c["label"]: float(c["max_points"]) for c in components}
    total_max = sum(tops.values())
    marks = {k: round(min(1.0, max(0.0, target + rng.gauss(0, 0.07))) * top * 2) / 2 for k, top in tops.items()}
    want = target * total_max   # inside the drawn tier
    labels = list(tops)
    # nudge half a point at a time towards the drawn score (not just to the tier's edge, which piles scores on 60.00)
    for _ in range(1000):
        s = sum(marks.values())
        if s < want - 0.25:
            k = rng.choice([k for k in labels if marks[k] < tops[k]])
            marks[k] += 0.5
        elif s > want + 0.25:
            k = rng.choice([k for k in labels if marks[k] > 0])
            marks[k] -= 0.5
        else:
            break
    return marks


def demo_marks(conn, seed: str = "btu-demo", entered_by: str = "demo-marks", dry_run: bool = False,
               redraw: bool = False) -> list[dict]:
    """Marks every unmarked skill course of every student's sheet skills (and, with redraw, re-marks the ones only
    this command marked); returns one line per skill."""
    rows = conn.execute(
        """SELECT s.id AS student_fk, s.student_id, a.skill_id, j.id AS subject_fk
           FROM skill_awards a JOIN students s ON s.id = a.student_fk
           JOIN subjects j ON j.code = a.skill_id AND j.passport_relevant = 1
           ORDER BY s.student_id, a.skill_id""").fetchall()
    out = []
    for r in rows:
        marked = conn.execute(
            """SELECT 1 FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
               JOIN syllabi y ON y.id = c.syllabus_fk WHERE g.student_fk = ? AND y.subject_fk = ? LIMIT 1""",
            (r["student_fk"], r["subject_fk"])).fetchone()
        syllabus = student_syllabus(conn, r["student_fk"], r["subject_fk"])
        salt = ""
        if marked:
            latest = latest_entries(conn, r["student_fk"], syllabus["id"]).values()
            ours = latest and all(e["source"] == "SYNTHETIC" and e["entered_by"] == entered_by for e in latest)
            if not (redraw and ours):
                out.append({"student": r["student_id"], "skill": r["skill_id"], "result": "already marked"})
                continue
            salt = f":redraw:{conn.execute('SELECT COUNT(*) FROM grade_entries WHERE student_fk = ?', (r['student_fk'],)).fetchone()[0]}"
        comps = conn.execute("SELECT label, max_points FROM syllabus_components WHERE syllabus_fk = ? ORDER BY position",
                             (syllabus["id"],)).fetchall()
        marks = random_marks(comps, random.Random(f"{seed}:{r['student_id']}:{r['skill_id']}{salt}"))
        if not dry_run:
            record_marks(conn, r["student_id"], r["skill_id"], marks, entered_by=entered_by, source="SYNTHETIC", note=NOTE)
        out.append({"student": r["student_id"], "skill": r["skill_id"], "result": "redrawn" if salt else "marked",
                    "score": sum(marks.values()),
                    "marks": marks})
    return out
