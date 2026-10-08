# Editing

How the app's editing screen works. Code: `src/App.tsx`, `src/Timeline.tsx`, `src/store.ts`.

## Using it

- Import (Ctrl+I, or drag files in): mp4 / mov / mkv, H.264 or HEVC. Bin shows thumbnail, duration, resolution.
- Drag clips from the bin to the timeline. V1-V3 video, A1-A3 audio; higher video tracks cover lower ones.
- Shortcuts: `V` select, `C` razor, `Ctrl+K` cut at playhead, `Space` play/pause, `J`/`K`/`L` reverse/stop/forward, `Delete` delete (leaves a gap), `Shift+Delete` ripple delete, `Ctrl+Z` undo, `Ctrl+Shift+Z` redo, `Ctrl+D` add 1 s dissolve, `Ctrl+S` save, `Ctrl+O` open, `Ctrl+M` export.
- Trim tools: `B` ripple, `N` roll, `Y` slip, `U` slide.
- Inspector: volume, fades, volume keyframes, brightness/contrast/saturation, crop/scale/position, speed, transitions; titles have text, font, size, colour, position and duration.
- Export MP4 (H.264 + AAC) to a path you choose, with a progress bar. Projects save as `.ovep`.

## Media bin and editing notes

- Bin: click to select, Delete / × / right-click removes (clips using it go too; Ctrl+Z restores). Drag an item to a track; dropping over a clip overwrites it (Premiere-style).
- Ctrl+wheel zooms the timeline around the cursor. On an empty launch the bin is pre-filled with a few clips from `D:\OBS Videos` (read-only).

## Transitions

Video: Cross Dissolve, Dip to Black, Dip to White, Film Dissolve, Wipe Left/Right/Up/Down, Push Left/Right/Up/Down, Cross Zoom, Blur Dissolve. Audio: Constant Power, Constant Gain, Exponential Fade. They are written once in `shared/math.js` as ffmpeg expressions; the preview evaluates them in JS and the exporter pastes them into ffmpeg filters, so both render the same picture.

## Export

The Export dialog has a Budget (`fast`, `balanced`, `background`) that sets ffmpeg's thread count and process priority, and an Encoder (`auto`, `gpu`, `cpu`). `auto` uses NVENC if the GPU has it, otherwise x264. The default folder is `D:\Open Video Editor Videos` (`OVE_EXPORT_DIR` overrides). Code: `electron/exportrun.js`, `electron/exporter.js`.
