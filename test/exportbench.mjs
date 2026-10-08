// Windows node: node test/exportbench.mjs <proj.ovep|stress> <out.mp4> <budget> <encoder> [cancelAfterSec]
// Runs runExport with a working-set sampler and a hard guard (4 GB ffmpeg RSS or 20 min => kill).
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { runExport } from '../electron/exportrun.js'
const require = createRequire(import.meta.url)
const [src, out, budget = 'balanced', encoder = 'auto', cancelAt] = process.argv.slice(2)
const ffmpeg = process.env.FFMPEG_BIN || require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked')
const cacheDir = new URL('../cache', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const base = JSON.parse(fs.readFileSync(new URL('../cache/ove/highlights.ovep', import.meta.url)))
let proj = base
if (src === 'stress') {
  const pairs = base.clips.filter((c) => c.kind === 'video')
  const clips = []; let t = 0, id = 1
  for (let i = 0; i < 100; i++) {
    const v = pairs[i % pairs.length], a = base.clips.find((c) => c.link === v.link && c.kind === 'audio')
    const d = Math.min(4, v.dur), l = 'sl' + i
    for (const c of [v, a]) clips.push({ ...c, id: 's' + id++, link: l, start: t, dur: d, transition: 0.5, transOut: 0.5 })
    t += d - 0.5
  }
  proj = { ...base, clips }
} else if (src !== 'reel') proj = JSON.parse(fs.readFileSync(src))
let peak = 0, killed = ''
const ctl = {}
const t0 = Date.now()
const samp = setInterval(() => {
  execFile('tasklist', ['/FI', 'IMAGENAME eq ffmpeg.exe', '/FO', 'CSV', '/NH'], (e, so) => {
    let tot = 0
    for (const l of (so || '').split('\n')) { const m = l.match(/"([\d,]+) K"\s*$/); if (m) tot += +m[1].replace(/,/g, '') / 1024 }
    if (tot > peak) peak = tot
    if (tot > 4096 || Date.now() - t0 > 20 * 60e3) { killed = tot > 4096 ? 'rss' : 'time'; ctl.cancelled = true; ctl.proc?.kill() }
  })
}, 500)
let last = Date.now(), gaps = [], cancelMs
const fmt = (n) => Math.round(n)
if (cancelAt) setTimeout(() => { ctl.cancelled = true; const k = Date.now(); ctl.proc?.kill(); ctl.t = k }, +cancelAt * 1000)
const res = { src, budget, encoder }
try {
  const r = await runExport(proj, out, { ffmpeg, cacheDir, budget, encoder, ctl, onProgress: () => { const n = Date.now(); gaps.push(n - last); last = n } })
  res.ok = true; res.r = r
} catch (e) { res.ok = false; res.cancelled = !!e.cancelled; res.err = String(e.message).slice(0, 600); if (ctl.t) res.cancelMs = Date.now() - ctl.t }
clearInterval(samp)
res.wallS = fmt((Date.now() - t0) / 1000); res.peakMB = fmt(peak); res.killed = killed
res.maxProgressGapS = gaps.length ? +(Math.max(...gaps) / 1000).toFixed(2) : null; res.updates = gaps.length
res.exists = fs.existsSync(out); res.part = fs.existsSync(out.replace(/\.mp4$/, '.part.mp4'))
console.log(JSON.stringify(res))
