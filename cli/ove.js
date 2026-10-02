#!/usr/bin/env node
// ove: headless, token-efficient editor CLI for the app's .ovep projects. See `ove help`.
import fs from 'node:fs'
import path from 'node:path'
import { sequenceEnd } from '../shared/math.js'
import * as P from './project.js'
import * as E from '../shared/edit.js'
import * as U from './probe.js'
import * as R from './render.js'
import * as J from './jobs.js'
import * as C from './cache.js'
import { setClock, clock, elapsed } from './run.js'
import { Err, fail, tokenize, parseArgs, parseTime, num, atomicWrite, toLocal, toStored, r2, r3, cacheDir } from './util.js'

const HELP = `ove <cmd> [args] [-p file.ovep]   one command per call, or one per stdin line (batch, one process). Reply: one JSON line.
  ok -> {"ok":1,...}  error -> {"err":"..."}  exit 1 on error. Batch: --stop halts at first error.
  Times: 12.5 | 1:05 | 0:01:05.5. Ids: m1 (media) c7 (clip), stable across save/load. Linked video+audio move/cut/rm together.
PROJECT (single call: changes auto-save to -p; batch: only on "save")
  new [-w 1920 -h 1080 -fps 30]      fresh project (size/fps auto-set by the first clip unless given)
  import <path...>                   add media -> id,dur,w,h,fps,audio
  add <mId> [V1|A1..] [@t] [in=s] [dur=s]   video+linked audio at t (default: timeline end); overwrites what it lands on
  cut <t> [ids]                      split at t (all clips under t, or just ids)
  rm <ids> [--ripple]                delete, optionally close the gap
  move <id> @t [track]               move (group moves together)
  trim <id> in=|out=|start=|end=     in/out = source secs, start/end = timeline secs; head trims keep the end fixed
  speed <id> <x>                     0.5 = slow; clamped so it does not run into the next clip
  set <id> k=v...                    volume brightness contrast saturation scale posX posY fadeIn fadeOut transition transOut
                                     start in dur | crop.l/r/t/b (0-1) | titles: text font size color x y
  keys <id> t:v,t:v | -              volume keyframes (t = secs from clip start, v = gain); - clears
  fade <id> in=s out=s               audio fade in/out
  dissolve <id> [dur=1]              alias: Cross Dissolve at the start of <id> (start-aligned)
  transition <edge> type=<name> [dur=1 align=centre|start|end audio=0|1]   edge = <clipId>:in|out or <clipA>/<clipB>
                                     types: crossdissolve dipblack dipwhite filmdissolve wipeleft|right|up|down pushleft|right|up|down crosszoom blurdissolve
                                     (audio edges: constpower constgain expfade). Short media -> shortened, reply has short:1
  rm-transition <edge>               remove it (restores the clips' overlap)
  title @t [dur=3] text="Hi\\nthere" [font=Arial size=96 color=#fff x=.5 y=.5 track=V2]
  track <V2|A1> mute|unmute|hide|show   (mute = audio tracks, hide = video tracks)
  undo                               batch only: revert the last changing command
  save [path]                        atomic write
  show [--media] [--json]            header + one line per clip: id track start-end src[in-out] xSpeed volN fx...
UNDERSTAND (media path or mediaId) - small bursts: scan first, then zoom with --from/--to
  scan <m>                           one fast pass: facts, keyframe scene candidates, loudness per 10s, silences, "zoom" hints
  probe <m>                          dur,w,h,fps,audio,vcodec
  scenes <m> [--thr 0.3]             scene-cut seconds
  silence <m> [--db -35 --min 1]     [[start,end],..]
  loud <m> [--top 20 --win 2]        loudest windows [t,peak_db,rms_db]
  frames <m> --every 30s | --at t,t  JPGs <=320px -> cache/ove/
  sheet <m> [--cols 6 --n 36]        one contact-sheet JPG with timestamps
  transcript <m>                     [{t,d,text}] via OVE_WHISPER (GPU faster-whisper, see README; "{wav}" marks the wav arg)
  Every probe: --from t --to t (absolute source secs; no range = whole file if <=120s, else first 60s + "more").
  --budget s  stop after s secs (default 20, transcript/preview 60) -> {"partial":1,"done_to":t,"retry":"..."}; exit 0.
  --bg        run detached -> {"job":"j1"}; job j1 [--cancel] polls/stops it; jobs lists them (bg budget default 600).
  Replies carry ms and "cached":1|"part" (results, WAV and a 320p proxy are cached per file in cache/ove/). OVE_DEBUG=1 logs ffmpeg args.
  Failed batch lines: remaining lines still run, a summary line lists failures; re-piping the same stdin skips finished lines.
SELF-CHECK
  frame --at t,t                     the composed timeline frame(s) as PNG, all in one ffmpeg run (same graph as the app's export)
  preview [-o out.mp4]               480p render of the whole timeline
  check                              lint: gaps, overlaps, reads past media end, missing files, muted/hidden tracks
Export to MP4 happens in the app: open the .ovep there, review, export.`

