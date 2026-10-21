"""Renders a Digital Passport onto BTU's official template (assets/template.pdf = Passport_Blank.pdf).

Pages, in order:
  1  cover: name, surname, first-issue date, Passport ID, version, issue date, verification code
  2  about (static BTU text) + Passport ID
  3+ Verified AI Skillset: one stamp card per skill, 10 per page, page repeated as needed
  .. AI Skill Supplement: one table row per skill, 5 per page, repeated; QR + code on its last page
  .. continuation pages, only when a table cell's text can't fit even at the smallest legible size.
     BTU supplied no design for these, so they reuse the supplement background with a clearly
     labelled temporary layout.

Text is shrunk to fit its cell first; nothing is cut off. When a cell still can't hold its text, the
cell says where the text continues and the full text is printed on a continuation page.

render_passport() returns a Layout recording what was printed where, so check.py can read the
finished PDF back and confirm every piece of text is really there.
"""
from __future__ import annotations

import io
import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf as fitz
import qrcode

from .model import LEARNING_FORMAT, Holder, Skill

ASSETS = Path(__file__).resolve().parent / "assets"  # override with PASSPORT_ASSETS_DIR

BLACK = (0, 0, 0)
GREY = (0.42, 0.42, 0.45)

# Template page indexes
P_COVER, P_ABOUT, P_SKILLSET, P_SUPPLEMENT = 0, 1, 2, 3

# Stamp artwork, clipped from BTU's filled example (card borders removed): category -> clip rect
STAMP_CLIPS = {
    "AI Skill": fitz.Rect(80.0, 154.5, 208.3, 215.0),
    "AI Applied Skill": fitz.Rect(226.5, 160.3, 349.8, 207.0),
    "AI Advanced Skill": fitz.Rect(357.3, 153.2, 489.0, 209.8),
}

# Skillset page grid (5 x 2 cards)
CARD_X = [78.2, 218.0, 357.7, 497.5, 637.2]
CARD_Y = [138.9, 300.0]
CARD_W, CARD_H = 130.7, 151.8
CARDS_PER_PAGE = 10

# Supplement table geometry
COL_X = [82.0, 204.0, 300.0, 445.0, 620.0, 764.0]  # stamp | skill | description | earned through | date
ROW_Y = [188.0, 243.0, 297.0, 351.0, 405.0, 460.0]
ROWS_PER_PAGE = 5

# Continuation pages (temporary layout on the supplement background)
CONT_X0, CONT_X1 = 82.0, 765.0
CONT_Y0, CONT_Y1 = 146.0, 456.0
CONT_LABEL = "TEMPORARY LAYOUT: BTU HAS NOT SUPPLIED A DESIGN FOR CONTINUATION PAGES"

# Smallest sizes used before text is moved to a continuation page (pt)
NAME_SIZES = [9.0, 8.5, 8.0, 7.5, 7.0, 6.5]
DESC_SIZES = [6.3, 6.0, 5.75, 5.5, 5.25, 5.0]
EARNED_SIZES = [7.0, 6.5, 6.0, 5.5]
CARD_NAME_SIZES = [10.5, 10.0, 9.5, 9.0, 8.5, 8.0, 7.5, 7.0]
COVER_MIN_SIZE = 9.0


class RenderError(Exception):
    """The document can't be produced without hiding or clipping information."""


def assets_dir() -> Path:
    return Path(os.environ.get("PASSPORT_ASSETS_DIR", ASSETS))


def _font_files():
    a = assets_dir() / "fonts"
    return {
        "light": a / "Outfit-300.ttf",
        "bold": a / "Outfit-800.ttf",
        "geo-light": a / "NotoSansGeorgian-400.ttf",
        "geo-bold": a / "NotoSansGeorgian-800.ttf",
    }


def _is_georgian(text: str) -> bool:
    return any("Ⴀ" <= ch <= "ჿ" or "Ა" <= ch <= "Ჿ" for ch in text)


