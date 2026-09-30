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

## Cache

Thumbnails, waveforms, 960 px proxies (built automatically for HEVC, very large or high-bitrate footage) and export temp files live in `cache/` inside the app folder (override with `OVE_CACHE`). It is capped at 2 GB and the **Clear cache** button empties it. Nothing is written elsewhere except your chosen export/project paths. Source media is never modified.

## Tests

`npm test` (export with every feature; needs `ffmpeg` on PATH or `FFMPEG_BIN`) and `node test/sync.test.js` (flash/beep A/V sync through cuts and 2x speed).

## Credits

Electron (MIT), React (MIT), zustand (MIT), Vite (MIT), ffmpeg-static (GPL-3.0 build of FFmpeg, https://ffmpeg.org), ffprobe-static (MIT, bundles FFmpeg's ffprobe). FFmpeg is licensed LGPL/GPL by its authors.


## Media bin and editing notes
- Bin: click to select, Delete / × / right-click removes (clips using it go too; Ctrl+Z restores). Drag an item to a track; dropping over a clip overwrites it (Premiere-style).
- Ctrl+wheel zooms the timeline around the cursor. On an empty launch the bin is pre-filled with a few clips from `D:\OBS Videos` (read-only).
- Test drivers: `test/deploy.sh`, `test/run.mjs` (mouse-driven CDP scenarios).
