// "Understand" tools: facts, scan, scene cuts, silence, loudness, frames, contact sheet, transcript.
// Every probe takes a range, answers from the result cache where it can, computes only missing parts and obeys the time budget.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { probeFile } from '../shared/probe.js'
import { bin, fail, Err, cacheDir, enforceCache, fontDir, parseTime, r2, num, toLocal, toStored } from './util.js'
import { ff, left, clock, debug } from './run.js'
import * as C from './cache.js'

// mono = average of L and R in float (ffmpeg's own mono downmix is +3 dB / int-normalised), so levels stay close to the old per-channel measurements
const MONO = 'aresample=16000,aformat=sample_fmts=fltp:channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1'
const OVE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ove.js')
const isWsl = process.platform === 'linux'

export async function facts(file) {
  if (!fs.existsSync(file)) fail(`file not found: ${file}`)
  const id = C.fid(file); const st = C.load(id, 'probe')
  if (st.facts) return Object.defineProperty({ ...st.facts }, 'cached', { value: 1, enumerable: false })
  let f
  try { f = await probeFile(bin().ffprobe, file) } catch (e) { fail(`cannot read media: ${String(e.message).split('\n')[0].slice(0, 160)}`) }
  C.store(id, 'probe', '', { cov: [], items: [], facts: f }); return f
}

/** --from/--to -> {from,to,more}. No range: whole file if <= 120 s, else the first 60 s plus a `more` hint. */
export function range(dur, flags) {
  let from = flags.from != null ? parseTime(flags.from, '--from') : null, to = flags.to != null ? parseTime(flags.to, '--to') : null, more
  if (from == null && to == null) { if (dur <= 120) { from = 0; to = dur } else { from = 0; to = 60; more = `--from 60 --to ${r2(dur)}` } }
  else { from ??= 0; to ??= dur }
  if (from < 0) fail('--from must be >= 0')
  if (from >= dur) fail(`--from ${r2(from)} is past the end of the media (${r2(dur)}s)`)
  to = Math.min(to, dur)
  if (!(to > from)) fail('--to must be after --from')
  return { from, to, more }
}

const pct = (a, b) => (t) => clock.onPct?.(Math.max(0, Math.min(1, (t - a) / (b - a))), t)

// ---------- audio / proxy caches ----------
/** 16 kHz mono WAV of the whole audio, written once (or the source itself when the WAV cannot be made in time). */
async function audioInput(mi) {
  const w = C.wavPath(mi.id)
  if (fs.existsSync(w)) return { path: w, wav: true }
  const part = w + '.part.wav'
  slowFs(mi)
  try {
    const keep = clock.budget // the WAV decode may use up to half of what is left of the budget
    clock.budget = (Date.now() - clock.start + Math.max(2000, left() * 0.5)) / 1000
    try { const r = await ff(['-y', '-i', mi.file, '-vn', '-af', MONO, '-c:a', 'pcm_s16le', part]); if (!r.stopped) { fs.renameSync(part, w); enforceCache(); return { path: w, wav: true } } }
    finally { clock.budget = keep }
  } catch (e) { if (!(e instanceof Err)) throw e }
  fs.rmSync(part, { force: true })
  return { path: mi.file, wav: false }
}

let pendingProxy = null
/** Proxy builds start only after the command's own work, so they never compete with it for CPU. */
export function startProxy(mi) { pendingProxy = mi }
export function flushProxy() { const mi = pendingProxy; pendingProxy = null; if (mi) spawnProxy(mi) }
function spawnProxy(mi) {
  if (process.env.OVE_NO_PROXY) return
  const px = C.proxyPath(mi.id)
  if (fs.existsSync(px)) return
  const lock = px + '.lock'
  try { if (Date.now() - fs.statSync(lock).mtimeMs < 120000) return } catch {}
  fs.writeFileSync(lock, String(process.pid))
  const c = spawn(process.execPath, [OVE_JS, '__proxy', mi.file, px], { detached: true, stdio: 'ignore', windowsHide: true })
  c.unref()
}
/** Child side of startProxy: all-intra 320p copy (every frame a keyframe) so range seeks and scene scans are cheap. */
export async function buildProxy(file, px) {
  const lock = px + '.lock'; const part = px + '.part.mp4'
  const hb = setInterval(() => { try { fs.utimesSync(lock, new Date(), new Date()) } catch {} }, 30000)
  try {
    clock.budget = 36000
    await ff(['-y', '-i', file, '-an', '-vf', 'scale=320:-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '1', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-threads', '2', part], { budget: false })
    fs.renameSync(part, px); enforceCache()
  } catch { fs.rmSync(part, { force: true }) } finally { clearInterval(hb); fs.rmSync(lock, { force: true }) }
}
const videoInput = (mi) => { const px = C.proxyPath(mi.id); startProxy(mi); return fs.existsSync(px) ? { path: px, proxy: true } : { path: mi.file, proxy: false } }

