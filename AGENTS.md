# Repo facts
- Electron 44 app. Main `electron/main.js` (ESM), preload `electron/preload.cjs` (CJS), UI in `src/` (React 19, zustand 5), built by Vite into `dist/`.
- `shared/math.js` is used by BOTH preview (`src/engine.ts`) and export (`electron/exporter.js`); change it once so they stay matched.
- zustand v5: selectors must return stable references (no fresh arrays/objects) or React loops (#185).
- Must run as a native Windows app; on Windows use `npm.cmd`. WSL testing: rsync to `D:\ove-test`, run Windows node/Electron there, drive with `test/cdp.mjs` (CDP on port 9222, run from Windows node). Launch tests with `OVE_INACTIVE=1` so the window does not take focus.
- Never write into `D:\OBS Videos` or other user files. Cache is bounded (`cache/`, 2 GB) and clearable.
- Tests: `npm test`, `node test/sync.test.js` (system ffmpeg).
- Mouse-driven tests: `test/deploy.sh` (WSL) then `node.exe test/run.mjs core|edit|inspector|hevc` from /mnt/d/ove-test. Timeline edits that move clips must call store `overwrite(ids)`.

# `ove` CLI (edit videos headlessly; the user reviews in the app)
- `node cli/ove.js help` (or `npm.cmd run ove -- help`). One JSON line per reply; batch = one command per stdin line.
- Flow: probe (`scenes`/`silence`/`loud`/`sheet`/`frames`/`transcript`) -> plan -> build (`new`, `import`, `add`, `cut`, `rm`, `speed`, `set`, `title`, `dissolve`...) -> check (`check`, `frame --at`, `preview`) -> `save x.ovep` -> tell the user to open it in the app (Ctrl+O) and export there.
- Single calls auto-save to `-p`; batch saves only on `save`. Never export MP4 from the CLI.
- Project ops live in `cli/project.js` and mirror `src/store.ts`; change both together. `frame` uses `buildExport({frameAt})`.
- Under WSL ove uses system ffmpeg (bundled Linux build has no drawtext); ffmpeg 8 draws a box for `\n` in titles, the Windows ffmpeg-static does not. Stored media paths are Windows paths (`D:\...`).
- Test: `node test/ove.test.js`; app check: `test/scenarios/ove.mjs` (opens `cache/ove/app.ovep` by the Open dialog).
- ove speed: ranged probes, `scan`, `--budget`, `--bg`/`job`/`jobs`, result cache + WAV + 320p all-intra proxy in `cache/ove/` (`OVE_CACHE` overrides). Code: `cli/run.js` (ffmpeg runner, budget/timeouts), `cli/cache.js`, `cli/jobs.js`, `cli/probe.js`. Debug: `OVE_DEBUG=1` logs every ffmpeg call, `OVE_NO_PROXY=1` stops proxy builds (tests).
- GPU transcript: `cli/whisper_gpu.py` in a Windows venv (`D:\ove-whisper`: faster-whisper + nvidia-cublas-cu12 + nvidia-cudnn-cu12); `OVE_WHISPER='<venv python> <path>\cli\whisper_gpu.py --model small {wav}'`. Reads the cached 16 kHz WAV, falls back to CPU with `"warn":"cpu"`.
- Batch: failed lines don't stop the rest; a `{"summary":1,...}` line appears only when a line failed; checkpoints in `cache/ove/batch-<hash>.json`, re-piping skips finished lines.
