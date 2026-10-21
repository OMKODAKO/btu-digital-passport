"""Checks that need only the sheet itself: required fields, formats, dates, and consistency
between rows. Checks against the database happen in sync.py."""
from __future__ import annotations

import hashlib
import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from . import config
from .table import (BADGE_CODE, DATE_EARNED, EDUCATION_LEVEL, EMAIL, FIRST_ISSUED, FIRST_NAME, INPUT_COLUMNS,
                    LAST_NAME, PASSPORT_ID, PROGRAM, RECORD_ID, SKILL_CATEGORY, SKILL_DESCRIPTION, SKILL_ID,
                    SKILL_NAME, STUDENT_ID, STUDENT_STATUS, SourceRow, SourceTable, raw_value)

BADGE_BY_CATEGORY = {"AI Skill": "BDG-AI-001", "AI Applied Skill": "BDG-AI-002", "AI Advanced Skill": "BDG-AI-003"}
KNOWN_STUDENT_STATUS = {"Active", "Graduate"}

# BTU test data uses BTU-T-0001; the real Student ID format is a BTU decision, so it can be set.
RE_STUDENT = re.compile(os.environ.get("PASSPORT_STUDENT_ID_PATTERN", r"^BTU-T-\d{4,}$"))
RE_RECORD = re.compile(r"^REC-\d{4,}$")
RE_SKILL = re.compile(r"^SKL-\d{3,}$")
RE_PASSPORT = re.compile(r"^BTU-AI-\d{6}$")
RE_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Required on every record: the workbook's rule (A–M and O–P), except Passport ID and First Issued,
# which a brand-new student may not have yet (handled as an explicit pending state, never invented).
REQUIRED = [h for h in INPUT_COLUMNS if h not in (BADGE_CODE, PASSPORT_ID, FIRST_ISSUED)]
IDENTITY_FIELDS = [FIRST_NAME, LAST_NAME, EMAIL, PASSPORT_ID, FIRST_ISSUED]
PROFILE_FIELDS = [PROGRAM, EDUCATION_LEVEL, STUDENT_STATUS]
SKILL_DEFINITION = [SKILL_NAME, SKILL_CATEGORY, SKILL_DESCRIPTION]


@dataclass
class Issue:
    sheet_row: int | None
    record_id: str | None
    student_code: str | None
    severity: str      # ERROR (row not processed) | HOLD (valid, waiting) | WARNING (processed, noted)
    code: str
    message: str


@dataclass
class Record:
    """A row whose own fields are valid, normalised for processing."""
    row: SourceRow
    student_code: str
    first_name: str
    last_name: str
    email: str
    program: str
    education_level: str
    student_status: str
    passport_id: str | None
    first_issued: date | None
    record_id: str
    skill_id: str
    skill_name: str
    skill_category: str
    badge_code: str
    description: str
    date_earned: date
    raw: dict
    fingerprint: str


@dataclass
class Validation:
    records: dict[int, Record] = field(default_factory=dict)     # sheet_row -> valid-so-far record
    issues: list[Issue] = field(default_factory=list)
    rejected: set[int] = field(default_factory=set)              # sheet rows with an ERROR
    held: set[int] = field(default_factory=set)                  # sheet rows with a HOLD
    run_notes: list[str] = field(default_factory=list)

    def add(self, row: SourceRow | None, severity: str, code: str, message: str, record_id=None, student=None):
        rid = record_id if record_id is not None else (_text(row.values.get(RECORD_ID)) if row else None)
        sid = student if student is not None else (_text(row.values.get(STUDENT_ID)) if row else None)
        self.issues.append(Issue(row.sheet_row if row else None, rid or None, sid or None, severity, code, message))
        if row and severity == "ERROR":
            self.rejected.add(row.sheet_row)
        if row and severity == "HOLD":
            self.held.add(row.sheet_row)

    def reject_all(self, rows: list[int], code: str, message: str):
        for r in rows:
            self.add(self.records[r].row, "ERROR", code, message)


def _text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return v.isoformat()[:10]
    return str(v).strip()


def parse_date(v) -> date | None:
    """Accepts real Excel dates and ISO 'YYYY-MM-DD' text. Anything else is invalid (None)."""
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _text(v)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        try:
            return date.fromisoformat(s)
        except ValueError:
            return None
    return None


