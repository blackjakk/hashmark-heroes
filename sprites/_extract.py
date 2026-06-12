#!/usr/bin/env python3
"""Extract PixelLab animation ZIPs into the game's sprites/ layout.

Usage:
    python3 sprites/_extract.py [zip ...]        # default: sprites/*.zip

PixelLab v3 animation downloads contain, per animation, 8 direction
folders (or direction-suffixed files) of frames named frame_000.png …
frame_004.png, where frame_000 is the reference frame (SKIPPED). This
script finds frames by pattern wherever they sit in the ZIP, maps the
animation folder name to a game pose via the SOURCES prefix table, and
writes:

    sprites/<pose>/<direction>_<idx>.png      (idx 0..3, frame_001..004)

Directions are normalized to the game's naming: east, west, north, south,
north-east, north-west, south-east, south-west.

When adding SOURCES entries, prefer prefixes with a trailing token break —
"running" would also match "running_back_executing_x"; use "running-".
"""
import io
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))

# PixelLab animation folder-name prefix → game pose folder.
# The prompts in sprites/SPRITE_REQUEST.md start with these exact tokens so
# the downloaded folder names match. (PixelLab slugs the prompt text.)
SOURCES = {
    # ── contact-moment upgrade pack ──
    "qb_release":        "throw_release",
    "qb-release":        "throw_release",
    "high_point_catch":  "catch_high",
    "high-point-catch":  "catch_high",
    "over_shoulder":     "catch_over_shoulder",
    "over-shoulder":     "catch_over_shoulder",
    "low_scoop":         "catch_low",
    "low-scoop":         "catch_low",
}

DIRS = {
    "east": "east", "west": "west", "north": "north", "south": "south",
    "northeast": "north-east", "north-east": "north-east", "north_east": "north-east",
    "northwest": "north-west", "north-west": "north-west", "north_west": "north-west",
    "southeast": "south-east", "south-east": "south-east", "south_east": "south-east",
    "southwest": "south-west", "south-west": "south-west", "south_west": "south-west",
}

FRAME_RE = re.compile(r"frame[_-]?(\d+)\.png$", re.IGNORECASE)


def norm_dir(token):
    return DIRS.get(token.lower().replace(" ", ""))


def pose_for(path):
    low = path.lower()
    for prefix, pose in SOURCES.items():
        if prefix in low:
            return pose
    return None


def extract(zip_path):
    wrote = 0
    skipped = set()
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            m = FRAME_RE.search(name)
            if not m:
                continue
            frame = int(m.group(1))
            if frame == 0:
                continue                      # reference frame — skip
            pose = pose_for(name)
            if not pose:
                top = name.split("/")[0]
                if top not in skipped:
                    skipped.add(top)
                continue
            # Direction: search every path token + the filename stem.
            direction = None
            for token in re.split(r"[/\\_\-.]", name):
                d = norm_dir(token)
                if d:
                    direction = d
                    break
            # Compound tokens ("south-east") survive the split above as two
            # tokens — try adjacent-pair joins if single tokens missed.
            if not direction:
                toks = re.split(r"[/\\_.]", name.lower())
                for i in range(len(toks) - 1):
                    d = norm_dir(toks[i] + "-" + toks[i + 1])
                    if d:
                        direction = d
                        break
            if not direction:
                print(f"  !? no direction in: {name}")
                continue
            out_dir = os.path.join(HERE, pose)
            os.makedirs(out_dir, exist_ok=True)
            out = os.path.join(out_dir, f"{direction}_{frame - 1}.png")
            with zf.open(name) as src, open(out, "wb") as dst:
                dst.write(src.read())
            wrote += 1
    if skipped:
        print(f"  (unmatched animation folders: {', '.join(sorted(skipped))})")
    return wrote


def main():
    zips = sys.argv[1:] or [
        os.path.join(HERE, f) for f in os.listdir(HERE) if f.endswith(".zip")
    ]
    if not zips:
        print("no ZIPs found — drop PixelLab downloads into sprites/ or pass paths")
        sys.exit(1)
    total = 0
    for z in zips:
        print(f"── {os.path.basename(z)}")
        n = extract(z)
        print(f"  wrote {n} frames")
        total += n
    print(f"\n{total} frames extracted. Refresh play.html — optional poses go live automatically.")


if __name__ == "__main__":
    main()
