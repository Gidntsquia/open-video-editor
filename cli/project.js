// Pure project model + edit ops, mirroring src/store.ts (addFromMedia, split, remove, rippleTrim, setSpeed, addTransition, overwrite).
import fs from 'node:fs'
import { sequenceEnd, typeFromName, TRANSITION_NAMES } from '../shared/math.js'
import * as E from '../shared/edit.js'
import { Err, fail, toLocal, r2, r3 } from './util.js'

export const TRACKS = [
  { id: 'V1', kind: 'video', name: 'V1' }, { id: 'V2', kind: 'video', name: 'V2' }, { id: 'V3', kind: 'video', name: 'V3' },
  { id: 'A1', kind: 'audio', name: 'A1' }, { id: 'A2', kind: 'audio', name: 'A2' }, { id: 'A3', kind: 'audio', name: 'A3' },
]
const EPS = 1e-4

export const newProject = (width = 1920, height = 1080, fps = 30) => ({ version: 1, width, height, fps, media: {}, tracks: structuredClone(TRACKS), clips: [] })

export function loadProject(text, file) {
  let d
  try { d = JSON.parse(text) } catch { fail(`${file} is not valid JSON`) }
  if (!d || typeof d !== 'object' || !Array.isArray(d.clips) || typeof d.media !== 'object' || !d.width || !d.height || !d.fps) fail(`${file} is not an .ovep project`)
  return { version: 1, width: d.width, height: d.height, fps: d.fps, media: d.media || {}, tracks: d.tracks || structuredClone(TRACKS), clips: E.migrateClips(d.clips) }
}
export const serialize = (p) => JSON.stringify({ version: 1, width: p.width, height: p.height, fps: p.fps, media: p.media, tracks: p.tracks, clips: p.clips }, null, 1)

export function nid(p, prefix) {
  const used = new Set([...Object.keys(p.media), ...p.clips.map((c) => c.id), ...p.clips.map((c) => c.link).filter(Boolean)])
  let n = 1; for (const k of used) { const m = new RegExp(`^${prefix}(\\d+)$`).exec(k); if (m) n = Math.max(n, +m[1] + 1) }
  while (used.has(prefix + n)) n++
  return prefix + n
}

export const blank = (o) => ({
  id: '', kind: 'video', trackId: 'V1', start: 0, in: 0, dur: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0,
  transition: 0, transOut: 0, brightness: 1, contrast: 1, saturation: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, ...o,
})

export const find = (p, id) => p.clips.find((c) => c.id === id) || fail(`unknown clip ${id}`)
export const trackOf = (p, id) => p.tracks.find((t) => t.id === id)
export function group(p, ids) {
  const links = new Set(p.clips.filter((c) => ids.includes(c.id)).map((c) => c.link).filter(Boolean))
  return p.clips.filter((c) => ids.includes(c.id) || (c.link && links.has(c.link))).map((c) => c.id)
}
export const parseIds = (p, list) => {
  const ids = list.flatMap((s) => String(s).split(',')).filter(Boolean)
  if (!ids.length) fail('need at least one clip id')
  ids.forEach((i) => find(p, i))
  return ids
}

// Clips in `ids` win; same-track clips they cover are trimmed or split.
export function overwrite(p, ids) {
  const mv = new Set(ids); const links = new Map(); const out = []
  for (const c of p.clips) {
    if (mv.has(c.id)) { out.push(c); continue }
    const over = p.clips.filter((m) => mv.has(m.id) && m.trackId === c.trackId && m.start < c.start + c.dur - EPS && m.start + m.dur > c.start + EPS)
    if (!over.length) { out.push(c); continue }
    const cov = over.map((m) => [m.start, m.start + m.dur]).sort((a, b) => a[0] - b[0])
    let pos = c.start; const end = c.start + c.dur; const pieces = []
    for (const [a, b] of cov) { if (a > pos + EPS) pieces.push([pos, Math.min(a, end)]); pos = Math.max(pos, b) }
    if (pos < end - EPS) pieces.push([pos, end])
    pieces.forEach(([a, b], i) => {
      if (b - a < EPS) return
      let link = c.link
      if (c.link && i > 0) { if (!links.has(c.link + i)) links.set(c.link + i, nid({ ...p, clips: [...p.clips, ...out] }, 'l')); link = links.get(c.link + i) }
      const cut = a - c.start
      out.push({ ...structuredClone(c), id: i === 0 ? c.id : nid({ ...p, clips: [...p.clips, ...out] }, 'c'), link, start: a, in: c.in + cut * c.speed, dur: b - a,
        keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })), fadeIn: a > c.start + EPS ? 0 : c.fadeIn, fadeOut: b < end - EPS ? 0 : c.fadeOut })
      const n = out[out.length - 1]
      if (a > c.start + EPS) E.clearIn(n)
      if (b < end - EPS) E.clearOut(n)
    })
  }
  p.clips = out
}

