// Pure edit operations shared by the app store (src/store.ts) and the ove CLI (cli/project.js).
// Every function takes the clip array (+ media map) and returns a NEW clip array; inputs are never mutated.
import { isAudioType, isVideoType, audioType } from './math.js'

const EPS = 1e-4
const fr = (t, fps) => Math.round(t * fps) / fps
export const ALIGN = { centre: 0.5, center: 0.5, start: 0, end: 1 }

export function groupIds(clips, ids) {
  const links = new Set(clips.filter((c) => ids.includes(c.id)).map((c) => c.link).filter(Boolean))
  return clips.filter((c) => ids.includes(c.id) || (c.link && links.has(c.link))).map((c) => c.id)
}

/** Spare media (timeline seconds) before the in point and after the out point. Titles have none. */
export function handlesOf(c, media) {
  if (c.kind === 'title' || !c.mediaId) return { head: 0, tail: 0 }
  const m = media[c.mediaId]; if (!m) return { head: 0, tail: 0 }
  return { head: Math.max(0, c.in / c.speed), tail: Math.max(0, (m.dur - (c.in + c.dur * c.speed)) / c.speed) }
}

/** Existing transition between a (outgoing) and b (incoming)? */
export const hasPair = (a, b) => !!(a && b && b.transition > 0 && !b.transSolo && a.transOut > 0 && Math.abs(a.start + a.dur - (b.start + b.transition)) < 0.03)

/** Cut time of the edit point between a and b (the original boundary, even when a transition overlaps). */
export const cutOf = (a, b) => (b.transition > 0 && !b.transSolo ? b.start + (b.transExtCur ?? 0) : a ? a.start + a.dur - (hasPair(a, b) ? a.transExtPrev ?? b.transExtPrev ?? 0 : 0) : b.start)

/** Edit points of a track list: {a,b} pairs that touch (or overlap through a transition), plus solo edges. */
export function editPoints(clips) {
  const out = []
  const tracks = [...new Set(clips.map((c) => c.trackId))]
  for (const tid of tracks) {
    const lane = clips.filter((c) => c.trackId === tid).sort((x, y) => x.start - y.start)
    for (let i = 0; i < lane.length; i++) {
      const b = lane[i], a = lane[i - 1]
      if (a && (Math.abs(a.start + a.dur - b.start) < 0.03 || hasPair(a, b))) out.push({ trackId: tid, a: a.id, b: b.id, t: cutOf(a, b) })
      else if (b.transition > 0 && b.transSolo) out.push({ trackId: tid, a: null, b: b.id, t: b.start })
    }
  }
  return out
}

/** The neighbour edge for a clip side ('l'|'r'): {a,b} with the adjacent clip when one touches, else a solo edge. */
export function edgeOf(clips, id, side) {
  const c = clips.find((x) => x.id === id); if (!c) return null
  const lane = clips.filter((x) => x.trackId === c.trackId && x.id !== id)
  if (side === 'l') {
    const a = lane.filter((x) => Math.abs(x.start + x.dur - c.start) < 0.03 || hasPair(x, c)).sort((p, q) => q.start - p.start)[0]
    return { a: a ? a.id : null, b: c.id }
  }
  const b = lane.filter((x) => Math.abs(c.start + c.dur - x.start) < 0.03 || hasPair(c, x)).sort((p, q) => p.start - q.start)[0]
  return { a: c.id, b: b ? b.id : null }
}

const CLEAR_IN = { transition: 0, transSolo: undefined, transType: undefined, transAlign: undefined, transReq: undefined, transExtPrev: undefined, transExtCur: undefined }
const CLEAR_OUT = { transOut: 0, transOutType: undefined, transOutSolo: undefined }
const strip = (c) => { for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k]; return c }

/** Clips an edge operation touches for primary clip c: itself for audio edges, its whole link group for video edges. */
const edgeGroup = (clips, c) => (c.kind === 'audio' ? [c.id] : clips.filter((x) => x.id === c.id || (c.link && x.link === c.link)).map((x) => x.id))

