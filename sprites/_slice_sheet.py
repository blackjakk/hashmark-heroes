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

    # Morphologically GATED flood. A raw flood leaks through 1-2px breaks
    # in the character's dark outline and deletes white features wholesale
    # — the white helmet dome vanished from random frames (the helmet IS
    # in every source frame; the flood was eating it). Gate: erode the
    # bg-acceptable mask by 1px so the flood cannot pass passages ≤2px
    # wide (an outline break), then dilate the flooded region back out
    # within the mask so the 1px ring at legitimate boundaries still
    # clears.
    L = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            if is_bg(px[x, y]):
                L[y * w + x] = 1
    L1 = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            if not L[y * w + x]:
                continue
            ok = True
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and not L[ny * w + nx]:
                    ok = False
                    break
            if ok:
                L1[y * w + x] = 1
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and L1[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and L1[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and L1[ny * w + nx]:
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    # Recover the eroded boundary ring: dilate flood within the full mask.
    for _ in range(2):
        grow = []
        for y in range(h):
            for x in range(w):
                if seen[y * w + x] or not L[y * w + x]:
                    continue
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and seen[ny * w + nx]:
                        grow.append((x, y))
                        break
        for x, y in grow:
            seen[y * w + x] = 1
    for y in range(h):
        for x in range(w):
            if seen[y * w + x]:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
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


def reink(im, ink=(38, 36, 40)):
    """Seal the silhouette so field green can never blend into the figure.

    NEAREST downscale drops the art's thin outline and opens hairline
    transparent gaps between limbs and torso. In-game (linear-filtered,
    premultiplied) light pixels on the silhouette edge blend straight
    into the field — green "seeps", differently per frame (color
    flicker). Repairs, in order:
      • OUTSIDE = transparency flood-filled from the frame border.
        Interior transparent pockets (arm/torso seams) are NOT outside.
      • Interior pockets → solid ink (the source art draws these as
        dark seam lines; sealing also stops green showing through the
        body at minification).
      • Every opaque pixel touching OUTSIDE → ink (complete outline,
        no luminance exemption — greys at lum 89-100 still tinged).
      • 1px ink dilation into OUTSIDE only, so the outline survives
        mipmap minification. (Dilating into interior gaps too made
        every seam a 3px dark vein across the jersey — heavy, sloppy.)
      • RGB under remaining transparent pixels → ink, so filtering
        can never pull stray light grey through the alpha edge.
    """
    px = im.load()
    w, h = im.size
    # Flood the OUTSIDE transparency from the border.
    outside = bytearray(w * h)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y][3] == 0 and not outside[y * w + x]:
                outside[y * w + x] = 1
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if px[x, y][3] == 0 and not outside[y * w + x]:
                outside[y * w + x] = 1
                stack.append((x, y))
    while stack:
        cx, cy = stack.pop()
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < w and 0 <= ny < h and not outside[ny * w + nx] and px[nx, ny][3] == 0:
                outside[ny * w + nx] = 1
                stack.append((nx, ny))
    # Seal interior transparent pockets with solid ink.
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0 and not outside[y * w + x]:
                px[x, y] = (ink[0], ink[1], ink[2], 255)
    # Outline: mid/dark opaque pixels touching OUTSIDE → ink. Near-white
    # pixels are LEFT ALONE — on small features (the helmet shell is a
    # 1-2px ring at frame scale) every shell pixel is a boundary pixel,
    # and inking them blacked out entire helmets. The 1px dilation ring
    # below is what seals whites from the field instead.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0 or (r, g, b) == ink:
                continue
            if r > 170 and g > 170 and b > 170:
                continue
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and outside[ny * w + nx]:
                    px[x, y] = (ink[0], ink[1], ink[2], 255)
                    break
    # Dilate 1px into OUTSIDE (collect first so it can't cascade).
    grow = []
    for y in range(h):
        for x in range(w):
            if not outside[y * w + x]:
                continue
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 255:
                    grow.append((x, y))
                    break
    for x, y in grow:
        px[x, y] = (ink[0], ink[1], ink[2], 255)
    # Ink RGB under whatever transparency remains.
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0 and px[x, y][:3] != ink:
                px[x, y] = (ink[0], ink[1], ink[2], 0)
    return im


def despeckle(im, min_size=25):
    """Drop stray disconnected pixel clusters.

    NEAREST downscale shatters thin diagonal outline runs into orphan
    specks floating around the figure (the run set carried 7-13 per
    frame) — in-game they read as flickering dots around the helmet.
    Keep the main body and anything ball-sized or bigger; clear the rest.
    """
    px = im.load()
    w, h = im.size
    seen = bytearray(w * h)
    comps = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0 and not seen[y * w + x]:
                q = deque([(x, y)])
                seen[y * w + x] = 1
                cells = []
                while q:
                    cx, cy = q.popleft()
                    cells.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny][3] > 0:
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
                comps.append(cells)
    if not comps:
        return im
    biggest = max(len(c) for c in comps)
    for cells in comps:
        if len(cells) < min_size and len(cells) < biggest:
            for x, y in cells:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return im


