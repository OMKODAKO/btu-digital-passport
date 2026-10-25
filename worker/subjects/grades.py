"""Students' marks per syllabus component (migration 007) and the subject results built from them.

Marks are append-only: record_marks() adds a first mark, or a correction that names the mark it
replaces; it never edits or removes one. A student's result in a subject is computed from their latest
marks under the syllabus version they were first marked under:

  - every component marked -> COMPLETE, with a score (scoring.subject_score) and a tier (or none below 60)
  - some components marked -> IN_PROGRESS, no score and no badge yet
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from ..db import audit, transaction, utc_now
from .scoring import RULES_VERSION, ScoreError, subject_score, tier_for

SOURCES = ("MANUAL", "SYNTHETIC", "BTU_API")


class GradeError(ValueError):
    pass


@dataclass
class SubjectResult:
    subject_code: str
    name_en: str
    name_ka: str
    skill_area: str | None
    credits: int
    syllabus_version: int
    marks: dict[str, float]          # component label -> latest points
    missing: list[str]               # components without a mark
    status: str                      # COMPLETE | IN_PROGRESS
    score: Decimal | None = None
    tier: str | None = None
    rules_version: int = RULES_VERSION
    components: list[dict] = field(default_factory=list)


def _student(conn, student_code: str):
    s = conn.execute("SELECT * FROM students WHERE student_id = ?", (student_code,)).fetchone()
    if s is None:
        raise GradeError(f"no student {student_code}")
    return s


def _subject(conn, subject_code: str):
    s = conn.execute("SELECT * FROM subjects WHERE code = ?", (subject_code,)).fetchone()
    if s is None:
        raise GradeError(f"no subject {subject_code}")
    if not s["passport_relevant"]:
        raise GradeError(f"{subject_code} does not count toward the passport; marks are kept only for passport subjects")
    return s


def student_syllabus(conn, student_fk: int, subject_fk: int):
    """The syllabus a student is marked under: the one of their first mark in this subject, else the newest."""
    row = conn.execute(
        """SELECT y.* FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
           JOIN syllabi y ON y.id = c.syllabus_fk
           WHERE g.student_fk = ? AND y.subject_fk = ? ORDER BY g.id LIMIT 1""", (student_fk, subject_fk)).fetchone()
    return row or conn.execute("SELECT * FROM syllabi WHERE subject_fk = ? ORDER BY version DESC LIMIT 1",
                               (subject_fk,)).fetchone()


def latest_entries(conn, student_fk: int, syllabus_fk: int) -> dict[int, object]:
    """component id -> the student's latest mark row (one that no other row corrects)."""
    rows = conn.execute(
        """SELECT g.* FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
           WHERE g.student_fk = ? AND c.syllabus_fk = ?
             AND NOT EXISTS (SELECT 1 FROM grade_entries n WHERE n.supersedes_fk = g.id)""",
        (student_fk, syllabus_fk)).fetchall()
    return {r["component_fk"]: r for r in rows}


