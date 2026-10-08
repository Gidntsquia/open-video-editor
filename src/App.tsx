import { useEffect, useRef, useState } from 'react'
import { useStore, uid } from './store'
import { engine, makeProxy } from './engine'
import { Timeline, fmtTime, tlApi } from './Timeline'
import { EffectsPanel, TransitionPopup, TransitionInspector, PrefsDialog, FourUp, typeName } from './Transitions'
import { edgeOf, edgeInfo } from '../shared/edit.js'
import type { Clip, Media } from './types'
import { FONTS, sequenceEnd } from '../shared/math.js'

async function loadAssets(m: Media) {
  const S = useStore.getState()
  window.api.thumb(m.path, Math.min(1, m.dur / 2)).then((t: string) => useStore.setState((s) => ({ thumbs: { ...s.thumbs, [m.id]: t } }))).catch(() => {})
  if (m.hasAudio) window.api.waveform(m.path).then((w: any) => useStore.setState((s) => ({ waves: { ...s.waves, [m.id]: w } }))).catch(() => {})
  if (m.proxy === undefined && (m.vcodec === 'hevc' || m.w > 1920 || m.bitrate > 40e6)) makeProxy(m.id)
  void S
}

export async function importPaths(paths: string[]) {
  const S = useStore.getState()
  for (const p of paths) {
    try {
      S.setStatus('Importing ' + p.split(/[\\/]/).pop() + '…')
      const info = await window.api.probe(p)
      const m: Media = { ...info, id: uid('m') }
      useStore.getState().addMedia(m)
      loadAssets(m)
    } catch (e: any) { S.setStatus('Import failed: ' + String(e.message || e).slice(0, 200)) }
  }
  useStore.getState().setStatus('Ready')
}

function Bin() {
  const mediaMap = useStore((s) => s.media)
  const media = Object.values(mediaMap)
  const thumbs = useStore((s) => s.thumbs)
  const binSel = useStore((s) => s.binSel)
  const playhead = useStore((s) => s.playhead)
  const addFromMedia = useStore((s) => s.addFromMedia)
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null)
  useEffect(() => { if (!ctx) return; const c = () => setCtx(null); window.addEventListener('pointerdown', c); return () => window.removeEventListener('pointerdown', c) }, [ctx])
  const down = (e: React.PointerEvent, m: Media) => {
    if (e.button !== 0) return
    const S = useStore.getState()
    S.setBinSel(e.shiftKey || e.ctrlKey ? (S.binSel.includes(m.id) ? S.binSel.filter((x) => x !== m.id) : [...S.binSel, m.id]) : [m.id])
    useStore.setState({ selection: [] })
    const x0 = e.clientX, y0 = e.clientY; let moved = false
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      moved = true; setGhost({ x: ev.clientX, y: ev.clientY, name: m.name })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setGhost(null)
      if (moved) tlApi.dropMedia?.(m.id, ev.clientX, ev.clientY)
    }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  return (
    <div className="panel bin" data-bin>
      <div className="ptitle">Media <button onClick={async () => importPaths(await window.api.importDialog())}>Import…</button></div>
      <div className="binlist" onPointerDown={(e) => { if (e.target === e.currentTarget) useStore.getState().setBinSel([]) }}>
        {media.length === 0 && <div className="hint">No media. Click Import… (Ctrl+I) or drop files here.</div>}
        {media.map((m) => (
          <div key={m.id} data-media={m.id} className={`binitem ${binSel.includes(m.id) ? 'sel' : ''}`} onPointerDown={(e) => down(e, m)}
            onContextMenu={(e) => { e.preventDefault(); if (!binSel.includes(m.id)) useStore.getState().setBinSel([m.id]); setCtx({ x: e.clientX, y: e.clientY, id: m.id }) }}
            onDoubleClick={() => addFromMedia(m.id, 'V1', playhead)} title="Drag onto the timeline, or double-click to add at the playhead. Delete removes it from the bin.">
            {thumbs[m.id] ? <img src={thumbs[m.id]} draggable={false} /> : <div className="ph" />}
            <div className="meta">
              <div className="nm">{m.name}</div>
              <div className="sub">{Math.floor(m.dur / 60)}:{String(Math.floor(m.dur % 60)).padStart(2, '0')} · {m.w}×{m.h} · {Math.round(m.fps)}fps{m.hasAudio ? '' : ' · no audio'}</div>
              <div className="sub">{m.vcodec}{m.proxy ? ' · proxy' : ''}{m.proxyBusy ? ' · building proxy…' : ''}
                {!m.proxy && !m.proxyBusy && <a onClick={() => makeProxy(m.id)}> make proxy</a>}</div>
              {m.error && <div className="err">{m.error.slice(0, 80)}</div>}
            </div>
            <button className="rm" title="Remove from bin" onPointerDown={(e) => e.stopPropagation()} onClick={() => useStore.getState().removeMedia([m.id])}>×</button>
          </div>
        ))}
      </div>
      {ghost && <div className="dragghost" style={{ left: ghost.x + 10, top: ghost.y + 10 }}>{ghost.name}</div>}
      {ctx && <div className="ctx" style={{ left: ctx.x, top: ctx.y }} onPointerDown={(e) => e.stopPropagation()}>
        <div onClick={() => { addFromMedia(ctx.id, 'V1', playhead); setCtx(null) }}>Add to timeline at playhead</div>
        <div onClick={() => { useStore.getState().removeMedia(useStore.getState().binSel.length ? useStore.getState().binSel : [ctx.id]); setCtx(null) }}>Remove from bin</div>
      </div>}
    </div>
  )
}

