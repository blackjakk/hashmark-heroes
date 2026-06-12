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


def remove_bg(im, tol=10):
    """Clear the background by flood-fill from the sheet border.

    Handles SOLID backgrounds and BAKED CHECKERBOARDS (ChatGPT's habit):
    collects the dominant border tones (a checker contributes two), then
    BFS-clears every border-connected pixel within tolerance of any of
    them. The character survives because its dark OUTLINE blocks the
    flood — which also means art with broken outlines can leak; inspect
    the first slices. Interior gaps (between legs) may keep a few checker
    pixels; at the game's 104px scale they are sub-pixel noise.
    """
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    from collections import Counter
    cnt = Counter()
    for x in range(w):
        cnt[px[x, 0][:3]] += 1
        cnt[px[x, h - 1][:3]] += 1
    for y in range(h):
        cnt[px[0, y][:3]] += 1
        cnt[px[w - 1, y][:3]] += 1
    tones = []
    for c, n in cnt.most_common(10):
        if n < (w + h) * 0.02:
            break
        if all(sum(abs(a - b) for a, b in zip(c, t)) > tol * 3 for t in tones):
            tones.append(c)
    if not tones:
        return im

    # Light-dominated border (white/grey checkerboards): accept the WHOLE
    # light-grey family as background, not just the sampled tones — ChatGPT
    # checkers drift across several grey families (243/246/254) with
    # anti-aliased seams that otherwise wall off the flood. The character
    # survives on its dark OUTLINE, not on color separation.
    border_light = all(c >= 230 for c in tones[0])

    def is_bg(p):
        if p[3] == 0:
            return False
        r, g, b = p[:3]
        if border_light and r >= 230 and g >= 230 and b >= 230 \
           and (max(r, g, b) - min(r, g, b)) <= 14:
            return True
        return any(sum(abs(a - b) for a, b in zip(p[:3], t)) <= tol * 3 for t in tones)

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and is_bg(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and is_bg(px[x, y]):
                seen[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_bg(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return im


def defringe(im, iters=2):
    """Erode the anti-aliased matte ring left after background removal.

    The boundary between a baked background and the character outline is
    a 1-2px blend of the two (light greys ~150-225): too dark for the
    background test, too light to be outline. In-game it reads as a
    "green-screen" halo — and the team tint COLORS it (lum > 180 counts
    as jersey). Kill edge-adjacent light, unsaturated pixels; dark
    outlines and saturated skin/ball pixels are untouched.
    """
    px = im.load()
    w, h = im.size
    for _ in range(iters):
        kill = []
        for y in range(h):
            for x in range(w):
                p = px[x, y]
                if p[3] == 0:
                    continue
                r, g, b = p[:3]
                if (r + g + b) / 3 < 140 or (max(r, g, b) - min(r, g, b)) > 28:
                    continue
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                        kill.append((x, y))
                        break
        if not kill:
            break
        for x, y in kill:
            p = px[x, y]
            px[x, y] = (p[0], p[1], p[2], 0)
    return im


def reink(im, lum_thresh=100, ink=(38, 36, 40)):
    """Restore the dark outline lost to NEAREST downscale.

    Sampling at ~0.27x randomly drops pixels of the art's thin outline,
    leaving light jersey pixels directly on the silhouette edge. In-game
    (linear-filtered, premultiplied) those blend straight into the field
    — the green "seeps" into the player, differently on every frame
    (reads as color flicker). Two repairs:
      • any opaque edge pixel still light → darken to the ink tone
        (a complete 1px outline, like the source art had)
      • RGB under fully-transparent pixels → ink tone, so texture
        filtering can never pull stray light grey through the alpha edge
    """
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                if (r, g, b) != ink:
                    px[x, y] = (ink[0], ink[1], ink[2], 0)
                continue
            if (r + g + b) / 3 <= lum_thresh:
                continue
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    px[x, y] = (ink[0], ink[1], ink[2], 255)
                    break
    return im


def _bands(profile, expected, label):
    """Contiguous non-zero bands in an opacity projection → (start, end)."""
    bands = []
    start = None
    for i, v in enumerate(profile):
        if v > 0 and start is None:
            start = i
        elif v == 0 and start is not None:
            bands.append((start, i))
            start = None
    if start is not None:
        bands.append((start, len(profile)))
    # Merge bands separated by tiny gaps (anti-aliasing crumbs)
    merged = []
    for b in bands:
        if merged and b[0] - merged[-1][1] < 6:
            merged[-1] = (merged[-1][0], b[1])
        else:
            merged.append(list(b))
    # Drop slivers (stray pixels)
    merged = [b for b in merged if b[1] - b[0] >= 12]
    if len(merged) != expected:
        sys.exit(f"found {len(merged)} {label} bands, expected {expected} — "
                 f"is the sheet a clean grid? (bands: {merged})")
    return merged


# Body-height contract: v1 sprites are 104px cells where the BODY occupies
# ~50px with its feet at ~y76 (the renderer's foot anchor / scale / hand
# offsets are tuned to that). AI sheets fill their cells edge-to-edge, so
# figures are normalized: one global scale per sheet (median figure height
# → BODY_H), each row's common ground baseline placed at FOOT_Y.
BODY_H = 50
FOOT_Y = 76


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("pose")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--dirs", default=None)
    ap.add_argument("--row", default=None, help="single-direction strip mode")
    ap.add_argument("--keep-bg", action="store_true")
    ap.add_argument("--body-h", type=int, default=BODY_H,
                    help=f"normalized body height in the 104px frame (default {BODY_H})")
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    sheet = Image.open(args.sheet).convert("RGBA")
    dirs = [args.row] if args.row else (
        args.dirs.split(",") if args.dirs else GAME_DIRS)
    for d in dirs:
        if d not in GAME_DIRS:
            sys.exit(f"unknown direction '{d}' — valid: {', '.join(GAME_DIRS)}")

    if not args.keep_bg:
        sheet = remove_bg(sheet)
        sheet = defringe(sheet)
    alpha = sheet.getchannel("A")
    w, h = sheet.size
    adata = list(alpha.get_flattened_data()) if hasattr(alpha, "get_flattened_data") else list(alpha.getdata())
    rowsum = [0] * h
    for y in range(h):
        base = y * w
        rowsum[y] = 1 if any(adata[base + x] > 16 for x in range(0, w, 2)) else 0
    row_bands = _bands(rowsum, len(dirs), "row")
    print(f"sheet {w}x{h} → detected {len(row_bands)} figure rows")

    # Figure cells: per row, column bands of the alpha projection.
    cells = []   # (rowIdx, colIdx, bbox)
    for ri, (y0, y1) in enumerate(row_bands):
        colsum = [0] * w
        for x in range(w):
            colsum[x] = 1 if any(adata[y * w + x] > 16 for y in range(y0, y1, 2)) else 0
        col_bands = _bands(colsum, args.cols, f"column (row {ri})")
        for ci, (x0, x1) in enumerate(col_bands):
            crop = sheet.crop((x0, y0, x1, y1))
            bb = crop.getchannel("A").getbbox()
            if not bb:
                sys.exit(f"empty cell at row {ri} col {ci}")
            cells.append((ri, ci, crop.crop(bb)))

    heights = sorted(c[2].height for c in cells)
    median_h = heights[len(heights) // 2]
    scale = args.body_h / median_h
    print(f"figure median height {median_h}px → scale {scale:.3f} "
          f"(body {args.body_h}px in the 104 frame)")

    # Per-row ground baseline: tallest scaled bottom in the row sits at
    # FOOT_Y; airborne frames keep their lift relative to it.
    out_dir = os.path.join(args.out, args.pose)
    os.makedirs(out_dir, exist_ok=True)
    wrote = 0
    for ri in range(len(row_bands)):
        row_cells = [c for c in cells if c[0] == ri]
        row_bottoms = []
        scaled = {}
        for (_, ci, fig) in row_cells:
            sw_, sh_ = max(1, round(fig.width * scale)), max(1, round(fig.height * scale))
            fig2 = fig.resize((sw_, sh_), Image.NEAREST)
            scaled[ci] = fig2
            row_bottoms.append(sh_)
        baseline = max(row_bottoms)
        for (_, ci, _fig) in row_cells:
            fig2 = scaled[ci]
            frame = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            ox = (CELL - fig2.width) // 2
            # Pin every frame's bottom to the foot line — pixel run cycles
            # encode the bounce in the body, not by floating off the ground.
            oy = FOOT_Y - fig2.height
            frame.paste(fig2, (ox, max(0, oy)))
            # NEAREST downscale resamples some interior light pixels onto
            # the new silhouette edge — one more erosion at frame scale,
            # then re-ink the outline the downscale broke.
            if not args.keep_bg:
                defringe(frame, iters=1)
            reink(frame)
            frame.save(os.path.join(out_dir, f"{dirs[ri]}_{ci}.png"))
            wrote += 1
    print(f"wrote {wrote} frames → {out_dir}/")
    # Manifest — the v2 loader (sprites2/manifest.json) reads {pose: frames}
    # to know each set's frame count (new art may be 6-frame where the old
    # was 4). Merge-update so multiple slices accumulate.
    import json
    man_path = os.path.join(args.out, "manifest.json")
    man = {}
    if os.path.exists(man_path):
        try:
            man = json.load(open(man_path))
        except Exception:
            man = {}
    man[args.pose] = args.cols
    json.dump(man, open(man_path, "w"), indent=1, sort_keys=True)
    print(f"manifest updated → {man_path}")
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
