"""Subject badge artwork and the "Verified Subject Badges" pages (subject stage 05).

The badges are drawn here in vector form, in the style of BTU's skill stamps: a slightly tilted
rectangle with a dashed inner border, now with the subject's icon on the left and the tier on the
right. Each tier has its own colour (Silver, Gold, Platinum), so every subject has three variants.
The pages reuse the template's skillset page (same 5 x 2 card grid) with their own heading.
"""
from __future__ import annotations

import math

import pymupdf as fitz

from .model import TIER_LABEL, SubjectBadge

WHITE = (1, 1, 1)
GREY = (0.42, 0.42, 0.45)

# tier -> (stamp fill, darker edge)
TIER_COLORS = {
    "SILVER": ((0.56, 0.60, 0.65), (0.40, 0.43, 0.48)),
    "GOLD": ((0.84, 0.60, 0.10), (0.64, 0.43, 0.04)),
    "PLATINUM": ((0.17, 0.27, 0.40), (0.08, 0.14, 0.24)),
}
STAMP_W, STAMP_H = 150.0, 56.0
TILTS = [-6.0, 4.0, -4.0, 6.0, -3.0]          # per card column, like the hand-placed skill stamps
HEADING = "VERIFIED SUBJECT BADGES"
SUBHEADING = "BTU course results, scored out of 100  ·  Silver 60+  ·  Gold 70+  ·  Platinum 90+"
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

def stamp_doc(fonts, logo_key: str, tier: str) -> fitz.Document:
    """One badge as a one-page PDF (STAMP_W x STAMP_H), to be placed tilted with show_pdf_page."""
    fill, edge = TIER_COLORS[tier]
    doc = fitz.open()
    page = doc.new_page(width=STAMP_W, height=STAMP_H)
    sh = page.new_shape()
    sh.draw_rect(fitz.Rect(2, 2, STAMP_W - 2, STAMP_H - 2))
    sh.finish(color=edge, fill=fill, width=1.6)
    sh.draw_rect(fitz.Rect(6, 6, STAMP_W - 6, STAMP_H - 6))
    sh.finish(color=WHITE, width=0.9, dashes="[3 2] 0")
    if tier == "PLATINUM":   # a thin inner rule sets platinum apart beyond its colour
        sh.draw_rect(fitz.Rect(9, 9, STAMP_W - 9, STAMP_H - 9))
        sh.finish(color=(0.75, 0.82, 0.92), width=0.4)
    sh.commit()
    icon = page.new_shape()
    _icon(icon, logo_key, fitz.Rect(13, 13, 43, 43))
    icon.commit()
    page.draw_line(fitz.Point(50, 14), fitz.Point(50, 42), color=WHITE, width=0.6)
    label = TIER_LABEL[tier].upper()
    size = 17.0
    while fonts.width(label, "bold", size) > STAMP_W - 72 and size > 9:
        size -= 0.5
    page.insert_text((57, 31), label, fontname="stampbold", fontfile=str(fonts.files["bold"]), fontsize=size, color=WHITE)
    page.insert_text((57, 42), "SUBJECT BADGE", fontname="stamplight", fontfile=str(fonts.files["light"]), fontsize=7.6,
                     color=WHITE)
    return doc


# ---------------------------------------------------------------- page

def retitle_page(page, d):
    """Replaces the skillset page's heading with this page's own, removing the old text itself."""
    for r in (fitz.Rect(72, 77, 300, 125),):
        page.add_redact_annot(r, fill=(1, 1, 1))
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                          graphics=getattr(fitz, "PDF_REDACT_LINE_ART_NONE", 0))
    d.text(page, 74.1, 101.0, HEADING, "bold", 22.0)
    d.text(page, 76.2, 120.0, SUBHEADING, "bold", 9.5)


def draw_subject_page(d, page, page_idx, h, badges: list[SubjectBadge], grid, page_no: int, page_count: int,
                      layout, placed_cls):
    card_x, card_y, card_w, white_out = grid
    retitle_page(page, d)
    cache: dict = {}
    for i, b in enumerate(badges):
        cx, cy = card_x[i % 5], card_y[i // 5]
        mid = cx + card_w / 2
        white_out(page, fitz.Rect(cx + 50, cy + 60, cx + 81, cy + 92))  # empty-slot asterisk
        key = (b.logo_key, b.tier)
        if key not in cache:
            cache[key] = stamp_doc(d.f, b.logo_key, b.tier)
        w, hgt = 118.0, 118.0 * STAMP_H / STAMP_W
        target = fitz.Rect(mid - w / 2 - 4, cy + 46 - hgt / 2 - 8, mid + w / 2 + 4, cy + 46 + hgt / 2 + 8)
        page.show_pdf_page(target, cache[key], 0, rotate=TILTS[i % 5])

        name = b.name_en.upper()
        fitted = d.fit(name, "bold", [9.5, 9.0, 8.5, 8.0, 7.5, 7.0], card_w - 14, 34, 1.1)
        if fitted:
            size, lines, lh = fitted
        else:  # the full name is in the passport data; the card shows as much as fits
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
        d.text(page, mid, sy + 9, f"{TIER_LABEL[b.tier].upper()}  ·  {b.credits} ECTS", "light", 6.8, GREY, align="center")
    d.text(page, 420, 500, DEMO_NOTE, "light", 5.6, GREY, align="center")
    d.text(page, 761, 511, h.passport_id, "bold", 12, align="right")
    if page_count > 1:
        d.text(page, 767, 112, f"{page_no} / {page_count}", "light", 9, GREY, align="right")