/** Remove the transition at edge {a,b} (either may be null). Restores the overlap geometry of new-style transitions. */
export function removeEdge(clips, edge) {
  const out = clips.map((c) => ({ ...c }))
  const a = edge.a ? out.find((c) => c.id === edge.a) : null, b = edge.b ? out.find((c) => c.id === edge.b) : null
  if (a && b) {
    if (!hasPair(a, b)) return out
    const gb = new Set(edgeGroup(out, b)), ga = new Set(edgeGroup(out, a))
    const ep = b.transExtPrev ?? 0
    for (const c of out) {
      if (gb.has(c.id) && c.transition > 0 && !c.transSolo) {
        const e = c.transExtCur ?? 0
        Object.assign(c, { start: c.start + e, in: c.in + e * c.speed, dur: c.dur - e, keys: c.keys.map((k) => ({ t: k.t - e, v: k.v })) }, CLEAR_IN)
      }
      if (ga.has(c.id) && c.transOut > 0 && !c.transOutSolo) Object.assign(c, { dur: c.dur - Math.min(ep, c.dur - EPS) }, CLEAR_OUT)
    }
  } else if (b) {
    for (const c of out) if (edgeGroup(out, b).includes(c.id) && c.transSolo) Object.assign(c, CLEAR_IN)
  } else if (a) {
    for (const c of out) if (edgeGroup(out, a).includes(c.id) && c.transOutSolo) Object.assign(c, CLEAR_OUT)
  }
  return out.map(strip)
}

/**
 * Apply a transition at edge {a,b}. opts: {type, dur, align (0..1 or 'centre'|'start'|'end'), audioType, alsoAudio, kind}
 * Returns {clips, dur, req, short, align} or {error}.
 */
export function applyEdge(clips0, media, fps, edge, opts) {
  const align0 = typeof opts.align === 'string' ? ALIGN[opts.align] ?? 0.5 : opts.align ?? 0.5
  const req = Math.max(1 / fps, fr(opts.dur ?? 1, fps))
  let clips = removeEdge(clips0, edge)
  const a = edge.a ? clips.find((c) => c.id === edge.a) : null, b = edge.b ? clips.find((c) => c.id === edge.b) : null
  if (!a && !b) return { error: 'no edit point' }
  const prim = (b || a)
  const audioOnly = prim.kind === 'audio'
  const vType = isVideoType(opts.type) ? opts.type : 'crossdissolve'
  const aType = audioType(isAudioType(opts.type) && opts.type !== 'none' ? opts.type : opts.audioType)
  const typeFor = (c) => (c.kind === 'audio' ? aType : vType)
  const grp = (c) => edgeGroup(clips, c)
  const setFields = (ids, f) => { clips = clips.map((c) => (ids.includes(c.id) ? { ...c, ...f(c) } : c)) }
  const wantAudio = (c) => c.kind !== 'audio' || audioOnly || opts.alsoAudio !== false

  if (a && b) {
    // Split the requested length over the cut by the alignment (in whole frames), then shorten each half to the
    // spare media on its side: a centred 1 s cut whose incoming clip starts at source 0 keeps the 0.5 s before the cut.
    const ha = handlesOf(a, media), hb = handlesOf(b, media)
    const F = (x) => Math.floor(x * fps + 1e-6)
    const reqF = Math.round(req * fps)
    let epF = Math.min(Math.round(reqF * (1 - align0)), F(ha.tail)), ecF = Math.min(reqF - Math.round(reqF * (1 - align0)), F(hb.head))
    const capF = F(Math.min(a.dur + (a.transOut || 0), b.dur))
    if (epF + ecF > capF) { const k = capF / (epF + ecF); epF = Math.floor(epF * k); ecF = Math.min(capF - epF, Math.floor(ecF * k)) }
    const dF = epF + ecF
    if (dF < 1) return { error: 'Insufficient media: no spare frames on either side of this cut' }
    const d = dF / fps, ep = epF / fps, ec = ecF / fps, al = ecF / dF
    const ga = grp(a), gb = grp(b)
    clips = clips.map((c) => {
      if (ga.includes(c.id)) { const w = wantAudio(c); return strip({ ...c, dur: c.dur + ep, transOut: d, transOutType: w ? typeFor(c) : 'none', transOutSolo: undefined }) }
      if (gb.includes(c.id)) {
        const w = wantAudio(c)
        return strip({ ...c, start: c.start - ec, in: c.in - ec * c.speed, dur: c.dur + ec, keys: c.keys.map((k) => ({ t: k.t + ec, v: k.v })),
          transition: d, transType: w ? typeFor(c) : 'none', transAlign: al, transReq: req, transExtPrev: ep, transExtCur: ec, transSolo: undefined })
      }
      return c
    })
    return { clips, dur: d, req, short: d < req - 1e-6, align: al }
  }
  if (b) {
    const d = Math.floor(Math.min(req, b.dur - (b.transOut || 0)) * fps + 1e-6) / fps
    if (d < 1 / fps - 1e-6) return { error: 'clip too short for a transition' }
    setFields(grp(b), (c) => ({ transition: d, transType: wantAudio(c) ? typeFor(c) : 'none', transSolo: true, transAlign: 0, transReq: req, transExtPrev: 0, transExtCur: 0 }))
    return { clips, dur: d, req, short: d < req - 1e-6, align: 0 }
  }
  const d = Math.floor(Math.min(req, a.dur - (a.transition || 0)) * fps + 1e-6) / fps
  if (d < 1 / fps - 1e-6) return { error: 'clip too short for a transition' }
  setFields(grp(a), (c) => ({ transOut: d, transOutType: wantAudio(c) ? typeFor(c) : 'none', transOutSolo: true }))
  return { clips, dur: d, req, short: d < req - 1e-6, align: 1 }
}

