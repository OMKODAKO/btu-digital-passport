"""Rubber-stamp inking: turns badge artwork (white lettering on a coloured shape) into a single-colour stamp impression.

The lettering and one or more rims along the shape's outline are inked, the coloured fill is left as bare paper, and
uneven ink (light patches, worn specks, a slightly heavier edge) is added from a fixed seed, so the same artwork and
seed give the same image on every run. Used by scripts/make-stamps.py for BTU's skill stamps and by subject_badges.py
for the subject badges, so both are printed in the same tier inks.
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

# a badge tier's ink, far enough apart to tell at a glance: light neutral grey, warm amber gold, deep indigo
TIER_INKS = {
    "silver": (128, 134, 142),
    "gold": (190, 132, 16),
    "platinum": (36, 58, 120),
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


def ink(canvas: Image.Image, colour, seed, rims=((0, 7), (12, 3))) -> Image.Image:
    """The stamp impression of `canvas` (RGBA artwork) in `colour`; `rims` are (inset, width) bands in px."""
    rgba = np.asarray(canvas.convert("RGBA"), dtype=np.float32) / 255
    whiteness = rgba[..., :3].min(axis=2)
    shape = rgba[..., 3] > 0.5
    lettering = rgba[..., 3] * np.clip((whiteness - 0.35) / 0.5, 0, 1)
    coverage = lettering * shape
    for inset, width in rims:
        coverage = np.maximum(coverage, rim(shape, inset, width))

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
    out[..., :3] = colour
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out)
