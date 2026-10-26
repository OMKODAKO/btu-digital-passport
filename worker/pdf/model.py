"""What one passport version contains, and the canonical record of what it certifies."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date

LEARNING_FORMAT = {
    "AI Skill": "Focused learning",
    "AI Applied Skill": "Applied learning",
    "AI Advanced Skill": "Extended academic learning",
}


@dataclass(frozen=True)
class Skill:
    record_id: str
    skill_id: str
    name: str
    category: str          # one of LEARNING_FORMAT's keys; picks the stamp artwork
    badge_code: str
    description: str
    date_earned: date
    earned_through: str = ""  # optional sheet column; falls back to the category's learning format


TIER_LABEL = {"SILVER": "Silver", "GOLD": "Gold", "PLATINUM": "Platinum"}


@dataclass(frozen=True)
class SubjectBadge:
    """A completed BTU subject with a badge tier (score 60+), printed after the sheet skills on the skillset
    and supplement pages."""
    code: str
    name_en: str
    name_ka: str
    logo_key: str          # picks the drawn subject icon (render.SUBJECT_ICONS)
    credits: int
    syllabus_version: int
    score: str             # "77.00", out of 100
    tier: str              # SILVER | GOLD | PLATINUM
    description: str = ""  # a short phrase about the course, from the catalog
    date_earned: str = ""  # ISO date the last mark was entered (when the subject was completed)
    category: str = ""     # for a skill from the skill sheet offered as a course: its category, e.g. "AI Applied Skill"
    badge_code: str = ""   # ... and that category's badge code, e.g. "BDG-AI-002" (both empty for a BTU course)


@dataclass
class Holder:
    passport_id: str        # permanent
    first_name: str         # frozen at first issuance
    last_name: str
    first_issued: date      # never changes between versions
    skills: list[Skill] = field(default_factory=list)
    program: str = ""         # study program and degree level, printed small on the cover
    education_level: str = ""
    subjects: list[SubjectBadge] = field(default_factory=list)


def canonical_payload(holder: Holder, version: int, issued_at: str) -> dict:
    """The data a version certifies; embedded in the PDF as passport-data.json.
    No email or student number: the document carries only what is printed on it."""
    return {
        "issuer": "Business and Technology University (BTU)",
        "passport_id": holder.passport_id,
        "first_name": holder.first_name,
        "last_name": holder.last_name,
        "first_issued": holder.first_issued.isoformat(),
        "version": version,
        "issued_at": issued_at,
        **({"program": holder.program} if holder.program else {}),
        **({"education_level": holder.education_level} if holder.education_level else {}),
        "skills": [{**asdict(s), "date_earned": s.date_earned.isoformat()} for s in holder.skills],
        # only in versions that have subject badges, so the data of every earlier version stays as it was
        **({"subject_badges": [asdict(b) for b in holder.subjects]} if holder.subjects else {}),
    }