const warned = new Set()
function slowFs(mi) {
  if (!isWsl || !/^\/mnt\/[a-z]\//.test(mi.file) || warned.has(mi.id)) return
  warned.add(mi.id)
  const mark = path.join(cacheDir(), `slowfs-${mi.id}`)
  if (fs.existsSync(mark)) return
  fs.writeFileSync(mark, '')
  clock.warn = 'slow fs, run from Windows node'
}

// ---------- generic ranged probe ----------
async function ranged({ id, kind, args, a, b, align, compute, merge, query }) {
  const st = C.load(id, kind, args); const total = b - a
  const gs = C.gaps(st.cov, a, b)
  const missing = gs.reduce((s, [x, y]) => s + y - x, 0)
  let doneTo = b, partial = false, dirty = false
  for (const [x0, y0] of gs) {
    if (left() <= 0) { partial = true; doneTo = x0; break }
    const [x, y] = align ? align(x0, y0) : [x0, y0]
    const r = await compute(x, y)
    if (r.timeout) { if (dirty) C.store(id, kind, args, st); throw Object.assign(new Err(`timeout after ${clock.budget}s`), { extra: dirty ? query(st.items, a, x0) : {} }) }
    st.items = merge(st.items, r.items, x, r.to); C.addCov(st.cov, x, r.to); dirty = true
    if (r.to < y - C.EPS) { partial = true; doneTo = r.to; break }
  }
  if (dirty) C.store(id, kind, args, st)
  const out = query(st.items, a, doneTo)
  if (!dirty) out.cached = 1; else if (total - missing > 0.5) out.cached = 'part'
  if (partial) { out.partial = 1; out.done_to = r2(doneTo) }
  return out
}
const progressTo = (r, a0, b) => (r.stopped ? Math.min(b, a0 + r.t) : b)

// ---------- scenes ----------
export async function scenes(mi, rg, thr = 0.3) {
  if (!(thr > 0 && thr < 1)) fail('--thr must be between 0 and 1')
  const vi = videoInput(mi)
  const out = await ranged({
    id: mi.id, kind: 'scenes', args: `thr=${thr}`, a: rg.from, b: rg.to,
    async compute(a, b) {
      const a0 = a > 0 ? Math.max(0, a - 0.25) : 0
      // proxy compression shifts scores a little: the proxy proposes candidates at a lower threshold, clear hits are kept, borderline ones are confirmed on the source
      const pthr = vi.proxy ? thr * 0.8 : thr
      const r = await ff(['-skip_loop_filter', 'all', '-flags2', '+fast', '-ss', a0, '-to', b, '-i', vi.path, '-an', '-vf', `scale=320:-2:flags=fast_bilinear,select='gt(scene,${pthr})',${vi.proxy ? 'metadata=print' : 'showinfo'}`, '-f', 'null', '-'], { onProgress: (t) => pct(rg.from, rg.to)(a0 + t) })
      if (r.stopped === 'timeout') return { timeout: 1 }
      let t = []; const edge = []
      if (vi.proxy) {
        for (const m of r.err.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*scene_score=([\d.]+)/g)) { const v = r2(a0 + parseFloat(m[1])); if (v < a - 1e-6) continue; if (parseFloat(m[2]) >= thr * 1.15) t.push(v); else edge.push(v) }
      } else for (const m of r.err.matchAll(/pts_time:([\d.]+)/g)) { const v = a0 + parseFloat(m[1]); if (v >= a - 1e-6) t.push(r2(v)) }
      let to = progressTo(r, a0, b)
      if (edge.length) {
        for (const c of edge) {
          if (left() <= 0 && c - 0.01 > a + 1) { to = Math.min(to, c - 0.01); break }
          const s0 = Math.max(0, c - 1.5)
          const q = await ff(['-ss', s0, '-to', c + 0.6, '-i', mi.file, '-an', '-vf', `scale=320:-2:flags=fast_bilinear,select='gt(scene,${thr})',showinfo`, '-f', 'null', '-'], { budget: false })
          if ([...q.err.matchAll(/pts_time:([\d.]+)/g)].some((m) => Math.abs(s0 + parseFloat(m[1]) - c) <= 0.5)) t.push(c)
        }
        t = t.filter((v) => v <= to + 1e-6).sort((x, y) => x - y)
      }
      return { items: t, to }
    },
    merge(old, add) { const all = [...old, ...add].sort((p, q) => p - q); const o = []; for (const v of all) if (!o.length || v - o[o.length - 1] > 0.5) o.push(v); return o },
    query(items, a, b) { const t = items.filter((v) => v >= a - 1e-6 && v <= b + 1e-6); return { n: t.length, t } },
  })
  return fin(out, rg)
}
function fin(out, rg) { const o = { ok: 1, from: r2(rg.from), to: r2(out.done_to ?? rg.to), ...out }; if (rg.more && !out.partial) o.more = rg.more; if (rg.more && out.partial) o.more = `--from ${out.done_to} --to ${rg.to}`; return o }

