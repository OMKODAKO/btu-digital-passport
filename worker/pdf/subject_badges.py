"""Subject badge artwork and how subject badges are placed on the passport (subject stage 05).

The badge is drawn here in vector form (a rectangle with a dashed inner border, the subject's icon on the left and
the tier on the right) and then inked like BTU's skill stamps (rubber_stamp.py): a single-colour rubber-stamp
impression in the tier's ink (Silver, Gold, Platinum), placed slightly tilted. Its tier and subtitle stay in the
PDF as invisible text, so the page can still be searched and copied.
render.py prints them after the sheet skills: a card on the Verified AI Skillset page and a row in the
AI Skill Supplement table, like a skill.
"""
from __future__ import annotations

import io
import math
import zlib

import pymupdf as fitz
from PIL import Image

from .model import TIER_LABEL, SubjectBadge
from .rubber_stamp import TIER_INKS, ink

WHITE = (1, 1, 1)
GREY = (0.42, 0.42, 0.45)

ARTWORK_FILL = (0.25, 0.25, 0.25)   # any dark fill: it is left as bare paper when inked
STAMP_W, STAMP_H = 150.0, 56.0
STAMP_ZOOM = 4                       # artwork pixels per point when inked
TILTS = [-6.0, 4.0, -4.0, 6.0, -3.0]          # per card column, like the hand-placed skill stamps
DEMO_NOTE = "DEMO: SIMULATED SYLLABI AND HAND-ENTERED MARKS (BTU GRADES NOT CONNECTED)"


# ---------------------------------------------------------------- icons (white line art in a square)

def _icon(shape: fitz.Shape, key: str, r: fitz.Rect):
    x0, y0, s = r.x0, r.y0, r.width
    P = lambda fx, fy: fitz.Point(x0 + fx * s, y0 + fy * s)  # noqa: E731

    def line(*pts):
        for a, b in zip(pts, pts[1:]):
            shape.draw_line(P(*a), P(*b))

    def dot(fx, fy, fr):
        shape.draw_circle(P(fx, fy), fr * s)

    if key == "agent":                                   # robot head
        shape.draw_rect(fitz.Rect(P(0.18, 0.32), P(0.82, 0.84)))
        dot(0.38, 0.55, 0.06); dot(0.62, 0.55, 0.06)
        line((0.38, 0.72), (0.62, 0.72)); line((0.5, 0.32), (0.5, 0.16)); dot(0.5, 0.12, 0.04)
    elif key == "neural":                                # 3-layer network
        a = [(0.15, 0.3), (0.15, 0.7)]; b = [(0.5, 0.18), (0.5, 0.5), (0.5, 0.82)]; c = [(0.85, 0.5)]
        for p in a:
            for q in b:
                line(p, q)
        for p in b:
            line(p, c[0])
        for p in a + b + c:
            dot(*p, 0.07)
    elif key == "spark":                                 # four-point star
        shape.draw_polyline([P(0.5, 0.05), P(0.6, 0.4), P(0.95, 0.5), P(0.6, 0.6), P(0.5, 0.95), P(0.4, 0.6),
                             P(0.05, 0.5), P(0.4, 0.4), P(0.5, 0.05)])
    elif key == "layers":                                # stacked sheets
        for dy in (0.0, 0.22, 0.44):
            shape.draw_polyline([P(0.5, 0.12 + dy), P(0.92, 0.3 + dy), P(0.5, 0.48 + dy), P(0.08, 0.3 + dy), P(0.5, 0.12 + dy)])
    elif key == "code":                                  # </>
        line((0.32, 0.25), (0.1, 0.5), (0.32, 0.75)); line((0.68, 0.25), (0.9, 0.5), (0.68, 0.75)); line((0.58, 0.18), (0.42, 0.82))
    elif key == "brackets":                              # { }
        for sx in (1, -1):
            cx = 0.5 - sx * 0.3
            line((cx + sx * 0.12, 0.15), (cx + sx * 0.04, 0.2), (cx + sx * 0.04, 0.42), (cx - sx * 0.06, 0.5),
                 (cx + sx * 0.04, 0.58), (cx + sx * 0.04, 0.8), (cx + sx * 0.12, 0.85))
        dot(0.5, 0.5, 0.05)
    elif key == "tree":                                  # binary tree
        line((0.5, 0.2), (0.25, 0.55)); line((0.5, 0.2), (0.75, 0.55)); line((0.25, 0.55), (0.12, 0.85)); line((0.25, 0.55), (0.38, 0.85))
        for p in [(0.5, 0.2), (0.25, 0.55), (0.75, 0.55), (0.12, 0.85), (0.38, 0.85)]:
            dot(*p, 0.075)
    elif key == "database":                              # cylinder
        shape.draw_oval(fitz.Rect(P(0.18, 0.1), P(0.82, 0.3)))
        line((0.18, 0.2), (0.18, 0.8)); line((0.82, 0.2), (0.82, 0.8))
        for y in (0.5, 0.8):
            shape.draw_bezier(P(0.18, y), P(0.18, y + 0.13), P(0.82, y + 0.13), P(0.82, y))
    elif key == "distribution":                          # bell curve over an axis
        pts = [P(0.05 + 0.9 * i / 24, 0.85 - 0.62 * math.exp(-((i - 12) / 5.0) ** 2)) for i in range(25)]
        shape.draw_polyline(pts); line((0.05, 0.88), (0.95, 0.88)); line((0.5, 0.2), (0.5, 0.88))
    elif key == "matrix":                                # [ : : : ]
        line((0.2, 0.12), (0.1, 0.12), (0.1, 0.88), (0.2, 0.88)); line((0.8, 0.12), (0.9, 0.12), (0.9, 0.88), (0.8, 0.88))
        for i in range(3):
            for j in range(3):
                dot(0.3 + 0.2 * i, 0.28 + 0.22 * j, 0.045)
    elif key == "chart":                                 # bar chart
        line((0.08, 0.88), (0.92, 0.88))
        for x, h in ((0.15, 0.3), (0.38, 0.55), (0.61, 0.42), (0.84, 0.72)):
            shape.draw_rect(fitz.Rect(P(x - 0.07, 0.88 - h), P(x + 0.07, 0.88)))
    elif key == "shield":                                # shield with a tick
        shape.draw_polyline([P(0.5, 0.08), P(0.88, 0.22), P(0.82, 0.6), P(0.5, 0.92), P(0.18, 0.6), P(0.12, 0.22), P(0.5, 0.08)])
        line((0.32, 0.5), (0.46, 0.64), (0.7, 0.36))
    elif key == "chip":                                  # chip with pins
        shape.draw_rect(fitz.Rect(P(0.25, 0.25), P(0.75, 0.75)))
        shape.draw_rect(fitz.Rect(P(0.4, 0.4), P(0.6, 0.6)))
        for t in (0.35, 0.5, 0.65):
            line((t, 0.25), (t, 0.1)); line((t, 0.75), (t, 0.9)); line((0.25, t), (0.1, t)); line((0.75, t), (0.9, t))
    else:                                                # unknown subject: a book
        shape.draw_rect(fitz.Rect(P(0.15, 0.15), P(0.85, 0.85))); line((0.5, 0.15), (0.5, 0.85))
    shape.finish(color=WHITE, width=max(1.1, s * 0.055), fill=None, closePath=False, lineCap=1, lineJoin=1)


