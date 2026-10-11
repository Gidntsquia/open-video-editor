#!/bin/bash
# encode.sh <frames dir> <out.gif> <speed> [width=1280] [fps=10]
# Frames dir from rec.mjs (frames.txt = ffconcat with real durations). Speeds up, scales, 2-pass palette.
D="$1"; OUT="$2"; SPEED="$3"; W="${4:-1280}"; FPS="${5:-10}"
F="setpts=PTS/$SPEED,fps=$FPS,scale=$W:-1:flags=lanczos"
ffmpeg -v error -y -f concat -safe 0 -i "$D/frames.txt" -vf "$F,palettegen=max_colors=256:stats_mode=diff" "$D/palette.png" &&
ffmpeg -v error -y -f concat -safe 0 -i "$D/frames.txt" -i "$D/palette.png" -lavfi "$F[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT" &&
ffprobe -v error -show_entries stream=width,height:format=duration,size -of compact "$OUT"