def _caps(text: str) -> str:
    # Georgian has no case in the design sense; only uppercase Latin text.
    return text if _is_georgian(text) else text.upper()


def fmt_date(d) -> str:
    return d.strftime("%d.%m.%Y")


def fmt_date_iso(iso: str) -> str:
    return f"{iso[8:10]}.{iso[5:7]}.{iso[0:4]}"


class _Fonts:
    def __init__(self):
        self.files = _font_files()
        missing = [str(p) for p in self.files.values() if not p.exists()]
        if missing:
            raise RenderError(f"font file(s) missing: {', '.join(missing)}")
        self.fonts = {k: fitz.Font(fontfile=str(p)) for k, p in self.files.items()}

    def key(self, s: str, weight: str) -> str:
        return f"geo-{weight}" if _is_georgian(s) else weight

    def width(self, s: str, weight: str, size: float) -> float:
        return self.fonts[self.key(s, weight)].text_length(s, fontsize=size)


@dataclass
class Placed:
    """Text that check.py must find, complete, inside `rect` of page `page`."""
    page: int
    rect: tuple
    text: str
    what: str


@dataclass
class Layout:
    page_count: int = 0
    passport_id: str = ""
    code: str = ""
    cover_texts: list[str] = field(default_factory=list)
    placed: list[Placed] = field(default_factory=list)
    supplement_pages: list[int] = field(default_factory=list)
    continuation_pages: list[int] = field(default_factory=list)
    continued: list[dict] = field(default_factory=list)  # {record_id, texts: [...]}


class _Doc:
    def __init__(self):
        self.f = _Fonts()

    def text(self, page, x, y, s, weight="light", size=10.0, color=BLACK, align="left"):
        key = self.f.key(s, weight)
        if align != "left":
            w = self.f.width(s, weight, size)
            x = x - w if align == "right" else x - w / 2
        page.insert_text((x, y), s, fontname=key.replace("-", ""), fontfile=str(self.f.files[key]),
                         fontsize=size, color=color)

    def wrap(self, s: str, weight: str, size: float, max_w: float) -> list[str]:
        """Word wrap; a single word wider than the line is broken by characters, never clipped."""
        lines, cur = [], ""
        for word in s.split():
            while self.f.width(word, weight, size) > max_w:
                n = len(word)
                while n > 1 and self.f.width(word[:n], weight, size) > max_w:
                    n -= 1
                if cur:
                    lines.append(cur)
                    cur = ""
                lines.append(word[:n])
                word = word[n:]
            trial = f"{cur} {word}".strip()
            if cur and self.f.width(trial, weight, size) > max_w:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        if cur:
            lines.append(cur)
        return lines

    def fit(self, s, weight, sizes, max_w, max_h, lh_factor):
        """Largest size at which `s` fits the box: (size, lines, line_height) or None."""
        for size in sizes:
            lines = self.wrap(s, weight, size, max_w)
            if len(lines) * size * lh_factor <= max_h:
                return size, lines, size * lh_factor
        return None


def qr_png(data: str) -> bytes:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=0)
    qr.add_data(data)
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buf, format="PNG")
    return buf.getvalue()


def place_stamp(page, stamps_doc, category, center_x, center_y, scale=1.0):
    clip = STAMP_CLIPS[category]
    w, h = clip.width * scale, clip.height * scale
    rect = fitz.Rect(center_x - w / 2, center_y - h / 2, center_x + w / 2, center_y + h / 2)
    page.show_pdf_page(rect, stamps_doc, 0, clip=clip)


def white_out(page, rect):
    page.draw_rect(rect, color=None, fill=(1, 1, 1), overlay=True)


# ---------------------------------------------------------------- planning

@dataclass
class _Cell:
    text: str
    weight: str
    rect: fitz.Rect
    fitted: tuple | None  # (size, lines, lh) or None when it overflows