def mode_downscale(im, sw, sh):
    """Majority-color downscale (pixel-art aware).

    NEAREST at ~0.27x is a sampling lottery: each destination pixel keeps
    ONE source pixel, so thin light features lose to the dark outline and
    facemask around them — the white helmet shell survived only on
    head-on frames where it was chunky ("there's literally a helmet in
    every frame" — and there is, the downscale was dropping it). Instead,
    each destination pixel takes the MAJORITY color class of its source
    box (mean within the winning class), so whichever feature dominates
    the box wins, regardless of where the sample grid lands. Flat areas
    stay flat — no cross-class blending, no new colors.
    """
    w, h = im.size
    px = im.load()
    out = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    op = out.load()
    for dy in range(sh):
        y0 = (dy * h) // sh
        y1 = max(y0 + 1, ((dy + 1) * h) // sh)
        for dx in range(sw):
            x0 = (dx * w) // sw
            x1 = max(x0 + 1, ((dx + 1) * w) // sw)
            buckets = {}
            total = opaque = 0
            for sy in range(y0, y1):
                for sx in range(x0, x1):
                    r, g, b, a = px[sx, sy]
                    total += 1
                    if a < 128:
                        continue
                    opaque += 1
                    k = (r // 48, g // 48, b // 48)
                    e = buckets.get(k)
                    if e:
                        e[0] += r; e[1] += g; e[2] += b; e[3] += 1
                    else:
                        buckets[k] = [r, g, b, 1]
            if opaque * 2 < total or not buckets:
                continue
            br, bg, bb, bn = max(buckets.values(), key=lambda e: e[3])
            op[dx, dy] = (br // bn, bg // bn, bb // bn, 255)
    return out



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
    # Detached-prop absorption: a kicked/flipped ball mid-air projects as
    # its own small band between figures. While over count, merge the
    # narrowest band into whichever neighbor is closer — but only if it's
    # clearly prop-sized (< half the median band width), so a genuinely
    # mis-gridded sheet still errors out.
    while len(merged) > expected:
        widths = sorted(b[1] - b[0] for b in merged)
        median = widths[len(widths) // 2]
        k = min(range(len(merged)), key=lambda i: merged[i][1] - merged[i][0])
        if merged[k][1] - merged[k][0] >= median / 2:
            break
        if k == 0:
            merged[1] = [merged[0][0], merged[1][1]]
        elif k == len(merged) - 1:
            merged[-2] = [merged[-2][0], merged[-1][1]]
        else:
            gapL = merged[k][0] - merged[k - 1][1]
            gapR = merged[k + 1][0] - merged[k][1]
            if gapL <= gapR:
                merged[k - 1] = [merged[k - 1][0], merged[k][1]]
            else:
                merged[k + 1] = [merged[k][0], merged[k + 1][1]]
        merged.pop(k)
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
    ap.add_argument("--flip-east", action="store_true",
                    help="sheet's profile/diagonal rows were drawn facing "
                         "LEFT (west family) — flip east/south-east/"
                         "north-east frames horizontally so 'east' truly "
                         "faces east (carry, hurdle, qb_carry, refs sheets)")
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
            fig2 = mode_downscale(fig, sw_, sh_)
            scaled[ci] = fig2
            row_bottoms.append(sh_)
        baseline = max(row_bottoms)
        for (_, ci, _fig) in row_cells:
            fig2 = scaled[ci]
            frame = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
            # Horizontal anchor: bbox centering shifts the whole body
            # whenever an arm/ball/stride extends the box on one side —
            # frame-to-frame the helmet visibly jittered sideways
            # ("flicker, mostly in the helmet"). For UPRIGHT figures the
            # stable visual column is the HEAD (top third centroid) —
            # feet stride and arms swing by design, the head shouldn't.
            # Horizontal figures (prone/dive frames) keep bbox centering.
            fpx = fig2.load()
            ox = (CELL - fig2.width) // 2
            if fig2.height > fig2.width:
                hxs = []
                for y in range(0, max(4, fig2.height // 3)):
                    for x in range(fig2.width):
                        if fpx[x, y][3] > 0:
                            hxs.append(x)
                if hxs:
                    ox = int(round(CELL / 2 - sum(hxs) / len(hxs)))
            ox = max(0, min(CELL - fig2.width, ox))
            # Pin every frame's bottom to the foot line — pixel run cycles
            # encode the bounce in the body, not by floating off the ground.
            oy = FOOT_Y - fig2.height
            frame.paste(fig2, (ox, max(0, oy)))
            # NEAREST downscale resamples some interior light pixels onto
            # the new silhouette edge — one more erosion at frame scale,
            # then re-ink the outline the downscale broke.
            if not args.keep_bg:
                defringe(frame, iters=1)
            despeckle(frame)
            reink(frame)
            if args.flip_east and dirs[ri] in ("east", "south-east", "north-east"):
                frame = frame.transpose(Image.FLIP_LEFT_RIGHT)
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