function LeftPanel() {
  const [tab, setTab] = useState<'bin' | 'effects'>('bin')
  return (
    <div className="leftpanel">
      <div className="tabs"><button className={tab === 'bin' ? 'on' : ''} onClick={() => setTab('bin')} data-tab="bin">Bin</button><button className={tab === 'effects' ? 'on' : ''} onClick={() => setTab('effects')} data-tab="effects">Effects</button></div>
      {tab === 'bin' ? <Bin /> : <EffectsPanel />}
    </div>
  )
}

function Timecode() {
  const t = useStore((s) => s.playhead); const fps = useStore((s) => s.fps)
  return <span className="tc">{fmtTime(t, fps)}</span>
}

function Perf() {
  const [, force] = useState(0)
  const playing = useStore((s) => s.playing)
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 500); return () => clearInterval(i) }, [])
  const st = engine.stats
  if (!st.frames) return <span className="perf">idle</span>
  return <span className="perf" data-testid="perf">{playing ? 'playing' : 'stopped'} · {st.fps.toFixed(0)} fps · late frames {st.late}/{st.frames} · dropped video frames {st.dropped}/{st.decoded} · worst {st.worst.toFixed(0)}ms</span>
}

function Preview() {
  const ref = useRef<HTMLCanvasElement>(null)
  const playing = useStore((s) => s.playing)
  const width = useStore((s) => s.width), height = useStore((s) => s.height), fps = useStore((s) => s.fps)
  useEffect(() => { if (ref.current) engine.attach(ref.current) }, [])
  const step = (n: number) => { engine.pause(); engine.seek(Math.max(0, useStore.getState().playhead + n / fps)) }
  return (
    <div className="panel preview">
      <div className="canvaswrap"><canvas ref={ref} width={width} height={height} style={{ aspectRatio: `${width}/${height}` }} /></div>
      <div className="transport">
        <Timecode />
        <button title="Go to start (Home)" onClick={() => engine.seek(0)}>⏮</button>
        <button title="Step back (Left)" onClick={() => step(-1)}>◀|</button>
        <button className="play" title="Play/Pause (Space)" onClick={() => engine.toggle()}>{playing ? '⏸' : '▶'}</button>
        <button title="Step forward (Right)" onClick={() => step(1)}>|▶</button>
        <button title="Go to end (End)" onClick={() => engine.seek(sequenceEnd(useStore.getState().clips))}>⏭</button>
        <select value={`${width}x${height}@${fps}`} onChange={(e) => { const [r, f] = e.target.value.split('@'); const [w, h] = r.split('x'); useStore.getState().setSequence(+w, +h, +f) }}>
          {['1920x1080@30', '1920x1080@60', '1280x720@30', '1280x720@60', '2560x1440@30', '1920x1080@24'].map((o) => <option key={o}>{o}</option>)}
          {!['1920x1080@30', '1920x1080@60', '1280x720@30', '1280x720@60', '2560x1440@30', '1920x1080@24'].includes(`${width}x${height}@${fps}`) && <option>{`${width}x${height}@${fps}`}</option>}
        </select>
      </div>
      <Perf />
    </div>
  )
}