def _plan_rows(d: _Doc, skills: list[Skill]):
    rows = []
    for i, sk in enumerate(skills):
        r = i % ROWS_PER_PAGE
        y0, y1 = ROW_Y[r], ROW_Y[r + 1]
        name_r = fitz.Rect(COL_X[1] + 5, y0 + 3, COL_X[2] - 5, y1 - 3)
        desc_r = fitz.Rect(COL_X[2] + 7, y0 + 3, COL_X[3] - 7, y1 - 3)
        earn_r = fitz.Rect(COL_X[3] + 8, y0 + 3, COL_X[4] - 8, y1 - 12)  # last 9pt: badge line
        earned = _caps(sk.earned_through or LEARNING_FORMAT[sk.category])
        cells = {
            "name": _Cell(_caps(sk.name), "bold", name_r,
                          d.fit(_caps(sk.name), "bold", NAME_SIZES, name_r.width, name_r.height, 1.12)),
            "description": _Cell(_caps(sk.description), "light", desc_r,
                                 d.fit(_caps(sk.description), "light", DESC_SIZES, desc_r.width, desc_r.height, 1.18)),
            "earned_through": _Cell(earned, "light", earn_r,
                                    d.fit(earned, "light", EARNED_SIZES, earn_r.width, earn_r.height, 1.2)),
        }
        rows.append((sk, cells))
    return rows


def _plan_continuation(d: _Doc, overflowing: list[tuple[Skill, list[str]]]):
    """Lines for the continuation pages: [[(text, weight, size, color, line_height, record_id)]] per page."""
    width = CONT_X1 - CONT_X0
    items = []
    for sk, fields in overflowing:
        entry = [(ln, "bold", 9.0, BLACK, 11.0) for ln in d.wrap(_caps(sk.name), "bold", 9.0, width)]
        meta = f"{_caps(sk.category)}  ·  BADGE {sk.badge_code}  ·  {sk.record_id}  ·  EARNED {fmt_date(sk.date_earned)}"
        entry += [(ln, "light", 6.8, GREY, 9.5) for ln in d.wrap(meta, "light", 6.8, width)]
        if "description" in fields:
            entry += [(ln, "light", 7.6, BLACK, 9.6) for ln in d.wrap(sk.description, "light", 7.6, width)]
        if "earned_through" in fields:
            text = f"Earned through: {sk.earned_through or LEARNING_FORMAT[sk.category]}"
            entry += [(ln, "light", 7.6, BLACK, 9.6) for ln in d.wrap(text, "light", 7.6, width)]
        items.append((sk.record_id, entry))

    pages, cur, y = [], [], CONT_Y0
    starts = {}
    for rid, entry in items:
        # keep an entry's heading with its first lines when the page is nearly full
        if cur and y + sum(x[4] for x in entry[:3]) > CONT_Y1:
            pages.append(cur)
            cur, y = [], CONT_Y0
        starts[rid] = len(pages)
        for ln in entry:
            if y + ln[4] > CONT_Y1:
                pages.append(cur)
                cur, y = [], CONT_Y0
            cur.append((*ln, rid))
            y += ln[4]
        y += 8.0
    if cur:
        pages.append(cur)
    return pages, starts


# ---------------------------------------------------------------- drawing

def _draw_cell(d: _Doc, page, cell: _Cell, color=BLACK):
    size, lines, lh = cell.fitted
    mid = (cell.rect.x0 + cell.rect.x1) / 2
    y = (cell.rect.y0 + cell.rect.y1) / 2 - len(lines) * lh / 2 + size * 0.78
    for ln in lines:
        d.text(page, mid, y, ln, cell.weight, size, color, align="center")
        y += lh


