// Shared by the preview (renderer) and the exporter (main) so both compute the same picture and sound.

export const FONTS = {
  Arial: 'arial.ttf',
  'Segoe UI': 'segoeui.ttf',
  Consolas: 'consola.ttf',
  Impact: 'impact.ttf',
  'Times New Roman': 'times.ttf',
  Verdana: 'verdana.ttf',
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

export function clipEnd(c) { return c.start + c.dur }

/** Position and size a source of (sw x sh) after crop, fitted into the frame, then scaled. All even ints. */
export function placement(c, mw, mh, W, H) {
  const cr = c.crop || { l: 0, r: 0, t: 0, b: 0 }
  const sx = Math.round(mw * cr.l), sy = Math.round(mh * cr.t)
  const sw = Math.max(2, Math.round(mw * (1 - cr.l - cr.r))), sh = Math.max(2, Math.round(mh * (1 - cr.t - cr.b)))
  const fit = Math.min(W / sw, H / sh)
  const s = fit * (c.scale ?? 1)
  const dw = Math.max(2, 2 * Math.round((sw * s) / 2)), dh = Math.max(2, 2 * Math.round((sh * s) / 2))
  const dx = Math.round((W - dw) / 2 + (c.posX || 0)), dy = Math.round((H - dh) / 2 + (c.posY || 0))
  return { sx, sy, sw, sh, dx, dy, dw, dh }
}

/** Colour matrix params matching CSS brightness/contrast/saturate. */
export function colorParams(c) {
  return { b: c.brightness ?? 1, c: c.contrast ?? 1, s: c.saturation ?? 1 }
}
export const hasColor = (c) => (c.brightness ?? 1) !== 1 || (c.contrast ?? 1) !== 1 || (c.saturation ?? 1) !== 1

// ---------------------------------------------------------------------------------------------
// Transitions. ONE definition: each type is a set of tiny expressions in `p` (progress 0..1),
// written in ffmpeg expression syntax. The preview evaluates them in JS (evalExpr), the exporter
// pastes them into ffmpeg filters, so both render the same picture.
// ---------------------------------------------------------------------------------------------
export const VIDEO_TRANSITIONS = [
  { id: 'crossdissolve', name: 'Cross Dissolve' }, { id: 'dipblack', name: 'Dip to Black' }, { id: 'dipwhite', name: 'Dip to White' },
  { id: 'filmdissolve', name: 'Film Dissolve' },
  { id: 'wipeleft', name: 'Wipe Left' }, { id: 'wiperight', name: 'Wipe Right' }, { id: 'wipeup', name: 'Wipe Up' }, { id: 'wipedown', name: 'Wipe Down' },
  { id: 'pushleft', name: 'Push Left' }, { id: 'pushright', name: 'Push Right' }, { id: 'pushup', name: 'Push Up' }, { id: 'pushdown', name: 'Push Down' },
  { id: 'crosszoom', name: 'Cross Zoom' }, { id: 'blurdissolve', name: 'Blur Dissolve' },
]
export const AUDIO_TRANSITIONS = [
  { id: 'constpower', name: 'Constant Power' }, { id: 'constgain', name: 'Constant Gain' }, { id: 'expfade', name: 'Exponential Fade' },
]
export const TRANSITION_NAMES = Object.fromEntries([...VIDEO_TRANSITIONS, ...AUDIO_TRANSITIONS, { id: 'none', name: 'None' }].map((t) => [t.id, t.name]))
export const isAudioType = (id) => AUDIO_TRANSITIONS.some((t) => t.id === id) || id === 'none'
export const isVideoType = (id) => VIDEO_TRANSITIONS.some((t) => t.id === id)
/** Names accepted by the CLI: id, display name without spaces, or the old ffmpeg-ish aliases. */
export function typeFromName(s) {
  const k = String(s).toLowerCase().replace(/[^a-z]/g, '')
  const alias = { dissolve: 'crossdissolve', fade: 'crossdissolve', fadeblack: 'dipblack', fadewhite: 'dipwhite', diptoblack: 'dipblack', diptowhite: 'dipwhite', crossfade: 'constpower', constantpower: 'constpower', constantgain: 'constgain', exponentialfade: 'expfade', exp: 'expfade', zoom: 'crosszoom', blur: 'blurdissolve' }
  const all = [...VIDEO_TRANSITIONS, ...AUDIO_TRANSITIONS]
  return alias[k] || all.find((t) => t.id === k || t.name.toLowerCase().replace(/[^a-z]/g, '') === k)?.id || null
}

const dirs = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }
function videoSpec(type, solo) {
  const Z = { alpha: '1', dx: '0', dy: '0', s: '1', blur: '0', rect: null, dip: '0' }
  let i = { ...Z }, o = { ...Z }
  if (type === 'crossdissolve' || type === 'filmdissolve') {
    const q = type === 'filmdissolve' ? 'p*p*(3-2*p)' : 'p'
    i.alpha = q; o.alpha = solo ? `1-(${q})` : '1'
  } else if (type === 'dipblack' || type === 'dipwhite') {
    i.alpha = solo ? '1' : 'if(gte(p,0.5),1,0)'
    i.dip = solo ? '1-p' : '1-abs(2*p-1)'
    if (solo) o.dip = 'p'
  } else if (type.startsWith('wipe')) {
    const d = type.slice(4)
    const R = { left: ['1-p', '0', '1', '1'], right: ['0', '0', 'p', '1'], up: ['0', '1-p', '1', '1'], down: ['0', '0', '1', 'p'] }[d]
    const C = { left: ['0', '0', '1-p', '1'], right: ['p', '0', '1', '1'], up: ['0', '0', '1', '1-p'], down: ['0', 'p', '1', '1'] }[d]
    i.rect = R; if (solo) o.rect = C
  } else if (type.startsWith('push')) {
    const [sx, sy] = dirs[type.slice(4)]
    i.dx = `${sx}*(1-p)`; i.dy = `${sy}*(1-p)`; o.dx = `${-sx}*p`; o.dy = `${-sy}*p`
  } else if (type === 'crosszoom') {
    i.alpha = 'p'; i.s = '2-p'; o.s = '1+p'; o.alpha = solo ? '1-p' : '1'
  } else if (type === 'blurdissolve') {
    i.alpha = 'p'; o.alpha = solo ? '1-p' : '1'; i.blur = o.blur = 'sin(PI*p)'
  } else { i.alpha = 'p'; o.alpha = solo ? '1-p' : '1' }
  return { in: i, out: o }
}

