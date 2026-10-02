import { useEffect, useRef, useState } from 'react'
import { useStore, type Edge } from './store'
import { engine } from './engine'
import { tlApi } from './Timeline'
import { VIDEO_TRANSITIONS, AUDIO_TRANSITIONS, TRANSITION_NAMES, transFx, layerRect, DIP_COLOR, audioCurve, isAudioType } from '../shared/math.js'
import { edgeInfo, ALIGN } from '../shared/edit.js'

const ALIGNS: [string, number][] = [['Centre at cut', 0.5], ['Start at cut', 0], ['End at cut', 1]]
export const typeName = (id: string | undefined) => (id && (TRANSITION_NAMES as Record<string, string>)[id]) || 'Cross Dissolve'
const fmt2 = (n: number) => n.toFixed(2)

/** Small animated preview of a type: two coloured frames (A out, B in) or the audio gain curves. */
function FxPreview({ type }: { type: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const g = cv.getContext('2d')!; const W = cv.width, H = cv.height
    let raf = 0; const t0 = performance.now()
    const audio = isAudioType(type)
    const draw = () => {
      const p = (((performance.now() - t0) / 1600) % 1.25) / 1.25
      g.clearRect(0, 0, W, H); g.fillStyle = '#111'; g.fillRect(0, 0, W, H)
      if (audio) {
        g.lineWidth = 2
        for (const [role, col] of [['out', '#ff8a5c'], ['in', '#5cb3ff']] as const) {
          g.strokeStyle = col; g.beginPath()
          for (let i = 0; i <= 40; i++) { const x = i / 40; const v = role === 'in' ? audioCurve(type, x, 'in') : audioCurve(type, 1 - x, 'out'); const px = x * W, py = H - 6 - v * (H - 12); i ? g.lineTo(px, py) : g.moveTo(px, py) }
          g.stroke()
        }
        g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(p * W, 0); g.lineTo(p * W, H); g.stroke(); return
      }
      const pl = { dx: 0, dy: 0, dw: W, dh: H }
      const frame = (col: string, role: 'in' | 'out', label: string) => {
        const fx = transFx(type, role, false, p)
        const lr = layerRect(pl, fx, W, H)
        g.save()
        if (fx.rect) { const [x0, y0, x1, y1] = fx.rect; g.beginPath(); g.rect(x0 * W, y0 * H, (x1 - x0) * W, (y1 - y0) * H); g.clip() }
        g.globalAlpha = fx.alpha; g.fillStyle = col; g.fillRect(lr.x, lr.y, lr.w, lr.h)
        g.fillStyle = '#fff'; g.font = `bold ${H * 0.5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, lr.x + lr.w / 2, lr.y + lr.h / 2)
        g.restore()
      }
      frame('#d2562b', 'out', 'A'); frame('#2b7bd2', 'in', 'B')
      const fx = transFx(type, 'in', false, p)
      const dc = (DIP_COLOR as Record<string, number[]>)[type]
      if (dc && fx.dip > 0) { g.fillStyle = `rgba(${dc[0]},${dc[1]},${dc[2]},${fx.dip})`; g.fillRect(0, 0, W, H) }
    }
    const loop = () => { draw(); raf = requestAnimationFrame(loop) }
    loop(); return () => cancelAnimationFrame(raf)
  }, [type])
  return <canvas ref={ref} width={120} height={68} className="fxprev" />
}

/** Effects tab: search, folders, drag onto edges, right-click -> set default, hover preview. */
export function EffectsPanel() {
  const [q, setQ] = useState('')
  const prefs = useStore((s) => s.prefs)
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const timer = useRef<number>(0)
  const [open, setOpen] = useState({ v: true, a: true })
  useEffect(() => { if (!ctx) return; const c = () => setCtx(null); window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c) }, [ctx])
  const match = (n: string) => !q || n.toLowerCase().includes(q.toLowerCase())
  const isDef = (id: string) => prefs.videoType === id || prefs.audioType === id
  const down = (e: React.PointerEvent, t: { id: string; name: string }) => {
    if (e.button !== 0) return
    clearTimeout(timer.current); setHover(null)
    const x0 = e.clientX, y0 = e.clientY; let moved = false
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      if (!moved) tlApi.setFxDrag?.(t.id)
      moved = true; setGhost({ x: ev.clientX, y: ev.clientY, name: t.name }); tlApi.fxHover?.(ev.clientX, ev.clientY)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setGhost(null)
      if (moved) tlApi.dropEffect?.(t.id, ev.clientX, ev.clientY)
      tlApi.setFxDrag?.(null)
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  const item = (t: { id: string; name: string }) => match(t.name) && (
    <div key={t.id} className="fxitem" data-fx={t.id} onPointerDown={(e) => down(e, t)}
      onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id: t.id }) }}
      onPointerEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover({ id: t.id, x: r.right + 6, y: r.top }), 500) }}
      onPointerLeave={() => { clearTimeout(timer.current); setHover(null) }}>
      <span className="fxico">{isAudioType(t.id) ? '♪' : '▭'}</span>{t.name}{isDef(t.id) && <span className="fxdef" title="Default transition"> ✓</span>}
    </div>
  )
  return (
    <div className="panel bin" data-effects>
      <div className="ptitle">Effects</div>
      <input className="fxsearch" placeholder="Search effects" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="binlist">
        <div className="fxfolder" onClick={() => setOpen({ ...open, v: !open.v })}>{open.v ? '▾' : '▸'} Video Transitions</div>
        {(open.v || q) && VIDEO_TRANSITIONS.map(item)}
        <div className="fxfolder" onClick={() => setOpen({ ...open, a: !open.a })}>{open.a ? '▾' : '▸'} Audio Transitions</div>
        {(open.a || q) && AUDIO_TRANSITIONS.map(item)}
      </div>
      {ghost && <div className="dragghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }}>{ghost.name}</div>}
      {hover && <div className="fxpop" style={{ left: hover.x, top: hover.y }}><FxPreview type={hover.id} /></div>}
      {ctx && <div className="ctx" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
        <div onClick={() => { useStore.getState().setPrefs(isAudioType(ctx.id) ? { audioType: ctx.id } : { videoType: ctx.id }); setCtx(null) }}>Set as default transition</div>
      </div>}
    </div>
  )
}

/** The popup anchored at an edit point: type list, duration, alignment, Apply / Remove. */
export function TransitionPopup() {
  const popup = useStore((s) => s.popup)
  const prefs = useStore((s) => s.prefs)
  const clips = useStore((s) => s.clips)
  const [type, setType] = useState('crossdissolve')
  const [dur, setDur] = useState('1.00')
  const [align, setAlign] = useState(0.5)
  const key = popup ? `${popup.edge.a}/${popup.edge.b}` : ''
  const prim = popup ? clips.find((c) => c.id === (popup.edge.b || popup.edge.a)) : undefined
  const isA = prim?.kind === 'audio'
  const info = popup ? edgeInfo(clips, popup.edge) : null
  useEffect(() => {
    if (!popup) return
    const i = edgeInfo(useStore.getState().clips, popup.edge)
    const a = useStore.getState().clips.find((c) => c.id === (popup.edge.b || popup.edge.a))?.kind === 'audio'
    setType(i?.type && i.type !== 'none' ? i.type : a ? prefs.audioType : prefs.videoType)
    setDur(fmt2(i ? i.req : a ? prefs.audioDur : prefs.videoDur)); setAlign(i && !i.solo ? i.align : 0.5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    if (!popup) return
    const c = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('.tpopup')) useStore.getState().setPopup(null) }
    window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c)
  }, [!!popup])
  if (!popup || !prim) return null
  const list = isA ? AUDIO_TRANSITIONS : VIDEO_TRANSITIONS
  const apply = () => {
    const d = parseFloat(dur); if (!(d > 0)) return
    useStore.getState().setTransition(popup.edge, { type, dur: d, align })
  }
  const solo = !(popup.edge.a && popup.edge.b)
  const left = Math.min(popup.x, window.innerWidth - 260), top = Math.min(popup.y, window.innerHeight - 380)
  return (
    <div className="tpopup" style={{ left, top }} data-tpopup onContextMenu={(e) => e.preventDefault()}>
      <div className="th">{isA ? 'Audio' : 'Video'} transition{solo ? ' (one-sided)' : ''}</div>
      <div className="tlist">
        <div className="tgrp">{isA ? 'Audio Transitions' : 'Video Transitions'}</div>
        {list.map((t) => <div key={t.id} className={`titem ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)} data-ttype={t.id}>{t.name}</div>)}
      </div>
      <label className="trow"><span>Duration</span><input type="number" min={0.04} step={0.05} value={dur} onChange={(e) => setDur(e.target.value)} onBlur={() => setDur(fmt2(parseFloat(dur) || 1))} data-tdur /> s</label>
      <label className="trow"><span>Alignment</span>
        <select value={solo ? 0.5 : align} disabled={solo} onChange={(e) => setAlign(+e.target.value)} data-talign>{ALIGNS.map(([n, v]) => <option key={v} value={v}>{n}</option>)}</select></label>
      {!isA && <label className="trow"><input type="checkbox" checked={prefs.alsoAudio} onChange={(e) => useStore.getState().setPrefs({ alsoAudio: e.target.checked })} /> Also audio (Constant Power crossfade)</label>}
      {info && info.short && <div className="twarn">Insufficient media: shortened to {fmt2(info.dur)} s</div>}
      <div className="trow btns">
        <button className="primary" onClick={apply} data-tapply>Apply</button>
        {info && <button onClick={() => { useStore.getState().removeTransition(popup.edge); useStore.getState().setPopup(null) }} data-tremove>Remove</button>}
        <button onClick={() => useStore.getState().setPopup(null)}>Close</button>
      </div>
    </div>
  )
}