def _draw_overflow_cell(d: _Doc, page, cell: _Cell, page_no: int, sizes):
    """Start of the text, then where it continues. Nothing printed here is cut mid-character."""
    size = sizes[-1]
    lh = size * 1.18
    note = f"(CONTINUED ON PAGE {page_no})"
    room = max(1, int(cell.rect.height // lh) - 1)
    lines = d.wrap(cell.text, cell.weight, size, cell.rect.width)[:room]
    lines[-1] = lines[-1] + " …"
    if d.f.width(lines[-1], cell.weight, size) > cell.rect.width:
        lines[-1] = lines[-1][:-2].rsplit(" ", 1)[0] + " …"
    _draw_cell(d, page, _Cell("", cell.weight, cell.rect, (size, lines + [note], lh)))


def draw_cover(d: _Doc, page, h: Holder, version: int, issued_at: str, code: str, layout: Layout):
    for s, x, y, max_w in ((_caps(h.first_name), 200, 272, 375), (_caps(h.last_name), 246, 313, 178)):
        size = 26.0
        while size > COVER_MIN_SIZE and d.f.width(s, "light", size) > max_w:
            size -= 0.5
        if d.f.width(s, "light", size) > max_w:
            raise RenderError(f"name '{s}' is too long for the cover even at {COVER_MIN_SIZE}pt")
        d.text(page, x, y, s, "light", size)
        layout.cover_texts.append(s)
    d.text(page, 648, 266, fmt_date(h.first_issued), "light", 15)
    d.text(page, 761, 511, h.passport_id, "bold", 12, align="right")
    d.text(page, 108, 504, f"VERSION V{version}  ·  ISSUED {fmt_date_iso(issued_at)}", "light", 7.5)
    d.text(page, 108, 516, f"VERIFICATION CODE  {code}", "bold", 7.5)
    layout.cover_texts += [fmt_date(h.first_issued), h.passport_id, code, f"VERSION V{version}"]


def draw_skillset(d: _Doc, page, stamps, h: Holder, skills: list[Skill], page_no: int, page_count: int):
    if not h.skills:
        white_out(page, fitz.Rect(CARD_X[0] - 2, CARD_Y[0] - 2, CARD_X[-1] + CARD_W + 2, CARD_Y[1] + CARD_H + 2))
        d.text(page, 421, 300, "NO CONFIRMED AI SKILLS RECORDED YET", "bold", 13, GREY, align="center")
    for i, sk in enumerate(skills):
        cx, cy = CARD_X[i % 5], CARD_Y[i // 5]
        mid = cx + CARD_W / 2
        white_out(page, fitz.Rect(cx + 50, cy + 60, cx + 81, cy + 92))  # empty-slot asterisk
        place_stamp(page, stamps, sk.category, mid, cy + 46)

        # The card is a summary: the name shrinks to fit 4 lines; the supplement row holds the full text.
        fitted = d.fit(_caps(sk.name), "bold", CARD_NAME_SIZES, CARD_W - 14, 46, 1.1)
        if fitted:
            size, lines, lh = fitted
        else:
            size, lh = CARD_NAME_SIZES[-1], CARD_NAME_SIZES[-1] * 1.1
            lines = d.wrap(_caps(sk.name), "bold", size, CARD_W - 14)[:4]
            lines[-1] = lines[-1].rsplit(" ", 1)[0] + " …"
        block_h = len(lines) * lh + 22
        y = cy + 118 - block_h / 2 + size * 0.85
        for ln in lines:
            d.text(page, mid, y, ln, "bold", size, align="center")
            y += lh
        d.text(page, mid, y + 1, _caps(sk.category), "light", 10, align="center")
        d.text(page, mid, y + 12, f"EARNED {fmt_date(sk.date_earned)}", "light", 7, GREY, align="center")
    d.text(page, 761, 511, h.passport_id, "bold", 12, align="right")
    if page_count > 1:
        d.text(page, 767, 112, f"{page_no} / {page_count}", "light", 9, GREY, align="right")


def draw_supplement(d: _Doc, page, page_idx, stamps, h: Holder, rows, page_no, page_count, cont_page_of,
                    version, issued_at, code, verify_url, layout: Layout):
    if not h.skills:
        white_out(page, fitz.Rect(COL_X[0] - 12, ROW_Y[0] + 1, COL_X[5] + 5, ROW_Y[1] - 1))
        for r in range(1, ROWS_PER_PAGE):
            ym = (ROW_Y[r] + ROW_Y[r + 1]) / 2
            white_out(page, fitz.Rect(124, ym - 14, 158, ym + 14))  # empty-row circle
        d.text(page, 421, (ROW_Y[0] + ROW_Y[1]) / 2 + 3, "NO CONFIRMED AI SKILLS RECORDED YET", "bold", 10, GREY,
               align="center")
    for i, (sk, cells) in enumerate(rows):
        y0, y1 = ROW_Y[i], ROW_Y[i + 1]
        ym = (y0 + y1) / 2
        white_out(page, fitz.Rect(129, ym - 12, 153, ym + 12))  # empty-row circle
        place_stamp(page, stamps, sk.category, (COL_X[0] + COL_X[1]) / 2, ym, scale=0.66)
        for key, sizes in (("name", NAME_SIZES), ("description", DESC_SIZES), ("earned_through", EARNED_SIZES)):
            cell = cells[key]
            if cell.fitted:
                _draw_cell(d, page, cell)
                layout.placed.append(Placed(page_idx, tuple(cell.rect), cell.text, f"{sk.record_id} {key}"))
            else:
                _draw_overflow_cell(d, page, cell, cont_page_of[sk.record_id] + 1, sizes)
        badge = f"BADGE {sk.badge_code}  ·  {sk.record_id}"
        d.text(page, (COL_X[3] + COL_X[4]) / 2, y1 - 6, badge, "light", 5.8, GREY, align="center")
        layout.placed.append(Placed(page_idx, (COL_X[3] + 4, y1 - 12, COL_X[4] - 4, y1 - 2), badge, f"{sk.record_id} badge"))
        date_r = fitz.Rect(COL_X[4] + 4, y0 + 3, COL_X[5] - 4, y1 - 3)
        _draw_cell(d, page, _Cell(fmt_date(sk.date_earned), "light", date_r, (10, [fmt_date(sk.date_earned)], 10)))
        layout.placed.append(Placed(page_idx, tuple(date_r), fmt_date(sk.date_earned), f"{sk.record_id} date"))

    d.text(page, 154, 492.5, h.passport_id, "bold", 12)
    if page_count > 1:
        d.text(page, 767, 112, f"{page_no} / {page_count}", "light", 9, GREY, align="right")
    if page_no == page_count:
        page.insert_image(fitz.Rect(282, 465, 326, 509), stream=qr_png(verify_url))
        d.text(page, 334, 473, "SCAN OR ENTER THE CODE TO VERIFY", "light", 6.2, GREY)
        d.text(page, 334, 486, code, "bold", 10.5)
        d.text(page, 334, 497, f"VERSION V{version}  ·  ISSUED {fmt_date_iso(issued_at)}", "light", 6.8)
        d.text(page, 334, 507, verify_url.split("://", 1)[-1], "light", 5.8, GREY)


def draw_continuation(d: _Doc, page, h: Holder, lines, page_no: int, page_count: int):
    white_out(page, fitz.Rect(64, 107, 784, 468))
    d.text(page, 76, 120, "Continued: full text of table entries that do not fit in their cells", "bold", 10.5)
    d.text(page, 76, 133, CONT_LABEL, "light", 6.3, GREY)
    y = CONT_Y0
    for text, weight, size, color, lh, _rid in lines:
        d.text(page, CONT_X0, y + size * 0.8, text, weight, size, color)
        y += lh
    d.text(page, 154, 492.5, h.passport_id, "bold", 12)
    if page_count > 1:
        d.text(page, 767, 112, f"{page_no} / {page_count}", "light", 9, GREY, align="right")


# ---------------------------------------------------------------- document

def render_passport(holder: Holder, version: int, issued_at: str, code: str, verify_url: str,
                    payload: dict, out_path: Path) -> Layout:
    a = assets_dir()
    if not (a / "template.pdf").exists() or not (a / "stamps.pdf").exists():
        raise RenderError(f"BTU template or stamp artwork missing in {a}")
    d = _Doc()
    template = fitz.open(a / "template.pdf")
    stamps = fitz.open(a / "stamps.pdf")
    for sk in holder.skills:
        if sk.category not in STAMP_CLIPS:
            raise RenderError(f"{sk.record_id}: no stamp artwork for category '{sk.category}'")

    rows = _plan_rows(d, holder.skills)
    overflowing = [(sk, [k for k, c in cells.items() if not c.fitted]) for sk, cells in rows
                   if any(not c.fitted for c in cells.values())]
    cont_pages, cont_start = _plan_continuation(d, overflowing)

    skill_pages = max(1, math.ceil(len(holder.skills) / CARDS_PER_PAGE))
    supp_pages = max(1, math.ceil(len(holder.skills) / ROWS_PER_PAGE))
    first_cont = 2 + skill_pages + supp_pages
    cont_page_of = {rid: first_cont + n for rid, n in cont_start.items()}

    doc = fitz.open()
    doc.insert_pdf(template, from_page=P_COVER, to_page=P_ABOUT)
    for _ in range(skill_pages):
        doc.insert_pdf(template, from_page=P_SKILLSET, to_page=P_SKILLSET)
    for _ in range(supp_pages + len(cont_pages)):
        doc.insert_pdf(template, from_page=P_SUPPLEMENT, to_page=P_SUPPLEMENT)

    layout = Layout(passport_id=holder.passport_id, code=code)
    draw_cover(d, doc[0], holder, version, issued_at, code, layout)
    d.text(doc[1], 154, 492.5, holder.passport_id, "bold", 12)
    for n in range(skill_pages):
        chunk = holder.skills[n * CARDS_PER_PAGE:(n + 1) * CARDS_PER_PAGE]
        draw_skillset(d, doc[2 + n], stamps, holder, chunk, n + 1, skill_pages)
    for n in range(supp_pages):
        idx = 2 + skill_pages + n
        draw_supplement(d, doc[idx], idx, stamps, holder, rows[n * ROWS_PER_PAGE:(n + 1) * ROWS_PER_PAGE], n + 1,
                        supp_pages, cont_page_of, version, issued_at, code, verify_url, layout)
        layout.supplement_pages.append(idx)
    for n, lines in enumerate(cont_pages):
        idx = first_cont + n
        draw_continuation(d, doc[idx], holder, lines, n + 1, len(cont_pages))
        layout.continuation_pages.append(idx)
    for sk, fields in overflowing:
        texts = [_caps(sk.name)]
        if "description" in fields:
            texts.append(sk.description)
        if "earned_through" in fields:
            texts.append(sk.earned_through or LEARNING_FORMAT[sk.category])
        layout.continued.append({"record_id": sk.record_id, "fields": fields, "texts": texts})
    layout.page_count = doc.page_count

    ts = issued_at.replace("-", "").replace(":", "").replace("T", "").rstrip("Z")
    doc.set_metadata({
        "title": f"BTU AI Skills Digital Passport - {holder.first_name} {holder.last_name}",
        "author": "Business and Technology University (BTU)",
        "subject": f"Passport {holder.passport_id} version V{version}",
        "keywords": f"passport_id={holder.passport_id}; version=V{version}; verification_code={code}",
        "creator": "BTU Digital Passport Generator",
        "producer": "BTU Digital Passport Generator",
        "creationDate": f"D:{ts}Z",
        "modDate": f"D:{ts}Z",
    })
    # Machine-readable copy of exactly what this version certifies, for the verifier.
    doc.embfile_add("passport-data.json", json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8"),
                    filename="passport-data.json", desc="Certified passport data")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path, garbage=3, deflate=True)
    return layout
