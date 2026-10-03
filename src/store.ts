import { create } from 'zustand'
import type { Clip, Media, Track, Wave } from './types'
import { sequenceEnd } from '../shared/math.js'
import { edgeOf, applyEdge, removeEdge, edgeInfo, clearIn, clearOut, migrateClips } from '../shared/edit.js'

let idn = Date.now()
export const uid = (p = 'id') => `${p}${(idn++).toString(36)}`

export const TRACKS: Track[] = [
  { id: 'V1', kind: 'video', name: 'V1' }, { id: 'V2', kind: 'video', name: 'V2' }, { id: 'V3', kind: 'video', name: 'V3' },
  { id: 'A1', kind: 'audio', name: 'A1' }, { id: 'A2', kind: 'audio', name: 'A2' }, { id: 'A3', kind: 'audio', name: 'A3' },
]

const blank = (o: Partial<Clip>): Clip => ({
  id: uid('c'), kind: 'video', trackId: 'V1', start: 0, in: 0, dur: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0,
  transition: 0, transOut: 0, brightness: 1, contrast: 1, saturation: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, ...o,
})

export type Tool = 'select' | 'razor' | 'ripple' | 'roll' | 'slip' | 'slide'
export type Edge = { a: string | null; b: string | null }
export type Prefs = { videoType: string; audioType: string; videoDur: number; audioDur: number; alsoAudio: boolean }
export const PREFS0: Prefs = { videoType: 'crossdissolve', audioType: 'constpower', videoDur: 1, audioDur: 1, alsoAudio: true }
const loadPrefs = (): Prefs => { try { return { ...PREFS0, ...JSON.parse(localStorage.getItem('ove.prefs') || '{}') } } catch { return PREFS0 } }

type Snap = { clips: Clip[]; media: Record<string, Media> }
export type State = {
  media: Record<string, Media>
  thumbs: Record<string, string>
  waves: Record<string, Wave>
  tracks: Track[]
  clips: Clip[]
  width: number; height: number; fps: number
  playhead: number
  playing: boolean
  selection: string[]
  tool: Tool
  selEdge: Edge | null
  popup: { x: number; y: number; edge: Edge } | null
  fourUp: { clipId: string; mode: 'slip' | 'slide' } | null
  setPopup: (p: { x: number; y: number; edge: Edge } | null) => void
  prefs: Prefs
  zoom: number // px per second
  snap: boolean
  past: Snap[]; future: Snap[]
  lastEdit: { key: string; t: number }
  projectPath: string | null
  dirty: boolean
  status: string
  // actions
  setStatus: (s: string) => void
  setPlayhead: (t: number) => void
  setSelection: (ids: string[]) => void
  setTool: (t: Tool) => void
  setSelEdge: (e: Edge | null) => void
  setPrefs: (p: Partial<Prefs>) => void
  setZoom: (z: number) => void
  pushHistory: (key?: string) => void
  undo: () => void
  redo: () => void
  addMedia: (m: Media) => void
  removeMedia: (ids: string[]) => number
  binSel: string[]
  setBinSel: (ids: string[]) => void
  overwrite: (ids: string[]) => void
  patchMedia: (id: string, p: Partial<Media>) => void
  setSequence: (w: number, h: number, fps: number) => void
  addFromMedia: (mediaId: string, trackId: string, start: number) => void
  setClips: (fn: (c: Clip[]) => Clip[], history?: boolean | string) => void
  group: (ids: string[]) => string[]
  split: (t: number, ids?: string[]) => void
  remove: (ids: string[], ripple: boolean) => void
  copy: (ids: string[]) => number
  paste: (t: number) => void
  rippleTrim: (t: number, side: 'start' | 'end') => void
  addTitle: (start: number) => void
  unlink: (ids: string[]) => void
  setProps: (ids: string[], patch: Partial<Clip>, key?: string) => void
  setSpeed: (ids: string[], speed: number) => void
  addTransition: (id: string, d: number) => void
  setTransition: (edge: Edge, o: { type?: string; dur?: number; align?: number | string; alsoAudio?: boolean }) => { ok: boolean; dur?: number; req?: number; short?: boolean; msg: string }
  removeTransition: (id: string | Edge) => void
  applyDefault: (kind: 'video' | 'audio') => void
  nudge: (ids: string[], frames: number) => void
  toggleTrack: (id: string, what: 'muted' | 'hidden') => void
  loadProject: (d: any, path: string | null) => void
  serialize: () => any
}

