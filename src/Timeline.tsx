import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import { engine } from './engine'
import type { Clip } from './types'
import { clipEnd, sequenceEnd, isAudioType } from '../shared/math.js'
import { edgeOf, cutOf, edgeInfo, applyEdge, transitionBlocks, trimEdge, rollEdge, slipClip, slideClip } from '../shared/edit.js'
import { typeName } from './Transitions'
import type { Edge } from './store'

export const LABEL_W = 70
export const tlApi: { dropMedia?: (id: string, x: number, y: number) => boolean; dropEffect?: (id: string, x: number, y: number) => boolean; setFxDrag?: (id: string | null) => void; fxHover?: (x: number, y: number) => void } = {}
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

function ClipView({ clip, onDown, onTrim, onCtx, onEdgeCtx }: { clip: Clip; onEdgeCtx: (e: React.MouseEvent, c: Clip, edge: 'l' | 'r') => void; onCtx: (e: React.MouseEvent, c: Clip) => void; onDown: (e: React.PointerEvent, c: Clip) => void; onTrim: (e: React.PointerEvent, c: Clip, edge: 'l' | 'r') => void }) {
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
      {clip.fadeIn > 0 && <div className="fade fi" style={{ width: clip.fadeIn * zoom }} />}
      {clip.fadeOut > 0 && <div className="fade fo" style={{ width: clip.fadeOut * zoom }} />}
      <span className="cname">{name}{clip.speed !== 1 ? ` (${clip.speed}x)` : ''}</span>
      <div className="edge l" style={{ width: eg }} onPointerDown={(e) => onTrim(e, clip, 'l')} onContextMenu={(e) => onEdgeCtx(e, clip, 'l')} />
      <div className="edge r" style={{ width: eg }} onPointerDown={(e) => onTrim(e, clip, 'r')} onContextMenu={(e) => onEdgeCtx(e, clip, 'r')} />
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
  const [fxDrag, setFxDrag] = useState<string | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const [ctrl, setCtrl] = useState(false)
  const selEdge = st.selEdge
  useEffect(() => { const f = (e: KeyboardEvent) => setCtrl(e.ctrlKey || e.metaKey); window.addEventListener('keydown', f); window.addEventListener('keyup', f); return () => { window.removeEventListener('keydown', f); window.removeEventListener('keyup', f) } }, [])
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
    if (s.tool === 'slip' || s.tool === 'slide') {
      s.setSelection([c.id]); const orig = s.clips; const x0 = e.clientX; let started = false; const grp = s.group([c.id]); const mode = s.tool
      const mv = (ev: PointerEvent) => {
        if (!started && Math.abs(ev.clientX - x0) < 3) return
        const S = useStore.getState()
        if (!started) { S.pushHistory(); started = true; useStore.setState({ fourUp: { clipId: c.id, mode } }) }
        const d = Math.round(((ev.clientX - x0) / S.zoom) * S.fps) / S.fps
        useStore.setState({ clips: mode === 'slip' ? slipClip(orig, S.media, S.fps, c.id, d) : slideClip(orig, S.media, S.fps, c.id, d), dirty: true })
      }
      const upp = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upp); useStore.setState({ fourUp: null }); if (started) useStore.getState().overwrite(grp) }
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upp); return
    }
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

  const selectEdge = (ed: Edge, x: number, y: number, popup = true) => {
    const S = useStore.getState(); S.setSelection([]); S.setSelEdge(ed); S.setPopup(popup ? { x, y, edge: ed } : null)
  }
  const onEdgeCtx = (e: React.MouseEvent, c: Clip, edge: 'l' | 'r') => {
    e.preventDefault(); e.stopPropagation()
    selectEdge(edgeOf(useStore.getState().clips, c.id, edge)!, e.clientX, e.clientY)
  }
  const onTrim = (e: React.PointerEvent, c: Clip, edge: 'l' | 'r') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s = useStore.getState()
    if (s.tool === 'razor') return
    const ed = edgeOf(s.clips, c.id, edge)!
    const orig = s.clips
    const ripple = s.tool === 'ripple' || e.ctrlKey || e.metaKey
    const roll = s.tool === 'roll'
    const grp = s.group([c.id])
    const cx = e.clientX, cy = e.clientY; let started = false
    const pts = snapPts(new Set(grp))
    const cut0 = edge === 'l' ? c.start : c.start + c.dur
    if (roll && !(ed.a && ed.b)) { s.setSelection([c.id]); return }
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - cx) < 3) return
      const S = useStore.getState()
      if (!started) { S.pushHistory(); started = true }
      const t = snapTo(timeAt(ev.clientX), pts)
      const next = roll ? rollEdge(orig, S.media, S.fps, ed.a, ed.b, t - cut0) : trimEdge(orig, S.media, S.fps, c.id, edge, t, ripple)
      useStore.setState({ clips: next, dirty: true, selection: grp, selEdge: null, popup: null })
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setGuide(null)
      if (started) useStore.getState().overwrite(grp)
      else if (s.tool === 'select' && !ripple) selectEdge(ed, cx, cy)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  // ---- transition blocks (drag edges = duration, drag body = alignment) ----
  const blocks = useMemo(() => transitionBlocks(clips) as { id: string; edge: Edge; trackId: string; t0: number; t1: number; type: string; short: boolean; req: number; kind: string }[], [clips])
  const onBlock = (e: React.PointerEvent, b: (typeof blocks)[0], mode: 'l' | 'r' | 'move') => {
    if (e.button !== 0) return
    e.stopPropagation()
    const s0 = useStore.getState(); const info = edgeInfo(s0.clips, b.edge); if (!info) return
    const orig = s0.clips; const x0 = e.clientX; let started = false
    s0.setSelection([]); s0.setSelEdge(b.edge)
    const fps = s0.fps
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - x0) < 3) return
      const S = useStore.getState()
      if (!started) { S.pushHistory(); started = true }
      const dt = (ev.clientX - x0) / S.zoom
      let dur = info.req, align = info.align
      if (mode === 'r') dur = info.dur + dt
      else if (mode === 'l') dur = info.dur - dt
      else if (!info.solo) { align = Math.min(1, Math.max(0, info.align - dt / info.dur)); for (const a of [0, 0.5, 1]) if (Math.abs(align - a) < 0.08) align = a }
      dur = Math.max(1 / fps, Math.round(dur * fps) / fps)
      const prim = orig.find((c) => c.id === (b.edge.b || b.edge.a))
      const r = applyEdge(orig, S.media, fps, b.edge, { type: info.type === 'none' ? undefined : info.type, dur, align, audioType: S.prefs.audioType, alsoAudio: S.prefs.alsoAudio })
      if (!('error' in r && r.error) && prim) useStore.setState({ clips: r.clips, dirty: true, status: r.short ? `Insufficient media: shortened to ${(r.dur ?? 0).toFixed(2)} s` : `Transition ${(r.dur ?? 0).toFixed(2)} s` })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  // ---- drag-and-drop of effects onto edit points ----
  const targets = (fx: string | null) => {
    if (!fx) return []
    const aud = isAudioType(fx); const seen = new Set<string>(); const out: { key: string; edge: Edge; t: number; trackId: string }[] = []
    const add = (ed: Edge) => {
      const key = `${ed.a}/${ed.b}`; if (seen.has(key)) return; seen.add(key)
      const a = ed.a ? clips.find((c) => c.id === ed.a) : null, b = ed.b ? clips.find((c) => c.id === ed.b) : null
      const prim = b || a; if (!prim || (prim.kind === 'audio') !== aud) return
      out.push({ key, edge: ed, t: a && b ? cutOf(a, b) : b ? b.start : a!.start + a!.dur, trackId: prim.trackId })
    }
    for (const c of clips) { add(edgeOf(clips, c.id, 'l')!); const r = edgeOf(clips, c.id, 'r')!; if (!r.b) add(r) }
    return out
  }
  const nearest = (fx: string, x: number, y: number) => {
    const row = rowAt(y); if (!row) return null
    const t = timeAt(x); let best: ReturnType<typeof targets>[0] | null = null, bd = 16 / useStore.getState().zoom
    for (const g of targets(fx)) if (g.trackId === row) { const d = Math.abs(g.t - t); if (d < bd) { bd = d; best = g } }
    return best
  }
  tlApi.setFxDrag = (id) => { setFxDrag(id); if (!id) setHot(null) }
  tlApi.fxHover = (x, y) => setHot(fxDrag ? nearest(fxDrag, x, y)?.key ?? null : null)
  tlApi.dropEffect = (id, x, y) => {
    const g = nearest(id, x, y); if (!g) return false
    const S = useStore.getState(); S.setSelection([]); S.setSelEdge(g.edge)
    return S.setTransition(g.edge, { type: id }).ok
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
    <div className={`timeline tool-${st.tool} ${ctrl ? 'ctrl' : ''}`} ref={scroller}>
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
              {clips.filter((c) => c.trackId === tr.id).map((c) => <ClipView key={c.id} clip={c} onDown={onClipDown} onTrim={onTrim} onCtx={onCtx} onEdgeCtx={onEdgeCtx} />)}
              {blocks.filter((b) => b.trackId === tr.id).map((b) => {
                const w = Math.max(6, (b.t1 - b.t0) * zoom); const sel = selEdge && selEdge.a === b.edge.a && selEdge.b === b.edge.b
                return (
                  <div key={b.id} className={`tblock ${b.kind} ${b.short ? 'short' : ''} ${sel ? 'sel' : ''}`} data-tblock={b.id} style={{ left: b.t0 * zoom, width: w }}
                    title={b.short ? `Insufficient media: shortened to ${(b.t1 - b.t0).toFixed(2)} s` : `${typeName(b.type)} ${(b.t1 - b.t0).toFixed(2)} s`}
                    onPointerDown={(e) => onBlock(e, b, 'move')}
                    onDoubleClick={(e) => selectEdge(b.edge, e.clientX, e.clientY)}
                    onContextMenu={(e) => { e.preventDefault(); selectEdge(b.edge, e.clientX, e.clientY) }}>
                    {w > 60 && <span className="tlabel">{typeName(b.type)}</span>}
                    <div className="th l" onPointerDown={(e) => onBlock(e, b, 'l')} /><div className="th r" onPointerDown={(e) => onBlock(e, b, 'r')} />
                  </div>)
              })}
              {selEdge && (() => {
                const a = selEdge.a ? clips.find((c) => c.id === selEdge.a) : null, b = selEdge.b ? clips.find((c) => c.id === selEdge.b) : null
                const prim = b || a; if (!prim || prim.trackId !== tr.id) return null
                const t = a && b ? cutOf(a, b) : b ? b.start : a!.start + a!.dur
                return <div className={`editpt ${a && b ? 'join' : b ? 'in' : 'out'}`} data-editpt style={{ left: t * zoom - (a && b ? 5 : b ? 0 : 6) }} />
              })()}
              {fxDrag && targets(fxDrag).filter((g) => g.trackId === tr.id).map((g) => <div key={g.key} className={`dropt ${hot === g.key ? 'hot' : ''}`} data-drop={g.key} style={{ left: g.t * zoom - 7 }} />)}
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