function Num({ label, value, min, max, step, onChange, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label className="num"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      <input type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} onChange={(e) => e.target.value !== '' && onChange(+e.target.value)} />{unit}
    </label>
  )
}

function Inspector() {
  const sel = useStore((s) => s.selection)
  const clips = useStore((s) => s.clips)
  const playhead = useStore((s) => s.playhead)
  const S = useStore.getState
  const selEdge = useStore((s) => s.selEdge)
  const c = clips.find((x) => x.id === sel[0])
  const [kv, setKv] = useState(1)
  if (selEdge && !c) return <TransitionInspector edge={selEdge} />
  if (!c) return <div className="panel inspector"><div className="ptitle">Inspector</div><div className="hint">Select a clip to edit it.</div></div>
  const ids = sel
  const set = (p: Partial<Clip>) => S().setProps(ids, p)
  const setLinked = (p: Partial<Clip>) => S().setProps(S().group(ids), p)
  const crop = (k: 'l' | 'r' | 't' | 'b', v: number) => set({ crop: { ...c.crop, [k]: v } })
  return (
    <div className="panel inspector">
      <div className="ptitle">Inspector · {c.kind}</div>
      <div className="insp">
        {c.kind !== 'title' && <Num label="Speed" value={c.speed} min={0.25} max={4} step={0.05} unit="×" onChange={(v) => S().setSpeed(ids, v)} />}
        {c.kind === 'video' && <>
          <h4>Color</h4>
          <Num label="Brightness" value={c.brightness} min={0} max={2} step={0.01} onChange={(v) => set({ brightness: v })} />
          <Num label="Contrast" value={c.contrast} min={0} max={2} step={0.01} onChange={(v) => set({ contrast: v })} />
          <Num label="Saturation" value={c.saturation} min={0} max={2} step={0.01} onChange={(v) => set({ saturation: v })} />
          <h4>Crop / scale / position</h4>
          <Num label="Crop left" value={c.crop.l} min={0} max={0.9} step={0.01} onChange={(v) => crop('l', v)} />
          <Num label="Crop right" value={c.crop.r} min={0} max={0.9} step={0.01} onChange={(v) => crop('r', v)} />
          <Num label="Crop top" value={c.crop.t} min={0} max={0.9} step={0.01} onChange={(v) => crop('t', v)} />
          <Num label="Crop bottom" value={c.crop.b} min={0} max={0.9} step={0.01} onChange={(v) => crop('b', v)} />
          <Num label="Scale" value={c.scale} min={0.1} max={4} step={0.01} onChange={(v) => set({ scale: v })} />
          <Num label="Position X" value={c.posX} min={-1920} max={1920} step={1} unit="px" onChange={(v) => set({ posX: v })} />
          <Num label="Position Y" value={c.posY} min={-1080} max={1080} step={1} unit="px" onChange={(v) => set({ posY: v })} />
          <h4>Transition</h4>
          <div className="row">
            <button onClick={() => S().setTransition(edgeOf(S().clips, c.id, 'l')!, { align: 0 })}>Add default transition in</button>
            {c.transition > 0 && <button onClick={() => S().removeTransition(edgeOf(S().clips, c.id, 'l')!)}>Remove</button>}
          </div>
          {c.transition > 0 && <div className="hint">{typeName(c.transType)} {c.transition.toFixed(2)} s{(c.transReq ?? c.transition) > c.transition + 1e-6 ? <span className="twarn"> · Insufficient media: shortened to {c.transition.toFixed(2)} s</span> : ''} <a onClick={() => S().setSelEdge(edgeOf(S().clips, c.id, 'l')!)}>edit</a></div>}
        </>}
        {c.kind === 'audio' && <>
          <h4>Audio</h4>
          <Num label="Volume" value={c.volume} min={0} max={2} step={0.01} onChange={(v) => set({ volume: v })} />
          <Num label="Fade in" value={c.fadeIn} min={0} max={Math.max(0.1, c.dur)} step={0.05} unit="s" onChange={(v) => set({ fadeIn: v })} />
          <Num label="Fade out" value={c.fadeOut} min={0} max={Math.max(0.1, c.dur)} step={0.05} unit="s" onChange={(v) => set({ fadeOut: v })} />
          {c.transition > 0 && <div className="hint">Crossfade in: {typeName(c.transType)} {c.transition.toFixed(2)} s</div>}
          <h4>Volume keyframes</h4>
          <div className="row">
            <input type="number" min={0} max={2} step={0.05} value={kv} onChange={(e) => setKv(+e.target.value)} style={{ width: 60 }} />
            <button disabled={playhead < c.start || playhead > c.start + c.dur}
              onClick={() => { const t = playhead - c.start; set({ keys: [...c.keys.filter((k) => Math.abs(k.t - t) > 0.02), { t, v: kv }] }) }}>Add keyframe at playhead</button>
          </div>
          {[...c.keys].sort((a, b) => a.t - b.t).map((k, i) => (
            <div className="row key" key={i}>{k.t.toFixed(2)}s → ×{k.v.toFixed(2)} <button onClick={() => set({ keys: c.keys.filter((x) => x !== k) })}>✕</button></div>
          ))}
        </>}
        {c.kind === 'title' && <>
          <h4>Title</h4>
          <textarea value={c.text} rows={3} onChange={(e) => set({ text: e.target.value })} />
          <label className="num"><span>Font</span>
            <select value={c.font} onChange={(e) => set({ font: e.target.value })}>{Object.keys(FONTS).map((f) => <option key={f}>{f}</option>)}</select></label>
          <Num label="Size" value={c.size || 64} min={8} max={400} step={1} unit="px" onChange={(v) => set({ size: v })} />
          <label className="num"><span>Colour</span><input type="color" value={c.color || '#ffffff'} onChange={(e) => set({ color: e.target.value })} /></label>
          <Num label="X" value={c.x ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => set({ x: v })} />
          <Num label="Y" value={c.y ?? 0.5} min={0} max={1} step={0.01} onChange={(v) => set({ y: v })} />
          <Num label="Duration" value={c.dur} min={0.2} max={60} step={0.1} unit="s" onChange={(v) => set({ dur: v })} />
          <Num label="Start" value={c.start} min={0} max={3600} step={0.1} unit="s" onChange={(v) => set({ start: v })} />
        </>}
      </div>
    </div>
  )
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState(0)
  const [state, setState] = useState<'idle' | 'run' | 'done' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const ls = (k: string, d: string) => { try { return localStorage.getItem(k) || d } catch { return d } }
  const [budget, setBudget] = useState(() => ls('ove.exportBudget', 'balanced'))
  const [encoder, setEncoder] = useState(() => ls('ove.exportEncoder', 'auto'))
  const [adv, setAdv] = useState(false)
  const [used, setUsed] = useState('')
  useEffect(() => { try { localStorage.setItem('ove.exportBudget', budget); localStorage.setItem('ove.exportEncoder', encoder) } catch {} }, [budget, encoder])
  useEffect(() => { window.api.onExportProgress((v: number) => setP(v)); window.api.onExportInfo((v: any) => setUsed(v.encoder)) }, [])
  const go = async () => {
    const out = await window.api.exportDialog(); if (!out) return
    const s = useStore.getState()
    const used = new Set(s.clips.map((c) => c.mediaId).filter(Boolean))
    const media: Record<string, any> = {}
    for (const id of used) { const m = s.media[id!]; media[id!] = { path: m.path, w: m.w, h: m.h, dur: m.dur, hasAudio: m.hasAudio } }
    setState('run'); setP(0); setUsed(''); setMsg(out)
    const t0 = performance.now()
    try {
      const r = await window.api.exportProject({ width: s.width, height: s.height, fps: s.fps, media, tracks: s.tracks, clips: s.clips }, out, { budget, encoder })
      setState('done'); setMsg(`Saved ${r.out}\n${r.total.toFixed(2)}s, ${r.encoder}, took ${((performance.now() - t0) / 1000).toFixed(1)}s`)
    } catch (e: any) { setState('err'); setMsg(String(e.message || e).replace(/^Error invoking remote method 'export': (Error: )?/, '')) }
  }
  useEffect(() => { (window as any).__ove_export = go })
  return (
    <div className="modal"><div className="dlg" data-export>
      <h3>Export MP4</h3>
      {state !== 'run' && <>
        <label className="trow"><span>Budget</span><select value={budget} onChange={(e) => setBudget(e.target.value)} data-budget>
          <option value="fast">Fast (all cores)</option><option value="balanced">Balanced (2 cores free)</option><option value="background">Background (half the cores)</option></select></label>
        <details open={adv} onToggle={(e) => setAdv((e.target as HTMLDetailsElement).open)} data-advanced>
          <summary>Advanced</summary>
          <label className="trow"><span>Encoder</span><select value={encoder} onChange={(e) => setEncoder(e.target.value)} data-encoder>
            <option value="auto">Auto</option><option value="gpu">GPU (NVENC)</option><option value="cpu">CPU (libx264)</option></select></label>
        </details>
      </>}
      {state === 'run' && <><progress value={p} max={1} style={{ width: '100%' }} /><div className="hint">{Math.round(p * 100)}% · {used || '…'}</div></>}
      {state !== 'run' && msg && <pre className="msg">{msg}</pre>}
      <div className="row">
        {state === 'run' && <button onClick={() => window.api.cancelExport()}>Cancel</button>}
        {state !== 'run' && <button className="primary" onClick={go}>Export…</button>}
        {state !== 'run' && <button onClick={onClose}>Close</button>}
      </div>
    </div></div>
  )
}