// ---------- silence / loud ----------
export async function silence(mi, rg, db = -35, min = 1) {
  if (!mi.audio) fail('no audio track')
  const base = Math.min(min, 0.5)
  const ai = await audioInput(mi)
  const out = await ranged({
    id: mi.id, kind: 'silence', args: `db=${db},d=${base}`, a: rg.from, b: rg.to,
    async compute(a, b) {
      const r = await ff(['-ss', a, '-to', b, '-i', ai.path, '-vn', '-af', `silencedetect=noise=${db}dB:d=${base}`, '-f', 'null', '-'], { onProgress: (t) => pct(rg.from, rg.to)(a + t) })
      if (r.stopped === 'timeout') return { timeout: 1 }
      const to = progressTo(r, a, b); const items = []; let s = null
      for (const m of r.err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
        const v = a + parseFloat(m[2])
        if (m[1] === 'start') s = Math.max(a, v); else if (s != null) { items.push([r2(s), r2(Math.min(v, to))]); s = null }
      }
      if (s != null) items.push([r2(s), r2(to)])
      return { items, to }
    },
    merge(old, add) { const all = [...old, ...add].sort((p, q) => p[0] - q[0]); const o = []; for (const x of all) { const l = o[o.length - 1]; if (l && x[0] <= l[1] + 0.05) l[1] = Math.max(l[1], x[1]); else o.push([...x]) } return o },
    query(items, a, b) {
      const r = items.filter((x) => x[1] > a && x[0] < b && x[1] - x[0] >= min - 1e-6).map((x) => [r2(Math.max(a, x[0])), r2(Math.min(b, x[1]))])
      return { n: r.length, r }
    },
  })
  return fin(out, rg)
}

export async function loud(mi, rg, top = 20, win = 2) {
  if (!(win > 0)) fail('--win must be > 0')
  if (!mi.audio) fail('no audio track')
  const sr = 16000
  const ai = await audioInput(mi)
  const out = await ranged({
    id: mi.id, kind: 'loud', args: `win=${win}`, a: rg.from, b: rg.to,
    align: (a, b) => [Math.floor(a / win + 1e-9) * win, Math.min(mi.dur, Math.ceil(b / win - 1e-9) * win)],
    async compute(a, b) {
      const r = await ff(['-ss', a, '-to', b, '-i', ai.path, '-vn', '-af', `asetnsamples=n=${Math.round(win * sr)}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:file=-`, '-f', 'null', '-'], { onProgress: (t) => pct(rg.from, rg.to)(a + t) })
      if (r.stopped === 'timeout') return { timeout: 1 }
      const rows = []; let t = null, peak = null, rms = null
      const flush = () => { if (t != null && peak != null) rows.push([r3(a + t), r2(peak), r2(rms ?? peak)]); peak = rms = null }
      for (const line of r.out.split('\n')) {
        let m
        if ((m = /pts_time:([\d.]+)/.exec(line))) { flush(); t = +m[1] }
        else if ((m = /Overall\.Peak_level=(-?[\d.]+|-inf)/.exec(line))) peak = m[1] === '-inf' ? -99 : +m[1]
        else if ((m = /Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(line))) rms = m[1] === '-inf' ? -99 : +m[1]
      }
      flush()
      const to = progressTo(r, a, b)
      return { items: rows.filter((x) => x[0] < to - win * 0.5 || !r.stopped), to: r.stopped ? Math.floor((to - a) / win) * win + a : b }
    },
    merge(old, add) { const m = new Map(old.map((x) => [x[0], x])); for (const x of add) m.set(x[0], x); return [...m.values()].sort((p, q) => p[0] - q[0]) },
    query(items, a, b) {
      const rows = items.filter((x) => x[0] >= a - win + 1e-6 && x[0] < b - 1e-6).sort((p, q) => q[2] - p[2]).slice(0, top)
      return { win, cols: 't,peak_db,rms_db', r: rows }
    },
  })
  return fin(out, rg)
}
const r3 = (x) => Math.round(x * 1000) / 1000

