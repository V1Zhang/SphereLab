#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="${1:-$PWD/test-media}"
FRAME_DIR="$OUT_DIR/frames/frame_000000"
mkdir -p "$FRAME_DIR"

colors=("#e63946" "#f1fa8c" "#2a9d8f" "#457b9d" "#ff7f11" "#a8dadc" "#8338ec" "#06d6a0" "#ff006e" "#ffd166" "#118ab2" "#ef476f" "#7209b7" "#80ed99" "#fb5607" "#3a86ff")
index=0
for row in 0 1 2 3; do
  for column in 0 1 2 3; do
    color="${colors[$index]}"
    output="$FRAME_DIR/tile_$(printf '%02d' "$column")_$(printf '%02d' "$row").png"
    ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=${color}:s=4096x4096" -frames:v 1 -y "$output"
    index=$((index + 1))
  done
done

echo "Generated 16 test tiles in $FRAME_DIR"
