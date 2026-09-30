// Self-check: composed frames, 480p preview and lint, all through buildExport (the app's own ffmpeg graph).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { buildExport } from '../electron/exporter.js'
import { sequenceEnd } from '../shared/math.js'
import { bin, exec, fail, cacheDir, tmpDir, enforceCache, fontDir, toLocal, r2 } from './util.js'

function localProject(p) {
  const q = structuredClone(p)
  for (const m of Object.values(q.media)) m.path = toLocal(m.path)
  return q
}
function needsMedia(p) {
  for (const m of Object.values(p.media)) if (!fs.existsSync(m.path)) fail(`missing media file ${m.path}`)
}

async function runBuild(project, out, opts) {
  const dir = tmpDir(); const scriptPath = path.join(dir, 'filter.txt')
  try {
    const b = buildExport(project, out, { fontDir: fontDir(), tmpDir: dir, scriptPath, ...opts })
    fs.writeFileSync(scriptPath, b.script)
    for (const t of b.textFiles) fs.writeFileSync(t.path, t.text, 'utf8')
    await exec(bin().ffmpeg, b.args)
    return b
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

export async function frame(p, times) {
  if (!p.clips.length) fail('timeline is empty')
  const q = localProject(p); needsMedia(q)
  const end = sequenceEnd(q.clips); const out = []
  const k = crypto.createHash('sha1').update(JSON.stringify(p)).digest('hex').slice(0, 8)
  for (const t of times) {
    if (!(t >= 0) || t >= end) fail(`time ${r2(t)} is outside the timeline (0-${r2(end)}s)`)
    const f = path.join(cacheDir(), `tl-${k}-${Math.round(t * 1000)}.png`)
    await runBuild(q, f, { frameAt: t })
    if (!fs.existsSync(f)) fail(`no frame rendered at ${r2(t)}`)
    out.push([r2(t), f])
  }
  enforceCache()
  return { ok: 1, f: out }
}

export async function preview(p, outPath) {
  if (!p.clips.length) fail('timeline is empty')
  const q = localProject(p); needsMedia(q)
  const H = 480, f = H / q.height
  q.width = 2 * Math.round((q.width * f) / 2); q.height = H
  for (const c of q.clips) { c.posX *= f; c.posY *= f; if (c.kind === 'title') c.size = (c.size || 64) * f }
  const out = outPath || path.join(cacheDir(), 'preview.mp4')
  const tmp = out + '.part.mp4'
  const encArgs = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28']
  let b
  try { b = await runBuild(q, tmp, { encArgs }); fs.renameSync(tmp, out) } catch (e) { fs.rmSync(tmp, { force: true }); throw e }
  enforceCache()
  return { ok: 1, f: out, dur: r2(b.total), w: q.width, h: q.height }
}

export function check(p) {
  const f = []; const fr = 1 / p.fps
  if (!p.clips.length) return [{ w: 'empty', msg: 'no clips' }]
  for (const t of p.tracks) {
    const cs = p.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start)
    if (cs.length && (t.muted || t.hidden)) f.push({ w: t.muted ? 'muted' : 'hidden', track: t.id, n: cs.length })
    if (t.id === 'V1' && cs.length && cs[0].start > fr) f.push({ w: 'gap', track: t.id, t: [0, r2(cs[0].start)] })
    for (let i = 1; i < cs.length; i++) {
      const a = cs[i - 1], b = cs[i]; const ae = a.start + a.dur
      if (b.start > ae + fr) f.push({ w: 'gap', track: t.id, t: [r2(ae), r2(b.start)] })
      else if (b.start < ae - Math.max(fr, b.transition || 0) - 1e-3) f.push({ w: 'overlap', track: t.id, ids: [a.id, b.id], t: [r2(b.start), r2(Math.min(ae, b.start + b.dur))] })
    }
  }
  for (const c of p.clips) {
    if (c.kind === 'title') continue
    const m = p.media[c.mediaId]
    if (!m) { f.push({ w: 'nomedia', id: c.id }); continue }
    const over = c.in + c.dur * c.speed - m.dur
    if (over > fr) f.push({ w: 'pastend', id: c.id, by: r2(over) })
    if (c.kind === 'audio' && !m.hasAudio) f.push({ w: 'noaudio', id: c.id })
  }
  for (const m of Object.values(p.media)) if (!fs.existsSync(toLocal(m.path))) f.push({ w: 'missing', media: m.id, path: m.path })
  return f
}
