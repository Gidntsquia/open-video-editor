// "Understand" tools: facts, scene cuts, silence, loudness, frame grabs, contact sheet, transcript.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { probeFile } from '../shared/probe.js'
import { bin, exec, fail, cacheDir, enforceCache, fontDir, parseTime, r2, num, toLocal, tmpDir } from './util.js'

export async function facts(file) {
  if (!fs.existsSync(file)) fail(`file not found: ${file}`)
  try { return await probeFile(bin().ffprobe, file) } catch (e) { fail(`cannot read media: ${String(e.message).split('\n')[0].slice(0, 160)}`) }
}

const tag = (f, extra = '') => crypto.createHash('sha1').update(f + extra + fs.statSync(f).mtimeMs).digest('hex').slice(0, 8)
const sec = (x) => r2(parseFloat(x))

export async function scenes(file, dur, thr = 0.3) {
  if (!(thr > 0 && thr < 1)) fail('--thr must be between 0 and 1')
  const { err } = await exec(bin().ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-vf', `scale=320:-2,select='gt(scene,${thr})',showinfo`, '-f', 'null', '-'])
  const t = []
  for (const m of err.matchAll(/pts_time:([\d.]+)/g)) { const v = sec(m[1]); if (!t.length || v - t[t.length - 1] > 0.5) t.push(v) }
  return { ok: 1, n: t.length, t }
}

export async function silence(file, dur, db = -35, min = 1) {
  const { err } = await exec(bin().ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${db}dB:d=${min}`, '-f', 'null', '-'])
  const r = []; let s = null
  for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') s = Math.max(0, +m[2]); else if (s != null) { r.push([r2(s), r2(+m[2])]); s = null }
  }
  if (s != null) r.push([r2(s), r2(dur)])
  return { ok: 1, n: r.length, r }
}

export async function loud(file, top = 20, win = 2) {
  if (!(win > 0)) fail('--win must be > 0')
  const sr = 8000
  const { out } = await exec(bin().ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `aresample=${sr},asetnsamples=n=${Math.round(win * sr)}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:file=-`, '-f', 'null', '-'])
  const rows = []; let t = null, peak = null, rms = null
  const flush = () => { if (t != null && peak != null) rows.push([r2(t), r2(peak), r2(rms ?? peak)]) ; peak = rms = null }
  for (const line of out.toString().split('\n')) {
    let m
    if ((m = /pts_time:([\d.]+)/.exec(line))) { flush(); t = +m[1] }
    else if ((m = /Overall\.Peak_level=(-?[\d.]+|-inf)/.exec(line))) peak = m[1] === '-inf' ? -99 : +m[1]
    else if ((m = /Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(line))) rms = m[1] === '-inf' ? -99 : +m[1]
  }
  flush()
  rows.sort((a, b) => b[2] - a[2])
  return { ok: 1, win, cols: 't,peak_db,rms_db', r: rows.slice(0, top) }
}

export async function frames(file, dur, { every, at }) {
  const dir = cacheDir(); const k = tag(file, 'f'); const out = []
  const times = at ?? (() => { const a = []; for (let t = 0; t < dur; t += every) a.push(t); return a })()
  if (!times.length) fail('no frames requested')
  if (times.length > 200) fail(`${times.length} frames is too many (max 200); use a larger --every`)
  for (const t of times) {
    if (t < 0 || t > dur) fail(`time ${r2(t)} is outside the media (${r2(dur)}s)`)
    const f = path.join(dir, `fr-${k}-${Math.round(t * 100)}.jpg`)
    await exec(bin().ffmpeg, ['-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', "scale='min(320,iw)':-2", '-q:v', '4', f])
    if (!fs.existsSync(f)) fail(`no frame at ${r2(t)}`)
    out.push([r2(t), f])
  }
  enforceCache()
  return { ok: 1, f: out }
}

export async function sheet(file, dur, cols = 6, n = 36) {
  if (!(cols >= 1 && n >= 1 && n <= 400)) fail('--cols and --n must be positive (n <= 400)')
  const f = path.join(cacheDir(), `sheet-${tag(file, 's' + cols + n)}.jpg`)
  const fd = fontDir().replace(/:/g, '\\:')
  const step = dur / n, rows = Math.ceil(n / cols)
  const dt = `drawtext=fontfile='${fd}/arial.ttf':text='%{pts\\:gmtime\\:0\\:%M\\\\\\:%S}':x=4:y=4:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6`
  await exec(bin().ffmpeg, ['-y', '-v', 'error', '-skip_frame', 'nokey', '-i', file, '-an', '-vf', `fps=1/${step.toFixed(4)},scale=240:-2,${dt},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '4', f])
  enforceCache()
  return { ok: 1, f, cols, n }
}

export async function transcript(file) {
  const w = process.env.OVE_WHISPER
  if (!w) fail('set OVE_WHISPER to a whisper CLI')
  const dir = tmpDir(); const wav = path.join(dir, 'a.wav')
  try {
    await exec(bin().ffmpeg, ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
    const parts = w.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ''))
    const args = parts.slice(1).map((a) => a.replace('{wav}', wav))
    if (!parts.slice(1).some((a) => a.includes('{wav}'))) args.push(wav)
    let r
    try { r = await exec(parts[0], args) } catch (e) { fail(`OVE_WHISPER failed: ${String(e.message).slice(0, 200)}`) }
    const seg = []
    const ts = (s) => s.split(':').reduce((a, x) => a * 60 + parseFloat(x), 0)
    for (const line of (r.out.toString() + '\n').split('\n')) {
      const m = /\[\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*\]\s*(.*)$/.exec(line)
      if (m) { const a = ts(m[1].replace(',', '.')), b = ts(m[2].replace(',', '.')); if (m[3].trim()) seg.push({ t: r2(a), d: r2(b - a), text: m[3].trim() }) }
    }
    if (!seg.length) fail('whisper printed no "[start --> end] text" lines')
    return { ok: 1, n: seg.length, seg }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
export { parseTime, num, toLocal }