// ---------- frames / sheet ----------
export async function frames(mi, rg, { every, at }) {
  const dir = cacheDir(); const vi = videoInput(mi)
  let times
  if (at) { times = at; for (const t of at) if (t < 0 || t > mi.dur) fail(`time ${r2(t)} is outside the media (${r2(mi.dur)}s)`) }
  else { times = []; for (let t = rg.from; t < rg.to - 1e-6; t += every) times.push(t) }
  if (!times.length) fail('no frames requested')
  if (times.length > 200) fail(`${times.length} frames is too many (max 200); use a larger --every or a shorter range`)
  const items = times.map((t) => ({ t, f: path.join(dir, `fr-${mi.id}-${Math.round(t * 1000)}.jpg`) }))
  const todo = items.filter((x) => !fs.existsSync(x.f)); let i = 0
  const worker = async () => {
    while (i < todo.length && left() > 0) {
      const x = todo[i++]
      await ff(['-y', '-v', 'error', '-ss', x.t, '-i', vi.path, '-frames:v', '1', '-vf', "scale='min(320,iw)':-2", '-q:v', '4', x.f], { budget: false })
      clock.onPct?.((items.length - todo.length + i) / items.length, x.t)
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker))
  const have = items.filter((x) => fs.existsSync(x.f))
  enforceCache()
  const o = { ok: 1, f: have.map((x) => [r2(x.t), x.f]) }
  if (!todo.length) o.cached = 1; else if (todo.length < items.length) o.cached = 'part'
  if (have.length < items.length) { const nx = items.find((x) => !fs.existsSync(x.f)); o.partial = 1; o.done_to = r2(nx.t); if (rg.more) o.more = `--from ${r2(nx.t)} --to ${r2(rg.to)}` }
  else if (rg.more) o.more = rg.more
  return o
}

export async function sheet(mi, rg, cols = 6, n = 36) {
  if (!(cols >= 1 && n >= 1 && n <= 400)) fail('--cols and --n must be positive (n <= 400)')
  const f = path.join(cacheDir(), `sheet-${mi.id}-${cols}x${n}-${Math.round(rg.from * 10)}-${Math.round(rg.to * 10)}.jpg`)
  const o = { ok: 1, f, cols, n, from: r2(rg.from), to: r2(rg.to) }
  if (rg.more) o.more = rg.more
  if (fs.existsSync(f)) return { ...o, cached: 1 }
  const vi = videoInput(mi)
  const fd = fontDir().replace(/:/g, '\\:')
  const step = (rg.to - rg.from) / n, rows = Math.ceil(n / cols)
  const dt = `drawtext=fontfile='${fd}/arial.ttf':text='%{pts\\:gmtime\\:${r3(rg.from)}\\:%M\\\\\\:%S}':x=4:y=4:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6`
  const part = f + '.part.jpg'
  const r = await ff(['-y', '-v', 'error', ...(vi.proxy ? [] : ['-skip_frame', 'nokey']), '-ss', rg.from, '-to', rg.to, '-i', vi.path, '-an', '-vf', `fps=1/${step.toFixed(4)},scale=240:-2,${dt},tile=${cols}x${rows}`, '-frames:v', '1', '-q:v', '4', part])
  if (r.stopped) { fs.rmSync(part, { force: true }); throw Object.assign(new Err(`timeout after ${clock.budget}s`), {}) }
  if (!fs.existsSync(part)) fail('no sheet rendered')
  fs.renameSync(part, f); enforceCache()
  return o
}