const MUT = new Set(['new', 'import', 'add', 'cut', 'rm', 'move', 'trim', 'speed', 'set', 'keys', 'fade', 'dissolve', 'transition', 'rm-transition', 'title', 'track'])
const NUMERIC = ['volume', 'brightness', 'contrast', 'saturation', 'scale', 'posX', 'posY', 'fadeIn', 'fadeOut', 'transition', 'transOut', 'transAlign', 'start', 'in', 'dur', 'size', 'x', 'y']
const STRINGS = ['text', 'font', 'color', 'transType', 'transOutType']

const ctx = { proj: null, file: null, history: [], batch: false, sizeLocked: false, loaded: false }
const need = () => ctx.proj || fail('no project: pass -p file.ovep or run new')

function loadFile(file) {
  if (!fs.existsSync(file)) fail(`project not found: ${file}`)
  ctx.proj = P.loadProject(fs.readFileSync(file, 'utf8'), file); ctx.file = file
}

const mediaArg = (s) => {
  if (ctx.proj && ctx.proj.media[s]) return { file: toLocal(ctx.proj.media[s].path), m: ctx.proj.media[s] }
  return { file: toLocal(s), m: null }
}
async function mediaInfo(s) {
  const { file, m } = mediaArg(s)
  if (!fs.existsSync(file)) fail(`file not found: ${file}`)
  const f = m || await U.facts(file)
  return { file, ref: s, id: C.fid(file), dur: f.dur, w: f.w, h: f.h, fps: f.fps, audio: !!f.hasAudio, size: fs.statSync(file).size }
}
const PROBES = new Set(['probe', 'scan', 'scenes', 'silence', 'loud', 'frames', 'sheet', 'transcript'])
const RETRY = new Set([...PROBES, 'frame', 'preview'])
const qt = (x) => (x === '' || /[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)
function retryLine(tokens, cli, from) {
  const o = []
  for (let i = 0; i < tokens.length; i++) { if (tokens[i] === '--bg') continue; if (from != null && tokens[i] === '--from') { i++; continue } o.push(tokens[i]) }
  if (from != null) o.push('--from', String(from))
  if (cli.p) o.push('-p', cli.p)
  return o.map(qt).join(' ')
}
const timeList = (s) => String(s).split(',').filter(Boolean).map((x) => parseTime(x))

function pos(a, n, usage) { if (a.pos.length < n) fail(`usage: ${usage}`); return a.pos }
function checkRange(c, k, v) {
  if (['volume', 'brightness', 'contrast', 'saturation', 'fadeIn', 'fadeOut', 'transition', 'transOut'].includes(k) && v < 0) fail(`${k} must be >= 0`)
  if (['scale', 'size'].includes(k) && !(v > 0)) fail(`${k} must be > 0`)
  if (['x', 'y'].includes(k) && (v < 0 || v > 1)) fail(`${k} must be 0-1`)
  if (k === 'start' && v < 0) fail('start must be >= 0')
  if (k === 'in' && v < 0) fail('in must be >= 0')
  if (k === 'dur' && !(v > 0)) fail('dur must be > 0')
}

// Returns the reply fields (minus ok). Mutations run on a copy, validate, then replace the project.
async function mutate(cmd, a) {
  const p = structuredClone(need()); let res = {}
  switch (cmd) {
    case 'import': {
      if (!a.pos.length) fail('usage: import <path...>')
      const rows = []
      for (const raw of a.pos) {
        const f = path.resolve(toLocal(raw)); const stored = toStored(f)
        const dup = Object.values(p.media).find((m) => m.path === stored)
        if (dup) { rows.push(dup); continue }
        const info = await U.facts(f); const id = P.nid(p, 'm')
        p.media[id] = { id, ...info, path: stored }; rows.push(p.media[id])
      }
      res = { m: rows.map((m) => ({ id: m.id, dur: r2(m.dur), w: m.w, h: m.h, fps: r2(m.fps), audio: m.hasAudio ? 1 : 0 })) }
      break
    }
    case 'add': {
      const [mid, tr] = pos(a, 1, 'add <mediaId> [track] [@start] [in=] [dur=]')
      const start = a.at != null ? parseTime(a.at) : sequenceEnd(p.clips)
      const ids = P.addFromMedia(p, mid, tr || 'V1', start, a.kv.in != null ? parseTime(a.kv.in) : 0, a.kv.dur != null ? parseTime(a.kv.dur) : undefined, ctx.sizeLocked)
      res = { c: ids, end: r2(sequenceEnd(p.clips)) }
      break
    }
    case 'cut': {
      const t = parseTime(pos(a, 1, 'cut <t> [ids]')[0]); if (t < 0) fail('time must be >= 0')
      const ids = a.pos.length > 1 ? P.parseIds(p, a.pos.slice(1)) : undefined
      res = { c: P.split(p, t, ids) }
      break
    }
    case 'rm': {
      const ids = P.parseIds(p, pos(a, 1, 'rm <ids> [--ripple]'))
      res = { n: P.remove(p, ids, !!a.flags.ripple) }
      break
    }
    case 'move': {
      const [id] = pos(a, 1, 'move <id> @t [track]'); const c = P.find(p, id)
      if (a.at == null && a.pos.length < 2 && a.kv.start == null) fail('usage: move <id> @t [track]')
      const t = parseTime(a.at ?? a.kv.start ?? a.pos[1]); if (t < 0) fail('start must be >= 0')
      const trk = a.pos.find((x, i) => i >= 1 && /^[VA]\d+$/.test(x))
      const grp = P.group(p, [id]); const d = t - c.start
      if (trk) {
        const tr = P.trackOf(p, trk) || fail(`unknown track ${trk}`)
        if (tr.kind !== (c.kind === 'audio' ? 'audio' : 'video')) fail(`track ${trk} is a ${tr.kind} track; clip ${id} is ${c.kind}`)
      }
      for (const x of p.clips) if (grp.includes(x.id)) {
        x.start += d
        if (trk) { const n = trk.slice(1); x.trackId = x.id === id ? trk : (P.trackOf(p, (x.kind === 'audio' ? 'A' : 'V') + n) ? (x.kind === 'audio' ? 'A' : 'V') + n : x.trackId) }
      }
      P.overwrite(p, grp); res = { c: grp }
      break
    }
    case 'trim': {
      const [id] = pos(a, 1, 'trim <id> in=|out=|start=|end='); const c = P.find(p, id)
      const ks = Object.keys(a.kv); if (!ks.length || ks.some((k) => !['in', 'out', 'start', 'end'].includes(k))) fail('trim needs in=, out=, start= or end=')
      const grp = P.group(p, [id]); const sp = c.speed
      let head = null, tail = null // head: timeline start moves; tail: timeline end moves
      if (a.kv.in != null) head = c.start + (parseTime(a.kv.in) - c.in) / sp
      if (a.kv.start != null) head = parseTime(a.kv.start)
      if (a.kv.out != null) tail = c.start + (parseTime(a.kv.out) - c.in) / sp
      if (a.kv.end != null) tail = parseTime(a.kv.end)
      const s0 = head ?? c.start, e0 = tail ?? c.start + c.dur
      if (s0 < -1e-6) fail('start would be negative')
      if (!(e0 > s0 + 1e-3)) fail('trim leaves no duration')
      for (const x of p.clips) if (grp.includes(x.id)) {
        const d0 = x.start, e = x.start + x.dur
        const ns = head != null ? s0 : d0, ne = tail != null ? e0 : e
        const cut = ns - d0
        x.in += cut * x.speed; x.start = ns; x.dur = ne - ns
        if (cut > 0) { E.clearIn(x); x.fadeIn = 0 }
        if (ne < e - 1e-6) { E.clearOut(x); x.fadeOut = 0 }
        x.keys = x.keys.map((k) => ({ t: k.t - cut, v: k.v }))
      }
      P.overwrite(p, grp); res = { c: grp }
      break
    }
    case 'speed': {
      const [id, x] = pos(a, 2, 'speed <id> <x>'); const c = P.find(p, id)
      const sp = P.setSpeed(p, [id], num(x, 'speed'))
      const n = P.find(p, id); res = { speed: r3(sp), dur: r2(n.dur) }
      if (sp > Number(x) + 1e-9) res.clamped = 1
      void c
      break
    }
    case 'set': {
      const [id] = pos(a, 1, 'set <id> k=v...'); const c = P.find(p, id)
      if (!Object.keys(a.kv).length) fail('usage: set <id> k=v...')
      for (const [k, raw] of Object.entries(a.kv)) {
        if (/^crop\.[lrtb]$/.test(k)) { const v = num(raw, k); if (v < 0 || v >= 1) fail(`${k} must be 0-1`); c.crop[k.slice(5)] = v }
        else if (NUMERIC.includes(k)) {
          if (c.kind === 'title' && ['in'].includes(k)) fail(`unknown prop ${k} for a title`)
          const v = k === 'start' || k === 'in' || k === 'dur' || k.startsWith('fade') || k.startsWith('trans') ? parseTime(raw, k) : num(raw, k)
          checkRange(c, k, v); c[k] = v
          // a bare number gets the default type (same as the app opening an old project); 0 clears it
          if (k === 'transition' || k === 'transOut') { const tk = k === 'transition' ? 'transType' : 'transOutType'; if (v > 0) c[tk] = c[tk] || (c.kind === 'audio' ? 'constgain' : 'crossdissolve'); else delete c[tk] }
        } else if (STRINGS.includes(k)) {
          if (c.kind !== 'title') fail(`${k} is only for titles`)
          if (k === 'color' && !/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(raw)) fail('color must be #rrggbb')
          c[k] = k === 'text' ? raw.replace(/\\n/g, '\n') : raw
        } else fail(`unknown prop ${k}`)
      }
      if (c.crop.l + c.crop.r >= 1 || c.crop.t + c.crop.b >= 1) fail('crop leaves no picture')
      if ('start' in a.kv || 'in' in a.kv || 'dur' in a.kv) P.overwrite(p, [id])
      res = { c: id }
      break
    }
    case 'keys': {
      const [id, spec] = pos(a, 2, 'keys <id> t:v,t:v | -'); const c = P.find(p, id)
      if (spec === '-') c.keys = []
      else c.keys = spec.split(',').map((kv) => {
        const [t, v] = kv.split(':'); if (v == null) fail(`bad key "${kv}" (use t:v)`)
        const tt = parseTime(t, 'key time'), vv = num(v, 'key value')
        if (tt < 0 || tt > c.dur + 1e-6) fail(`key time ${r2(tt)} is outside the clip (0-${r2(c.dur)})`)
        if (vv < 0) fail('key value must be >= 0'); return { t: tt, v: vv }
      }).sort((x, y) => x.t - y.t)
      res = { c: id, n: c.keys.length }
      break
    }
    case 'fade': {
      const [id] = pos(a, 1, 'fade <id> in=s out=s'); P.find(p, id)
      if (a.kv.in == null && a.kv.out == null) fail('fade needs in= or out=')
      let grp = new Set(P.group(p, [id]).filter((i) => P.find(p, i).kind === 'audio'))
      if (!grp.size) grp = new Set([id])
      for (const x of p.clips) if (grp.has(x.id)) {
        if (a.kv.in != null) { const v = parseTime(a.kv.in, 'fade in'); if (v < 0 || v > x.dur) fail(`fade in must be 0-${r2(x.dur)}`); x.fadeIn = v }
        if (a.kv.out != null) { const v = parseTime(a.kv.out, 'fade out'); if (v < 0 || v > x.dur) fail(`fade out must be 0-${r2(x.dur)}`); x.fadeOut = v }
      }
      res = { c: [...grp] }
      break
    }
    case 'dissolve': {
      const [id] = pos(a, 1, 'dissolve <id> [dur=1]')
      const d = a.kv.dur != null ? parseTime(a.kv.dur) : a.pos[1] != null ? parseTime(a.pos[1]) : 1
      const r = P.addTransition(p, id, d); res = { c: id, dur: r2(r.dur) }
      if (r.short) res.short = 1
      break
    }
    case 'transition': {
      const [spec] = pos(a, 1, 'transition <edge> type=<name> [dur=1 align=centre|start|end]')
      const r = P.setTransition(p, spec, { type: a.kv.type, dur: a.kv.dur != null ? parseTime(a.kv.dur) : undefined, align: a.kv.align, audio: a.kv.audio != null ? a.kv.audio !== '0' : undefined })
      res = { edge: spec, type: r.type, dur: r2(r.dur) }
      if (r.short) { res.short = 1; res.req = r2(r.req); res.msg = `Insufficient media: shortened to ${r.dur.toFixed(2)} s` }
      break
    }
    case 'rm-transition': {
      const [spec] = pos(a, 1, 'rm-transition <edge>')
      P.removeTransition(p, spec); res = { edge: spec }
      break
    }
    case 'title': {
      if (a.at == null) fail('usage: title @t [dur=3] text="..."')
      const t = parseTime(a.at); if (t < 0) fail('start must be >= 0')
      const dur = a.kv.dur != null ? parseTime(a.kv.dur) : 3; if (!(dur > 0)) fail('dur must be > 0')
      if (!a.kv.text) fail('title needs text="..."')
      const trk = a.kv.track || 'V2'; const tr = P.trackOf(p, trk); if (!tr || tr.kind !== 'video') fail(`unknown video track ${trk}`)
      const hit = p.clips.find((c) => c.trackId === trk && c.start < t + dur - 1e-4 && c.start + c.dur > t + 1e-4)
      if (hit) fail(`title overlaps ${hit.id} on ${trk}; pick another time or track=V3`)
      const c = P.blank({ id: P.nid(p, 'c'), kind: 'title', trackId: trk, start: t, dur, text: a.kv.text.replace(/\\n/g, '\n'), font: 'Arial', size: 96, color: '#ffffff', x: 0.5, y: 0.5 })
      for (const k of ['font', 'size', 'color', 'x', 'y']) if (a.kv[k] != null) {
        if (k === 'font') c.font = a.kv.font
        else if (k === 'color') { if (!/^#[0-9a-fA-F]{6}$|^#[0-9a-fA-F]{3}$/.test(a.kv.color)) fail('color must be #rrggbb'); c.color = a.kv.color }
        else { c[k] = num(a.kv[k], k); checkRange(c, k, c[k]) }
      }
      p.clips.push(c); res = { c: c.id }
      break
    }
    case 'track': {
      const [id, what] = pos(a, 2, 'track <V2> mute|unmute|hide|show'); const tr = P.trackOf(p, id) || fail(`unknown track ${id}`)
      const w = { mute: ['muted', true, 'audio'], unmute: ['muted', false, 'audio'], hide: ['hidden', true, 'video'], show: ['hidden', false, 'video'] }[what] || fail('use mute, unmute, hide or show')
      if (tr.kind !== w[2]) fail(`${what} applies to ${w[2]} tracks; ${id} is a ${tr.kind} track`)
      tr[w[0]] = w[1]; res = { track: id, [w[0]]: w[1] ? 1 : 0 }
      break
    }
  }
  P.validate(p)
  ctx.history.push(ctx.proj); ctx.proj = p
  return res
}

async function dispatch(cmd, a) {
  switch (cmd) {
    case 'help': return { raw: a.pos[0] ? HELP.split('\n').filter((l) => l.trim().startsWith(a.pos[0] + ' ') || l.trim().startsWith(a.pos[0] + '\n')).join('\n') || `no help for ${a.pos[0]}` : HELP }
    case 'new': {
      if (ctx.proj) ctx.history.push(ctx.proj)
      ctx.proj = P.newProject(a.flags.w ? num(a.flags.w, '-w') : 1920, a.flags.h ? num(a.flags.h, '-h') : 1080, a.flags.fps ? num(a.flags.fps, '-fps') : 30)
      ctx.sizeLocked = !!(a.flags.w || a.flags.h || a.flags.fps)
      if (ctx.proj.width < 16 || ctx.proj.height < 16 || ctx.proj.fps <= 0 || ctx.proj.fps > 240) fail('bad size or fps')
      return { size: `${ctx.proj.width}x${ctx.proj.height}`, fps: ctx.proj.fps }
    }
    case 'undo': {
      if (!ctx.batch) fail('undo works only in batch mode')
      if (!ctx.history.length) fail('nothing to undo'); ctx.proj = ctx.history.pop(); return {}
    }
    case 'save': {
      const p = need(); const target = a.pos[0] || a.flags.p || ctx.file || fail('save needs a path (or -p)')
      P.validate(p); atomicWrite(target, P.serialize(p)); ctx.file = target
      return { f: target }
    }
    case 'show': {
      const p = need()
      if (a.flags.json) return { raw: JSON.stringify(p), wrap: 'project', val: p }
      const lines = P.showLines(p, !!a.flags.media); return { raw: lines.join('\n'), wrap: 'show', val: lines }
    }
    case 'probe': { const [m] = pos(a, 1, 'probe <media>'); const { file, m: mm } = mediaArg(m); const f = mm || await U.facts(file); const r = { dur: r2(f.dur), w: f.w, h: f.h, fps: r2(f.fps), audio: f.hasAudio ? 1 : 0, vcodec: f.vcodec, kbps: Math.round(f.bitrate / 1000) }; if (f.cached) r.cached = 1; return r }
    case 'scan': { const mi = await mediaInfo(pos(a, 1, 'scan <media>')[0]); const r = await U.scan(mi); r.zoom = r.zoom.map((z) => z.replace('<m>', qt(mi.ref))); return r }
    case 'scenes': { const mi = await mediaInfo(pos(a, 1, 'scenes <media>')[0]); return U.scenes(mi, U.range(mi.dur, a.flags), a.flags.thr != null ? num(a.flags.thr, '--thr') : 0.3) }
    case 'silence': { const mi = await mediaInfo(pos(a, 1, 'silence <media>')[0]); return U.silence(mi, U.range(mi.dur, a.flags), a.flags.db != null ? num(a.flags.db, '--db') : -35, a.flags.min != null ? num(a.flags.min, '--min') : 1) }
    case 'loud': { const mi = await mediaInfo(pos(a, 1, 'loud <media>')[0]); return U.loud(mi, U.range(mi.dur, a.flags), a.flags.top != null ? num(a.flags.top, '--top') : 20, a.flags.win != null ? num(a.flags.win, '--win') : 2) }
    case 'frames': {
      const mi = await mediaInfo(pos(a, 1, 'frames <media> --every 30s | --at t,t')[0])
      if (a.flags.at) return U.frames(mi, { from: 0, to: mi.dur }, { at: timeList(a.flags.at) })
      if (!a.flags.every) fail('frames needs --every or --at'); const e = parseTime(a.flags.every, '--every'); if (!(e > 0)) fail('--every must be > 0')
      return U.frames(mi, U.range(mi.dur, a.flags), { every: e })
    }
    case 'sheet': { const mi = await mediaInfo(pos(a, 1, 'sheet <media>')[0]); return U.sheet(mi, U.range(mi.dur, a.flags), a.flags.cols != null ? num(a.flags.cols, '--cols') : 6, a.flags.n != null ? num(a.flags.n, '--n') : 36) }
    case 'transcript': { const mi = await mediaInfo(pos(a, 1, 'transcript <media>')[0]); return U.transcript(mi, U.range(mi.dur, a.flags)) }
    case 'job': { const [id] = pos(a, 1, 'job <id> [--cancel]'); return J.view(id, !!a.flags.cancel) }
    case 'jobs': { const l = J.list(); return { n: l.length, jobs: l } }
    case 'frame': { if (!a.flags.at) fail('frame needs --at t[,t]'); return R.frame(need(), timeList(a.flags.at)) }
    case 'preview': return R.preview(need(), a.flags.o ? path.resolve(a.flags.o) : undefined)
    case 'check': { const f = R.check(need()); return { findings: f } }
    default:
      if (MUT.has(cmd)) return mutate(cmd, a)
      fail(`unknown command "${cmd}" (see: ove help)`)
  }
}

/** Run one command line (token array). Returns {line, ok, raw}. */
async function runOne(tokens, cli) {
  const t0 = Date.now(); const cmd = tokens[0]; const a = parseArgs(tokens.slice(1))
  const bg = !!a.flags.bg && (PROBES.has(cmd) || cmd === 'preview')
  try {
    if (a.flags.budget != null && !(Number(a.flags.budget) > 0)) fail('--budget must be a number of seconds > 0')
    setClock(a.flags.budget != null ? Number(a.flags.budget) : cmd === 'preview' || cmd === 'transcript' ? 60 : 20); clock.warn = null
    if (bg) {
      const needsProj = cmd === 'preview' || /^m\d+$/.test(a.pos[0] || '')
      if (needsProj && !ctx.file) fail('--bg needs a saved project: pass -p file.ovep (or use a media path)')
      const jt = tokens.filter((x) => x !== '--bg'); if (a.flags.budget == null) jt.push('--budget', '600'); if (ctx.file) jt.push('-p', ctx.file)
      return { ok: true, json: { ok: 1, job: J.start(jt, tokens.join(' ')), ms: Date.now() - t0 } }
    }
    if (cmd === 'new' && cli.p) ctx.file = cli.p
    let r = await dispatch(cmd, a)
    if (MUT.has(cmd) && !ctx.batch && ctx.file && cmd !== 'new') { atomicWrite(ctx.file, P.serialize(ctx.proj)); r = { ...r, saved: 1 } }
    else if (cmd === 'new' && !ctx.batch && ctx.file) { atomicWrite(ctx.file, P.serialize(ctx.proj)); r = { ...r, saved: 1 } }
    if (r.raw !== undefined) return { ok: true, raw: r.raw, json: r.wrap ? { ok: 1, [r.wrap]: r.val } : { ok: 1, help: r.raw } }
    if (cmd === 'check' && !ctx.batch) return { ok: true, raw: r.findings.length ? r.findings.map((f) => JSON.stringify(f)).join('\n') : '{"ok":1}', json: null }
    if (cmd === 'check') return { ok: true, json: { ok: 1, n: r.findings.length, f: r.findings } }
    const { ok: _o, ...rest } = r
    const json = { ok: 1, ...rest }
    if (clock.warn) json.warn = clock.warn
    if (json.partial) json.retry = retryLine(tokens, cli, json.done_to)
    json.ms = Date.now() - t0; U.flushProxy()
    return { ok: true, json }
  } catch (e) {
    const json = { err: e instanceof Err ? e.message : String(e.message || e).split('\n')[0].slice(0, 300) }
    if (e.extra) Object.assign(json, e.extra)
    if (RETRY.has(cmd)) json.retry = retryLine(tokens, cli, e.extra?.done_to)
    json.ms = Date.now() - t0; U.flushProxy()
    return { ok: false, json }
  }
}

const outputsExist = (j) => {
  const fs_ = []; if (typeof j.f === 'string') fs_.push(j.f); else if (Array.isArray(j.f)) for (const x of j.f) if (Array.isArray(x) && typeof x[1] === 'string') fs_.push(x[1])
  return fs_.every((f) => fs.existsSync(f))
}
const STATEFUL = (c) => MUT.has(c) || c === 'new' || c === 'undo'

async function batch(text, cli, stop, out) {
  const ckFile = path.join(cacheDir(), `batch-${C.hash(text + '\0' + (cli.p || ''), 12)}.json`)
  let ck = {}; try { ck = JSON.parse(fs.readFileSync(ckFile, 'utf8')) } catch {}
  const next = {}; const failed = []; let n = 0, skipped = 0, dirty = false
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; if (!line.trim() || line.trim().startsWith('#')) continue
    n++
    const h = C.hash(line); const prev = ck[i]; let r; const t0 = Date.now()
    let tokens; try { tokens = tokenize(line) } catch (e) { r = { ok: false, json: { err: e.message } } }
    if (tokens && prev && prev.h === h && prev.ok && !dirty && tokens[0] !== 'save' && outputsExist(prev.json)) {
      if (STATEFUL(tokens[0])) ctx.history.push(ctx.proj)
      if (prev.proj !== undefined) { ctx.proj = prev.proj; ctx.sizeLocked = prev.sl }
      out(JSON.stringify({ ...prev.json, cached: 1, ms: Date.now() - t0 })); next[i] = prev; skipped++
      continue
    }
    if (tokens) { try { r = await runOne(tokens, cli) } catch (e) { r = { ok: false, json: { err: e.message } } } }
    out(JSON.stringify(r.json || { ok: 1 }))
    if (!r.ok) failed.push(i + 1)
    else if (tokens && STATEFUL(tokens[0])) dirty = true
    next[i] = { h, ok: r.ok, json: r.json || { ok: 1 }, proj: ctx.proj, sl: ctx.sizeLocked }
    try { atomicWrite(ckFile, JSON.stringify({ ...ck, ...next })) } catch {}
    if (!r.ok && stop) break
  }
  if (failed.length) out(JSON.stringify({ summary: 1, n, ok: n - failed.length, failed, skipped, hint: 're-pipe the same input to rerun only the failed lines' }))
  return failed.length ? 1 : 0
}

async function main() {
  let argv = process.argv.slice(2); const cli = {}
  const pi = argv.indexOf('-p'); if (pi >= 0 && argv[pi + 1]) { cli.p = path.resolve(argv[pi + 1]); argv.splice(pi, 2) }
  const stop = argv.includes('--stop'); argv = argv.filter((x) => x !== '--stop')
  const out = (s) => process.stdout.write(s + '\n')
  if (argv[0] === '__proxy') { await U.buildProxy(argv[1], argv[2]); process.exit(0) }
  if (!argv.length && !process.stdin.isTTY) {
    ctx.batch = true
    if (cli.p && fs.existsSync(cli.p)) try { loadFile(cli.p) } catch (e) { out(JSON.stringify({ err: e.message })); process.exit(1) }
    const text = await new Promise((res) => { let b = ''; process.stdin.on('data', (d) => (b += d)); process.stdin.on('end', () => res(b)) })
    process.exit(await batch(text, cli, stop, out))
  }
  if (!argv.length) { console.log(HELP); process.exit(0) }
  if (cli.p && fs.existsSync(cli.p) && argv[0] !== 'new') { try { loadFile(cli.p) } catch (e) { out(JSON.stringify({ err: e.message })); process.exit(1) } }
  const rep = process.env.OVE_JOB ? J.reporter(process.env.OVE_JOB) : null
  if (rep) clock.onPct = rep.pct
  let r
  try { r = await runOne(argv, cli) } catch (e) { r = { ok: false, json: { err: e.message } } }
  if (rep) { rep.finish(r.json, r.ok); process.exit(0) }
  if (r.raw !== undefined && r.ok) out(r.raw); else out(JSON.stringify(r.json))
  process.exit(r.ok ? 0 : 1)
}
main()