const EX = { if: (c, a, b) => (c ? a : b), gte: (a, b) => (a >= b ? 1 : 0), lt: (a, b) => (a < b ? 1 : 0), abs: Math.abs, sin: Math.sin, cos: Math.cos, exp: Math.exp, clip: clamp, min: Math.min, max: Math.max, PI: Math.PI }
const exprCache = new Map()
/** Compile an ffmpeg-syntax expression of p to a closure (no eval/new Function: the renderer's CSP forbids it). */
function compileExpr(src) {
  const toks = src.match(/\d+\.?\d*|[A-Za-z_]\w*|[-+*/(),]/g) || []
  let i = 0
  const peek = () => toks[i], next = () => toks[i++]
  const expect = (t) => { if (next() !== t) throw new Error(`bad expression: ${src}`) }
  function sum() {
    let l = prod()
    while (peek() === '+' || peek() === '-') { const op = next(), r = prod(), a = l; l = op === '+' ? (p) => a(p) + r(p) : (p) => a(p) - r(p) }
    return l
  }
  function prod() {
    let l = unary()
    while (peek() === '*' || peek() === '/') { const op = next(), r = unary(), a = l; l = op === '*' ? (p) => a(p) * r(p) : (p) => a(p) / r(p) }
    return l
  }
  function unary() {
    if (peek() === '-') { next(); const u = unary(); return (p) => -u(p) }
    if (peek() === '+') { next(); return unary() }
    return atom()
  }
  function atom() {
    const t = next()
    if (t === undefined) throw new Error(`bad expression: ${src}`)
    if (t === '(') { const e = sum(); expect(')'); return e }
    if (/^\d/.test(t)) { const v = parseFloat(t); return () => v }
    if (t === 'p') return (p) => p
    if (t === 'PI') return () => Math.PI
    if (peek() === '(') {
      next(); const args = []
      if (peek() !== ')') { args.push(sum()); while (peek() === ',') { next(); args.push(sum()) } }
      expect(')')
      const f = EX[t]; if (!f) throw new Error(`unknown function ${t} in ${src}`)
      return (p) => f(...args.map((a) => a(p)))
    }
    throw new Error(`bad token ${t} in ${src}`)
  }
  const f = sum()
  if (i !== toks.length) throw new Error(`bad expression: ${src}`)
  return f
}
/** Evaluate an ffmpeg-syntax expression of p in JS. */
export function evalExpr(src, p) {
  let f = exprCache.get(src)
  if (!f) { f = compileExpr(src); exprCache.set(src, f) }
  return f(p)
}
/** Substitute progress expression `pe` for the variable p in an expression string. */
export const withP = (src, pe) => src.replace(/\bp\b/g, `(${pe})`)

/** Expression set for a transition layer: role 'in' (incoming clip) or 'out' (outgoing). solo = against black. */
export function transSpec(type, role, solo) {
  const sp = videoSpec(isVideoType(type) ? type : 'crossdissolve', !!solo)[role]
  return sp
}
export const DIP_COLOR = { dipblack: [0, 0, 0], dipwhite: [255, 255, 255] }
export const BLUR_FRAC = 0.012
/** Numbers for one layer at progress p. */
export function transFx(type, role, solo, p) {
  p = clamp(p, 0, 1)
  const sp = transSpec(type, role, solo); const e = (s) => evalExpr(s, p)
  return { alpha: clamp(e(sp.alpha), 0, 1), dx: e(sp.dx), dy: e(sp.dy), s: e(sp.s), blur: clamp(e(sp.blur), 0, 1), rect: sp.rect ? sp.rect.map(e) : null, dip: clamp(e(sp.dip), 0, 1) }
}