// ---------- scan: one ffmpeg pass over video keyframes + audio ----------
export async function scan(mi) {
  const hit = C.load(mi.id, 'scan'); if (hit.scan) { videoInput(mi); return { ...hit.scan, cached: 1 } }
  startProxy(mi)
  const bin = mi.dur <= 600 ? 10 : Math.ceil(mi.dur / 60 / 10) * 10
  const w = C.wavPath(mi.id), part = w + '.part.wav'; const mkWav = mi.audio && !fs.existsSync(w)
  slowFs(mi)
  const fc = [`[0:v]scale=160:-2,select='gt(scene,0.3)+eq(n,0)',showinfo[v]`]
  if (mi.audio) fc.push(`[0:a]aresample=8000,asplit=2[a1][a2]`, `[a1]silencedetect=noise=-35dB:d=3[s]`, `[a2]asetnsamples=n=${bin * 8000}:p=0,astats=metadata=1:reset=1,ametadata=mode=print:file=-[l]`)
  const args = ['-skip_frame', 'nokey', '-i', mi.file, '-filter_complex', fc.join(';'), '-map', '[v]', '-f', 'null', '-']
  if (mi.audio) args.push('-map', '[s]', '-f', 'null', '-', '-map', '[l]', '-f', 'null', '-')
  if (mkWav) args.push('-map', '0:a', '-af', MONO, '-c:a', 'pcm_s16le', part)
  const r = await ff(args, { onProgress: (t) => clock.onPct?.(t / mi.dur, t) })
  if (r.stopped === 'timeout') { fs.rmSync(part, { force: true }); throw new Err(`timeout after ${clock.budget}s`) }
  if (mkWav) { if (r.stopped) fs.rmSync(part, { force: true }); else if (fs.existsSync(part)) fs.renameSync(part, w) }
  const to = r.stopped ? Math.min(mi.dur, r.t) : mi.dur
  const cand = []
  for (const m of r.err.matchAll(/showinfo.*? n:\s*(\d+) .*?pts_time:([\d.]+)/g)) { if (m[1] === '0') continue; const v = r2(+m[2]); if (v <= to + 1e-6 && (!cand.length || cand[cand.length - 1] !== v)) cand.push(v) }
  const sil = []; let s = null
  for (const m of r.err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) { if (m[1] === 'start') s = Math.max(0, +m[2]); else if (s != null) { sil.push([r2(s), r2(+m[2])]); s = null } }
  if (s != null) sil.push([r2(s), r2(to)])
  const bins = []; let t = null, rms = null
  for (const line of r.out.split('\n')) {
    let m
    if ((m = /pts_time:([\d.]+)/.exec(line))) t = +m[1]
    else if ((m = /Overall\.RMS_level=(-?[\d.]+|-inf)/.exec(line)) && t != null) bins.push([Math.round(t), m[1] === '-inf' ? -99 : r2(+m[1])])
  }
  void rms
  const zoom = []
  const loudest = [...bins].sort((p, q) => q[1] - p[1])[0]
  if (loudest) zoom.push(`loud <m> --from ${Math.max(0, loudest[0] - 10)} --to ${loudest[0] + bin + 10}`, `transcript <m> --from ${loudest[0]} --to ${loudest[0] + 60}`)
  for (const c of cand.slice(0, 3)) zoom.push(`scenes <m> --from ${Math.max(0, Math.floor(c - 10))} --to ${Math.ceil(c + 1)}`)
  if (sil.length) zoom.push(`silence <m> --from ${Math.floor(sil[0][0] - 5)} --to ${Math.ceil(sil[0][1] + 5)}`)
  const o = { ok: 1, dur: r2(mi.dur), w: mi.w, h: mi.h, fps: r2(mi.fps), mb: Math.round(mi.size / 1e5) / 10, audio: mi.audio ? 1 : 0, cand, kf: 'candidates are keyframes, +-8s of the cut', bin, bins, silence: sil, zoom }
  if (r.stopped) { o.partial = 1; o.done_to = r2(to) } else C.store(mi.id, 'scan', '', { cov: [], items: [], scan: o })
  return o
}