export default function App() {
  const st = useStore()
  const [showExport, setShowExport] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)

  useEffect(() => {
    window.__ove = { store: useStore, engine, importPaths,
      // control channel (electron/control.js): load a parsed .ovep, then show it
      openData: (data: any, path: string | null) => { engine.pause(); useStore.getState().loadProject(data, path); Object.values(useStore.getState().media).forEach((m) => loadAssets(m as Media)) },
      // preview canvas as a JPEG data URL, longest side <= 512 px
      capture: () => {
        const cv = engine.canvas; if (!cv) return null
        const k = Math.min(1, 512 / Math.max(cv.width, cv.height)); const o = document.createElement('canvas')
        o.width = Math.round(cv.width * k); o.height = Math.round(cv.height * k)
        o.getContext('2d')!.drawImage(cv, 0, 0, o.width, o.height); return o.toDataURL('image/jpeg', 0.7)
      } }
    const unsub = useStore.subscribe((s, p) => { if (s.clips !== p.clips || s.tracks !== p.tracks || s.media !== p.media || s.width !== p.width || s.height !== p.height) engine.invalidate() })
    return unsub
  }, [])

  const save = async (as: boolean) => {
    const S = useStore.getState()
    const p = await window.api.saveProject(S.serialize(), as ? null : S.projectPath)
    if (p) { useStore.setState({ projectPath: p, dirty: false }); S.setStatus('Saved ' + p) }
  }
  const open = async () => {
    if (useStore.getState().dirty && !window.confirm('Discard unsaved changes and open another project?')) return
    const r = await window.api.openProject(null); if (!r) return
    engine.pause(); useStore.getState().loadProject(r.data, r.path)
    Object.values(useStore.getState().media).forEach((m) => loadAssets(m as Media))
    useStore.getState().setStatus('Opened ' + r.path)
  }
  useEffect(() => {
    // empty launch: pre-fill the bin with a few read-only sample clips
    window.__ove.ready = window.api.sampleClips?.().then((ps: string[]) => { if (ps.length && !Object.keys(useStore.getState().media).length && !useStore.getState().projectPath) return importPaths(ps).then(() => useStore.setState({ dirty: false, past: [] })) }).catch(() => {})
  }, [])
  useEffect(() => {
    const name = st.projectPath ? st.projectPath.split(/[\\/]/).pop() : 'Untitled'
    document.title = `${st.dirty ? '* ' : ''}${name} - Open Video Editor`
  }, [st.dirty, st.projectPath])
  useEffect(() => {
    const bu = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', bu); return () => window.removeEventListener('beforeunload', bu)
  }, [])
  useEffect(() => {
    window.api.onMenu(async (m: string) => {
      if (m === 'import') importPaths(await window.api.importDialog())
      if (m === 'open') open()
      if (m === 'save') save(false)
      if (m === 'saveas') save(true)
      if (m === 'export') setShowExport(true)
      if (m === 'prefs') setShowPrefs(true)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement
      if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) && !(tg as HTMLInputElement).type?.match(/range|checkbox/) ) return
      if (tg && tg.tagName === 'BUTTON') tg.blur()  // Space/Enter must not re-press the last toolbar button
      const S = useStore.getState(); const ctrl = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase()
      const fps = S.fps
      let used = true
      if (ctrl && k === 'z' && !e.shiftKey) S.undo()
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) S.redo()
      else if (ctrl && k === 'a') S.setSelection(S.clips.map((c) => c.id))
      else if (ctrl && k === 'c') S.copy(S.selection)
      else if (ctrl && k === 'x') { if (S.copy(S.selection)) S.remove(S.selection, false) }
      else if (ctrl && k === 'v') S.paste(S.playhead)
      else if (ctrl && e.shiftKey && k === 'k') S.split(S.playhead)
      else if (ctrl && k === 'k') S.split(S.playhead, S.selection.length ? S.selection : undefined)
      else if (ctrl && k === 'd') S.applyDefault(e.shiftKey ? 'audio' : 'video')
      else if (ctrl) used = false
      else if (k === ' ') engine.toggle()
      else if (k === 'k') engine.pause()
      else if (k === 'l') { engine.playing && engine.dir > 0 ? null : engine.play(1) }
      else if (k === 'j') { engine.pause(); engine.play(-1) }
      else if (k === 'q') S.rippleTrim(S.playhead, 'start')
      else if (k === 'w') S.rippleTrim(S.playhead, 'end')
      else if (k === ',') S.nudge(S.selection, e.key === '<' || e.shiftKey ? -5 : -1)
      else if (k === '.') S.nudge(S.selection, e.key === '>' || e.shiftKey ? 5 : 1)
      else if (k === 'b') S.setTool('ripple')
      else if (k === 'n') S.setTool('roll')
      else if (k === 'y') S.setTool('slip')
      else if (k === 'u') S.setTool('slide')
      else if (k === 'escape') { S.setPopup(null); S.setSelEdge(null); S.setSelection([]); S.setBinSel([]) }
      else if (k === '\\') S.setZoom(Math.max(0.1, (window.innerWidth - 300) / Math.max(5, sequenceEnd(S.clips) * 1.05)))
      else if (k === 'v') S.setTool('select')
      else if (k === 'c') S.setTool('razor')
      else if ((k === 'delete' || k === 'backspace') && S.selEdge && !S.selection.length) { if (edgeInfo(S.clips, S.selEdge)) S.removeTransition(S.selEdge) }
      else if (k === 'delete' || k === 'backspace') { if (S.binSel.length && !S.selection.length) S.removeMedia(S.binSel); else S.remove(S.selection, e.shiftKey) }
      else if (k === 'arrowleft') { engine.pause(); engine.seek(S.playhead - (e.shiftKey ? 5 : 1) / fps) }
      else if (k === 'arrowright') { engine.pause(); engine.seek(S.playhead + (e.shiftKey ? 5 : 1) / fps) }
      else if (k === 'arrowup' || k === 'arrowdown') {
        const pts = [...new Set(S.clips.flatMap((c) => [c.start, c.start + c.dur]))].sort((a, b) => a - b)
        const eps = 0.5 / fps
        const t = k === 'arrowup' ? [...pts].reverse().find((p) => p < S.playhead - eps) ?? 0 : pts.find((p) => p > S.playhead + eps) ?? S.playhead
        engine.seek(t)
      }
      else if (k === 'home') engine.seek(0)
      else if (k === 'end') engine.seek(sequenceEnd(S.clips))
      else if (k === '=' || k === '+') S.setZoom(S.zoom * 1.25)
      else if (k === '-') S.setZoom(S.zoom / 1.25)
      else used = false
      if (used) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      const files = [...e.dataTransfer.files]; if (files.length) { e.preventDefault(); importPaths(files.map((f: any) => window.api.pathForFile?.(f) || f.path).filter(Boolean)) }
    }}>
      <div className="toolbar">
        <button onClick={async () => importPaths(await window.api.importDialog())}>Import</button>
        <button onClick={() => save(false)}>Save</button>
        <button onClick={open}>Open</button>
        <span className="sep" />
        <button className={st.tool === 'select' ? 'on' : ''} title="Selection tool (V)" onClick={() => st.setTool('select')}>V Select</button>
        <button className={st.tool === 'razor' ? 'on' : ''} title="Razor tool (C)" onClick={() => st.setTool('razor')}>C Razor</button>
        <button className={st.tool === 'ripple' ? 'on' : ''} title="Ripple Edit tool (B)" onClick={() => st.setTool('ripple')}>B Ripple</button>
        <button className={st.tool === 'roll' ? 'on' : ''} title="Rolling Edit tool (N)" onClick={() => st.setTool('roll')}>N Roll</button>
        <button className={st.tool === 'slip' ? 'on' : ''} title="Slip tool (Y)" onClick={() => st.setTool('slip')}>Y Slip</button>
        <button className={st.tool === 'slide' ? 'on' : ''} title="Slide tool (U)" onClick={() => st.setTool('slide')}>U Slide</button>
        <button title="Cut at playhead (Ctrl+K)" onClick={() => st.split(st.playhead, st.selection.length ? st.selection : undefined)}>Cut (Ctrl+K)</button>
        <button title="Delete leaving a gap (Delete)" onClick={() => st.remove(st.selection, false)}>Delete</button>
        <button title="Ripple delete (Shift+Delete)" onClick={() => st.remove(st.selection, true)}>Ripple delete</button>
        <button onClick={() => st.addTitle(st.playhead)}>+ Title</button>
        <button className={st.snap ? 'on' : ''} onClick={() => useStore.setState({ snap: !st.snap })}>Snap</button>
        <button disabled={!st.past.length} onClick={() => st.undo()}>Undo</button>
        <button disabled={!st.future.length} onClick={() => st.redo()}>Redo</button>
        <label className="zoom">Zoom <input type="range" min={-3.3} max={8.6} step={0.05} value={Math.log2(st.zoom)} onChange={(e) => st.setZoom(2 ** +e.target.value)} /></label>
        <span className="grow" />
        <CacheBtn />
        <button className="primary" onClick={() => setShowExport(true)}>Export…</button>
      </div>
      <div className="main"><LeftPanel /><Preview /><Inspector /></div>
      <Timeline />
      <div className="status">{st.status}{st.projectPath ? ` · ${st.projectPath}` : ''}{st.dirty ? ' · unsaved' : ''}</div>
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
      {showPrefs && <PrefsDialog onClose={() => setShowPrefs(false)} />}
      <TransitionPopup />
      <FourUp />
    </div>
  )
}

function CacheBtn() {
  const [info, setInfo] = useState<any>(null)
  useEffect(() => { window.api.cacheInfo().then(setInfo) }, [])
  return <button title={info ? `Cache folder: ${info.dir}\nCapped at ${(info.limit / 1e9).toFixed(0)} GB` : ''}
    onClick={async () => setInfo(await window.api.clearCache())}>Clear cache{info ? ` (${(info.size / 1e6).toFixed(0)} MB)` : ''}</button>
}
