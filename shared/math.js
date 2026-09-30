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

/** Opacity of a video clip at local timeline time t (seconds since clip start): dissolve-in only. */
export function clipAlpha(c, t) {
  const d = c.transition || 0
  return d > 0 ? clamp(t / d, 0, 1) : 1
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
  const fi = Math.max(c.fadeIn || 0, c.transition || 0)
  if (fi > 0) g *= clamp(t / fi, 0, 1)
  const fo = Math.max(c.fadeOut || 0, c.transOut || 0)
  if (fo > 0) g *= clamp((c.dur - t) / fo, 0, 1)
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
  const fi = Math.max(c.fadeIn || 0, c.transition || 0)
  if (fi > 0) e += `*clip(t/${n(fi)},0,1)`
  const fo = Math.max(c.fadeOut || 0, c.transOut || 0)
  if (fo > 0) e += `*clip((${n(c.dur)}-t)/${n(fo)},0,1)`
  return e
}

/** Source time in seconds for timeline time t within clip c. */
export function sourceTime(c, t) {
  return c.in + (t - c.start) * (c.speed || 1)
}

export function sequenceEnd(clips) {
  return clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0)
}