/** Transition info for the clip pair/edge: {type,dur,req,align,short,solo} or null. */
export function edgeInfo(clips, edge) {
  const a = edge.a ? clips.find((c) => c.id === edge.a) : null, b = edge.b ? clips.find((c) => c.id === edge.b) : null
  if (a && b) {
    if (!hasPair(a, b)) return null
    return { type: b.transType, dur: b.transition, req: b.transReq ?? b.transition, align: b.transAlign ?? 0, short: (b.transReq ?? b.transition) > b.transition + 1e-6, solo: false, legacy: b.transExtCur == null }
  }
  if (b && b.transition > 0 && b.transSolo) return { type: b.transType, dur: b.transition, req: b.transReq ?? b.transition, align: 0, short: (b.transReq ?? b.transition) > b.transition + 1e-6, solo: true }
  if (a && a.transOut > 0 && a.transOutSolo) return { type: a.transOutType, dur: a.transOut, req: a.transOut, align: 1, short: false, solo: true }
  return null
}

/** Transition blocks to draw: [{id (incoming/owning clip), edge, t0, t1, type, short}] for one clip list. */
export function transitionBlocks(clips) {
  const out = []
  for (const c of clips) {
    if (c.transition > 0) {
      const prev = clips.find((a) => a.trackId === c.trackId && hasPair(a, c))
      out.push({ id: c.id, edge: { a: prev ? prev.id : null, b: c.id }, trackId: c.trackId, t0: c.start, t1: c.start + c.transition, type: c.transType, short: (c.transReq ?? c.transition) > c.transition + 1e-6, req: c.transReq ?? c.transition, legacy: !prev ? false : c.transExtCur == null, kind: c.kind })
    }
    if (c.transOut > 0 && c.transOutSolo) out.push({ id: c.id + ':out', edge: { a: c.id, b: null }, trackId: c.trackId, t0: c.start + c.dur - c.transOut, t1: c.start + c.dur, type: c.transOutType, short: false, req: c.transOut, kind: c.kind })
  }
  return out
}

// ------------------------------------------------------------------------------------------------
// Trim tools. All take the ORIGINAL clips (snapshot at drag start) so a drag is a pure function of the pointer.
// ------------------------------------------------------------------------------------------------
const minDurOf = (fps) => 1 / fps

/** Neighbouring limits on a lane: end of the previous non-group clip, start of the next non-group clip. */
function laneLimits(clips, c, grp) {
  const lane = clips.filter((x) => x.trackId === c.trackId && !grp.has(x.id))
  const prevEnd = Math.max(0, ...lane.filter((x) => x.start + x.dur <= c.start + EPS).map((x) => x.start + x.dur))
  const nextStart = Math.min(Infinity, ...lane.filter((x) => x.start >= c.start + c.dur - EPS).map((x) => x.start))
  return { prevEnd, nextStart }
}

/** Trim one edge ('l'|'r') of clip id to timeline time t. ripple: later clips (all tracks) shift. Linked clips follow. */
export function trimEdge(clips, media, fps, id, side, t, ripple) {
  const c0 = clips.find((c) => c.id === id); if (!c0) return clips
  const gids = new Set(groupIds(clips, [id]))
  const md = minDurOf(fps)
  const lim = laneLimits(clips, c0, gids)
  let delta = 0 // change of timeline duration of the primary clip
  const res = clips.map((o) => {
    if (!gids.has(o.id)) return o
    const m = o.mediaId ? media[o.mediaId] : undefined
    if (side === 'l') {
      let ns = Math.min(t, o.start + o.dur - md)
      if (o.kind !== 'title') ns = Math.max(ns, o.start - o.in / o.speed)
      ns = Math.max(0, ns)
      if (!ripple && o.id === id) ns = Math.max(ns, Math.min(lim.prevEnd, o.start))
      const d = ns - o.start
      if (o.id === id) delta = -d
      if (ripple) return { ...o, in: o.in + d * o.speed, dur: o.dur - d, keys: o.keys.map((k) => ({ t: k.t - d, v: k.v })), transition: d > 0 ? Math.min(o.transition, o.dur - d) : o.transition }
      return { ...o, start: ns, in: o.in + d * o.speed, dur: o.dur - d, keys: o.keys.map((k) => ({ t: k.t - d, v: k.v })), transition: d > 0 ? Math.min(o.transition, o.dur - d) : o.transition }
    }
    let dur = Math.max(md, t - o.start)
    if (!ripple && o.id === id && lim.nextStart < Infinity && !o.transOut) dur = Math.min(dur, lim.nextStart - o.start)
    if (m) dur = Math.min(dur, (m.dur - o.in) / o.speed)
    if (o.id === id) delta = dur - o.dur
    return { ...o, dur, transOut: Math.min(o.transOut || 0, dur) }
  })
  if (!ripple || Math.abs(delta) < 1e-9) return res
  const end0 = c0.start + c0.dur
  return res.map((x) => (gids.has(x.id) || x.start < end0 - 1e-6 ? x : { ...x, start: Math.max(0, x.start + delta) }))
}

