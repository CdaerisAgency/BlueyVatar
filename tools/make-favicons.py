#!/usr/bin/env python3
"""Generate the circle-masked favicon set from apps/web/public/logo.jpg.

Run from the repo root: python3 -I tools/make-favicons.py

Outputs (Next.js app router file conventions):
  apps/web/app/favicon.ico      multi-size ICO
  apps/web/app/icon.png         PNG icon
  apps/web/app/apple-icon.png   larger PNG for Apple touch icons

Every size is a fraction of the source side, so nothing is stretched and no
dimension is hardcoded. The source must be square. Corners are transparent.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "apps/web/public/logo.jpg"
APP = ROOT / "apps/web/app"
SS = 4  # supersampling factor for a smooth circle edge


def circle(img: Image.Image, side: int) -> Image.Image:
    big = side * SS
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    mask = mask.resize((side, side), Image.LANCZOS)
    out = img.convert("RGBA").resize((side, side), Image.LANCZOS)
    out.putalpha(mask)
    return out


def main() -> None:
    src = Image.open(SRC)
    w, h = src.size
    if w != h:
        raise SystemExit(f"logo must be square, got {w}x{h}")
    s = w
    circle(src, s).save(APP / "apple-icon.png", optimize=True)
    circle(src, s // 2).save(APP / "icon.png", optimize=True)
    sizes = [s // 16, s // 8, s // 4]
    base = circle(src, s // 4)
    base.save(APP / "favicon.ico", format="ICO", sizes=[(n, n) for n in sizes])
    print("source", (w, h), "ico frames", sizes, "icon", s // 2, "apple", s)


if __name__ == "__main__":
    main()