def record_marks(conn, student_code: str, subject_code: str, marks: dict[str, float], *, entered_by: str,
                 source: str = "MANUAL", note: str | None = None) -> dict:
    """Records marks (component label -> points). A mark equal to the latest one is skipped; a different one
    is entered as a correction. Everything is checked before anything is written: one bad mark stores none."""
    if source not in SOURCES:
        raise GradeError(f"source must be one of {', '.join(SOURCES)}")
    if not str(entered_by or "").strip():
        raise GradeError("entered_by is required")
    if not marks:
        raise GradeError("no marks given")
    student, subject = _student(conn, student_code), _subject(conn, subject_code)
    syllabus = student_syllabus(conn, student["id"], subject["id"])
    if syllabus is None:
        raise GradeError(f"{subject_code} has no syllabus")
    comps = {c["label"]: c for c in conn.execute(
        "SELECT * FROM syllabus_components WHERE syllabus_fk = ? ORDER BY position", (syllabus["id"],))}
    unknown = sorted(set(marks) - set(comps))
    if unknown:
        raise GradeError(f"not in {subject_code} syllabus v{syllabus['version']}: {', '.join(unknown)}")
    for label, points in marks.items():
        if not isinstance(points, (int, float)) or isinstance(points, bool):
            raise GradeError(f"{label}: points must be a number")
        if points < 0 or points > comps[label]["max_points"]:
            raise GradeError(f"{label}: {points:g} is outside 0–{comps[label]['max_points']:g}")

    added, corrected, unchanged = [], [], []
    with transaction(conn):
        latest = latest_entries(conn, student["id"], syllabus["id"])
        now = utc_now()
        for label, points in marks.items():
            c = comps[label]
            prev = latest.get(c["id"])
            if prev is not None and prev["points"] == float(points):
                unchanged.append(label)
                continue
            conn.execute(
                """INSERT INTO grade_entries (student_fk, component_fk, points, source, entered_by, entered_at,
                       supersedes_fk, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (student["id"], c["id"], float(points), source, entered_by, now, prev["id"] if prev else None, note))
            (corrected if prev else added).append(label)
        if added or corrected:
            audit(conn, "GRADES_RECORDED", actor=entered_by, student_id=student_code, subject=subject_code,
                  syllabus_version=syllabus["version"], source=source, added=added, corrected=corrected)
    return {"added": added, "corrected": corrected, "unchanged": unchanged}


def subject_results(conn, student_code: str) -> list[SubjectResult]:
    """The student's result in every passport subject they have at least one mark in."""
    student = _student(conn, student_code)
    subjects = conn.execute(
        """SELECT DISTINCT s.* FROM grade_entries g JOIN syllabus_components c ON c.id = g.component_fk
           JOIN syllabi y ON y.id = c.syllabus_fk JOIN subjects s ON s.id = y.subject_fk
           WHERE g.student_fk = ? AND s.passport_relevant = 1 ORDER BY s.skill_area, s.name_en""",
        (student["id"],)).fetchall()
    out = []
    for s in subjects:
        syllabus = student_syllabus(conn, student["id"], s["id"])
        comps = conn.execute("SELECT * FROM syllabus_components WHERE syllabus_fk = ? ORDER BY position",
                             (syllabus["id"],)).fetchall()
        latest = latest_entries(conn, student["id"], syllabus["id"])
        marks = {c["label"]: latest[c["id"]]["points"] for c in comps if c["id"] in latest}
        missing = [c["label"] for c in comps if c["id"] not in latest]
        r = SubjectResult(s["code"], s["name_en"], s["name_ka"], s["skill_area"], s["credits"], syllabus["version"],
                          marks, missing, "IN_PROGRESS" if missing else "COMPLETE",
                          components=[dict(label=c["label"], kind=c["kind"], weight=c["weight"],
                                           max_points=c["max_points"]) for c in comps])
        if not missing:
            try:
                r.score = subject_score(r.components, marks)
            except ScoreError as exc:  # marks are checked on entry, so this means stored data is inconsistent
                raise GradeError(f"{student_code} {s['code']}: {exc}") from exc
            r.tier = tier_for(r.score)
        out.append(r)
    return out


def mark_history(conn, student_code: str, subject_code: str) -> list:
    """Every mark entered for the student in the subject, oldest first, corrections included."""
    student = _student(conn, student_code)
    return conn.execute(
        """SELECT g.*, c.label, c.max_points, y.version AS syllabus_version FROM grade_entries g
           JOIN syllabus_components c ON c.id = g.component_fk JOIN syllabi y ON y.id = c.syllabus_fk
           JOIN subjects s ON s.id = y.subject_fk WHERE g.student_fk = ? AND s.code = ? ORDER BY g.id""",
        (student["id"], subject_code)).fetchall()
