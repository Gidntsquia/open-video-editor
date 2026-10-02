import { useStore } from './store'
import type { Clip, Media } from './types'
import { placement, clipGain, sourceTime, hasColor, colorParams, sequenceEnd, activeTrans, transFx, layerRect, DIP_COLOR, BLUR_FRAC } from '../shared/math.js'

/** Source time to seek the <video> to so it shows the frame the exporter shows at timeline time t.
 *  ffmpeg (`-ss in`) starts at the first source frame at or after `in`; Chromium shows the frame containing the seek
 *  time, so aim at the middle of the wanted frame (exact frame boundaries round either way). */
function previewSeek(c: Clip, m: Media, t: number) {
  const f = Math.max(1, m.fps || 30)
  const in0 = Math.ceil(c.in * f - 1e-6) / f
  const off = (t - c.start) * (c.speed || 1)
  return in0 + (Math.floor(off * f + 1e-6) + 0.5) / f
}
type VEl = { el: HTMLVideoElement; lastSeek: number; gain?: GainNode; src: string; corrAt?: number; lead?: number }
const PREROLL = 0.5 // s before a clip starts: its element already plays (silent) so it is in sync at the cut

/** Real-time preview: one <video> per active clip, composited on a canvas; audio via WebAudio gain per clip. */
export class Engine {
  canvas: HTMLCanvasElement | null = null
  ctx2d: CanvasRenderingContext2D | null = null
  els = new Map<string, VEl>()
  audio: AudioContext | null = null
  playing = false
  dir = 1
  t0 = 0
  tl0 = 0
  dirty = true
  raf = 0
  stats = { fps: 0, late: 0, frames: 0, dropped: 0, decoded: 0, worst: 0 }
  private last = 0
  private lastPh = -1
  private droppedBase = 0
  private decodedBase = 0
  private frameCount = 0
  private fpsT = 0
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop)
    this.tick(now)
  }

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx2d = canvas.getContext('2d', { alpha: false })
    if (!this.raf) this.raf = requestAnimationFrame(this.loop)
  }

  mediaSrc(m: Media) {
    return window.api.mediaUrl(m.proxy || m.path)
  }

  play(dir = 1) {
    const s = useStore.getState()
    const end = sequenceEnd(s.clips)
    if (!s.clips.length) return
    if (dir > 0 && s.playhead >= end - 1e-3) s.setPlayhead(0)
    if (dir < 0 && s.playhead <= 0) return
    if (!this.audio) this.audio = new AudioContext()
    this.audio.resume()
    this.dir = dir
    this.playing = true
    this.t0 = performance.now()
    this.tl0 = useStore.getState().playhead
    this.stats = { fps: 0, late: 0, frames: 0, dropped: 0, decoded: 0, worst: 0 }
    this.droppedBase = this.decodedBase = 0
    this.last = 0
    useStore.setState({ playing: true })
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    for (const v of this.els.values()) v.el.pause()
    useStore.setState({ playing: false })
    this.dirty = true
  }

  toggle() { this.playing ? this.pause() : this.play(1) }

  /** While paused, keep repainting until this time: a decoded frame can reach the canvas a moment after 'seeked'. */
  private settleUntil = 0
  private pending = false

  seek(t: number) {
    this.settleUntil = performance.now() + 2500
    useStore.getState().setPlayhead(t)
    if (this.playing) { this.t0 = performance.now(); this.tl0 = useStore.getState().playhead }
    this.dirty = true
  }

  /** Called by UI when clips change while paused. */
  invalidate() { this.dirty = true }

  private release(id: string) {
    const v = this.els.get(id)
    if (!v) return
    const q = v.el.getVideoPlaybackQuality?.()
    if (q) { this.droppedBase += q.droppedVideoFrames; this.decodedBase += q.totalVideoFrames }
    v.el.pause(); v.el.removeAttribute('src'); v.el.load()
    v.gain?.disconnect()
    this.els.delete(id)
  }

  private ensure(c: Clip, m: Media, t: number): VEl {
    let v = this.els.get(c.id)
    const src = this.mediaSrc(m)
    if (v && v.src !== src) { this.release(c.id); v = undefined }
    if (v) return v
    const el = document.createElement('video')
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.muted = c.kind === 'video'
    el.playsInline = true
    el.src = src
    el.addEventListener('seeked', () => {
      this.dirty = true; this.settleUntil = performance.now() + 2500
      // the decoded frame can reach the canvas well after 'seeked' (cold start); repaint when the compositor has it
      const rv = (el as any).requestVideoFrameCallback
      if (rv) rv.call(el, () => { this.dirty = true; this.settleUntil = performance.now() + 300 })
    })
    el.addEventListener('loadeddata', () => (this.dirty = true))
    el.addEventListener('error', () => {
      const cur = useStore.getState().media[m.id]
      if (cur && !cur.proxy && !cur.proxyBusy) {
        useStore.getState().setStatus(`Cannot decode ${cur.name} directly - building a proxy…`)
        makeProxy(cur.id)
      }
    })
    const cl = Math.min(Math.max(t, c.start), c.start + c.dur)
    el.currentTime = previewSeek(c, m, cl)
    v = { el, lastSeek: sourceTime(c, cl), src }
    if (c.kind === 'audio') {
      if (!this.audio) this.audio = new AudioContext()
      const node = this.audio.createMediaElementSource(el)
      const gain = this.audio.createGain()
      node.connect(gain).connect(this.audio.destination)
      v.gain = gain
    }
    this.els.set(c.id, v)
    return v
  }

  private tick(now: number) {
    const s = useStore.getState()
    if (this.playing) {
      if (this.last) {
        const dt = now - this.last
        this.stats.frames++
        if (dt > 25) this.stats.late++
        if (dt > this.stats.worst) this.stats.worst = dt
      }
      this.last = now
      this.frameCount++
      if (now - this.fpsT > 500) { this.stats.fps = (this.frameCount * 1000) / (now - this.fpsT); this.frameCount = 0; this.fpsT = now }
      const end = sequenceEnd(s.clips)
      let t = this.tl0 + ((now - this.t0) / 1000) * this.dir
      if (t >= end && this.dir > 0) { t = end; s.setPlayhead(t); this.pause(); this.dirty = true; return }
      if (t <= 0 && this.dir < 0) { t = 0; s.setPlayhead(t); this.pause(); this.dirty = true; return }
      s.setPlayhead(t)
      this.sync(t, this.dir > 0)
      this.draw(t)
      let d = this.droppedBase, dec = this.decodedBase
      for (const v of this.els.values()) { const q = v.el.getVideoPlaybackQuality?.(); if (q) { d += q.droppedVideoFrames; dec += q.totalVideoFrames } }
      this.stats.dropped = d; this.stats.decoded = dec
    } else if (this.dirty || s.playhead !== this.lastPh || this.pending || now < this.settleUntil) {
      this.dirty = false
      this.sync(s.playhead, false)
      this.draw(s.playhead)
    }
    this.lastPh = s.playhead
  }

  private sync(t: number, playing: boolean) {
    const s = useStore.getState()
    const need = new Set<string>()
    for (const c of s.clips) {
      if (c.kind === 'title' || !c.mediaId) continue
      const m = s.media[c.mediaId]; if (!m) continue
      const tr = s.tracks.find((x) => x.id === c.trackId)
      const near = t >= c.start - 2 && t <= c.start + c.dur + 0.3
      if (!near) continue
      need.add(c.id)
      const v = this.ensure(c, m, t)
      const active = t >= c.start && t < c.start + c.dur
      const target = sourceTime(c, t)
      // pre-roll: while playing, a clip about to start already runs (silent) from the source frames before its in point
      const preroll = playing && !active && t < c.start && t >= c.start - PREROLL && target >= 0
      if (!active && !preroll) {
        v.el.pause()
        if (t < c.start && Math.abs(v.lastSeek - c.in) > 0.05 && !v.el.seeking) { v.el.currentTime = c.in; v.lastSeek = c.in }
        if (v.gain) v.gain.gain.value = 0
        continue
      }
      if (v.gain) {
        const g = v.gain.gain, ac = this.audio!
        if (playing && !preroll && !tr?.muted) {
          // ramp on the audio clock to the gain the clip has one frame from now, so fades/transitions are not a frame late
          const dt = 1 / 60
          g.cancelScheduledValues(ac.currentTime); g.setValueAtTime(g.value, ac.currentTime)
          g.linearRampToValueAtTime(clipGain(c, Math.min(c.dur, t - c.start + dt)), ac.currentTime + dt)
        } else g.setTargetAtTime(tr?.muted || preroll ? 0 : clipGain(c, t - c.start), ac.currentTime, 0.01)
      }
      if (playing) {
        if (v.el.playbackRate !== c.speed) v.el.playbackRate = c.speed
        const now = performance.now(), lag = target - v.el.currentTime
        if (v.el.paused) {
          // one seek, then let it start: re-seeking every frame while a (slow) video seek is in flight never lets it play
          if (Math.abs(lag) > 0.04 && !v.el.seeking && now - (v.corrAt || 0) > 300) { v.el.currentTime = target + (v.lead || 0); v.lastSeek = target; v.corrAt = now }
          v.el.play().catch(() => {})
        } else if (Math.abs(lag) > 0.08 && !v.el.seeking && now - (v.corrAt || 0) > 300) {
          // the element starts/seeks late by a fairly constant amount: learn it and seek that far ahead next time
          v.lead = Math.min(0.5, Math.max(0, (v.lead || 0) + lag))
          v.el.currentTime = target + v.lead; v.lastSeek = target; v.corrAt = now
        }
      } else {
        if (!v.el.paused) v.el.pause()
        if (Math.abs(v.lastSeek - target) > 0.5 / s.fps) { v.el.currentTime = previewSeek(c, m, t); v.lastSeek = target }
      }
    }
    for (const id of [...this.els.keys()]) if (!need.has(id)) this.release(id)
  }

  draw(t: number) {
    const s = useStore.getState()
    const cv = this.canvas, g = this.ctx2d
    if (!cv || !g) return
    if (cv.width !== s.width || cv.height !== s.height) { cv.width = s.width; cv.height = s.height }
    g.filter = 'none'; g.globalAlpha = 1
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height)
    const order = new Map(s.tracks.map((tr, i) => [tr.id, i]))
    const vis = s.clips
      .filter((c) => c.kind !== 'audio' && t >= c.start && t < c.start + c.dur && !s.tracks.find((x) => x.id === c.trackId)?.hidden)
      .sort((a, b) => (order.get(a.trackId)! - order.get(b.trackId)!) || a.start - b.start)
    this.pending = false
    for (const c of vis) {
      if (c.kind === 'title') { this.drawTitle(g, c, s.width, s.height); continue }
      const m = s.media[c.mediaId!]; const v = this.els.get(c.id)
      if (!m || !v || v.el.readyState < 2 || (!this.playing && v.el.seeking)) { this.pending = true; continue }
      const p = placement(c, m.w, m.h, s.width, s.height)
      const rx = v.el.videoWidth / m.w, ry = v.el.videoHeight / m.h
      const at = activeTrans(c, t - c.start)
      const fx = at ? transFx(at.type, at.role, at.solo, at.p) : null
      const lr = fx ? layerRect(p, fx, s.width, s.height) : { x: p.dx, y: p.dy, w: p.dw, h: p.dh }
      g.save()
      if (fx?.rect) { const [x0, y0, x1, y1] = fx.rect; g.beginPath(); g.rect(x0 * s.width, y0 * s.height, (x1 - x0) * s.width, (y1 - y0) * s.height); g.clip() }
      const col = hasColor(c) ? (() => { const q = colorParams(c); return `brightness(${q.b}) contrast(${q.c}) saturate(${q.s})` })() : ''
      g.globalAlpha = fx ? fx.alpha : 1
      g.filter = col || 'none'
      g.drawImage(v.el, p.sx * rx, p.sy * ry, p.sw * rx, p.sh * ry, lr.x, lr.y, lr.w, lr.h)
      if (fx && fx.blur > 0) {
        g.globalAlpha = fx.alpha * fx.blur
        g.filter = `${col} blur(${Math.round(s.width * BLUR_FRAC)}px)`.trim()
        g.drawImage(v.el, p.sx * rx, p.sy * ry, p.sw * rx, p.sh * ry, lr.x, lr.y, lr.w, lr.h)
      }
      g.restore()
      g.filter = 'none'; g.globalAlpha = 1
      if (fx && fx.dip > 0 && DIP_COLOR[at!.type as keyof typeof DIP_COLOR]) {
        const [r, gg, b] = DIP_COLOR[at!.type as keyof typeof DIP_COLOR]
        g.fillStyle = `rgb(${r},${gg},${b})`; g.globalAlpha = fx.dip; g.fillRect(0, 0, s.width, s.height); g.globalAlpha = 1
      }
    }
  }

  private drawTitle(g: CanvasRenderingContext2D, c: Clip, W: number, H: number) {
    const lines = (c.text || '').split('\n'); const size = Math.round(c.size || 64)
    g.font = `${size}px "${c.font || 'Arial'}"`; g.fillStyle = c.color || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
    const lh = size * 1.2, y0 = (c.y ?? 0.5) * H - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => g.fillText(l, Math.round((c.x ?? 0.5) * W), y0 + i * lh))
  }
}

export const engine = new Engine()

export async function makeProxy(id: string) {
  const st = useStore.getState()
  const m = st.media[id]; if (!m || m.proxy || m.proxyBusy) return
  st.patchMedia(id, { proxyBusy: true })
  try {
    const p = await window.api.proxy(m.path)
    useStore.getState().patchMedia(id, { proxy: p, proxyBusy: false })
    useStore.getState().setStatus(`Proxy ready for ${m.name}`)
    engine.invalidate()
  } catch (e: any) {
    useStore.getState().patchMedia(id, { proxyBusy: false, error: String(e.message || e) })
  }
}
