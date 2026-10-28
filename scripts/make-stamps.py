"""Turn BTU's skill badges (assets/stamps-src) into rubber-stamp impressions for the passport booklet (public/stamps).

Each badge becomes a single-colour rubber stamp in the style of a postmark: the badge's lettering and a double
rim along its outline are inked, and the coloured fill is left as bare paper. Uneven ink (light patches, worn specks,
a slightly heavier rim) is added from a fixed seed, so the output is the same on every run. All three are drawn on
the same canvas at a similar visual weight, so they line up whatever their shape.

A skill with a score also has a badge tier (worker/subjects/scoring.py: Silver 60-70, Gold 70-90, Platinum 90-100),
so every stamp is also made in the three tier inks, <name>-silver|gold|platinum.png; a platinum stamp has a third,
thin rim (between the other two) so the rarest tier stands out beyond its colour. The tier stamps are written twice: for the booklet
(public/stamps) and for the official PDF (worker/pdf/assets/tier-stamps).

    .venv/bin/python scripts/make-stamps.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / "assets" / "stamps-src", ROOT / "public" / "stamps"
PDF_OUT = ROOT / "worker" / "pdf" / "assets" / "tier-stamps"
CANVAS = (360, 280)  # every stamp shares this box (9:7)
# name: (ink colour, fit inside this width x height on the canvas, noise seed)
STAMPS = {
    "ai-skill": ((139, 58, 50), (300, 262), 3),          # faded red-brown ink, triangle
    "ai-applied-skill": ((86, 70, 112), (348, 150), 5),  # faded violet, wide rectangle
    "ai-advanced-skill": ((50, 62, 92), (252, 252), 7),   # faded blue-black, circle
}
TIER_INKS = {
    "silver": (104, 110, 120),   # cool grey
    "gold": (158, 116, 28),      # old gold
    "platinum": (44, 92, 138),   # blue steel
}


def noise(shape, rng, blur):
    img = Image.fromarray((rng.random(shape) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img, dtype=np.float32)
    return (a - a.min()) / max(a.max() - a.min(), 1e-6)


def rim(shape, inset, width):
    """a band `width` px wide, `inset` px inside the shape's outline"""
    m = Image.fromarray((shape * 255).astype(np.uint8))
    outer = m.filter(ImageFilter.MinFilter(2 * inset + 1)) if inset else m
    inner = outer.filter(ImageFilter.MinFilter(2 * width + 1))
    return np.clip((np.asarray(outer, dtype=np.float32) - np.asarray(inner, dtype=np.float32)) / 255, 0, 1)


def stamp(name, ink, fit, seed, out_name=None, extra_rim=False, outs=(OUT,)):
    src = Image.open(SRC / f"{name}.png").convert("RGBA")
    scale = min(fit[0] / src.width, fit[1] / src.height)
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    canvas.paste(src, ((CANVAS[0] - src.width) // 2, (CANVAS[1] - src.height) // 2), src)

    rgba = np.asarray(canvas, dtype=np.float32) / 255
    whiteness = rgba[..., :3].min(axis=2)
    shape = rgba[..., 3] > 0.5
    lettering = rgba[..., 3] * np.clip((whiteness - 0.35) / 0.5, 0, 1)
    coverage = np.maximum(lettering * shape, rim(shape, 0, 7) + rim(shape, 12, 3))
    if extra_rim:
        coverage = np.maximum(coverage, rim(shape, 9, 2))

    rng = np.random.default_rng(seed)
    h, w = coverage.shape
    patches = noise((h, w), rng, 18)  # broad light and dark areas of an unevenly inked pad
    grain = noise((h, w), rng, 1.2)  # paper grain
    specks = noise((h, w), rng, 2.5)  # small worn spots
    ink_level = np.clip(0.5 + 0.75 * patches, 0.35, 1) * np.clip(0.75 + 0.5 * grain, 0, 1)
    ink_level[specks > 0.72] *= 0.12
    # a pressed stamp leaves more ink on its outer edge
    edge = np.asarray(Image.fromarray((coverage * 255).astype(np.uint8)).filter(ImageFilter.FIND_EDGES), dtype=np.float32) / 255
    ink_level = np.clip(ink_level + 0.35 * edge, 0, 1)

    alpha = np.clip(coverage * ink_level * 1.05, 0, 0.92)
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = ink
    out[..., 3] = (alpha * 255).astype(np.uint8)
    for d in outs:
        d.mkdir(parents=True, exist_ok=True)
        Image.fromarray(out).save(d / f"{out_name or name}.png", optimize=True)
        print("wrote", d / f"{out_name or name}.png")


if __name__ == "__main__":
    for name, (ink, fit, seed) in STAMPS.items():
        stamp(name, ink, fit, seed)
        for tier, tier_ink in TIER_INKS.items():
            stamp(name, tier_ink, fit, seed, f"{name}-{tier}", extra_rim=tier == "platinum", outs=(OUT, PDF_OUT))
