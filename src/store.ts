import { create } from 'zustand'
import type { Clip, Media, Track, Wave } from './types'
import { sequenceEnd } from '../shared/math.js'

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
  tool: 'select' | 'razor'
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
  setTool: (t: 'select' | 'razor') => void
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
  addTitle: (start: number) => void
  setProps: (ids: string[], patch: Partial<Clip>, key?: string) => void
  setSpeed: (ids: string[], speed: number) => void
  addTransition: (id: string, d: number) => void
  removeTransition: (id: string) => void
  toggleTrack: (id: string, what: 'muted' | 'hidden') => void
  loadProject: (d: any, path: string | null) => void
  serialize: () => any
}

export const useStore = create<State>((set, get) => {
  const snap = (): Snap => ({ clips: structuredClone(get().clips), media: get().media })
  return {
    media: {}, thumbs: {}, waves: {}, tracks: TRACKS, clips: [], width: 1920, height: 1080, fps: 30,
    playhead: 0, playing: false, selection: [], binSel: [], tool: 'select', zoom: 60, snap: true,
    past: [], future: [], lastEdit: { key: '', t: 0 }, projectPath: null, dirty: false, status: 'Ready',
    setStatus: (status) => set({ status }),
    setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
    setSelection: (selection) => set((s) => ({ selection, binSel: selection.length ? [] : s.binSel })),
    setTool: (tool) => set({ tool }),
    setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(0.1, zoom)) }),
    pushHistory: (key) => {
      const s = get(); const now = performance.now()
      if (key && s.lastEdit.key === key && now - s.lastEdit.t < 900) { set({ lastEdit: { key, t: now } }); return }
      set({ past: [...s.past.slice(-99), snap()], future: [], lastEdit: { key: key || '', t: now }, dirty: true })
    },
    undo: () => {
      const s = get(); const p = s.past[s.past.length - 1]; if (!p) return
      set({ past: s.past.slice(0, -1), future: [...s.future, snap()], clips: p.clips, media: p.media, lastEdit: { key: '', t: 0 }, dirty: true,
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
          out.push({ ...structuredClone(c), id: i === 0 ? c.id : uid('c'), link, start: a, in: c.in + cut * c.speed, dur: b - a,
            keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })), transition: a > c.start + eps ? 0 : c.transition,
            transOut: b < end - eps ? 0 : c.transOut, fadeIn: a > c.start + eps ? 0 : c.fadeIn, fadeOut: b < end - eps ? 0 : c.fadeOut })
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
        const right: Clip = { ...structuredClone(c), id: uid('c'), link: nl, start: t, in: c.in + cut * c.speed, dur: c.dur - cut,
          transition: 0, fadeIn: 0, keys: c.keys.map((k) => ({ t: k.t - cut, v: k.v })) }
        const left: Clip = { ...c, dur: cut, transOut: 0, fadeOut: 0 }
        add.push(right); changed.set(c.id, left)
      }
      set((st) => ({ clips: [...st.clips.map((c) => changed.get(c.id) || c), ...add], selection: [], dirty: true }))
    },
    remove: (ids, ripple) => {
      const s = get(); const grp = new Set(s.group(ids)); const del = s.clips.filter((c) => grp.has(c.id))
      if (!del.length) return
      get().pushHistory()
      const gs = Math.min(...del.map((c) => c.start)), ge = Math.max(...del.map((c) => c.start + c.dur))
      const trs = new Set(del.map((c) => c.trackId))
      set((st) => ({
        clips: st.clips.filter((c) => !grp.has(c.id)).map((c) => (ripple && trs.has(c.trackId) && c.start >= ge - 1e-6 ? { ...c, start: c.start - (ge - gs) } : c)),
        selection: [], dirty: true,
      }))
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
      const grp = new Set(get().group(ids))
      get().pushHistory('speed:' + ids.join())
      set((st) => ({ clips: st.clips.map((c) => (grp.has(c.id) ? { ...c, speed, dur: (c.dur * c.speed) / speed } : c)), dirty: true }))
    },
    addTransition: (id, d) => {
      const s = get(); const b = s.clips.find((c) => c.id === id); if (!b) return
      const partners = s.clips.filter((c) => c.link && c.link === b.link)
      const pairs: [Clip, Clip][] = []
      for (const cur of [b, ...partners]) {
        const prev = s.clips.filter((c) => c.trackId === cur.trackId && c.id !== cur.id && c.kind !== 'title' && Math.abs(c.start + c.dur - cur.start) < 0.05).sort((x, y) => y.start - x.start)[0]
        if (prev) pairs.push([prev, cur])
      }
      if (!pairs.length) { set({ status: 'Dissolve needs a clip ending exactly where this one starts on the same track.' }); return }
      get().pushHistory()
      const upd = new Map<string, Partial<Clip>>()
      for (const [prev, cur] of pairs) {
        const m = prev.mediaId ? s.media[prev.mediaId] : undefined
        // extend the previous clip into its handle; if there is none, pull the next clip earlier
        const handle = m ? m.dur - (prev.in + prev.dur * prev.speed) : 0
        const ext = Math.min(d, handle / prev.speed)
        const shift = d - ext
        upd.set(prev.id, { dur: prev.dur + ext, transOut: d })
        upd.set(cur.id, { start: cur.start - shift, transition: d })
        if (shift > 1e-6) { /* subsequent clips keep position; overlap is created by moving cur earlier */ }
      }
      set((st) => ({ clips: st.clips.map((c) => (upd.has(c.id) ? { ...c, ...upd.get(c.id) } : c)), dirty: true }))
    },
    removeTransition: (id) => {
      const s = get(); const b = s.clips.find((c) => c.id === id); if (!b) return
      get().pushHistory()
      set((st) => ({ clips: st.clips.map((c) => (c.id === id || (b.link && c.link === b.link) ? { ...c, transition: 0 } : c)).map((c) => (c.transOut && !st.clips.some((x) => x.trackId === c.trackId && x.transition > 0 && Math.abs(x.start - (c.start + c.dur - c.transOut)) < 0.05 && x.id !== id && x.link !== b.link) ? { ...c, transOut: 0 } : c)), dirty: true }))
    },
    toggleTrack: (id, what) => set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, [what]: !t[what] } : t)), dirty: true })),
    serialize: () => { const s = get(); return { version: 1, width: s.width, height: s.height, fps: s.fps, media: s.media, tracks: s.tracks, clips: s.clips } },
    loadProject: (d, path) => set({
      media: d.media || {}, tracks: d.tracks || TRACKS, clips: d.clips || [], width: d.width, height: d.height, fps: d.fps,
      playhead: 0, selection: [], binSel: [], past: [], future: [], projectPath: path, dirty: false, thumbs: {}, waves: {},
    }),
  }
})

export const seqEnd = () => sequenceEnd(useStore.getState().clips)
