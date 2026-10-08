// Segmented, budgeted export shared by the app (electron/main.js) and `ove preview`.
// Video is rendered in short windows (inputs are opened only for clips inside the window), audio in one pass,
// then the window files are concatenated with stream copy and muxed with the audio. No re-encode at the joins.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { buildExport } from './exporter.js'

export const BUDGETS = ['fast', 'balanced', 'background']
export function budgetPlan(budget) {
  const cores = os.cpus().length || 4
  if (budget === 'fast') return { threads: cores, prio: os.constants.priority.PRIORITY_NORMAL }
  if (budget === 'background') return { threads: Math.max(1, Math.floor(cores / 2)), prio: os.constants.priority.PRIORITY_LOW }
  return { threads: Math.max(1, cores - 2), prio: os.constants.priority.PRIORITY_BELOW_NORMAL }
}

let nvencCache = new Map()
export function hasNvenc(ffmpeg) {
  if (!nvencCache.has(ffmpeg)) {
    const t = spawnSync(ffmpeg, ['-hide_banner', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { windowsHide: true })
    nvencCache.set(ffmpeg, t.status === 0)
  }
  return nvencCache.get(ffmpeg)
}

const stamp = () => { const d = new Date(), p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }
const SEG = 8 // seconds per window (rounded to whole frames)

/**
 * opts: {ffmpeg, cacheDir, fontDir, budget, encoder:'auto'|'gpu'|'cpu', encArgs (overrides encoder), onProgress(0..1), ctl:{cancelled,proc}}
 * Returns {out,total,encoder,log}. Throws Error (message = stderr tail + log path); err.cancelled on cancel.
 */
export async function runExport(project, out, opts) {
  const { ffmpeg, cacheDir } = opts
  const bp = budgetPlan(opts.budget || 'balanced')
  const ctl = opts.ctl || {}
  const nv = opts.encArgs ? false : opts.encoder === 'gpu' ? true : opts.encoder === 'cpu' ? false : hasNvenc(ffmpeg)
  if (!opts.encArgs && opts.encoder === 'gpu' && !hasNvenc(ffmpeg)) throw new Error('GPU encoder (h264_nvenc) is not available in this ffmpeg or on this machine. Choose Auto or CPU (libx264).')
  const encName = opts.encArgs ? opts.encArgs[1] : nv ? 'h264_nvenc' : 'libx264'
  opts.onInfo?.({ encoder: encName })
  const encArgs = opts.encArgs || (nv ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', String(bp.threads)])
  const threads = ['-threads', String(bp.threads), '-filter_threads', String(bp.threads), '-filter_complex_threads', String(bp.threads)]
  fs.mkdirSync(cacheDir, { recursive: true })
  const dir = fs.mkdtempSync(path.join(cacheDir, 'export-'))
  const logPath = path.join(cacheDir, `export-${stamp()}.log`)
  let log = ''
  const part = out + '.part.mp4'
  const cleanup = () => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(part, { force: true }) }
  const fps = project.fps
  const fullTotal = buildExport(project, 'x', { fontDir: opts.fontDir }).total
  const frames = Math.max(1, Math.round(fullTotal * fps))
  const per = Math.max(1, Math.round(SEG * fps))
  const wins = []
  for (let f = 0; f < frames; f += per) wins.push({ t0: f / fps, t1: Math.min(frames, f + per) / fps })
  const weights = [0.1, ...wins.map((w) => (w.t1 - w.t0) / fullTotal * 0.85), 0.05] // audio, windows, mux
  let doneW = 0
  const report = (i, frac) => opts.onProgress?.(Math.min(1, weights.slice(0, i).reduce((a, b) => a + b, 0) + weights[i] * frac))

  const runFf = (args, step, i, span) => new Promise((resolve, reject) => {
    if (ctl.cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }))
    log += `\n=== ${step}\n${ffmpeg} ${args.join(' ')}\n`
    const c = spawn(ffmpeg, args, { windowsHide: true })
    ctl.proc = c
    try { os.setPriority(c.pid, bp.prio) } catch {}
    let buf = '', err = '', last = 0, lastAt = Date.now()
    // ffmpeg is silent while it opens inputs; creep progress so it still moves at least every ~1 s
    const beat = setInterval(() => {
      if (span && Date.now() - lastAt > 900) { last = Math.min(0.95, last + 0.003); lastAt = Date.now(); report(i, last) }
    }, 1000)
    c.stdout.on('data', (d) => {
      buf = (buf + d).slice(-4000)
      const m = [...buf.matchAll(/out_time_us=(\d+)/g)].pop()
      if (m && span) { const f = Math.min(1, Number(m[1]) / 1e6 / span); if (f > last) { last = f; lastAt = Date.now(); report(i, f) } }
    })
    c.stderr.on('data', (d) => { err += d; if (err.length > 4e6) err = err.slice(-2e6) })
    c.on('error', (x) => { clearInterval(beat); log += `spawn error: ${x.message}\n`; reject(x) })
    c.on('close', (code) => {
      clearInterval(beat)
      ctl.proc = null
      log += err
      if (ctl.cancelled) return reject(Object.assign(new Error('Cancelled'), { cancelled: true }))
      if (code === 0) return resolve()
      reject(Object.assign(new Error(`ffmpeg exited with code ${code} (${step})`), { tail: err.trim().split('\n').slice(-30).join('\n') }))
    })
  })
  const build = (name, o) => {
    const scriptPath = path.join(dir, `${name}.txt`)
    const b = buildExport(project, o.out, { fontDir: opts.fontDir, tmpDir: dir, scriptPath, threads, ...o.opts })
    fs.writeFileSync(scriptPath, b.script)
    for (const t of b.textFiles) fs.writeFileSync(t.path, t.text, 'utf8')
    log += `\n--- filter script ${name}\n${b.script}\n`
    return b
  }
  try {
    const aOut = path.join(dir, 'audio.m4a')
    const ab = build('audio', { out: aOut, opts: { audioOnly: true } })
    await runFf(ab.args, 'audio', 0, fullTotal)
    const list = []
    for (let i = 0; i < wins.length; i++) {
      const f = path.join(dir, `seg${i}.mp4`)
      const b = build(`seg${i}`, { out: f, opts: { videoOnly: true, window: wins[i], encArgs } })
      await runFf(b.args, `video ${i + 1}/${wins.length}`, i + 1, wins[i].t1 - wins[i].t0)
      list.push(`file '${f.replace(/\\/g, '/')}'`)
    }
    const lp = path.join(dir, 'list.txt')
    fs.writeFileSync(lp, list.join('\n'))
    await runFf(['-y', '-hide_banner', '-nostats', '-f', 'concat', '-safe', '0', '-i', lp, '-i', aOut, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', '-t', String(fullTotal), part], 'mux', wins.length + 1, 0)
    fs.renameSync(part, out)
    opts.onProgress?.(1)
    cleanup()
    return { out, total: fullTotal, encoder: encName }
  } catch (e) {
    cleanup()
    if (e.cancelled) throw e
    try { fs.writeFileSync(logPath, log) } catch {}
    e.log = logPath
    e.message = `${e.message}\n${e.tail || ''}\n\nFull log: ${logPath}`
    throw e
  }
}
