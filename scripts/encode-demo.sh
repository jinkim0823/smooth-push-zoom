#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ $# -eq 1 ]] || { printf 'Usage: %s FRAME_DIRECTORY\n' "$0" >&2; exit 2; }
FRAMES="$1"
node "$ROOT/tests/demo-trajectory.cjs" "$FRAMES"
COUNT=$(find "$FRAMES" -maxdepth 1 -name 'frame-*.png' -type f | wc -l)
[[ "$COUNT" -eq 600 ]] || { printf 'Expected 600 rendered frames; found %s\n' "$COUNT" >&2; exit 1; }
ffmpeg -hide_banner -loglevel error -y -framerate 60 -i "$FRAMES/frame-%03d.png" \
    -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart "$ROOT/docs/demo.mp4"
ffmpeg -hide_banner -loglevel error -y -framerate 60 -i "$FRAMES/frame-%03d.png" \
    -vf 'fps=20,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse' "$ROOT/docs/demo.gif"
ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,nb_frames,duration \
    -of default=noprint_wrappers=1 "$ROOT/docs/demo.mp4"