export function addFromMedia(p, mediaId, trackId, start, inSrc, dur, sizeLocked) {
  const m = p.media[mediaId] || fail(`unknown media ${mediaId}`)
  const tr = trackOf(p, trackId) || fail(`unknown track ${trackId}`)
  if (!(start >= 0)) fail('start must be >= 0')
  if (!(inSrc >= 0) || inSrc >= m.dur) fail(`in=${r2(inSrc)} is outside the media (${r2(m.dur)}s)`)
  if (dur == null) dur = m.dur - inSrc
  if (!(dur > 0)) fail('dur must be > 0')
  if (inSrc + dur > m.dur + 1e-3) fail(`in+dur=${r2(inSrc + dur)} runs past the media end (${r2(m.dur)}s)`)
  if (!p.clips.length && !sizeLocked) {
    const f = m.fps > 50 ? 60 : m.fps > 27 ? 30 : m.fps > 24.5 ? 25 : 24
    p.width = m.w >= 1900 ? 1920 : m.w >= 1200 ? 1280 : m.w; p.height = m.w >= 1900 ? 1080 : m.w >= 1200 ? 720 : m.h; p.fps = f
  }
  const out = []; const mk = (o) => { const c = blank({ ...o, id: nid({ ...p, clips: [...p.clips, ...out] }, 'c') }); out.push(c); return c }
  const link = m.hasAudio ? nid(p, 'l') : undefined
  if (tr.kind === 'video') {
    mk({ kind: 'video', trackId: tr.id, mediaId, start, in: inSrc, dur, link })
    if (m.hasAudio) mk({ kind: 'audio', trackId: 'A' + tr.id.slice(1), mediaId, start, in: inSrc, dur, link })
  } else if (m.hasAudio) mk({ kind: 'audio', trackId: tr.id, mediaId, start, in: inSrc, dur })
  else fail('media has no audio')
  for (const c of out) if (!trackOf(p, c.trackId)) fail(`unknown track ${c.trackId}`)
  p.clips.push(...out)
  overwrite(p, out.map((c) => c.id))
  return out.map((c) => c.id)
}

export function split(p, t, ids) {
  const eps = 1 / p.fps / 2
  const sel = ids ?? p.clips.filter((c) => t > c.start + eps && t < c.start + c.dur - eps).map((c) => c.id)
  const grp = new Set(group(p, sel))
  const hits = p.clips.filter((c) => grp.has(c.id) && t > c.start + eps && t < c.start + c.dur - eps)
  if (!hits.length) fail(`nothing to cut at ${r2(t)}`)
  const links = new Map(); const add = []; const changed = new Map()
  for (const c of hits) {
    const cut = t - c.start
    let nl; if (c.link) { if (!links.has(c.link)) links.set(c.link, nid({ ...p, clips: [...p.clips, ...add] }, 'l')); nl = links.get(c.link) }
    add.push({ ...structuredClone(c), id: nid({ ...p, clips: [...p.clips, ...add] }, 'c'), link: nl, start: t, in: c.in + cut * c.speed, dur: c.dur - cut,
      fadeIn: 0, keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })) })
    E.clearIn(add[add.length - 1])
    changed.set(c.id, E.clearOut({ ...c, dur: cut, fadeOut: 0 }))
  }
  p.clips = [...p.clips.map((c) => changed.get(c.id) || c), ...add]
  return add.map((c) => c.id)
}

