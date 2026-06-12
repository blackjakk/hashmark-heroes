#!/usr/bin/env python3
"""Slice an AI-generated sprite SHEET into the game's per-frame layout.

For art generated as a grid (ChatGPT/DALL-E, Midjourney, etc.) instead of
PixelLab's per-frame ZIPs. Writes sprites/<pose>/<direction>_<idx>.png,
104x104 RGBA, nearest-neighbor scaled — exactly what play-sprites.js loads.

Usage:
    python3 sprites/_slice_sheet.py SHEET.png POSE [options]

    --cols N        frames per direction (default 4)
    --dirs a,b,c    row order, top to bottom (default: the full 8 in the
                    game's order: east,north-east,north,north-west,west,
                    south-west,south,south-east)
    --row DIR       single-strip mode: the sheet is ONE direction, one row
    --keep-bg       skip background removal (use when the sheet already
                    has clean transparency)
    --out DIR       output root (default: this sprites/ folder)

Minimum viable set: 5 directions — south, north, east, south-east,
north-east. The renderer mirrors the west side from the east side at draw
time for these optional packs (drawPlayerSprite mirror fallback), so:
    --dirs south,north,east,south-east,north-east     (5-row sheet)

Background removal: flood-fills from the four corners, clearing every
pixel within tolerance of the corner color (handles solid AND
slightly-gradient backgrounds). Checkerboard "fake transparency" is NOT
handled — regenerate with a real transparent or solid background.
"""
import argparse
import os
import sys
from collections import deque

from PIL import Image

GAME_DIRS = ["east", "north-east", "north", "north-west",
             "west", "south-west", "south", "south-east"]
CELL = 104


def remove_bg(im, tol=28):
    """Flood-fill transparent from the corners (solid-ish backgrounds)."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    seen = [[False] * h for _ in range(w)]
    for cx, cy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        base = px[cx, cy][:3]
        if px[cx, cy][3] == 0:
            continue
        q = deque([(cx, cy)])
        while q:
            x, y = q.popleft()
            if x < 0 or y < 0 or x >= w or y >= h or seen[x][y]:
                continue
            seen[x][y] = True
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if abs(r - base[0]) + abs(g - base[1]) + abs(b - base[2]) > tol * 3:
                continue
            px[x, y] = (r, g, b, 0)
            q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("pose")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--dirs", default=None)
    ap.add_argument("--row", default=None, help="single-direction strip mode")
    ap.add_argument("--keep-bg", action="store_true")
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    dirs = [args.row] if args.row else (
        args.dirs.split(",") if args.dirs else GAME_DIRS)
    for d in dirs:
        if d not in GAME_DIRS:
            sys.exit(f"unknown direction '{d}' — valid: {', '.join(GAME_DIRS)}")

    rows = len(dirs)
    cw = sheet.width // args.cols
    ch = sheet.height // rows
    print(f"sheet {sheet.width}x{sheet.height} → {rows} rows x {args.cols} cols "
          f"(cell {cw}x{ch})")
    if cw < 32 or ch < 32:
        sys.exit("cells under 32px — wrong --cols/--dirs for this sheet?")

    out_dir = os.path.join(args.out, args.pose)
    os.makedirs(out_dir, exist_ok=True)
    wrote = 0
    for r, direction in enumerate(dirs):
        for c in range(args.cols):
            cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            if not args.keep_bg:
                cell = remove_bg(cell)
            # Square-pad on the larger axis, then NEAREST to the game's
            # 104x104 (pixel art must never be smoothed).
            side = max(cell.size)
            sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            sq.paste(cell, ((side - cell.width) // 2, (side - cell.height) // 2))
            sq = sq.resize((CELL, CELL), Image.NEAREST)
            out = os.path.join(out_dir, f"{direction}_{c}.png")
            sq.save(out)
            wrote += 1
    print(f"wrote {wrote} frames → {out_dir}/")
    missing = [d for d in GAME_DIRS if d not in dirs]
    if missing:
        mirrors = {"west": "east", "north-west": "north-east", "south-west": "south-east"}
        unmirrored = [d for d in missing if mirrors.get(d) not in dirs]
        print(f"directions not in sheet: {', '.join(missing)}")
        if unmirrored and any(d in ("north", "south") for d in unmirrored):
            print("  ⚠ north/south have no mirror twin — generate them or the "
                  "renderer falls back to the procedural body for those angles")
        else:
            print("  (west side auto-mirrors from east at draw time)")
    print("Refresh play.html — the optional pose goes live automatically.")


if __name__ == "__main__":
    main()
