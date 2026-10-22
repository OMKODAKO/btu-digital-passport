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


@dataclass
class Holder:
    passport_id: str        # permanent
    first_name: str         # frozen at first issuance
    last_name: str
    first_issued: date      # never changes between versions
    skills: list[Skill] = field(default_factory=list)
    program: str = ""         # study program and degree level, printed small on the cover
    education_level: str = ""


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
    }