// ripple: merge the removed ranges, then move each later clip up by the removed length that lies before it (several separate ids stay in sync)
function rippleShift(del) {
  const iv = del.map((c) => [c.start, c.start + c.dur]).sort((a, b) => a[0] - b[0]); const m = []
  for (const r of iv) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], r[1]); else m.push([...r]) }
  return (t) => m.reduce((s, [a, b]) => (b <= t + 1e-6 ? s + (b - a) : s), 0)
}
export function remove(p, ids, ripple) {
  const grp = new Set(group(p, ids)); const del = p.clips.filter((c) => grp.has(c.id))
  const trs = new Set(del.map((c) => c.trackId)); const sh = rippleShift(del)
  p.clips = p.clips.filter((c) => !grp.has(c.id)).map((c) => { const d = ripple && trs.has(c.trackId) ? sh(c.start) : 0; return d ? { ...c, start: c.start - d } : c })
  return del.length
}

export function setSpeed(p, ids, speed) {
  if (!(speed > 0)) fail('speed must be > 0')
  const grp = new Set(group(p, ids)); let sp = speed
  for (const c of p.clips) if (grp.has(c.id)) {
    const nx = p.clips.filter((x) => x.trackId === c.trackId && !grp.has(x.id) && x.start >= c.start + c.dur - 1e-6).sort((a, b) => a.start - b.start)[0]
    if (nx) sp = Math.max(sp, (c.dur * c.speed) / (nx.start - c.start))
  }
  for (const c of p.clips) if (grp.has(c.id) && c.kind !== 'title') {
    c.keys = c.keys.map((k) => ({ t: (k.t * c.speed) / sp, v: k.v })); c.dur = (c.dur * c.speed) / sp; c.speed = sp
  }
  return sp
}

/** edgeSpec: <clipId>:in|out or <clipA>/<clipB> -> {a,b} */
export function parseEdge(p, spec) {
  const m = /^(\w+):(in|out)$/.exec(spec)
  if (m) { find(p, m[1]); return E.edgeOf(p.clips, m[1], m[2] === 'in' ? 'l' : 'r') }
  const q = /^(\w+)\/(\w+)$/.exec(spec)
  if (q) { find(p, q[1]); find(p, q[2]); return { a: q[1], b: q[2] } }
  fail('edge must be <clipId>:in|out or <clipA>/<clipB>')
}

export function setTransition(p, edgeSpec, o = {}) {
  const edge = parseEdge(p, edgeSpec)
  let type = 'crossdissolve'
  if (o.type != null) { type = typeFromName(o.type); if (!type) fail(`unknown transition type "${o.type}"; one of ${Object.keys(TRANSITION_NAMES).join(", ")}`) }
  const dur = o.dur ?? 1; if (!(dur > 0)) fail('dur must be > 0')
  if (o.align != null && !(o.align in E.ALIGN)) fail('align must be centre|start|end')
  const r = E.applyEdge(p.clips, p.media, p.fps, edge, { type, dur, align: o.align ?? 'centre', alsoAudio: o.audio ?? true, audioType: o.audioType })
  if (r.error) fail(r.error)
  p.clips = r.clips
  return { dur: r.dur, req: r.req, short: r.short, type }
}
export function removeTransition(p, edgeSpec) {
  const edge = parseEdge(p, edgeSpec)
  if (!E.edgeInfo(p.clips, edge)) fail('no transition at that edge')
  p.clips = E.removeEdge(p.clips, edge)
}
export function addTransition(p, id, d) { return setTransition(p, `${id}:in`, { dur: d, type: 'crossdissolve', align: 'start' }) }

