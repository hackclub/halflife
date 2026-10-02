#!/usr/bin/env python3
"""
Bake the platform's muted doodle background into a seamless tile.

Source drawings live in `background assets/` (7 hand-drawn PNGs, each a single
black drawing on a 2000x2000 transparent canvas). This script crops each to its
drawing, recolours the linework to the platform ink (navy), and scatters many
small copies of them across a tile with Poisson-disc spacing tuned to each
drawing's own rotated size — so the result is dense and natural, with no dust
settling in a visible grid and nothing colliding through its neighbour. Edges
wrap (each drawing is stamped on all nine tiled positions) so the sheet repeats
seamlessly, and no two of the same drawing are ever placed within SAME_MAX of
each other.

Output: `public/platform/doodle-sheet.png` (1024x1024, indexed palette),
referenced by `.shell-backdrop::before` in `src/app/(platform)/globals.css`.

Run from the repository root:

    python3 scripts/make-doodle-sheet.py

Requires Pillow. Tuning knobs live at the top of this file: N_SYMBOLS, the
size range in `targets`, the radius factor, SAME_MAX, and SEED.
"""

import glob
import math
import os
import random

from PIL import Image

SRC = glob.glob("background assets/*.png")
OUT = "public/platform/doodle-sheet.png"
NAVY = (28, 26, 89)  # --color-navy
TILE = 768  # tile edge, power of two for clean scaling
N_SYMBOLS = 64
SAME_MAX = 120  # two of the same drawing keep this toroidal distance (px)
SEED = 20261003
random.seed(SEED)


def tor_dist(a, b):
    """Toroidal distance on the tile, so placement wraps cleanly at the seam."""
    dx = abs(a[0] - b[0])
    dy = abs(a[1] - b[1])
    return math.hypot(min(dx, TILE - dx), min(dy, TILE - dy))


def load_symbol(path):
    im = Image.open(path).convert("RGBA")
    alpha = im.split()[3]
    # Trim the transparent margin tight: the drawings sit in 2000x2000 canvases
    # with a lot of empty border, and a faint alias halo can inflate the edge a
    # few pixels further. Cut to the pixels that actually carry ink.
    mask = alpha.point(lambda a: 255 if a >= 16 else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise RuntimeError(f"empty symbol: {path}")
    im = im.crop(bbox)
    # Recolour the black linework to the ink colour, keeping the alpha.
    alpha = im.split()[3]
    ink = Image.new("RGBA", im.size, (*NAVY, 0))
    ink.putalpha(alpha)
    return ink


def main():
    symbols = [load_symbol(p) for p in sorted(SRC)]
    print(f"{len(symbols)} symbols loaded")

    # Random target size and rotation for each marker up front, so spacing can
    # be tuned to the drawing that will actually sit there.
    targets = [random.uniform(45, 85) for _ in range(N_SYMBOLS)]
    angles = [random.uniform(-180, 180) for _ in range(N_SYMBOLS)]
    # A circle roughly covering the rotated bounding box; the 0.8 factor allows
    # a thin near-touch without letting icons grind through each other.
    radii = [0.5 * t * math.sqrt(2) * 0.8 for t in targets]

    # Poisson-disc placement; each candidate must clear its own and the placed
    # marker's radius. If the tile cannot be filled, the clearance relaxes.
    points = []
    factor = 1.0
    attempts = 0
    while len(points) < N_SYMBOLS and factor >= 0.45:
        attempts += 1
        if attempts > 300_000:
            factor *= 0.92
            attempts = 0
        p = (random.uniform(0, TILE), random.uniform(0, TILE))
        mine = radii[len(points)] * factor
        if all(tor_dist(p, q) >= mine + r for q, r in zip(points, radii)):
            points.append(p)
    print(f"placed {len(points)} points (clearance factor {factor:.2f})")

    # Choose a drawing per point, never one that already sits within SAME_MAX.
    assigned = []
    for p in points:
        used = {s for (q, s) in zip(points, assigned) if tor_dist(p, q) < SAME_MAX}
        options = [i for i in range(len(symbols)) if i not in used]
        assigned.append(random.choice(options) if options else random.randrange(len(symbols)))

    # Separation rule, checked outright: same drawings keep apart on the torus.
    for i in range(len(points)):
        for j in range(i + 1, len(points)):
            if assigned[i] == assigned[j] and tor_dist(points[i], points[j]) < SAME_MAX:
                raise RuntimeError(f"same symbol too close at {i},{j}")
    print("same-symbol separation OK")

    # Draw onto a 3x3 tiling, then crop the centre tile so seams wrap cleanly.
    canvas = Image.new("RGBA", (TILE * 3, TILE * 3), (0, 0, 0, 0))
    for (cx, cy), idx, target, angle in zip(points, assigned, targets, angles):
        sym = symbols[idx]
        scale = target / max(sym.size)
        size = (max(1, round(sym.width * scale)), max(1, round(sym.height * scale)))
        sym = sym.resize(size, Image.LANCZOS)
        # Full-circle rotation: drawings land at every angle.
        sym = sym.rotate(angle, resample=Image.BICUBIC, expand=True)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                px = round(cx + i * TILE - sym.width / 2 + TILE)
                py = round(cy + j * TILE - sym.height / 2 + TILE)
                canvas.alpha_composite(sym, (px, py))

    tile = canvas.crop((TILE, TILE, TILE * 2, TILE * 2))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # Indexed palette keeps the RGBA look at a fraction of the bytes.
    tile.convert("P", palette=Image.ADAPTIVE, colors=256).save(OUT, optimize=True)

    data = tile.getdata()
    n = len(data)
    ink_px = sum(1 for p in data if p[3] > 0)
    print(f"wrote {OUT}  {tile.size}  ink coverage {100 * ink_px / n:.2f}%")


if __name__ == "__main__":
    main()