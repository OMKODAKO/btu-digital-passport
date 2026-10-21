"""Source-neutral shape of the skill sheet. Readers (Excel today, Google Sheets later) produce a
SourceTable; the sync engine only ever sees this, never the file or API behind it."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

# Columns A–P: input written by BTU staff
STUDENT_ID = "Student ID"
FIRST_NAME = "First Name"
LAST_NAME = "Last Name"
EMAIL = "BTU Email (Test)"
PROGRAM = "Program"
EDUCATION_LEVEL = "Education Level"
PASSPORT_ID = "Passport ID (Existing)"
FIRST_ISSUED = "First Issued (Existing)"
STUDENT_STATUS = "Student Status"
RECORD_ID = "Record ID"
SKILL_ID = "Skill ID"
SKILL_NAME = "Skill Name"
SKILL_CATEGORY = "Skill Category"
BADGE_CODE = "Badge/Stamp Code"
SKILL_DESCRIPTION = "Skill Description"
DATE_EARNED = "Date Earned"
INPUT_COLUMNS = [
    STUDENT_ID, FIRST_NAME, LAST_NAME, EMAIL, PROGRAM, EDUCATION_LEVEL, PASSPORT_ID, FIRST_ISSUED,
    STUDENT_STATUS, RECORD_ID, SKILL_ID, SKILL_NAME, SKILL_CATEGORY, BADGE_CODE, SKILL_DESCRIPTION, DATE_EARNED,
]

# Columns Q–T: written only by this system
SYNC_STATUS = "Passport Sync Status"
SYNCED_VERSION = "Synced Passport Version"
SYNCED_AT = "Synced At (UTC)"
SYNC_NOTES = "Sync Error / Notes"
OUTPUT_COLUMNS = [SYNC_STATUS, SYNCED_VERSION, SYNCED_AT, SYNC_NOTES]


@dataclass
class SourceRow:
    sheet_row: int                 # 1-based row number in the sheet, for error messages
    values: dict[str, Any]         # A–P (and an optional confirmation column), exactly as read
    outputs: dict[str, Any]        # Q–T as currently in the sheet
    notes: list[str] = field(default_factory=list)  # reader remarks, e.g. formula without cached value


@dataclass
class SourceTable:
    source_type: str               # 'XLSX' | 'GOOGLE_SHEETS'
    source_name: str
    source_sha256: str | None
    sheet_name: str
    header_row: int
    columns: dict[str, int]        # header -> 1-based column number
    rows: list[SourceRow]
    ignored_rows: list[tuple[int, str]]  # (sheet row, why), e.g. the notes block under the data
    blank_rows: int
    confirmation_column: str | None  # header of the confirmation column, if the sheet has one


def raw_value(v):
    """JSON-safe copy of a cell value that keeps its meaning (dates as ISO text)."""
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v
