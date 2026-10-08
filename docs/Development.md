# Development

## Cache

Thumbnails, waveforms, 960 px proxies (built automatically for HEVC, very large or high-bitrate footage) and export temp files live in `cache/` inside the app folder (override with `OVE_CACHE`). It is capped at 2 GB and the **Clear cache** button empties it. Nothing is written elsewhere except your chosen export/project paths. Source media is never modified.

## Tests

`npm test` (export with every feature, plus the `ove` CLI: batch, bad input, round trip; needs `ffmpeg` on PATH or `FFMPEG_BIN`) and `node test/sync.test.js` (flash/beep A/V sync through cuts and 2x speed).

Mouse-driven scenarios: from WSL run `test/deploy.sh` (copies the repo to `D:\ove-test`), then `node.exe test/run.mjs core|edit|inspector|hevc|...` from `/mnt/d/ove-test`. They drive the app over CDP (port 9222). Set `OVE_INACTIVE=1` so the window doesn't take focus.

## Install notes

- Use `npm.cmd`, not `npm`. PowerShell's default execution policy blocks `npm.ps1`. Do not change the policy; `npm.cmd` avoids it.
- `npm start` builds the UI and opens the app. First run downloads Electron and a static ffmpeg build (about 250 MB inside `node_modules`). `scripts/start.js` runs their install scripts if npm skipped them.
- The app is a native Windows window (not WSLg). Do not launch it from WSL.

## Credits

Electron (MIT), React (MIT), zustand (MIT), Vite (MIT), ffmpeg-static (GPL-3.0 build of FFmpeg, https://ffmpeg.org), ffprobe-static (MIT, bundles FFmpeg's ffprobe). FFmpeg is licensed LGPL/GPL by its authors.
