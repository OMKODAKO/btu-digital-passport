"""Subject score and badge tier.

A subject's score is out of 100 and weighted by its syllabus:

    score = sum over components of  weight × earned / max_points

e.g. quizzes marked 15/20 that count for 10% add 7.5 points. The score is rounded to two decimals
(half up) before the tier is chosen, so the number shown and the tier always agree.

Tiers (Merabi, 2026-10-25), lower bound included:  60–70 Silver, 70–90 Gold, 90–100 Platinum.
Below 60 there is no badge.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

RULES_VERSION = 1
TIERS = (("PLATINUM", Decimal(90)), ("GOLD", Decimal(70)), ("SILVER", Decimal(60)))   # highest first


class ScoreError(ValueError):
    pass


def subject_score(components, earned: dict[str, float]) -> Decimal:
    """components: rows/dicts with label, weight, max_points. earned: label -> points on the component's
    own scale. Every component needs a mark (0 is a mark); a missing, negative or too-high mark is refused."""
    total = Decimal(0)
    labels = {c["label"] for c in components}
    unknown = set(earned) - labels
    if unknown:
        raise ScoreError(f"not in this syllabus: {', '.join(sorted(unknown))}")
    for c in components:
        if c["label"] not in earned or earned[c["label"]] is None:
            raise ScoreError(f"no mark for {c['label']}")
        points, top = Decimal(str(earned[c["label"]])), Decimal(str(c["max_points"]))
        if points < 0 or points > top:
            raise ScoreError(f"{c['label']}: {points} is outside 0–{top}")
        total += Decimal(str(c["weight"])) * points / top
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def tier_for(score) -> str | None:
    """SILVER, GOLD, PLATINUM, or None below 60."""
    s = Decimal(str(score))
    if s < 0 or s > 100:
        raise ScoreError(f"score {s} is outside 0–100")
    return next((name for name, low in TIERS if s >= low), None)