/** The transition layer active on video clip c at local time t, or null. */
export function activeTrans(c, t) {
  const din = c.transition || 0, dout = c.transOut || 0
  if (din > 0 && t < din) return { role: 'in', type: isVideoType(c.transType) ? c.transType : 'crossdissolve', d: din, p: t / din, solo: !!c.transSolo }
  if (dout > 0 && t > c.dur - dout) return { role: 'out', type: isVideoType(c.transOutType) ? c.transOutType : 'crossdissolve', d: dout, p: (t - (c.dur - dout)) / dout, solo: !!c.transOutSolo }
  return null
}

/** Rendered rectangle of a layer after the transition's scale/offset (same rounding as the exporter). */
export function layerRect(pl, fx, W, H) {
  const dw = Math.max(2, 2 * Math.floor((pl.dw * fx.s) / 2)), dh = Math.max(2, 2 * Math.floor((pl.dh * fx.s) / 2))
  return { x: pl.dx + pl.dw / 2 - dw / 2 + fx.dx * W, y: pl.dy + pl.dh / 2 - dh / 2 + fx.dy * H, w: dw, h: dh }
}

/** Fade-in gain curve of an audio transition at x in 0..1 (fade-out uses x = remaining fraction). */
export const AUDIO_CURVE = {
  constgain: 'clip(x,0,1)',
  constpower: 'sin(PI/2*clip(x,0,1))',
  expfade: '(exp(3*clip(x,0,1))-1)/(exp(3)-1)',
}
export function audioType(id) { return AUDIO_CURVE[id] ? id : id === 'none' ? 'none' : 'constgain' }
export function audioCurve(type, x, role) {
  type = audioType(type)
  if (type === 'none') return role === 'out' ? 0 : 1
  return evalExpr(AUDIO_CURVE[type].replace(/\bx\b/g, 'p'), x)
}

/** Keyframe list sorted; returns [{t,v}] */
export function sortedKeys(c) {
  return [...(c.keys || [])].sort((a, b) => a.t - b.t)
}

/** Linear gain at local time t (seconds since clip start, timeline time). */
export function clipGain(c, t) {
  let g = c.volume ?? 1
  const ks = sortedKeys(c)
  if (ks.length) {
    if (t <= ks[0].t) g *= ks[0].v
    else if (t >= ks[ks.length - 1].t) g *= ks[ks.length - 1].v
    else {
      for (let i = 0; i < ks.length - 1; i++) {
        if (t >= ks[i].t && t <= ks[i + 1].t) {
          const u = (t - ks[i].t) / Math.max(1e-6, ks[i + 1].t - ks[i].t)
          g *= ks[i].v + (ks[i + 1].v - ks[i].v) * u
          break
        }
      }
    }
  }
  if ((c.fadeIn || 0) > 0) g *= clamp(t / c.fadeIn, 0, 1)
  if ((c.fadeOut || 0) > 0) g *= clamp((c.dur - t) / c.fadeOut, 0, 1)
  if ((c.transition || 0) > 0 && t < c.transition) g *= audioCurve(c.transType, t / c.transition, 'in')
  if ((c.transOut || 0) > 0 && t > c.dur - c.transOut) g *= audioCurve(c.transOutType, (c.dur - t) / c.transOut, 'out')
  return g
}

/** ffmpeg `volume` expression (variable t = local time) equal to clipGain. */
export function gainExpr(c) {
  const n = (x) => Number(x).toFixed(6)
  let e = n(c.volume ?? 1)
  const ks = sortedKeys(c)
  if (ks.length) {
    let k = n(ks[ks.length - 1].v)
    for (let i = ks.length - 2; i >= 0; i--) {
      const a = ks[i], b = ks[i + 1]
      k = `if(lt(t,${n(b.t)}),${n(a.v)}+(${n(b.v - a.v)})*(t-${n(a.t)})/${n(Math.max(1e-6, b.t - a.t))},${k})`
    }
    k = `if(lt(t,${n(ks[0].t)}),${n(ks[0].v)},${k})`
    e = `${e}*(${k})`
  }
  if ((c.fadeIn || 0) > 0) e += `*clip(t/${n(c.fadeIn)},0,1)`
  if ((c.fadeOut || 0) > 0) e += `*clip((${n(c.dur)}-t)/${n(c.fadeOut)},0,1)`
  const curve = (type, x, role) => { const ty = audioType(type); return ty === 'none' ? (role === 'out' ? '0' : '1') : AUDIO_CURVE[ty].replace(/\bx\b/g, `(${x})`) }
  if ((c.transition || 0) > 0) e += `*if(lt(t,${n(c.transition)}),${curve(c.transType, `t/${n(c.transition)}`, 'in')},1)`
  if ((c.transOut || 0) > 0) e += `*if(gt(t,${n(c.dur - c.transOut)}),${curve(c.transOutType, `(${n(c.dur)}-t)/${n(c.transOut)}`, 'out')},1)`
  return e
}

/** Source time in seconds for timeline time t within clip c. */
export function sourceTime(c, t) {
  return c.in + (t - c.start) * (c.speed || 1)
}

export function sequenceEnd(clips) {
  return clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0)
}
