"""Subject badges on the passport (subject stage 05).

A student's completed passport subjects with a tier (score 60+) are printed as badges after their sheet
skills, on the skillset page (a stamp card each) and in the supplement table (with a short description). Each passport version records the badges it certifies (candidate_subjects ->
version_subjects, migration 008), so a new version is made only when a badge appears, changes tier or
score, or goes away after a corrected mark: sync.generate_if_needed compares the two.
"""
from __future__ import annotations

from functools import lru_cache

from ..pdf.model import SubjectBadge
from . import read_catalog
from .grades import latest_entries, student_syllabus, subject_results


@lru_cache(maxsize=1)
def _descriptions() -> dict[str, str]:
    """Short course descriptions from the catalog (printed on the passport)."""
    return {s["code"]: s.get("description", "") for s in read_catalog()["subjects"]}


def current_badges(conn, student_fk: int) -> list[SubjectBadge]:
    """The badges the student's marks give right now, in catalog order (skill area, then name)."""
    s = conn.execute("SELECT student_id FROM students WHERE id = ?", (student_fk,)).fetchone()
    if s is None or not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'grade_entries'").fetchone():
        return []
    out = []
    for r in subject_results(conn, s["student_id"]):
        if r.status != "COMPLETE" or r.tier is None:
            continue
        subj = conn.execute("SELECT id, logo_key FROM subjects WHERE code = ?", (r.subject_code,)).fetchone()
        syllabus = student_syllabus(conn, student_fk, subj["id"])
        done = max(e["entered_at"] for e in latest_entries(conn, student_fk, syllabus["id"]).values())
        out.append(SubjectBadge(code=r.subject_code, name_en=r.name_en, name_ka=r.name_ka, logo_key=subj["logo_key"] or "",
                                credits=r.credits, syllabus_version=r.syllabus_version, score=f"{r.score:.2f}",
                                tier=r.tier, description=_descriptions().get(r.subject_code, ""), date_earned=done[:10]))
    return out


def badge_keys(badges) -> set[tuple]:
    return {(b.code, b.syllabus_version, b.score, b.tier) for b in badges}


def contained_badges(conn, passport_fk: int, waiting=None, current=None) -> set[tuple]:
    """(code, syllabus version, score, tier) certified by the waiting candidate, else the current version."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'version_subjects'").fetchone():
        return set()   # a database from before migration 008 (only ever opened that way by tests)
    if waiting is not None:
        rows = conn.execute("SELECT * FROM candidate_subjects WHERE candidate_fk = ?", (waiting["id"],))
    elif current is not None:
        rows = conn.execute("SELECT * FROM version_subjects WHERE version_fk = ?", (current["id"],))
    else:
        return set()
    return {(r["subject_code"], r["syllabus_version"], r["score"], r["tier"]) for r in rows}


def publish(conn, registrar="configured", renderer=None, assign_new_passport_ids: bool = False) -> list[dict]:
    """Brings every marked student's passport up to date with their subject badges: renders a new version
    where the badges differ from the newest one and issues it (blockchain registration, or local-demo mode),
    exactly as an import does. Sheet skills are carried over unchanged. A marked student without a passport
    gets one only with assign_new_passport_ids (next BTU-AI number, first issued today), as an import would."""
    from .. import chain
    from ..db import audit, utc_now
    from ..issue import waiting_candidate
    from ..sync import _create_passport, _next_passport_id, generate_if_needed, try_issue

    registrar = chain.configured_registrar() if registrar == "configured" else registrar
    out = []
    students = conn.execute(
        "SELECT * FROM students WHERE id IN (SELECT student_fk FROM grade_entries) ORDER BY student_id").fetchall()
    for st in students:
        passport = conn.execute("SELECT * FROM passports WHERE student_fk = ?", (st["id"],)).fetchone()
        badges = current_badges(conn, st["id"])
        if passport is None:
            if not badges:
                continue
            if not assign_new_passport_ids:
                out.append({"student": st["student_id"], "result": "no passport (run with --assign-new-passport-ids)"})
                continue
            pid = _next_passport_id(conn)
            _create_passport(conn, st, pid, utc_now()[:10])
            audit(conn, "PASSPORT_CREATED", None, student_id=st["student_id"], passport_id=pid, reason="subject badges")
            passport = conn.execute("SELECT * FROM passports WHERE student_fk = ?", (st["id"],)).fetchone()
        gen = generate_if_needed(conn, passport, renderer)
        c = waiting_candidate(conn, passport["id"])
        issued = try_issue(conn, c, registrar) if c else None
        out.append({"student": st["student_id"], "passport_id": passport["passport_id"], "badges": len(badges),
                    "generation": "not needed" if gen is None else gen if isinstance(gen, str) else f"failed: {gen[1][:200]}",
                    "issuance": issued or "nothing waiting"})
    return out
