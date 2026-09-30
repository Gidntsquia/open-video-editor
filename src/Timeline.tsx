import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { engine } from './engine'
import type { Clip } from './types'
import { clipEnd, sequenceEnd } from '../shared/math.js'

export const LABEL_W = 70
export const tlApi: { dropMedia?: (id: string, x: number, y: number) => boolean } = {}
const ROW_H = 58

function fmtTime(t: number, fps: number) {
  const f = Math.floor(t * fps + 1e-6)
  const fr = f % Math.round(fps), s = Math.floor(f / Math.round(fps))
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}:${p(fr)}`
}
export { fmtTime }

function Waveform({ clip }: { clip: Clip }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wave = useStore((s) => (clip.mediaId ? s.waves[clip.mediaId] : undefined))
  const zoom = useStore((s) => s.zoom)
  useEffect(() => {
    const cv = ref.current; if (!cv || !wave) return
    const w = Math.min(4096, Math.max(1, Math.round(clip.dur * zoom))), h = ROW_H - 18
    cv.width = w; cv.height = h
    const g = cv.getContext('2d')!; g.clearRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,255,255,0.75)'
    const srcSpan = clip.dur * clip.speed
    for (let x = 0; x < w; x++) {
      const a = Math.floor((clip.in + (x / w) * srcSpan) * wave.pps), b = Math.max(a + 1, Math.floor((clip.in + ((x + 1) / w) * srcSpan) * wave.pps))
      let m = 0
      for (let i = a; i < b && i < wave.peaks.length; i++) m = Math.max(m, wave.peaks[i])
      const bh = Math.max(1, (m / 255) * h)
      g.fillRect(x, (h - bh) / 2, 1, bh)
    }
  }, [wave, clip.dur, clip.in, clip.speed, zoom])
  return <canvas ref={ref} className="wave" style={{ width: clip.dur * zoom }} />
}

function ClipView({ clip, onDown, onTrim, onCtx }: { clip: Clip; onCtx: (e: React.MouseEvent, c: Clip) => void; onDown: (e: React.PointerEvent, c: Clip) => void; onTrim: (e: React.PointerEvent, c: Clip, edge: 'l' | 'r') => void }) {
  const zoom = useStore((s) => s.zoom)
  const selected = useStore((s) => s.selection.includes(clip.id))
  const thumb = useStore((s) => (clip.mediaId ? s.thumbs[clip.mediaId] : undefined))
  const name = useStore((s) => (clip.mediaId ? s.media[clip.mediaId]?.name : clip.text))
  const w = Math.max(10, clip.dur * zoom)
  const eg = Math.min(6, Math.floor(w / 3))
  return (
    <div
      className={`clip ${clip.kind} ${selected ? 'sel' : ''} ${w < 40 ? 'tiny' : ''}`}
      data-clip={clip.id}
      style={{ left: clip.start * zoom, width: w }}
      onPointerDown={(e) => onDown(e, clip)}
      onContextMenu={(e) => onCtx(e, clip)}
    >
      {clip.kind === 'video' && thumb && <img src={thumb} className="cthumb" draggable={false} />}
      {clip.kind === 'audio' && <Waveform clip={clip} />}
      {clip.kind === 'audio' && (
        <svg className="env" width={w} height={ROW_H - 4} onPointerDown={() => {}}>
          {(clip.keys.length > 0 || clip.volume !== 1) && (
            <polyline
              fill="none" stroke="#ffd54a" strokeWidth="1.5"
              points={(clip.keys.length ? [{ t: 0, v: clip.keys[0].v }, ...[...clip.keys].sort((a, b) => a.t - b.t), { t: clip.dur, v: clip.keys[clip.keys.length - 1].v }] : [{ t: 0, v: 1 }, { t: clip.dur, v: 1 }])
                .map((k) => `${k.t * zoom},${(ROW_H - 4) - Math.min(2, k.v * clip.volume) / 2 * (ROW_H - 8) - 2}`).join(' ')}
            />
          )}
          {clip.keys.map((k, i) => <rect key={i} x={k.t * zoom - 3} y={(ROW_H - 4) - Math.min(2, k.v * clip.volume) / 2 * (ROW_H - 8) - 5} width="6" height="6" fill="#ffd54a" transform={`rotate(45 ${k.t * zoom} ${(ROW_H - 4) - Math.min(2, k.v * clip.volume) / 2 * (ROW_H - 8) - 2})`} />)}
        </svg>
      )}
      {clip.transition > 0 && <div className="trans" style={{ width: clip.transition * zoom }} title={`Cross-dissolve ${clip.transition.toFixed(2)}s`} />}
      {clip.fadeIn > 0 && <div className="fade fi" style={{ width: clip.fadeIn * zoom }} />}
      {clip.fadeOut > 0 && <div className="fade fo" style={{ width: clip.fadeOut * zoom }} />}
      <span className="cname">{name}{clip.speed !== 1 ? ` (${clip.speed}x)` : ''}</span>
      <div className="edge l" style={{ width: eg }} onPointerDown={(e) => onTrim(e, clip, 'l')} />
      <div className="edge r" style={{ width: eg }} onPointerDown={(e) => onTrim(e, clip, 'r')} />
    </div>
  )
}

function Playhead() {
  const t = useStore((s) => s.playhead)
  const zoom = useStore((s) => s.zoom)
  return <div className="playhead" style={{ left: LABEL_W + t * zoom - 1 }}><div className="phead" /></div>
}

export function Timeline() {
  const st = useStore()
  const { tracks, clips, zoom } = st
  const scroller = useRef<HTMLDivElement>(null)
  const [guide, setGuide] = useState<number | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  useEffect(() => { if (!ctx) return; const c = () => setCtx(null); window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c) }, [ctx])
  // keep the playhead in view while playing or stepping (page flip, like Premiere)
  useEffect(() => {
    const el = scroller.current; if (!el) return
    const x = LABEL_W + st.playhead * zoom
    if (x < el.scrollLeft + LABEL_W || x > el.scrollLeft + el.clientWidth - 4) el.scrollLeft = Math.max(0, x - LABEL_W - (el.clientWidth - LABEL_W) * 0.1)
  }, [st.playhead])
  const onCtx = (e: React.MouseEvent, c: Clip) => {
    e.preventDefault()
    const s = useStore.getState(); if (!s.selection.includes(c.id)) s.setSelection([c.id])
    setCtx({ x: e.clientX, y: e.clientY, id: c.id })
  }
  const emptyDown = (e: React.PointerEvent) => {
    const tg = e.target as HTMLElement
    if (e.button !== 0 || !(tg.classList.contains('row') || tg.classList.contains('lane'))) return
    const s = useStore.getState(); const base = e.shiftKey ? s.selection : []
    if (!e.shiftKey) s.setSelection([])
    const x0 = e.clientX, y0 = e.clientY; let moved = false
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return
      moved = true; setBox({ x0, y0, x1: ev.clientX, y1: ev.clientY })
      const t0 = Math.min(timeAt(x0), timeAt(ev.clientX)), t1 = Math.max(timeAt(x0), timeAt(ev.clientX))
      const ya = Math.min(y0, ev.clientY), yb = Math.max(y0, ev.clientY)
      const rowsHit = new Set<string>()
      scroller.current!.querySelectorAll<HTMLElement>('[data-track]').forEach((el) => { const r = el.getBoundingClientRect(); if (r.bottom > ya && r.top < yb) rowsHit.add(el.dataset.track!) })
      const hit = useStore.getState().clips.filter((c) => rowsHit.has(c.trackId) && c.start < t1 && c.start + c.dur > t0).map((c) => c.id)
      useStore.getState().setSelection([...new Set([...base, ...hit])])
    }
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setBox(null) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  const rows = [...tracks.filter((t) => t.kind === 'video').reverse(), ...tracks.filter((t) => t.kind === 'audio')]
  const total = Math.max(60, sequenceEnd(clips) + 30)

  const snapPts = (exclude: Set<string>) => {
    const s = useStore.getState()
    const pts = [0, s.playhead]
    for (const c of s.clips) if (!exclude.has(c.id)) pts.push(c.start, clipEnd(c))
    return pts
  }
  const snapTo = (t: number, pts: number[]) => {
    const s = useStore.getState(); if (!s.snap) return t
    const th = 8 / s.zoom
    let best = t, bd = th
    for (const p of pts) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p } }
    setGuide(best !== t ? best : null)
    return best
  }
  const timeAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect()
    return Math.max(0, (clientX - r.left + scroller.current!.scrollLeft - LABEL_W) / useStore.getState().zoom)
  }
  const rowAt = (clientY: number) => {
    const els = scroller.current!.querySelectorAll<HTMLElement>('[data-track]')
    for (const el of els) { const r = el.getBoundingClientRect(); if (clientY >= r.top && clientY < r.bottom) return el.dataset.track! }
    return null
  }

  const onClipDown = (e: React.PointerEvent, c: Clip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = useStore.getState()
    if (s.tool === 'razor') { s.split(snapTo(timeAt(e.clientX), snapPts(new Set())), [c.id]); return }
    let sel = s.selection
    if (e.shiftKey) sel = sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]
    else if (!sel.includes(c.id)) sel = [c.id]
    s.setSelection(sel)
    const grp = s.group(sel)
    const orig = new Map(s.clips.filter((x) => grp.includes(x.id)).map((x) => [x.id, x.start]))
    const x0 = e.clientX; let moved = false
    const pts = snapPts(new Set(grp))
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      const S = useStore.getState()
      if (!moved) { S.pushHistory(); moved = true }
      let dt = (ev.clientX - x0) / S.zoom
      const ps = orig.get(c.id)! + dt, pe = ps + c.dur
      const a = snapTo(ps, pts)
      if (a !== ps) dt = a - orig.get(c.id)!
      else { const b = snapTo(pe, pts); if (b !== pe) dt = b - c.dur - orig.get(c.id)! }
      const minStart = Math.min(...[...orig.values()])
      if (minStart + dt < 0) dt = -minStart
      const row = rowAt(ev.clientY)
      const tr = S.tracks.find((t) => t.id === row)
      useStore.setState((cur) => ({
        clips: cur.clips.map((x) => {
          if (!orig.has(x.id)) return x
          const nx: Clip = { ...x, start: orig.get(x.id)! + dt }
          if (x.id === c.id && tr && tr.kind === x.kind) nx.trackId = tr.id
          if (x.id === c.id && tr && x.kind === 'title' && tr.kind === 'video') nx.trackId = tr.id
          return nx
        }), dirty: true,
      }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) { useStore.getState().overwrite(grp); setGuide(null) } }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const onTrim = (e: React.PointerEvent, c: Clip, edge: 'l' | 'r') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = useStore.getState()
    if (s.tool === 'razor') return
    if (!s.selection.includes(c.id)) s.setSelection([c.id])
    const grp = new Set(s.group([c.id]))
    const lane = s.clips.filter((x) => x.trackId === c.trackId && !grp.has(x.id))
    const prevEnd = Math.max(0, ...lane.filter((x) => x.start + x.dur <= c.start + 1e-4 && !c.transition).map((x) => x.start + x.dur))
    const nextStart = Math.min(Infinity, ...lane.filter((x) => x.start >= c.start + c.dur - 1e-4 && !x.transition).map((x) => x.start))
    const snapshot = new Map(s.clips.filter((x) => grp.has(x.id)).map((x) => [x.id, { ...x }]))
    const pts = snapPts(grp); let started = false
    const move = (ev: PointerEvent) => {
      const S = useStore.getState()
      if (!started) { S.pushHistory(); started = true }
      const minDur = 1 / S.fps
      let t = snapTo(timeAt(ev.clientX), pts)
      useStore.setState((cur) => ({
        clips: cur.clips.map((x) => {
          const o = snapshot.get(x.id); if (!o) return x
          const m = o.mediaId ? cur.media[o.mediaId] : undefined
          if (edge === 'l') {
            let ns = Math.min(t, o.start + o.dur - minDur)
            if (o.kind !== 'title') ns = Math.max(ns, o.start - o.in / o.speed)
            ns = Math.max(0, ns)
            if (x.id === c.id) ns = Math.max(ns, Math.min(prevEnd, o.start))
            const d = ns - o.start
            return { ...o, start: ns, in: o.in + d * o.speed, dur: o.dur - d, keys: o.keys.map((k) => ({ t: k.t - d, v: k.v })), transition: d > 0 ? Math.min(o.transition, o.dur - d) : o.transition }
          }
          let dur = Math.max(minDur, t - o.start)
          if (x.id === c.id && nextStart < Infinity && !o.transOut) dur = Math.min(dur, nextStart - o.start)
          if (m) dur = Math.min(dur, (m.dur - o.in) / o.speed)
          return { ...o, dur }
        }), dirty: true,
      }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setGuide(null) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const scrub = (e: React.PointerEvent) => {
    const go = (ev: { clientX: number }) => engine.seek(snapTo(timeAt(ev.clientX), snapPts(new Set())))
    go(e)
    const mv = (ev: PointerEvent) => go(ev)
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setGuide(null) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }

  tlApi.dropMedia = (id, x, y) => {
    const r = scroller.current!.getBoundingClientRect()
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false
    const row = rowAt(y); if (!row) return false
    const t = snapTo(timeAt(x), snapPts(new Set())); setGuide(null)
    useStore.getState().addFromMedia(id, row, t)
    return true
  }
  useEffect(() => {
    const el = scroller.current!
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const S = useStore.getState(); const r = el.getBoundingClientRect()
      const x = e.clientX - r.left + el.scrollLeft - LABEL_W; const t = x / S.zoom
      S.setZoom(S.zoom * (e.deltaY < 0 ? 1.25 : 0.8))
      requestAnimationFrame(() => { el.scrollLeft = LABEL_W + t * useStore.getState().zoom - (e.clientX - r.left) + 0 })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  // ruler ticks
  const step = zoom > 200 ? 1 : zoom > 80 ? 2 : zoom > 40 ? 5 : zoom > 18 ? 10 : zoom > 9 ? 30 : zoom > 4 ? 60 : zoom > 1.5 ? 120 : zoom > 0.6 ? 300 : 900
  const ticks: number[] = []
  for (let t = 0; t < total; t += step) ticks.push(t)

  return (
    <div className="timeline" ref={scroller}>
      <div className="tl-inner" style={{ width: LABEL_W + total * zoom }}>
        <div className="ruler" onPointerDown={scrub} data-ruler>
          <div className="corner" style={{ width: LABEL_W }} />
          {ticks.map((t) => (
            <div key={t} className="tick" style={{ left: LABEL_W + t * zoom }}>{fmtTime(t, st.fps).slice(3, 8)}</div>
          ))}
        </div>
        {rows.map((tr) => (
          <div key={tr.id} className={`row ${tr.kind}`} data-track={tr.id} style={{ height: ROW_H }}
            onPointerDown={emptyDown}>
            <div className="label" style={{ width: LABEL_W }}>
              <b>{tr.name}</b>
              {tr.kind === 'audio' ? (
                <button className={tr.muted ? 'on' : ''} title="Mute track" onClick={() => st.toggleTrack(tr.id, 'muted')}>M</button>
              ) : (
                <button className={tr.hidden ? 'on' : ''} title="Hide track" onClick={() => st.toggleTrack(tr.id, 'hidden')}>👁</button>
              )}
            </div>
            <div className="lane" style={{ left: LABEL_W }}>
              {clips.filter((c) => c.trackId === tr.id).map((c) => <ClipView key={c.id} clip={c} onDown={onClipDown} onTrim={onTrim} onCtx={onCtx} />)}
            </div>
          </div>
        ))}
        {guide !== null && <div className="snapline" style={{ left: LABEL_W + guide * zoom }} />}
        <Playhead />
      </div>
      {box && <div className="marquee" style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }} />}
      {ctx && (() => { const S = useStore.getState; const c = S().clips.find((x) => x.id === ctx.id); const go = (f: () => void) => () => { f(); setCtx(null) }; return c && (
        <div className="ctx" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
          <div onClick={go(() => S().split(S().playhead, S().group([c.id])))}>Cut at playhead</div>
          <div onClick={go(() => S().copy(S().selection))}>Copy</div>
          <div onClick={go(() => { if (S().copy(S().selection)) S().remove(S().selection, false) })}>Cut</div>
          <div onClick={go(() => S().remove(S().selection, false))}>Delete</div>
          <div onClick={go(() => S().remove(S().selection, true))}>Ripple delete</div>
          {c.link && <div onClick={go(() => S().unlink(S().selection))}>Unlink audio/video</div>}
        </div>) })()}
    </div>
  )
}