SUBJECT_ICONS = ("agent", "neural", "spark", "layers", "code", "brackets", "tree", "database", "distribution",
                 "matrix", "chart", "shield", "chip")


# ---------------------------------------------------------------- stamp

def _label_sizes(fonts, label: str, subtitle: str) -> tuple[float, float]:
    size = 17.0
    while fonts.width(label, "bold", size) > STAMP_W - 72 and size > 9:
        size -= 0.5
    sub = 7.6
    while fonts.width(subtitle, "light", sub) > STAMP_W - 66 and sub > 5:
        sub -= 0.2
    return size, sub


def _artwork(fonts, logo_key: str, tier: str, subtitle: str) -> fitz.Document:
    """The badge as white line art and lettering on a dark rectangle, the input of the inking."""
    doc = fitz.open()
    page = doc.new_page(width=STAMP_W, height=STAMP_H)
    sh = page.new_shape()
    sh.draw_rect(fitz.Rect(2, 2, STAMP_W - 2, STAMP_H - 2))
    sh.finish(color=None, fill=ARTWORK_FILL)
    sh.draw_rect(fitz.Rect(7, 7, STAMP_W - 7, STAMP_H - 7))
    sh.finish(color=WHITE, width=1.0, dashes="[3 2] 0")
    if tier == "PLATINUM":   # a third, thin rule sets platinum apart beyond its colour, as on the skill stamps
        sh.draw_rect(fitz.Rect(10, 10, STAMP_W - 10, STAMP_H - 10))
        sh.finish(color=WHITE, width=0.6)
    sh.commit()
    icon = page.new_shape()
    _icon(icon, logo_key, fitz.Rect(14, 13, 44, 43))
    icon.commit()
    page.draw_line(fitz.Point(51, 15), fitz.Point(51, 41), color=WHITE, width=0.8)
    label = TIER_LABEL[tier].upper()
    size, sub = _label_sizes(fonts, label, subtitle)
    page.insert_text((57, 31), label, fontname="stampbold", fontfile=str(fonts.files["bold"]), fontsize=size, color=WHITE)
    page.insert_text((57, 42), subtitle, fontname="stamplight", fontfile=str(fonts.files["light"]), fontsize=sub,
                     color=WHITE)
    return doc