/** Reject anything the app could not load or export. Runs on the modified copy before it replaces the project. */
export function validate(p) {
  const tids = new Set(p.tracks.map((t) => t.id)); const seen = new Set()
  for (const c of p.clips) {
    if (seen.has(c.id)) fail(`duplicate clip id ${c.id}`); seen.add(c.id)
    if (!tids.has(c.trackId)) fail(`clip ${c.id}: unknown track ${c.trackId}`)
    for (const k of ['start', 'in', 'dur', 'speed', 'volume', 'fadeIn', 'fadeOut', 'transition', 'transOut', 'brightness', 'contrast', 'saturation', 'scale', 'posX', 'posY'])
      if (!Number.isFinite(c[k])) fail(`clip ${c.id}: ${k} is not a number`)
    if (c.start < -EPS || c.in < -EPS) fail(`clip ${c.id}: negative start/in`)
    if (!(c.dur > 0) || !(c.speed > 0)) fail(`clip ${c.id}: dur and speed must be > 0`)
    if (c.kind !== 'title') {
      const m = p.media[c.mediaId] || fail(`clip ${c.id}: unknown media ${c.mediaId}`)
      if (c.in + c.dur * c.speed > m.dur + 1e-3) fail(`clip ${c.id}: reads to ${r2(c.in + c.dur * c.speed)}s past the media end (${r2(m.dur)}s)`)
    }
  }
}

const f2 = (x) => String(r2(x))
export function showLines(p, withMedia) {
  const end = sequenceEnd(p.clips)
  const ti = new Map(p.tracks.map((t, i) => [t.id, i]))
  const out = [`# ${p.width}x${p.height} ${+p.fps.toFixed(3)}fps ${f2(end)}s ${p.clips.length} clips`]
  if (withMedia) for (const m of Object.values(p.media)) out.push(`${m.id} ${m.name} ${f2(m.dur)}s ${m.w}x${m.h} ${+m.fps.toFixed(2)}fps ${m.hasAudio ? 'audio' : 'mute'}`)
  const cs = [...p.clips].sort((a, b) => (ti.get(a.trackId) ?? 99) - (ti.get(b.trackId) ?? 99) || a.start - b.start || a.id.localeCompare(b.id))
  for (const c of cs) {
    const tr = trackOf(p, c.trackId)
    const fx = []
    if (c.fadeIn) fx.push(`fi=${f2(c.fadeIn)}`); if (c.fadeOut) fx.push(`fo=${f2(c.fadeOut)}`)
    if (c.transition) fx.push(`${c.transType || 'crossdissolve'}=${f2(c.transition)}`)
    if (c.brightness !== 1) fx.push(`bri=${r2(c.brightness)}`); if (c.contrast !== 1) fx.push(`con=${r2(c.contrast)}`); if (c.saturation !== 1) fx.push(`sat=${r2(c.saturation)}`)
    const cr = c.crop; if (cr && (cr.l || cr.r || cr.t || cr.b)) fx.push(`crop=${r2(cr.l)},${r2(cr.r)},${r2(cr.t)},${r2(cr.b)}`)
    if (c.scale !== 1) fx.push(`sc=${r2(c.scale)}`); if (c.posX || c.posY) fx.push(`pos=${Math.round(c.posX)},${Math.round(c.posY)}`)
    if (c.keys.length) fx.push(`keys=${c.keys.length}`); if (c.link) fx.push(`l=${c.link}`)
    if (tr && (tr.muted || tr.hidden)) fx.push(tr.muted ? 'MUTED' : 'HIDDEN')
    const head = `${c.id} ${c.trackId} ${f2(c.start)}-${f2(c.start + c.dur)}`
    if (c.kind === 'title') out.push(`${head} T${JSON.stringify(c.text || '')} ${c.font || 'Arial'}/${c.size || 96} ${c.color || '#ffffff'} @${r2(c.x ?? 0.5)},${r2(c.y ?? 0.5)}${fx.length ? ' ' + fx.join(' ') : ''}`)
    else out.push(`${head} ${c.mediaId}[${f2(c.in)}-${f2(c.in + c.dur * c.speed)}] x${r3(c.speed)} vol${r2(c.volume)}${fx.length ? ' ' + fx.join(' ') : ''}`)
  }
  return out
}

export function mediaPath(p, id) { const m = p.media[id] || fail(`unknown media ${id}`); return toLocal(m.path) }
export { Err }
