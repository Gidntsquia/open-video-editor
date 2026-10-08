# ove CLI

`ove` builds and inspects `.ovep` projects without opening the app, so an AI can do a rough edit and you review it. It prints one short JSON line per command and accepts many commands on stdin. Code: `cli/ove.js`, `cli/project.js` (mirrors `src/store.ts`), `cli/probe.js`, `cli/run.js`, `cli/cache.js`, `cli/jobs.js`.

```
npm.cmd run ove -- help                       # or: ove.cmd help / node cli/ove.js help
ove.cmd scenes "D:\OBS Videos\clip.mp4"        # understand: probe, scenes, silence, loud, frames, sheet, transcript
printf 'new\nimport "D:\\OBS Videos\\clip.mp4"\nadd m1 V1 @0 in=20 dur=30\ncut 10\nsave edit.ovep\n' | node cli/ove.js
ove.cmd frame -p edit.ovep --at 2,12           # check: composed frames, `preview` (480p MP4), `check` (lint)
```

Then open `edit.ovep` in the app (Ctrl+O), check it, and export there.

## Speed

`scan <m>` gives facts, scene candidates, loudness bins and silences in one pass (~5 s for 8 min). Probes take `--from/--to` (no range: whole file if <=120 s, else the first 60 s plus `more`), `--budget s` (partial result + `retry`), `--bg` (job; poll with `job j1`, `jobs`). Results, a 16 kHz WAV and a 320p all-intra proxy are cached in `cache/ove/` (cleared by the app's Clear cache).

## Batch

Failed lines don't stop the rest; a `{"summary":1,...}` line appears only when a line failed. Checkpoints are kept in `cache/ove/batch-<hash>.json`, and re-piping the same batch skips finished lines.

## GPU transcript

faster-whisper on CUDA, Windows venv; about 9 s for 8 min on an RTX 3080:

```
py -3 -m venv D:\ove-whisper
D:\ove-whisper\Scripts\pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12
set OVE_WHISPER=D:\ove-whisper\Scripts\python.exe D:\path\to\cli\whisper_gpu.py --model small {wav}
```

Without CUDA the wrapper falls back to CPU and the reply carries `"warn":"cpu"`. Under WSL point `OVE_WHISPER` at the Windows python.exe the same way.
