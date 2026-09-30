# Repo facts
- Electron 44 app. Main `electron/main.js` (ESM), preload `electron/preload.cjs` (CJS), UI in `src/` (React 19, zustand 5), built by Vite into `dist/`.
- `shared/math.js` is used by BOTH preview (`src/engine.ts`) and export (`electron/exporter.js`); change it once so they stay matched.
- zustand v5: selectors must return stable references (no fresh arrays/objects) or React loops (#185).
- Must run as a native Windows app; on Windows use `npm.cmd`. WSL testing: rsync to `D:\ove-test`, run Windows node/Electron there, drive with `test/cdp.mjs` (CDP on port 9222, run from Windows node). Launch tests with `OVE_INACTIVE=1` so the window does not take focus.
- Never write into `D:\OBS Videos` or other user files. Cache is bounded (`cache/`, 2 GB) and clearable.
- Tests: `npm test`, `node test/sync.test.js` (system ffmpeg).
- Mouse-driven tests: `test/deploy.sh` (WSL) then `node.exe test/run.mjs core|edit|inspector|hevc` from /mnt/d/ove-test. Timeline edits that move clips must call store `overwrite(ids)`.
