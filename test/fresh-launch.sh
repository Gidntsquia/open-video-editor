#!/bin/bash
# WSL: start the unzipped portable app with a clean environment (no Node/ffmpeg on PATH, no OBS sample folder),
# CDP on $PORT (default 9333), then un-minimize it at the bottom of the z-order so CDP input stays fast
# without covering the user's windows. Usage: test/fresh-launch.sh 'D:\ove-fresh\Open-Video-Editor-0.1.0-win-x64'
DIR="$1"; PORT="${PORT:-9333}"
powershell.exe -NoProfile -Command "Get-Process 'Open Video Editor' -ErrorAction SilentlyContinue | ? { \$_.Path -like '$DIR\\*' } | Stop-Process -Force" ; sleep 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$(dirname "$0")/fresh-launch.ps1")" -Dir "$DIR" -Port "$PORT" >/dev/null
EVSHOW_BEHIND=1 ~/.claude/local-tools/win.sh show "Untitled - Open Video Editor" 1030 0 1530 1000 60 | tail -1
