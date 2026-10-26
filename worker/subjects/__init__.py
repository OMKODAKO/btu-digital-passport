"""BTU subject catalog and simulated syllabi (migration 006).

catalog.json holds every course from the BTU course list with its ECTS credits, whether it counts
toward the AI Skills Digital Passport, and a SIMULATED syllabus: BTU's real syllabi are not available,
so each subject gets components (quizzes, assignments, project, midterm, final) worth points that add
up to 100 (quizzes 15, assignments 20, project 10, midterm 25, final 30): a component's maximum is
its weight, and a subject's score is simply the sum of its marks. load_catalog() adds what the database
is missing and never changes or removes existing rows; a changed syllabus is added as a new version.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from ..db import audit, transaction

CATALOG_PATH = Path(__file__).with_name("catalog.json")
KINDS = ("QUIZ", "ASSIGNMENT", "PROJECT", "MIDTERM", "FINAL")


class CatalogError(ValueError):
    pass


@dataclass
class LoadResult:
    subjects_added: list[str]
    syllabi_added: list[str]
    unchanged: int
    differences: list[str]   # subject values that differ from rows already in the database (left as they are)


def read_catalog(path: Path = CATALOG_PATH) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    problems = validate_catalog(data)
    if problems:
        raise CatalogError("; ".join(problems))
    return data


def validate_catalog(data: dict) -> list[str]:
    problems = []
    if not data.get("source"):
        problems.append("catalog has no source")
    seen_codes, seen_names = set(), set()
    for s in data.get("subjects", []):
        code = s.get("code") or "?"
        for key in ("code", "name_ka", "name_en"):
            if not str(s.get(key) or "").strip():
                problems.append(f"{code}: {key} is empty")
        if code in seen_codes:
            problems.append(f"{code}: code used twice")
        if s.get("name_ka") in seen_names:
            problems.append(f"{code}: name {s.get('name_ka')!r} used twice")
        seen_codes.add(code)
        seen_names.add(s.get("name_ka"))
        if not isinstance(s.get("credits"), int) or s["credits"] <= 0:
            problems.append(f"{code}: credits must be a positive whole number")
        if s.get("passport_relevant") and not s.get("skill_area"):
            problems.append(f"{code}: a passport subject needs a skill_area")
        if s.get("passport_relevant") and not str(s.get("description") or "").strip():
            problems.append(f"{code}: a passport subject needs a short description (printed on the passport)")
        if s.get("sheet_skill") is not None:
            problems += [f"{code}: {p}" for p in validate_sheet_skill(s)]
        problems += [f"{code}: {p}" for p in validate_syllabus(s.get("syllabus") or [])]
    if not seen_codes:
        problems.append("catalog has no subjects")
    return problems


# a sheet skill's badge follows its category, as in the skill sheet (validate.BADGE_BY_CATEGORY)
SHEET_BADGES = {"AI Skill": "BDG-AI-001", "AI Applied Skill": "BDG-AI-002", "AI Advanced Skill": "BDG-AI-003"}


def validate_sheet_skill(s: dict) -> list[str]:
    """A skill from the skill sheet offered as a course: code SKL-NNN (its sheet Skill ID), a known category with
    its badge code, a passport subject, and the placeholder credits value 1 (the sheet gives no ECTS)."""
    sk, problems = s["sheet_skill"], []
    if not re.fullmatch(r"SKL-\d{3}", str(s.get("code"))):
        problems.append("a sheet skill's code must be its Skill ID, SKL-NNN")
    if not isinstance(sk, dict) or sk.get("category") not in SHEET_BADGES:
        problems.append(f"sheet_skill.category must be one of {', '.join(SHEET_BADGES)}")
    elif sk.get("badge_code") != SHEET_BADGES[sk["category"]]:
        problems.append(f"sheet_skill.badge_code must be {SHEET_BADGES[sk['category']]} for {sk['category']}")
    if not s.get("passport_relevant"):
        problems.append("a sheet skill counts toward the passport")
    if s.get("credits") != 1:
        problems.append("a sheet skill has no ECTS: credits must be the placeholder 1")
    return problems


def validate_syllabus(components: list[dict]) -> list[str]:
    """A syllabus: at least one component, known kinds, unique labels, each worth its weight in points
    (max_points == weight), weights summing to 100."""
    problems = []
    if not components:
        return ["syllabus has no components"]
    labels = [c.get("label") for c in components]
    if len(set(labels)) != len(labels):
        problems.append("syllabus has a component label twice")
    for c in components:
        if c.get("kind") not in KINDS:
            problems.append(f"component {c.get('label')!r}: kind must be one of {', '.join(KINDS)}")
        if not (isinstance(c.get("weight"), (int, float)) and 0 < c["weight"] <= 100):
            problems.append(f"component {c.get('label')!r}: weight must be above 0 and at most 100")
        if not (isinstance(c.get("max_points"), (int, float)) and c["max_points"] > 0):
            problems.append(f"component {c.get('label')!r}: max_points must be above 0")
        elif c.get("max_points") != c.get("weight"):
            problems.append(f"component {c.get('label')!r}: max_points must equal its weight (the points add up to 100)")
    total = sum(c.get("weight") or 0 for c in components if isinstance(c.get("weight"), (int, float)))
    if abs(total - 100) > 1e-9:
        problems.append(f"weights add up to {total:g}, not 100")
    return problems


def load_catalog(conn, data: dict | None = None) -> LoadResult:
    """Adds missing subjects and their first syllabus, and a new syllabus version when the catalog's differs
    from the newest stored one. Existing rows are never changed: students already marked keep the version
    they were marked under, and a subject value that differs from the database is only reported."""
    data = data or read_catalog()
    problems = validate_catalog(data)
    if problems:
        raise CatalogError("; ".join(problems))
    result = LoadResult([], [], 0, [])
    with transaction(conn):
        for s in data["subjects"]:
            row = conn.execute("SELECT * FROM subjects WHERE code = ?", (s["code"],)).fetchone()
            if row is None:
                if conn.execute("SELECT 1 FROM subjects WHERE name_ka = ?", (s["name_ka"],)).fetchone():
                    raise CatalogError(f"{s['code']}: name {s['name_ka']!r} already belongs to another subject")
                subject_fk = conn.execute(
                    """INSERT INTO subjects (code, name_ka, name_en, credits, passport_relevant, skill_area, logo_key, source)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (s["code"], s["name_ka"], s["name_en"], s["credits"], int(bool(s["passport_relevant"])),
                     s.get("skill_area"), s.get("logo_key"), data["source"])).lastrowid
                result.subjects_added.append(s["code"])
            else:
                subject_fk = row["id"]
                for key, new in (("name_ka", s["name_ka"]), ("name_en", s["name_en"]), ("credits", s["credits"]),
                                 ("passport_relevant", int(bool(s["passport_relevant"]))),
                                 ("skill_area", s.get("skill_area")), ("logo_key", s.get("logo_key"))):
                    if row[key] != new:
                        result.differences.append(f"{s['code']}: {key} is {row[key]!r} in the database, {new!r} in the catalog")
            latest = current_syllabus(conn, subject_fk)
            if latest is not None:
                stored = [dict(kind=c["kind"], label=c["label"], weight=c["weight"], max_points=c["max_points"])
                          for c in syllabus_components(conn, subject_fk)]
                wanted = [dict(kind=c["kind"], label=c["label"], weight=float(c["weight"]), max_points=float(c["max_points"]))
                          for c in s["syllabus"]]
                if stored == wanted:
                    result.unchanged += 1
                    continue
            version = latest["version"] + 1 if latest is not None else 1
            syllabus_fk = conn.execute(
                "INSERT INTO syllabi (subject_fk, version, simulated, note) VALUES (?, ?, 1, ?)",
                (subject_fk, version, "Simulated: BTU syllabus not available")).lastrowid
            conn.executemany(
                """INSERT INTO syllabus_components (syllabus_fk, position, kind, label, weight, max_points)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [(syllabus_fk, i + 1, c["kind"], c["label"], c["weight"], c["max_points"])
                 for i, c in enumerate(s["syllabus"])])
            result.syllabi_added.append(s["code"] if version == 1 else f"{s['code']} v{version}")
        if result.subjects_added or result.syllabi_added:
            audit(conn, "SUBJECT_CATALOG_LOADED", source=data["source"], subjects_added=len(result.subjects_added),
                  syllabi_added=len(result.syllabi_added))
    return result


def current_syllabus(conn, subject_fk: int):
    return conn.execute("SELECT * FROM syllabi WHERE subject_fk = ? ORDER BY version DESC LIMIT 1",
                        (subject_fk,)).fetchone()


def syllabus_components(conn, subject_fk: int) -> list:
    """The components of a subject's newest syllabus, in order."""
    s = current_syllabus(conn, subject_fk)
    if s is None:
        return []
    return conn.execute("SELECT * FROM syllabus_components WHERE syllabus_fk = ? ORDER BY position",
                        (s["id"],)).fetchall()


def passport_subjects(conn) -> list:
    return conn.execute("SELECT * FROM subjects WHERE passport_relevant = 1 ORDER BY skill_area, name_en").fetchall()