// ---------- transcript ----------
const toWin = (p) => { if (!isWsl) return p; const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p); if (m) return toStored(p); const r = spawnSync('wslpath', ['-w', p], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : p }
const tsec = (s) => s.split(':').reduce((a, x) => a * 60 + parseFloat(x), 0)
const SEG = /\[\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*-->\s*((?:\d+:)?\d+:\d+(?:[.,]\d+)?)\s*\]\s*(.*)$/

export async function transcript(mi, rg) {
  const w = process.env.OVE_WHISPER
  if (!w) fail('set OVE_WHISPER to a whisper CLI')
  if (!mi.audio) fail('no audio track')
  const ai = await audioInput(mi)
  const parts = w.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ''))
  const exe = isWsl && /^[A-Za-z]:[\\/]/.test(parts[0]) ? toLocal(parts[0]) : parts[0]
  const winExe = isWsl && /\.exe$/i.test(exe)
  let warn
  const out = await ranged({
    id: mi.id, kind: 'transcript', args: `w=${w}`, a: rg.from, b: rg.to,
    async compute(a, b) {
      const tmp = path.join(cacheDir(), `seg-${process.pid}-${Date.now()}.wav`)
      try {
        const src = ai.path
        await ff(['-y', '-ss', a, '-to', b, '-i', src, '-vn', '-c:a', 'pcm_s16le', tmp])
        const wavArg = winExe ? toWin(tmp) : tmp
        const args = parts.slice(1).map((x) => x.replace('{wav}', wavArg))
        if (!parts.slice(1).some((x) => x.includes('{wav}'))) args.push(wavArg)
        debug(exe, args.join(' '))
        const items = []; let to = a, stopped = false, buf = '', errTxt = ''
        await new Promise((res, rej) => {
          const c = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          let fin = false
          const end = (e) => { if (fin) return; fin = true; clearInterval(iv); c.stdout.destroy(); c.stderr.destroy(); e ? rej(e) : res() }
          const eat = (flush) => {
            const lines = buf.split(/\r?\n/); buf = flush ? '' : lines.pop()
            for (const line of lines) {
              const m = SEG.exec(line); if (!m) continue
              const s = tsec(m[1].replace(',', '.')), e = tsec(m[2].replace(',', '.'))
              if (m[3].trim()) { items.push({ t: r2(a + s), d: r2(e - s), text: m[3].trim() }); to = Math.max(to, a + e); clock.onPct?.((to - rg.from) / (rg.to - rg.from), to) }
            }
          }
          c.stdout.on('data', (d) => { buf += d; eat(false) })
          c.stderr.on('data', (d) => (errTxt = (errTxt + d).slice(-4000)))
          c.on('error', (e) => end(new Err(`OVE_WHISPER failed: ${e.message}`)))
          c.on('exit', (code) => setTimeout(() => { eat(true); if (stopped || code === 0) end(); else end(new Err(`OVE_WHISPER failed: ${errTxt.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`)) }, 150))
          const iv = setInterval(() => {
            if (stopped) return
            const over = clock.start + clock.budget * 1000, now = Date.now()
            if ((now > over && items.length) || now > over + 2 * clock.budget * 1000) { stopped = items.length ? 'budget' : 'timeout'; c.kill(); setTimeout(() => end(), 1500) }
          }, 100)
        })
        if (/OVE_DEVICE=cpu/.test(errTxt)) warn = 'cpu'
        if (stopped === 'timeout') return { timeout: 1 }
        if (!stopped && !items.length && !to) fail('whisper printed no "[start --> end] text" lines')
        return { items, to: stopped ? to : b }
      } finally { fs.rmSync(tmp, { force: true }) }
    },
    merge(old, add, x) { const keep = old.filter((s) => !add.some((n) => n.t === s.t && n.text === s.text)); void x; return [...keep, ...add].sort((p, q) => p.t - q.t) },
    query(items, a, b) { const seg = items.filter((s) => s.t + s.d > a && s.t < b); return { n: seg.length, seg } },
  })
  if (warn) out.warn = warn
  return fin(out, rg)
}
export { parseTime, num, toLocal, os }
