"""Turn BTU's skill badges (assets/stamps-src) into rubber-stamp impressions for the passport booklet (public/stamps).

Each badge becomes a single-colour rubber stamp in the style of a postmark: the badge's lettering and a double
rim along its outline are inked, and the coloured fill is left as bare paper. Uneven ink (light patches, worn specks,
a slightly heavier rim) is added from a fixed seed, so the output is the same on every run. All three are drawn on
the same canvas at a similar visual weight, so they line up whatever their shape.

A skill with a score also has a badge tier (worker/subjects/scoring.py: Silver 60-70, Gold 70-90, Platinum 90-100),
so every stamp is also made in the three tier inks (worker/pdf/rubber_stamp.py, shared with the
PDF's subject badges), <name>-silver|gold|platinum.png; a platinum stamp has a third,
thin rim (between the other two) so the rarest tier stands out beyond its colour. The tier stamps are written twice: for the booklet
(public/stamps) and for the official PDF (worker/pdf/assets/tier-stamps).

    .venv/bin/python scripts/make-stamps.py
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from worker.pdf.rubber_stamp import TIER_INKS, ink  # noqa: E402  (shared with the PDF's subject badges)

SRC, OUT = ROOT / "assets" / "stamps-src", ROOT / "public" / "stamps"
PDF_OUT = ROOT / "worker" / "pdf" / "assets" / "tier-stamps"
CANVAS = (360, 280)  # every stamp shares this box (9:7)
# name: (ink colour, fit inside this width x height on the canvas, noise seed)
STAMPS = {
    "ai-skill": ((139, 58, 50), (300, 262), 3),          # faded red-brown ink, triangle
    "ai-applied-skill": ((86, 70, 112), (348, 150), 5),  # faded violet, wide rectangle
    "ai-advanced-skill": ((50, 62, 92), (252, 252), 7),   # faded blue-black, circle
}


def stamp(name, colour, fit, seed, out_name=None, extra_rim=False, outs=(OUT,)):
    src = Image.open(SRC / f"{name}.png").convert("RGBA")
    scale = min(fit[0] / src.width, fit[1] / src.height)
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(src, ((CANVAS[0] - src.width) // 2, (CANVAS[1] - src.height) // 2), src)
    out = ink(canvas, colour, seed, rims=((0, 7), (12, 3)) + (((9, 2),) if extra_rim else ()))
    for d in outs:
        d.mkdir(parents=True, exist_ok=True)
        out.save(d / f"{out_name or name}.png", optimize=True)
        print("wrote", d / f"{out_name or name}.png")


if __name__ == "__main__":
    for name, (colour, fit, seed) in STAMPS.items():
        stamp(name, colour, fit, seed)
        for tier, tier_ink in TIER_INKS.items():
            stamp(name, tier_ink, fit, seed, f"{name}-{tier}", extra_rim=tier == "platinum", outs=(OUT, PDF_OUT))