def stamp_doc(fonts, logo_key: str, tier: str, subtitle: str = "SUBJECT BADGE") -> fitz.Document:
    """One badge as a one-page PDF (STAMP_W x STAMP_H), a rubber stamp in its tier's ink, to be placed tilted with
    show_pdf_page. A skill from the skill sheet shows its category (e.g. AI APPLIED SKILL) where a BTU course says
    SUBJECT BADGE. The ink's wear is seeded by the badge, so a passport renders the same every time."""
    pix = _artwork(fonts, logo_key, tier, subtitle)[0].get_pixmap(matrix=fitz.Matrix(STAMP_ZOOM, STAMP_ZOOM), alpha=True)
    art = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)
    seed = zlib.crc32(f"{logo_key}:{tier}:{subtitle}".encode())
    png = io.BytesIO()
    ink(art, TIER_INKS[tier.lower()], seed, rims=((0, 2 * STAMP_ZOOM),)).save(png, "PNG", optimize=True)

    doc = fitz.open()
    page = doc.new_page(width=STAMP_W, height=STAMP_H)
    page.insert_image(page.rect, stream=png.getvalue())
    label = TIER_LABEL[tier].upper()
    size, sub = _label_sizes(fonts, label, subtitle)
    for at, text, font, fs in (((57, 31), label, "bold", size), ((57, 42), subtitle, "light", sub)):
        page.insert_text(at, text, fontname=f"stamp{font}", fontfile=str(fonts.files[font]), fontsize=fs, render_mode=3)
    return doc


# ---------------------------------------------------------------- placing

class StampCache(dict):
    """(logo_key, tier, subtitle) -> stamp document, made once per rendered passport."""

    def get_stamp(self, fonts, b: SubjectBadge) -> fitz.Document:
        subtitle = b.category.upper() if b.category else "SUBJECT BADGE"
        key = (b.logo_key, b.tier, subtitle)
        if key not in self:
            self[key] = stamp_doc(fonts, b.logo_key, b.tier, subtitle)
        return self[key]


def place_subject_stamp(page, fonts, cache: StampCache, b: SubjectBadge, center_x, center_y, width, tilt):
    h = width * STAMP_H / STAMP_W
    pad = width * 0.07   # room for the tilt
    target = fitz.Rect(center_x - width / 2 - pad, center_y - h / 2 - 2 * pad,
                       center_x + width / 2 + pad, center_y + h / 2 + 2 * pad)
    page.show_pdf_page(target, cache.get_stamp(fonts, b), 0, rotate=tilt)


def draw_subject_card(d, page, page_idx, b: SubjectBadge, slot: int, cx, cy, card_w, cache: StampCache, layout,
                      placed_cls):
    """One skillset-page card for a subject badge: stamp, course name, score, tier and ECTS."""
    mid = cx + card_w / 2
    place_subject_stamp(page, d.f, cache, b, mid, cy + 46, 106.0, TILTS[slot % 5])
    name = b.name_en.upper()
    fitted = d.fit(name, "bold", [9.5, 9.0, 8.5, 8.0, 7.5, 7.0], card_w - 14, 34, 1.1)
    if fitted:
        size, lines, lh = fitted
    else:  # the full name is in the supplement table and the passport data
        size, lh = 7.0, 7.7
        lines = d.wrap(name, "bold", size, card_w - 14)[:4]
        lines[-1] = lines[-1].rsplit(" ", 1)[0] + " …"
    y = cy + 84 + size * 0.85
    for ln in lines:
        d.text(page, mid, y, ln, "bold", size, align="center")
        y += lh
    score = f"SCORE {b.score} / 100"
    sy = cy + 131
    d.text(page, mid, sy, score, "light", 9.0, align="center")
    layout.placed.append(placed_cls(page_idx, (cx + 4, sy - 9, cx + card_w - 4, sy + 2.5), score, f"{b.code} score"))
    detail = (f"{TIER_LABEL[b.tier].upper()}  ·  {b.category.upper()}  ·  {b.badge_code}" if b.category
              else f"{TIER_LABEL[b.tier].upper()} SUBJECT BADGE  ·  {b.credits} ECTS")
    d.text(page, mid, sy + 9, detail, "light", 6.4 if not b.category else 5.6, GREY, align="center")


def draw_demo_note(d, page):
    d.text(page, 420, 500, DEMO_NOTE, "light", 5.6, GREY, align="center")