/** Inspector section for the selected transition. */
export function TransitionInspector({ edge }: { edge: Edge }) {
  const clips = useStore((s) => s.clips)
  const info = edgeInfo(clips, edge)
  const prim = clips.find((c) => c.id === (edge.b || edge.a))
  if (!info || !prim) return <div className="panel inspector"><div className="ptitle">Inspector · edit point</div><div className="hint">No transition here. Right-click the edge to add one.</div></div>
  const isA = prim.kind === 'audio'
  const list = isA ? AUDIO_TRANSITIONS : VIDEO_TRANSITIONS
  const S = useStore.getState
  const redo = (o: { type?: string; dur?: number; align?: number }) => S().setTransition(edge, { type: info.type, dur: info.req, align: info.solo ? 0.5 : info.align, ...o })
  // The edge object may refer to ids that survive the re-apply; keep it.
  const curve = isA ? info.type : (clips.find((c) => c.kind === 'audio' && prim.link && c.link === prim.link && (edge.b ? c.id && c.transition > 0 : c.transOut > 0)) ?? null)?.[edge.b ? 'transType' : 'transOutType'] ?? 'none'
  return (
    <div className="panel inspector" data-trinsp>
      <div className="ptitle">Inspector · transition</div>
      <div className="insp">
        <label className="num"><span>Type</span>
          <select value={info.type} onChange={(e) => redo({ type: e.target.value })} data-itype>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="num"><span>Duration</span>
          <input type="number" min={0.04} step={0.05} defaultValue={fmt2(info.req)} key={fmt2(info.req)} onBlur={(e) => { const d = parseFloat(e.target.value); if (d > 0 && Math.abs(d - info.req) > 1e-6) redo({ dur: d }) }} data-idur /> s</label>
        <label className="num"><span>Alignment</span>
          <select value={info.solo ? 0.5 : info.align} disabled={info.solo} onChange={(e) => redo({ align: +e.target.value })}>{ALIGNS.map(([n, v]) => <option key={v} value={v}>{n}</option>)}</select></label>
        {!isA && <div className="hint">Audio curve: {typeName(curve === 'none' ? undefined : curve)}{curve === 'none' ? ' (none)' : ''}</div>}
        {isA && <div className="hint">Audio curve: {typeName(info.type)}</div>}
        {info.short && <div className="twarn" data-short>Insufficient media: shortened to {fmt2(info.dur)} s</div>}
        <div className="row"><button onClick={() => S().removeTransition(edge)}>Remove</button></div>
      </div>
    </div>
  )
}

