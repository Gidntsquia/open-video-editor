#!/bin/bash
# encode-side.sh <left frames dir> <right frames dir> <out.gif> <speed> <height> [fps=10]
# Two rec.mjs recordings of the same moment, aligned by their first-frame timestamps (t0.txt), side by side.
L="$1"; R="$2"; OUT="$3"; SP="$4"; H="$5"; FPS="${6:-10}"; T=$(mktemp -d)
d=$(python3 -c "print(float(open('$R/t0.txt').read())-float(open('$L/t0.txt').read()))")
pl=$(python3 -c "print(max(0,-$d))"); pr=$(python3 -c "print(max(0,$d))")
G="[0:v]tpad=start_duration=$pl:start_mode=clone,scale=-2:$H:flags=lanczos,setsar=1[l];[1:v]tpad=start_duration=$pr:start_mode=clone,scale=-2:$H:flags=lanczos,setsar=1[r];[l][r]hstack=shortest=1,setpts=PTS/$SP,fps=$FPS"
ffmpeg -v error -y -f concat -safe 0 -i "$L/frames.txt" -f concat -safe 0 -i "$R/frames.txt" -filter_complex "$G" -c:v libx264 -crf 8 -pix_fmt yuv444p "$T/s.mp4" &&
ffmpeg -v error -y -i "$T/s.mp4" -vf "palettegen=max_colors=256:stats_mode=diff" "$T/pal.png" &&
ffmpeg -v error -y -i "$T/s.mp4" -i "$T/pal.png" -lavfi "[0:v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT" &&
ffprobe -v error -show_entries stream=width,height:format=duration,size -of compact "$OUT"; rm -rf "$T"
