"""Reads a finished passport PDF back from its exact bytes and confirms it says what it should.

Run on every rendered file before it can become a passport version. Any problem raises
PdfCheckError and the file is discarded, so a clipped, incomplete or wrong document is never issued.
"""
from __future__ import annotations

import json
import re

import pymupdf as fitz

from .render import Layout


class PdfCheckError(Exception):
    def __init__(self, problems: list[str]):
        super().__init__("PDF check failed: " + "; ".join(problems[:8]) + (" …" if len(problems) > 8 else ""))
        self.problems = problems


def _norm(s: str) -> str:
    """Compare text without whitespace or case: wrapping and line breaks don't count, letters do."""
    return re.sub(r"\s+", "", s).upper()


def check_pdf(data: bytes, layout: Layout, payload: dict) -> dict:
    problems: list[str] = []
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise PdfCheckError([f"not a readable PDF: {exc}"]) from exc
    if doc.is_encrypted:
        problems.append("PDF is encrypted")
    if doc.page_count != layout.page_count or doc.page_count < 4:
        problems.append(f"expected {layout.page_count} pages, file has {doc.page_count}")
        raise PdfCheckError(problems)

    pages = [_norm(p.get_text()) for p in doc]
    pid = _norm(layout.passport_id)
    for i, text in enumerate(pages):
        if pid not in text:
            problems.append(f"page {i + 1} lacks the Passport ID")
    for s in layout.cover_texts:
        if _norm(s) not in pages[0]:
            problems.append(f"cover lacks '{s}'")
    if _norm(layout.code) not in pages[layout.supplement_pages[-1]]:
        problems.append("verification code missing from the last supplement page")

    for item in layout.placed:
        got = _norm(doc[item.page].get_text(clip=fitz.Rect(item.rect)))
        if got != _norm(item.text):
            problems.append(f"page {item.page + 1}, {item.what}: expected '{item.text[:40]}', found '{got[:40]}'")

    continuation = "".join(_norm(doc[i].get_text(clip=fitz.Rect(70, 140, 780, 460), sort=True))
                           for i in layout.continuation_pages)
    for entry in layout.continued:
        for t in entry["texts"]:
            if _norm(t) not in continuation:
                problems.append(f"{entry['record_id']}: continued text '{t[:40]}' not found on continuation pages")

    meta = doc.metadata or {}
    if f"verification_code={layout.code}" not in (meta.get("keywords") or ""):
        problems.append("metadata lacks the verification code")
    try:
        embedded = json.loads(doc.embfile_get("passport-data.json"))
        if embedded != payload:
            problems.append("embedded passport-data.json differs from the certified data")
    except Exception:  # noqa: BLE001
        problems.append("embedded passport-data.json missing")

    if problems:
        raise PdfCheckError(problems)
    return {
        "pages": doc.page_count,
        "cells_checked": len(layout.placed),
        "continuation_pages": len(layout.continuation_pages),
        "continued_records": [e["record_id"] for e in layout.continued],
    }