export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const prefs = useStore((s) => s.prefs)
  const set = useStore.getState().setPrefs
  return (
    <div className="modal"><div className="dlg" data-prefs>
      <h3>Preferences</h3>
      <label className="trow"><span>Video transition duration</span><input type="number" min={0.04} step={0.05} value={prefs.videoDur} onChange={(e) => +e.target.value > 0 && set({ videoDur: +e.target.value })} data-pvdur /> s</label>
      <label className="trow"><span>Audio transition duration</span><input type="number" min={0.04} step={0.05} value={prefs.audioDur} onChange={(e) => +e.target.value > 0 && set({ audioDur: +e.target.value })} data-padur /> s</label>
      <div className="hint">Default video: {typeName(prefs.videoType)} · default audio: {typeName(prefs.audioType)} (right-click an effect to change)</div>
      <div className="row"><button className="primary" onClick={onClose}>Close</button></div>
    </div></div>
  )
}

/** Four-up during slip / slide: outgoing neighbour's last frame, clip first frame | clip last frame, incoming neighbour's first frame. */
export function FourUp() {
  const f = useStore((s) => s.fourUp)
  const clips = useStore((s) => s.clips)
  const media = useStore((s) => s.media)
  const fps = useStore((s) => s.fps)
  const cvs = useRef<(HTMLCanvasElement | null)[]>([])
  const vids = useRef(new Map<string, HTMLVideoElement>())
  useEffect(() => {
    if (!f) { vids.current.forEach((v) => { v.removeAttribute('src'); v.load() }); vids.current.clear(); return }
    const c = clips.find((x) => x.id === f.clipId); if (!c) return
    const lane = clips.filter((x) => x.trackId === c.trackId && x.id !== c.id)
    const prev = lane.filter((x) => Math.abs(x.start + x.dur - c.start) < 0.05).sort((a, b) => b.start - a.start)[0]
    const next = lane.filter((x) => Math.abs(c.start + c.dur - x.start) < 0.05)[0]
    const last = (x: typeof c) => x.in + (x.dur - 1 / fps) * x.speed
    const spec = f.mode === 'slip'
      ? [prev && { c: prev, t: last(prev) }, { c, t: c.in }, { c, t: last(c) }, next && { c: next, t: next.in }]
      : [prev && { c: prev, t: last(prev) }, { c, t: c.in }, { c, t: last(c) }, next && { c: next, t: next.in }]
    spec.forEach((sp, i) => {
      const cv = cvs.current[i]; if (!cv) return
      const g = cv.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height)
      if (!sp || !sp.c.mediaId) return
      const m = media[sp.c.mediaId]; if (!m) return
      let v = vids.current.get(i + m.id)
      if (!v) { v = document.createElement('video'); v.muted = true; v.crossOrigin = 'anonymous'; v.src = (engine as any).mediaSrc(m); vids.current.set(i + m.id, v) }
      const draw = () => { try { g.drawImage(v!, 0, 0, cv.width, cv.height) } catch { /* not ready */ } }
      v.onseeked = draw; v.onloadeddata = draw
      if (Math.abs(v.currentTime - sp.t) > 0.01) v.currentTime = Math.max(0, sp.t); else draw()
    })
  }, [f, clips, media, fps])
  if (!f) return null
  return (
    <div className="fourup" data-fourup>
      {[0, 1, 2, 3].map((i) => <canvas key={i} ref={(el) => { cvs.current[i] = el }} width={240} height={135} className={i < 2 ? 'l' : 'r'} />)}
    </div>
  )
}

void ALIGN
