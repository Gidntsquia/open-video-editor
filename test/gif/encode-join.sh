#!/bin/bash
# encode-join.sh <out.gif> <W> <H> <fps> <dir1> <speed1> [<dir2> <speed2> ...]
# Each rec.mjs frames dir is sped up and fitted to WxH, then the parts are joined and turned into one gif.
OUT="$1"; W="$2"; H="$3"; FPS="$4"; shift 4; T=$(mktemp -d); i=0; : > "$T/list.txt"
while [ $# -gt 0 ]; do
  ffmpeg -v error -y -f concat -safe 0 -i "$1/frames.txt" -vf "setpts=PTS/$2,fps=$FPS,scale=$W:$H:force_original_aspect_ratio=decrease:flags=lanczos,pad=$W:$H:(ow-iw)/2:(oh-ih)/2,setsar=1" -c:v libx264 -crf 8 -pix_fmt yuv444p "$T/p$i.mp4" || exit 1
  echo "file '$T/p$i.mp4'" >> "$T/list.txt"; i=$((i+1)); shift 2
done
ffmpeg -v error -y -f concat -safe 0 -i "$T/list.txt" -vf "palettegen=max_colors=256:stats_mode=diff" "$T/pal.png" &&
ffmpeg -v error -y -f concat -safe 0 -i "$T/list.txt" -i "$T/pal.png" -lavfi "[0:v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$OUT" &&
ffprobe -v error -show_entries stream=width,height:format=duration,size -of compact "$OUT"; rm -rf "$T"
