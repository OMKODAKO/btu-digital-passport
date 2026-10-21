"""Writes sample passports from synthetic data (no real student), with PNG previews and a manifest.

    python3 -m worker.samples --out samples/stage3

Every file goes through the same render + read-back check used for issuance. Names, Passport IDs
(BTU-AI-9xxxxx) and skills are invented; the codes are random and registered nowhere.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pymupdf as fitz

from .issue import CODE_ALPHABET
from .pdf.check import check_pdf
from .pdf.model import Holder, Skill, canonical_payload
from .pdf.render import render_passport

SKILLS = [
    ("Prompt Design Basics", "AI Skill", "Writing clear prompts and checking generated answers for accuracy."),
    ("AI for Market Research", "AI Applied Skill", "Using AI tools to gather, summarise and compare market information."),
    ("Responsible AI Practice", "AI Skill", "Recognising bias, privacy risks and limits of AI systems."),
    ("Automating Office Workflows", "AI Applied Skill", "Connecting AI assistants to everyday document and data tasks."),
    ("Machine Learning Foundations", "AI Advanced Skill", "Training, evaluating and explaining supervised learning models."),
    ("AI-Assisted Data Analysis", "AI Applied Skill", "Cleaning and interpreting datasets with AI-assisted tools."),
    ("Generative Media Literacy", "AI Skill", "Evaluating AI-generated images, audio and video critically."),
    ("Deploying AI Services", "AI Advanced Skill", "Packaging, deploying and monitoring AI models in production."),
]
BADGE = {"AI Skill": "BDG-AI-001", "AI Applied Skill": "BDG-AI-002", "AI Advanced Skill": "BDG-AI-003"}


def skills(n: int, start: int = 0) -> list[Skill]:
    out = []
    for i in range(start, start + n):
        name, cat, desc = SKILLS[i % len(SKILLS)]
        suffix = f" {i // len(SKILLS) + 1}" if i >= len(SKILLS) else ""
        out.append(Skill(f"REC-S{i + 1:03d}", f"SKL-S{i % len(SKILLS) + 1:02d}", name + suffix, cat, BADGE[cat], desc,
                         date(2026, 9, 1) + timedelta(days=3 * i)))
    return out


def code() -> str:
    c = "".join(secrets.choice(CODE_ALPHABET) for _ in range(12))
    return f"BTU-{c[:4]}-{c[4:8]}-{c[8:]}"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="samples/stage3")
    out = Path(ap.parse_args(argv).out)
    out.mkdir(parents=True, exist_ok=True)

    long = ("A deliberately long synthetic description: the student designed, tested and documented an AI-assisted "
            "process over several weeks, compared three tools, measured accuracy against a manual baseline, and "
            "presented the results with a written reflection on risks, limitations and responsible use. ") * 3
    base = Holder("BTU-AI-900001", "Sample", "Student", date(2026, 9, 1), skills(3))
    with_long = skills(6)
    with_long[1] = replace(with_long[1], description=long.strip())
    with_long[4] = replace(with_long[4], description=(long * 2).strip())
    cases = [
        ("01-first-issue-V1", base, 1, "2026-09-01T10:00:00Z"),
        ("02-update-V2", replace(base, skills=skills(5)), 2, "2026-10-15T10:00:00Z"),
        ("03-many-skills-23", Holder("BTU-AI-900002", "Sample", "Manyskills", date(2026, 9, 1), skills(23)), 1, "2026-10-21T10:00:00Z"),
        ("04-long-descriptions", Holder("BTU-AI-900003", "Sample", "Longtext", date(2026, 9, 1), with_long), 1, "2026-10-21T10:00:00Z"),
        ("05-no-skills-yet", Holder("BTU-AI-900004", "Sample", "Empty", date(2026, 10, 1), []), 1, "2026-10-21T10:00:00Z"),
        ("06-georgian-name", Holder("BTU-AI-900005", "ნიმუში", "სტუდენტი", date(2026, 9, 1), skills(4)), 1, "2026-10-21T10:00:00Z"),
    ]
    manifest = []
    for name, holder, version, issued_at, in cases:
        c = code()
        payload = canonical_payload(holder, version, issued_at)
        pdf = out / f"{name}.pdf"
        layout = render_passport(holder, version, issued_at, c, f"https://passport.btu.edu.ge/verify/{c}", payload, pdf)
        data = pdf.read_bytes()
        checked = check_pdf(data, layout, payload)
        doc = fitz.open(pdf)
        for i, page in enumerate(doc):
            page.get_pixmap(dpi=60).save(out / f"{name}-p{i + 1}.png")
        manifest.append({"file": pdf.name, "passport_id": holder.passport_id, "version": f"V{version}",
                         "first_issued": holder.first_issued.isoformat(), "issued_at": issued_at, "verification_code": c,
                         "skills": len(holder.skills), "sha256": hashlib.sha256(data).hexdigest(), "check": checked,
                         "note": "synthetic sample; not issued, not registered on any blockchain"})
        print(f"{pdf.name}: {checked['pages']} pages, {len(holder.skills)} skills, code {c}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