def fingerprint(values: dict) -> str:
    """SHA-256 of the normalised A–P values: two reads of an unchanged row give the same value."""
    norm = {h: _text(values.get(h)) for h in INPUT_COLUMNS}
    return hashlib.sha256(json.dumps(norm, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def validate_table(table: SourceTable, today: date | None = None) -> Validation:
    today = today or datetime.now(timezone.utc).date()
    v = Validation()

    if table.confirmation_column is None:
        if config.CONFIRMATION_WHEN_ABSENT == "HOLD":
            v.run_notes.append(f"No {config.CONFIRMATION_COLUMN!r} column: every row is held (policy HOLD).")
        else:
            v.run_notes.append(
                f"No {config.CONFIRMATION_COLUMN!r} column in the sheet. Following the workbook's own note, every "
                "complete A–P row is treated as an already-confirmed award. Passport Sync Status is never used as approval."
            )

    for row in table.rows:
        val = row.values
        missing = [h for h in REQUIRED if _text(val.get(h)) == ""]
        if missing:
            v.add(row, "ERROR", "MISSING_FIELD", "Required value missing: " + ", ".join(missing))
            continue
        errors = []
        sid, rid, kid = _text(val[STUDENT_ID]), _text(val[RECORD_ID]), _text(val[SKILL_ID])
        pid = _text(val[PASSPORT_ID]) or None
        if not RE_STUDENT.match(sid):
            errors.append(("INVALID_STUDENT_ID", f"Student ID {sid!r} does not match the Student ID format {RE_STUDENT.pattern}"))
        if not RE_RECORD.match(rid):
            errors.append(("INVALID_RECORD_ID", f"Record ID {rid!r} is not in the form REC-0000"))
        if not RE_SKILL.match(kid):
            errors.append(("INVALID_SKILL_ID", f"Skill ID {kid!r} is not in the form SKL-000"))
        if pid and not RE_PASSPORT.match(pid):
            errors.append(("INVALID_PASSPORT_ID", f"Passport ID {pid!r} is not in the form BTU-AI-000000"))
        email = _text(val[EMAIL])
        if not RE_EMAIL.match(email):
            errors.append(("INVALID_EMAIL", f"Email {email!r} is not a valid address"))
        earned = parse_date(val[DATE_EARNED])
        if earned is None:
            errors.append(("INVALID_DATE", f"Date Earned {_text(val[DATE_EARNED])!r} is not a date (YYYY-MM-DD)"))
        elif earned > today:
            errors.append(("FUTURE_DATE", f"Date Earned {earned} is in the future"))
        first_issued = None
        if _text(val[FIRST_ISSUED]):
            first_issued = parse_date(val[FIRST_ISSUED])
            if first_issued is None:
                errors.append(("INVALID_DATE", f"First Issued {_text(val[FIRST_ISSUED])!r} is not a date (YYYY-MM-DD)"))
            elif first_issued > today:
                errors.append(("FUTURE_DATE", f"First Issued {first_issued} is in the future"))
        category = _text(val[SKILL_CATEGORY])
        expected_badge = BADGE_BY_CATEGORY.get(category)
        if expected_badge is None:
            errors.append(("INVALID_CATEGORY", f"Skill Category {category!r} is not one of {list(BADGE_BY_CATEGORY)}"))
        badge = _text(val[BADGE_CODE])
        if expected_badge and badge and badge != expected_badge:
            errors.append(("BADGE_MISMATCH", f"Badge/Stamp Code {badge!r} doesn't match category {category!r} ({expected_badge})"))
        for code, msg in errors:
            v.add(row, "ERROR", code, msg)
        if errors:
            continue
        if not badge:
            from_formula = any(n.startswith(BADGE_CODE) for n in row.notes)
            # A formula with no saved result (the file was saved by a tool that doesn't calculate) is
            # expected; the workbook defines the badge by category, so the same rule is applied here.
            v.add(row, "WARNING", "BADGE_FROM_FORMULA" if from_formula else "BADGE_DERIVED",
                  f"Badge/Stamp Code {'formula not calculated' if from_formula else 'empty'}; "
                  f"used {expected_badge} for category {category!r}")
            badge = expected_badge
        for note in row.notes:
            if not note.startswith(BADGE_CODE):
                v.add(row, "WARNING", "READER_NOTE", note)
        status = _text(val[STUDENT_STATUS])
        if status not in KNOWN_STUDENT_STATUS:
            v.add(row, "WARNING", "UNKNOWN_STUDENT_STATUS", f"Student Status {status!r} is not Active or Graduate")

        v.records[row.sheet_row] = Record(
            row=row, student_code=sid, first_name=_text(val[FIRST_NAME]), last_name=_text(val[LAST_NAME]),
            email=email.lower(), program=_text(val[PROGRAM]), education_level=_text(val[EDUCATION_LEVEL]),
            student_status=status, passport_id=pid, first_issued=first_issued, record_id=rid, skill_id=kid,
            skill_name=_text(val[SKILL_NAME]), skill_category=category, badge_code=badge,
            description=_text(val[SKILL_DESCRIPTION]), date_earned=earned,
            raw={h: raw_value(x) for h, x in val.items()}, fingerprint=fingerprint({**val, BADGE_CODE: badge}),
        )

        if table.confirmation_column:
            c = _text(val.get(table.confirmation_column)).upper()
            if c not in config.CONFIRMED_VALUES:
                v.add(row, "HOLD", "NOT_CONFIRMED", f"{table.confirmation_column} is {c or 'empty'}; only "
                      f"{'/'.join(sorted(config.CONFIRMED_VALUES))} records reach a passport")
        elif config.CONFIRMATION_WHEN_ABSENT == "HOLD":
            v.add(row, "HOLD", "NOT_CONFIRMED", "No confirmation column; policy HOLD keeps this record waiting")

    _cross_row_checks(v)
    return v


def _cross_row_checks(v: Validation) -> None:
    live = lambda: [r for r in v.records.values() if r.row.sheet_row not in v.rejected]

    # Record ID is the de-duplication key: two rows with one Record ID are both refused.
    by_record = defaultdict(list)
    for r in live():
        by_record[r.record_id].append(r.row.sheet_row)
    for rid, rows in by_record.items():
        if len(rows) > 1:
            v.reject_all(rows, "DUPLICATE_RECORD_ID", f"Record ID {rid} appears on rows {rows}; none of them is processed")

    # One Student ID = one identity. Any disagreement stops every row of that student.
    by_student = defaultdict(list)
    for r in live():
        by_student[r.student_code].append(r)
    for sid, recs in by_student.items():
        diffs = []
        for f, attr in [(FIRST_NAME, "first_name"), (LAST_NAME, "last_name"), (EMAIL, "email"),
                        (PASSPORT_ID, "passport_id"), (FIRST_ISSUED, "first_issued")]:
            seen = sorted({str(getattr(r, attr) or "") for r in recs})
            if len(seen) > 1:
                diffs.append(f"{f}: {' / '.join(s or '(empty)' for s in seen)}")
        if diffs:
            v.reject_all([r.row.sheet_row for r in recs], "IDENTITY_CONFLICT",
                         f"Rows for {sid} disagree on " + "; ".join(diffs))
            continue
        for f, attr in [(PROGRAM, "program"), (EDUCATION_LEVEL, "education_level"), (STUDENT_STATUS, "student_status")]:
            seen = sorted({getattr(r, attr) for r in recs})
            if len(seen) > 1:
                v.add(recs[-1].row, "WARNING", "PROFILE_DIFFERS",
                      f"Rows for {sid} differ on {f} ({' / '.join(seen)}); the last row's value is used")

    # An email or a Passport ID may belong to only one Student ID.
    for attr, label, code in [("email", "Email", "EMAIL_CONFLICT"), ("passport_id", "Passport ID", "PASSPORT_ID_CONFLICT")]:
        owners = defaultdict(set)
        for r in live():
            if getattr(r, attr):
                owners[getattr(r, attr)].add(r.student_code)
        for value, students in owners.items():
            if len(students) > 1:
                rows = [r.row.sheet_row for r in live() if r.student_code in students]
                v.reject_all(rows, code, f"{label} {value} is used by more than one Student ID: {sorted(students)}")

    # One definition per Skill ID.
    by_skill = defaultdict(list)
    for r in live():
        by_skill[r.skill_id].append(r)
    for kid, recs in by_skill.items():
        defs = {(r.skill_name, r.skill_category, r.description) for r in recs}
        if len(defs) > 1:
            v.reject_all([r.row.sheet_row for r in recs], "SKILL_DEFINITION_CONFLICT",
                         f"Skill ID {kid} has {len(defs)} different names/categories/descriptions in the sheet")
