# Open Video Editor

A from-scratch, native Windows video editor for OBS screen and game recordings. Electron + React + TypeScript; ffmpeg does decoding helpers and export. MIT licensed.

## Run on Windows

Install these first (all free). Nothing else is needed.

1. **Node.js LTS (18 or newer)** - https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`)
2. **Git** (only to clone) - `winget install Git.Git`

Then, in a normal Windows terminal (cmd or PowerShell):

```
git clone <this repo> video-editor
cd video-editor
npm.cmd install
npm.cmd start
```

Or double-click `run.bat`, which does the same.

Notes:
- Use `npm.cmd`, not `npm`. PowerShell's default execution policy blocks `npm.ps1`. Do not change the policy; `npm.cmd` avoids it.
- `npm start` builds the UI and opens the app. First run downloads Electron and a static ffmpeg build (about 250 MB inside `node_modules`). `scripts/start.js` runs their install scripts if npm skipped them.
- The app is a native Windows window (not WSLg). Do not launch it from WSL.
- Optional: an NVIDIA GPU makes export faster (NVENC is used automatically; otherwise x264).

## Using it

- Import (Ctrl+I, or drag files in): mp4 / mov / mkv, H.264 or HEVC. Bin shows thumbnail, duration, resolution.
- Drag clips from the bin to the timeline. V1-V3 video, A1-A3 audio; higher video tracks cover lower ones.
- Shortcuts: `V` select, `C` razor, `Ctrl+K` cut at playhead, `Space` play/pause, `J`/`K`/`L` reverse/stop/forward, `Delete` delete (leaves a gap), `Shift+Delete` ripple delete, `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `Ctrl+D` add 1 s dissolve, `Ctrl+S` save, `Ctrl+O` open, `Ctrl+M` export.
- Inspector: volume, fades, volume keyframes, brightness/contrast/saturation, crop/scale/position, speed, transitions; titles have text, font, size, colour, position and duration.
- Export MP4 (H.264 + AAC) to a path you choose, with a progress bar. Projects save as `.ovep`.

## `ove`: editing from the command line (for AI assistants)

`ove` builds and inspects `.ovep` projects without opening the app, so an AI can do a rough edit and you review it. It prints one short JSON line per command and accepts many commands on stdin.

```
npm.cmd run ove -- help                       # or: ove.cmd help / node cli/ove.js help
ove.cmd scenes "D:\OBS Videos\clip.mp4"        # understand: probe, scenes, silence, loud, frames, sheet, transcript
printf 'new\nimport "D:\\OBS Videos\\clip.mp4"\nadd m1 V1 @0 in=20 dur=30\ncut 10\nsave edit.ovep\n' | node cli/ove.js
ove.cmd frame -p edit.ovep --at 2,12           # check: composed frames, `preview` (480p MP4), `check` (lint)
```

Then open `edit.ovep` in the app (Ctrl+O), check it, and export there.

Speed: `scan <m>` gives facts, scene candidates, loudness bins and silences in one pass (~5 s for 8 min). Probes take `--from/--to` (no range: whole file if <=120 s, else the first 60 s plus `more`), `--budget s` (partial result + `retry`), `--bg` (job; poll with `job j1`, `jobs`). Results, a 16 kHz WAV and a 320p all-intra proxy are cached in `cache/ove/` (cleared by the app's Clear cache).

GPU transcript (faster-whisper on CUDA, Windows venv; about 9 s for 8 min on an RTX 3080):
```
py -3 -m venv D:\ove-whisper
D:\ove-whisper\Scripts\pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
set OVE_WHISPER=D:\ove-whisper\Scripts\python.exe D:\path\to\cli\whisper_gpu.py --model small {wav}
```
Without CUDA the wrapper falls back to CPU and the reply carries `"warn":"cpu"`. Under WSL point `OVE_WHISPER` at the Windows python.exe the same way.

## MCP: let Claude Code edit and show you the result

`ove` is also an MCP server: every `ove` command is a typed tool (plus a raw `ove` tool), frames and contact sheets come back as small images, and the running app opens the project for you.

```
npm.cmd install        # once
npm.cmd run mcp        # or: node cli/mcp.js (stdio)
```

Claude Code picks it up from `.mcp.json` in this folder:

```json
{"mcpServers":{"ove":{"command":"node","args":["cli/mcp.js"]}}}
```

The app tools (`app_open`, `app_seek`, `app_selection`, `app_capture`, `app_launch`) need Windows node, so from WSL use `"command":"node.exe"` with the Windows path of the repo copy. After each edit the server reloads the project in the app and parks the playhead on the change, unless the app has unsaved changes.

Example: "remove the dead air from `D:\OBS Videos\clip.mp4` and show me" -> `new`, `import`, `silence`, `add`/`cut`/`rm` calls, `check`, and the app shows the cut timeline with the playhead on the first cut. You review, then export in the app (the server never exports).

## Cache

Thumbnails, waveforms, 960 px proxies (built automatically for HEVC, very large or high-bitrate footage) and export temp files live in `cache/` inside the app folder (override with `OVE_CACHE`). It is capped at 2 GB and the **Clear cache** button empties it. Nothing is written elsewhere except your chosen export/project paths. Source media is never modified.

## Tests

`npm test` (export with every feature, plus the `ove` CLI: batch, bad input, round trip; needs `ffmpeg` on PATH or `FFMPEG_BIN`) and `node test/sync.test.js` (flash/beep A/V sync through cuts and 2x speed).

## Credits

Electron (MIT), React (MIT), zustand (MIT), Vite (MIT), ffmpeg-static (GPL-3.0 build of FFmpeg, https://ffmpeg.org), ffprobe-static (MIT, bundles FFmpeg's ffprobe). FFmpeg is licensed LGPL/GPL by its authors.


## Media bin and editing notes
- Bin: click to select, Delete / × / right-click removes (clips using it go too; Ctrl+Z restores). Drag an item to a track; dropping over a clip overwrites it (Premiere-style).
- Ctrl+wheel zooms the timeline around the cursor. On an empty launch the bin is pre-filled with a few clips from `D:\OBS Videos` (read-only).
- Test drivers: `test/deploy.sh`, `test/run.mjs` (mouse-driven CDP scenarios).