let clipboard: Clip[] = []
export const useStore = create<State>((set, get) => {
  const snap = (): Snap => ({ clips: structuredClone(get().clips), media: get().media })
  return {
    media: {}, thumbs: {}, waves: {}, tracks: TRACKS, clips: [], width: 1920, height: 1080, fps: 30,
    playhead: 0, playing: false, selection: [], binSel: [], tool: 'select', selEdge: null, popup: null, fourUp: null, prefs: loadPrefs(), zoom: 60, snap: true,
    past: [], future: [], lastEdit: { key: '', t: 0 }, projectPath: null, dirty: false, status: 'Ready',
    setStatus: (status) => set({ status }),
    setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
    setSelection: (selection) => set((s) => ({ selection, selEdge: selection.length ? null : s.selEdge, popup: selection.length ? null : s.popup, binSel: selection.length ? [] : s.binSel })),
    setTool: (tool) => set({ tool }),
    setSelEdge: (selEdge) => set({ selEdge, popup: selEdge ? get().popup : null }),
    setPopup: (popup) => set({ popup }),
    setPrefs: (p) => { const prefs = { ...get().prefs, ...p }; try { localStorage.setItem('ove.prefs', JSON.stringify(prefs)) } catch {} set({ prefs }) },
    setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(0.1, zoom)) }),
    pushHistory: (key) => {
      const s = get(); const now = performance.now()
      if (key && s.lastEdit.key === key && now - s.lastEdit.t < 900) { set({ lastEdit: { key, t: now } }); return }
      set({ past: [...s.past.slice(-99), snap()], future: [], lastEdit: { key: key || '', t: now }, dirty: true })
    },
    undo: () => {
      const s = get(); const p = s.past[s.past.length - 1]; if (!p) return
      set({ past: s.past.slice(0, -1), future: [...s.future, snap()], selEdge: null, popup: null, clips: p.clips, media: p.media, lastEdit: { key: '', t: 0 }, dirty: true,
        selection: s.selection.filter((id) => p.clips.some((c) => c.id === id)) })
    },
    redo: () => {
      const s = get(); const f = s.future[s.future.length - 1]; if (!f) return
      set({ future: s.future.slice(0, -1), past: [...s.past, snap()], clips: f.clips, media: f.media, lastEdit: { key: '', t: 0 }, dirty: true })
    },
    addMedia: (m) => set((s) => ({ media: { ...s.media, [m.id]: m }, dirty: true })),
    setBinSel: (binSel) => set({ binSel }),
    removeMedia: (ids) => {
      const s = get(); const del = new Set(ids.filter((i) => s.media[i])); if (!del.size) return 0
      const used = s.clips.filter((c) => c.mediaId && del.has(c.mediaId)).length
      get().pushHistory()
      const media = { ...s.media }; del.forEach((i) => delete media[i])
      const clips = s.clips.filter((c) => !(c.mediaId && del.has(c.mediaId)))
      set({ media, clips, binSel: [], selection: s.selection.filter((i) => clips.some((c) => c.id === i)), dirty: true,
        status: `Removed ${del.size} item${del.size > 1 ? 's' : ''} from the bin` + (used ? ` and ${used} timeline clip${used > 1 ? 's' : ''} using ${del.size > 1 ? 'them' : 'it'} (Ctrl+Z to undo)` : ' (Ctrl+Z to undo)') })
      return used
    },
    // Premiere-style overwrite: clips in `ids` win; same-track clips they cover are trimmed or split.
    overwrite: (ids) => {
      const s = get(); const mv = new Set(ids); const eps = 1e-4
      const links = new Map<string, string>(); const out: Clip[] = []
      for (const c of s.clips) {
        if (mv.has(c.id)) { out.push(c); continue }
        const over = s.clips.filter((m) => mv.has(m.id) && m.trackId === c.trackId && m.start < c.start + c.dur - eps && m.start + m.dur > c.start + eps)
        if (!over.length) { out.push(c); continue }
        // subtract the union of covering intervals from c
        const cov = over.map((m) => [m.start, m.start + m.dur] as [number, number]).sort((a, b) => a[0] - b[0])
        let pos = c.start; const end = c.start + c.dur; const pieces: [number, number][] = []
        for (const [a, b] of cov) { if (a > pos + eps) pieces.push([pos, Math.min(a, end)]); pos = Math.max(pos, b) }
        if (pos < end - eps) pieces.push([pos, end])
        pieces.forEach(([a, b], i) => {
          if (b - a < eps) return
          let link = c.link
          if (c.link && i > 0) { if (!links.has(c.link + i)) links.set(c.link + i, uid('l')); link = links.get(c.link + i) }
          const cut = a - c.start
          let n: Clip = { ...structuredClone(c), id: i === 0 ? c.id : uid('c'), link, start: a, in: c.in + cut * c.speed, dur: b - a,
            keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })), fadeIn: a > c.start + eps ? 0 : c.fadeIn, fadeOut: b < end - eps ? 0 : c.fadeOut }
          if (a > c.start + eps) n = clearIn(n)
          if (b < end - eps) n = clearOut(n)
          out.push(n)
        })
      }
      set({ clips: out, dirty: true })
    },
    patchMedia: (id, p) => set((s) => (s.media[id] ? { media: { ...s.media, [id]: { ...s.media[id], ...p } } } : s)),
    setSequence: (width, height, fps) => set({ width, height, fps, dirty: true }),
    setClips: (fn, history = true) => {
      if (history) get().pushHistory(typeof history === 'string' ? history : undefined)
      set((s) => ({ clips: fn(s.clips), dirty: true }))
    },
    group: (ids) => {
      const cs = get().clips; const links = new Set(cs.filter((c) => ids.includes(c.id)).map((c) => c.link).filter(Boolean))
      return cs.filter((c) => ids.includes(c.id) || (c.link && links.has(c.link))).map((c) => c.id)
    },
    addFromMedia: (mediaId, trackId, start) => {
      const s = get(); const m = s.media[mediaId]; if (!m) return
      const first = s.clips.length === 0
      if (first) {
        const f = m.fps > 50 ? 60 : m.fps > 27 ? 30 : m.fps > 24.5 ? 25 : 24
        set({ width: m.w >= 1900 ? 1920 : m.w >= 1200 ? 1280 : m.w, height: m.w >= 1900 ? 1080 : m.w >= 1200 ? 720 : m.h, fps: f })
      }
      const tr = s.tracks.find((t) => t.id === trackId)
      const link = uid('l')
      const out: Clip[] = []
      if (!tr || tr.kind === 'video') {
        out.push(blank({ kind: 'video', trackId: tr?.id || 'V1', mediaId, start, dur: m.dur, link: m.hasAudio ? link : undefined }))
        if (m.hasAudio) out.push(blank({ kind: 'audio', trackId: 'A' + (tr?.id.slice(1) || '1'), mediaId, start, dur: m.dur, link }))
      } else {
        if (m.hasAudio) out.push(blank({ kind: 'audio', trackId, mediaId, start, dur: m.dur }))
      }
      get().pushHistory()
      set((st) => ({ clips: [...st.clips, ...out], selection: out.map((c) => c.id), dirty: true }))
      get().overwrite(out.map((c) => c.id))
    },
    split: (t, ids) => {
      const s = get(); const eps = 1 / s.fps / 2
      const sel = ids ?? s.clips.filter((c) => t > c.start + eps && t < c.start + c.dur - eps).map((c) => c.id)
      const grp = new Set(s.group(sel))
      const hits = s.clips.filter((c) => grp.has(c.id) && t > c.start + eps && t < c.start + c.dur - eps)
      if (!hits.length) return
      get().pushHistory()
      const links = new Map<string, string>()
      const add: Clip[] = []; const changed = new Map<string, Clip>()
      for (const c of hits) {
        const cut = t - c.start
        const nl = c.link ? (links.get(c.link) ?? (links.set(c.link, uid('l')), links.get(c.link)!)) : undefined
        const right: Clip = { ...clearIn(structuredClone(c)), id: uid('c'), link: nl, start: t, in: c.in + cut * c.speed, dur: c.dur - cut,
          fadeIn: 0, keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })) }
        const left: Clip = { ...clearOut(c), dur: cut, fadeOut: 0 }
        add.push(right); changed.set(c.id, left)
      }
      set((st) => ({ clips: [...st.clips.map((c) => changed.get(c.id) || c), ...add], selection: [], dirty: true }))
    },
    remove: (ids, ripple) => {
      const s = get(); const grp = new Set(s.group(ids)); const del = s.clips.filter((c) => grp.has(c.id))
      if (!del.length) return
      get().pushHistory()
      const trs = new Set(del.map((c) => c.trackId))
      // ripple: merge the removed ranges, move each later clip up by the removed length before it (matches cli/project.js)
      const iv = del.map((c) => [c.start, c.start + c.dur]).sort((x, y) => x[0] - y[0]); const m: number[][] = []
      for (const r of iv) { const l = m[m.length - 1]; if (l && r[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], r[1]); else m.push([...r]) }
      const sh = (t: number) => m.reduce((q, [x, y]) => (y <= t + 1e-6 ? q + (y - x) : q), 0)
      set((st) => ({
        clips: st.clips.filter((c) => !grp.has(c.id)).map((c) => { const d = ripple && trs.has(c.trackId) ? sh(c.start) : 0; return d ? { ...c, start: c.start - d } : c }),
        selection: [], dirty: true,
      }))
    },
    copy: (ids) => {
      const s = get(); const g = new Set(s.group(ids)); clipboard = structuredClone(s.clips.filter((c) => g.has(c.id)))
      if (clipboard.length) set({ status: `Copied ${clipboard.length} clip${clipboard.length > 1 ? 's' : ''}` })
      return clipboard.length
    },
    paste: (t) => {
      if (!clipboard.length) return
      const t0 = Math.min(...clipboard.map((c) => c.start)); const lm = new Map<string, string>()
      const add = clipboard.map((c) => ({ ...clearOut(clearIn(structuredClone(c))), id: uid('c'), start: t + c.start - t0,
        link: c.link ? (lm.get(c.link) ?? (lm.set(c.link, uid('l')), lm.get(c.link)!)) : undefined }))
      get().pushHistory()
      set((st) => ({ clips: [...st.clips, ...add], selection: add.map((c) => c.id), dirty: true }))
      get().overwrite(add.map((c) => c.id))
    },
    rippleTrim: (t, side) => {
      const s = get(); const eps = 1 / s.fps / 2
      const hits = s.clips.filter((c) => t > c.start + eps && t < c.start + c.dur - eps && (!s.selection.length || s.group(s.selection).includes(c.id)))
      if (!hits.length) return
      get().pushHistory()
      const H = new Map(hits.map((c) => [c.id, c]))
      const cutOf = (c: Clip) => (side === 'start' ? t - c.start : c.start + c.dur - t)
      // ripple: everything after the trimmed clips moves up by the removed length, on every track (like a Ctrl-drag trim)
      const sh = Math.max(...hits.map(cutOf)), after = Math.min(...hits.map((x) => x.start + x.dur))
      set((st) => ({ dirty: true, clips: st.clips.map((c) => {
        const h = H.get(c.id)
        if (h) { const cut = cutOf(h); return side === 'start' ? { ...clearIn(h), in: h.in + cut * h.speed, dur: h.dur - cut, fadeIn: 0, keys: h.keys.map((k) => ({ t: k.t - cut, v: k.v })) } : { ...clearOut(h), dur: h.dur - cut, fadeOut: 0 } }
        return c.start >= after - 1e-6 ? { ...c, start: c.start - sh } : c
      }) }))
    },
    unlink: (ids) => {
      const grp = new Set(get().group(ids)); get().pushHistory()
      set((st) => ({ clips: st.clips.map((c) => (grp.has(c.id) ? { ...c, link: undefined } : c)), dirty: true, status: 'Unlinked' }))
    },
    addTitle: (start) => {
      const c = blank({ kind: 'title', trackId: 'V2', start, dur: 3, text: 'New title', font: 'Arial', size: 96, color: '#ffffff', x: 0.5, y: 0.5 })
      get().pushHistory(); set((st) => ({ clips: [...st.clips, c], selection: [c.id], dirty: true }))
    },
    setProps: (ids, patch, key) => {
      const grp = new Set(ids)
      get().pushHistory(key || 'props:' + ids.join())
      set((st) => ({ clips: st.clips.map((c) => (grp.has(c.id) ? { ...c, ...patch } : c)), dirty: true }))
    },
    setSpeed: (ids, speed) => {
      const s0 = get(); const grp = new Set(s0.group(ids))
      if (!(speed > 0)) return
      // a slower clip grows; it may not run into the next clip on its track
      let sp = speed
      for (const c of s0.clips) if (grp.has(c.id)) {
        const nx = s0.clips.filter((x) => x.trackId === c.trackId && !grp.has(x.id) && x.start >= c.start + c.dur - 1e-6).sort((a, b) => a.start - b.start)[0]
        if (nx) sp = Math.max(sp, (c.dur * c.speed) / (nx.start - c.start))
      }
      if (sp > speed + 1e-9) set({ status: `Speed limited to ${(sp * 100).toFixed(1)}%: the clip would run into the next one` })
      get().pushHistory('speed:' + ids.join())
      set((st) => ({ clips: st.clips.map((c) => (grp.has(c.id) ? { ...c, speed: sp, dur: (c.dur * c.speed) / sp, keys: c.keys.map((k) => ({ t: (k.t * c.speed) / sp, v: k.v })) } : c)), dirty: true }))
    },
    addTransition: (id, d) => {
      const s = get(); const c = s.clips.find((x) => x.id === id); if (!c) return
      const e = edgeOf(s.clips, id, 'l'); if (e) get().setTransition(e, { dur: d })
    },
    setTransition: (edge, o) => {
      const s = get(); const prim = s.clips.find((c) => c.id === (edge.b || edge.a)); if (!prim) return { ok: false, msg: 'no edit point' }
      const isA = prim.kind === 'audio'
      const type = o.type ?? (isA ? s.prefs.audioType : s.prefs.videoType)
      const dur = o.dur ?? (isA ? s.prefs.audioDur : s.prefs.videoDur)
      const r = applyEdge(s.clips, s.media, s.fps, edge, { type, dur, align: o.align ?? 0.5, audioType: s.prefs.audioType, alsoAudio: o.alsoAudio ?? s.prefs.alsoAudio })
      if (r.error) { set({ status: r.error }); return { ok: false, msg: r.error } }
      get().pushHistory()
      const msg = r.short ? `Insufficient media: shortened to ${(r.dur ?? 0).toFixed(2)} s` : `Transition ${(r.dur ?? 0).toFixed(2)} s`
      set({ clips: r.clips, dirty: true, status: msg })
      return { ok: true, dur: r.dur, req: r.req, short: r.short, msg }
    },
    removeTransition: (idOrEdge) => {
      const s = get(); const edge = typeof idOrEdge === 'string' ? edgeOf(s.clips, idOrEdge, 'l') : idOrEdge; if (!edge) return
      if (!edgeInfo(s.clips, edge)) return
      get().pushHistory()
      set({ clips: removeEdge(s.clips, edge), dirty: true })
    },
    applyDefault: (kind) => {
      const s = get()
      // edit points: the selected edge, else the edges of the selected clips (Premiere)
      const edges: Edge[] = []
      if (s.selEdge) edges.push(s.selEdge)
      else for (const id of s.selection) { const c = s.clips.find((x) => x.id === id); if (!c || (kind === 'audio') !== (c.kind === 'audio')) continue; const l = edgeOf(s.clips, id, 'l'); if (l) edges.push(l) }
      if (!edges.length) { set({ status: 'Select an edit point or clips first' }); return }
      for (const e of edges) {
        const prim = s.clips.find((c) => c.id === (e.b || e.a)); if (!prim) continue
        const wantAudio = kind === 'audio'
        // Ctrl+Shift+D on a video edit point targets its linked audio edit point
        let edge = e
        if (wantAudio && prim.kind !== 'audio') {
          const la = s.clips.find((c) => c.kind === 'audio' && prim.link && c.link === prim.link); if (!la) continue
          edge = edgeOf(s.clips, la.id, e.b ? 'l' : 'r')!
        }
        get().setTransition(edge, { type: wantAudio ? s.prefs.audioType : s.prefs.videoType, dur: wantAudio ? s.prefs.audioDur : s.prefs.videoDur })
      }
    },
    nudge: (ids, frames) => {
      const s = get(); const grp = new Set(s.group(ids)); if (!grp.size) return
      get().pushHistory()
      const d = frames / s.fps
      const minStart = Math.min(...s.clips.filter((c) => grp.has(c.id)).map((c) => c.start))
      const dd = Math.max(d, -minStart)
      set((st) => ({ clips: st.clips.map((c) => (grp.has(c.id) ? { ...c, start: c.start + dd } : c)), dirty: true }))
      get().overwrite([...grp])
    },
    toggleTrack: (id, what) => set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, [what]: !t[what] } : t)), dirty: true })),
    serialize: () => { const s = get(); return { version: 1, width: s.width, height: s.height, fps: s.fps, media: s.media, tracks: s.tracks, clips: s.clips } },
    loadProject: (d, path) => set({
      media: d.media || {}, tracks: d.tracks || TRACKS, clips: migrateClips(d.clips || []), selEdge: null, popup: null, width: d.width, height: d.height, fps: d.fps,
      playhead: 0, selection: [], binSel: [], past: [], future: [], projectPath: path, dirty: false, thumbs: {}, waves: {},
    }),
  }
})

export const seqEnd = () => sequenceEnd(useStore.getState().clips)