/** Rolling edit: move the cut between a and b by delta seconds. Linked clips follow. */
export function rollEdge(clips, media, fps, aId, bId, delta) {
  const a0 = clips.find((c) => c.id === aId), b0 = clips.find((c) => c.id === bId); if (!a0 || !b0) return clips
  const md = minDurOf(fps)
  const ha = handlesOf(a0, media), hb = handlesOf(b0, media)
  const lo = Math.max(-(a0.dur - md), -hb.head), hi = Math.min(b0.dur - md, ha.tail)
  const d = Math.min(hi, Math.max(lo, delta))
  const ga = new Set(groupIds(clips, [aId])), gb = new Set(groupIds(clips, [bId]))
  return clips.map((c) => {
    if (ga.has(c.id)) return { ...c, dur: c.dur + d }
    if (gb.has(c.id)) return { ...c, start: c.start + d, in: c.in + d * c.speed, dur: c.dur - d, keys: c.keys.map((k) => ({ t: k.t - d, v: k.v })) }
    return c
  })
}

/** Slip: shift the clip's in point by delta source-seconds-per-timeline-second, keeping start/dur. Linked clips follow. */
export function slipClip(clips, media, fps, id, delta) {
  const c0 = clips.find((c) => c.id === id); if (!c0 || c0.kind === 'title') return clips
  const m = media[c0.mediaId]; const span = c0.dur * c0.speed
  const d = Math.min(Math.max(delta * c0.speed, -c0.in), (m ? m.dur : Infinity) - c0.in - span)
  const g = new Set(groupIds(clips, [id]))
  return clips.map((c) => (g.has(c.id) && c.kind !== 'title' ? { ...c, in: c.in + d } : c))
}

/** Slide: move clip by delta, trimming the previous clip's out and the next clip's in. */
export function slideClip(clips, media, fps, id, delta) {
  const c0 = clips.find((c) => c.id === id); if (!c0) return clips
  const md = minDurOf(fps)
  const g = new Set(groupIds(clips, [id]))
  const lane = clips.filter((x) => x.trackId === c0.trackId && !g.has(x.id))
  const prev = lane.filter((x) => Math.abs(x.start + x.dur - c0.start) < 0.03).sort((p, q) => q.start - p.start)[0]
  const next = lane.filter((x) => Math.abs(c0.start + c0.dur - x.start) < 0.03).sort((p, q) => p.start - q.start)[0]
  let lo = -c0.start, hi = Infinity
  if (prev) { lo = Math.max(lo, -(prev.dur - md)); hi = Math.min(hi, handlesOf(prev, media).tail) }
  if (next) { hi = Math.min(hi, next.dur - md); lo = Math.max(lo, -handlesOf(next, media).head) }
  const d = Math.min(hi, Math.max(lo, delta))
  const gp = prev ? new Set(groupIds(clips, [prev.id])) : new Set(), gn = next ? new Set(groupIds(clips, [next.id])) : new Set()
  return clips.map((c) => {
    if (g.has(c.id)) return { ...c, start: c.start + d }
    if (gp.has(c.id)) return { ...c, dur: c.dur + d }
    if (gn.has(c.id)) return { ...c, start: c.start + d, in: c.in + d * c.speed, dur: c.dur - d, keys: c.keys.map((k) => ({ t: k.t - d, v: k.v })) }
    return c
  })
}

/** Return a copy of c with its in-transition (or tail transition) cleared, including type fields. */
export const clearIn = (c) => strip({ ...c, ...CLEAR_IN })
export const clearOut = (c) => strip({ ...c, ...CLEAR_OUT })

/** Old projects stored only numbers: give them types (video: Cross Dissolve, audio: linear = Constant Gain). */
export function migrateClips(clips) {
  return clips.map((c) => {
    const n = { ...c }
    if (n.transition > 0 && !n.transType) n.transType = n.kind === 'audio' ? 'constgain' : 'crossdissolve'
    if (n.transOut > 0 && !n.transOutType) n.transOutType = n.kind === 'audio' ? 'constgain' : 'crossdissolve'
    return n
  })
}
