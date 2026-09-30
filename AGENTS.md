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
