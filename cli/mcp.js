#!/usr/bin/env node
// ove MCP server (stdio): every `ove` command as a typed tool, in-process, plus a raw `ove` tool, image replies,
// resources, and app control through the loopback channel in electron/control.js (port + token in cache/ove/app.json).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { runOne, ctx, HELP, MUT, loadFile } from './ove.js'
import * as R from './render.js'
import { ff } from './run.js'
import { tokenize, cacheDir, enforceCache, ROOT, atomicWrite, toLocal } from './util.js'
import * as P from './project.js'

const S = z.coerce.string(), N = z.coerce.number(), B = z.boolean()
const OPT = (x) => x.optional()
const PR = { from: OPT(S), to: OPT(S), budget: OPT(N), bg: OPT(B) }
const M = { m: S }
const SIL = { silent: OPT(B) }
const ID = { id: S }

ctx.keep = true // undo history works outside batch mode

// ---- tool table: description, zod shape, CLI tokens ----
const flag = (a, ...ks) => ks.flatMap((k) => (a[k] == null || a[k] === false ? [] : a[k] === true ? [`--${k}`] : [`--${k}`, String(a[k])]))
const kv = (a, ...ks) => ks.filter((k) => a[k] != null).map((k) => `${k}=${a[k]}`)
const rng = (a) => flag(a, 'from', 'to', 'budget', 'bg')
const TOOLS = {
  scan: ['Fast overview of a media file: scenes, loudness, silences.', { ...M, ...PR }, (a) => ['scan', a.m, ...rng(a)]],
  probe: ['Media duration, size, fps, audio, codec.', M, (a) => ['probe', a.m]],
  scenes: ['Scene-cut times.', { ...M, thr: OPT(N), ...PR }, (a) => ['scenes', a.m, ...flag(a, 'thr'), ...rng(a)]],
  silence: ['Silent ranges [[start,end],..].', { ...M, db: OPT(N), min: OPT(N), ...PR }, (a) => ['silence', a.m, ...flag(a, 'db', 'min'), ...rng(a)]],
  loud: ['Loudest windows [t,peak_db,rms_db].', { ...M, top: OPT(N), win: OPT(N), ...PR }, (a) => ['loud', a.m, ...flag(a, 'top', 'win'), ...rng(a)]],
  frames: ['Frames as images: every="30s" or at="10,20".', { ...M, every: OPT(S), at: OPT(S), ...PR }, (a) => ['frames', a.m, ...flag(a, 'every', 'at'), ...rng(a)]],
  sheet: ['One contact-sheet image with timestamps.', { ...M, cols: OPT(N), n: OPT(N), ...PR }, (a) => ['sheet', a.m, ...flag(a, 'cols', 'n'), ...rng(a)]],
  transcript: ['Speech transcript [{t,d,text}]; long, use bg and poll job.', { ...M, ...PR }, (a) => ['transcript', a.m, ...rng(a)]],
  new: ['New empty project; path = where it auto-saves.', { path: OPT(S), w: OPT(N), h: OPT(N), fps: OPT(N) }, (a) => ['new', ...(a.w ? ['-w', String(a.w)] : []), ...(a.h ? ['-h', String(a.h)] : []), ...(a.fps ? ['-fps', String(a.fps)] : [])]],
  import: ['Add media files to the project.', { paths: z.array(S), ...SIL }, (a) => ['import', ...a.paths]],
  add: ['Put media on the timeline (video + linked audio).', { m: S.describe('media id'), track: OPT(S), at: OPT(S), in: OPT(S), dur: OPT(S), ...SIL }, (a) => ['add', a.m, ...(a.track ? [a.track] : []), ...(a.at != null ? ['@' + a.at] : []), ...kv(a, 'in', 'dur')]],
  cut: ['Split clips at time t (all under t, or just ids).', { t: S, ids: OPT(z.array(S)), ...SIL }, (a) => ['cut', a.t, ...(a.ids || [])]],
  rm: ['Delete clips; ripple closes the gap.', { ids: z.array(S), ripple: OPT(B), ...SIL }, (a) => ['rm', ...a.ids, ...flag(a, 'ripple')]],
  move: ['Move a clip (group) to time at, optional track.', { ...ID, at: S, track: OPT(S), ...SIL }, (a) => ['move', a.id, '@' + a.at, ...(a.track ? [a.track] : [])]],
  trim: ['Trim by source in/out or timeline start/end.', { ...ID, in: OPT(S), out: OPT(S), start: OPT(S), end: OPT(S), ...SIL }, (a) => ['trim', a.id, ...kv(a, 'in', 'out', 'start', 'end')]],
  speed: ['Clip speed, 0.5 = slow.', { ...ID, x: N, ...SIL }, (a) => ['speed', a.id, String(a.x)]],
  set: ['Set clip props (volume, scale, posX, fadeIn, crop.l, text...).', { ...ID, props: z.record(S, z.union([S, N])), ...SIL }, (a) => ['set', a.id, ...Object.entries(a.props).map(([k, v]) => `${k}=${v}`)]],
  keys: ['Volume keyframes "t:v,t:v"; "-" clears.', { ...ID, keys: S, ...SIL }, (a) => ['keys', a.id, a.keys]],
  fade: ['Audio fade in/out seconds.', { ...ID, in: OPT(S), out: OPT(S), ...SIL }, (a) => ['fade', a.id, ...kv(a, 'in', 'out')]],
  dissolve: ['Cross dissolve at the start of a clip.', { ...ID, dur: OPT(S), ...SIL }, (a) => ['dissolve', a.id, ...kv(a, 'dur')]],
  transition: ['Transition on edge c3:in, c3:out or c1/c2; type crossdissolve, dipblack, wipeleft...', { edge: S, type: S, dur: OPT(S), align: OPT(S), audio: OPT(S), ...SIL }, (a) => ['transition', a.edge, ...kv(a, 'type', 'dur', 'align', 'audio')]],
  rm_transition: ['Remove a transition edge.', { edge: S, ...SIL }, (a) => ['rm-transition', a.edge]],
  title: ['Add a text title at time at.', { at: S, text: S, dur: OPT(S), font: OPT(S), size: OPT(N), color: OPT(S), x: OPT(N), y: OPT(N), track: OPT(S), ...SIL }, (a) => ['title', '@' + a.at, ...kv(a, 'dur', 'text', 'font', 'size', 'color', 'x', 'y', 'track')]],
  track: ['mute/unmute an audio track, hide/show a video track.', { id: S, op: z.enum(['mute', 'unmute', 'hide', 'show']), ...SIL }, (a) => ['track', a.id, a.op]],
  undo: ['Revert the last changing command.', SIL, () => ['undo']],
  save: ['Save the project (path optional).', { path: OPT(S) }, (a) => ['save', ...(a.path ? [a.path] : [])]],
  show: ['Project summary; json = full.', { media: OPT(B), json: OPT(B) }, (a) => ['show', ...flag(a, 'media', 'json')]],
  frame: ['Composed timeline frames as images; at="3.5,7".', { at: S }, (a) => ['frame', '--at', a.at]],
  preview: ['480p render of the timeline (not an export).', { o: OPT(S), budget: OPT(N), bg: OPT(B) }, (a) => ['preview', ...(a.o ? ['-o', a.o] : []), ...flag(a, 'budget', 'bg')]],
  check: ['Lint the timeline.', {}, () => ['check']],
  job: ['Poll or cancel a background job.', { id: S, cancel: OPT(B) }, (a) => ['job', a.id, ...flag(a, 'cancel')]],
  jobs: ['List background jobs.', {}, () => ['jobs']],
}
const CHANGES = new Set([...MUT, 'undo'])

// ---- one ove call at a time (the ffmpeg clock and the project are global) ----
let chain = Promise.resolve()
const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r }

async function oveLine(tokens) {
  const cmd = tokens[0]
  const r = await runOne(tokens, { p: ctx.file || undefined })
  if (cmd === 'undo' && r.ok && ctx.file) { try { atomicWrite(ctx.file, P.serialize(ctx.proj)) } catch {} }
  let json = r.json
  if (json == null) { // single-call `check` prints raw lines; give the batch shape instead
    const f = r.raw && r.raw !== '{"ok":1}' ? r.raw.split('\n').map((l) => JSON.parse(l)) : []
    json = { ok: 1, n: f.length, f }
  }
  return { ok: r.ok, json, cmd }
}

// ---- images ----
function jpeg512(src) {
  const st = fs.statSync(src)
  const out = path.join(cacheDir(), `mcp-${crypto.createHash('sha1').update(src + st.mtimeMs + st.size).digest('hex').slice(0, 12)}.jpg`)
  if (fs.existsSync(out)) return out
  return ff(['-y', '-v', 'error', '-i', src, '-frames:v', '1', '-vf', "scale='min(512,iw)':-2", '-q:v', '5', out], { budget: false }).then(() => { enforceCache(); return out })
}
async function imagesFor(cmd, json) {
  const files = cmd === 'sheet' ? [json.f] : Array.isArray(json.f) ? json.f.map((x) => x[1]) : []
  const out = []
  for (const f of files) {
    if (typeof f !== 'string' || !fs.existsSync(f)) continue
    const small = cmd === 'frames' && f.endsWith('.jpg') // frames are already <= 320 px
    const p = small ? f : await jpeg512(f)
    out.push({ type: 'image', data: fs.readFileSync(p).toString('base64'), mimeType: 'image/jpeg' })
  }
  return out
}

// ---- app channel ----
const appFile = () => path.join(cacheDir(), 'app.json')
async function appCall(name, body = {}, timeout = 15000) {
  let info; try { info = JSON.parse(fs.readFileSync(appFile(), 'utf8')) } catch { return null }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/${name}`, { method: 'POST', headers: { authorization: 'Bearer ' + info.token }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) })
    return await res.json()
  } catch { return null }
}
async function appLaunch() {
  if (await appCall('ping', {}, 1500)) return { ok: 1 }
  if (process.platform !== 'win32') return { err: 'app tools need Windows node' }
  const cmd = fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? [path.join(ROOT, 'scripts', 'start.js'), '--no-build'] : [path.join(ROOT, 'scripts', 'start.js')]
  const c = spawn(process.execPath, cmd, { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }); c.unref()
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) { await new Promise((r) => setTimeout(r, 1000)); if (await appCall('ping', {}, 1500)) return { ok: 1, launched: 1 } }
  return { err: 'app did not start within 60 s' }
}
const sameFile = (a, b) => !!a && !!b && path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase()

/** After a change: reload the project in the running app (if it has this project open and is clean) and park the playhead. */
async function syncApp(cmd, a, json) {
  if (a.silent || !ctx.file) return null
  const sel = await appCall('selection', {}, 1500)
  if (!sel || sel.err || !sameFile(sel.projectPath, ctx.file)) return null
  if (sel.dirty) return 'app has unsaved changes, not reloaded'
  const o = await appCall('open', { path: ctx.file })
  if (!o || o.err) return o?.err || 'app reload failed'
  let t = null, clip = Array.isArray(json.c) ? json.c[0] : json.c
  if (cmd === 'cut') t = Number(a.t); else if (cmd === 'title') t = Number(a.at)
  else if (clip && ctx.proj) t = ctx.proj.clips.find((x) => x.id === clip)?.start ?? null
  if (t != null && Number.isFinite(t)) await appCall('seek', { t })
  return 'reloaded'
}

// ---- server ----
const server = new McpServer({ name: 'ove', version: '1.0.0' })
const text = (o) => ({ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) })
const reply = (o, isError, extra = []) => ({ content: [text(o), ...extra], ...(isError ? { isError: true } : {}) })

for (const [name, [desc, shape, tok]] of Object.entries(TOOLS)) {
  server.registerTool(name, { description: desc, inputSchema: shape }, (a) => serial(async () => {
    try {
      if (name === 'new') ctx.file = a.path ? path.resolve(toLocal(a.path)) : null
      const r = await oveLine(tok(a))
      if (!r.ok) return reply(r.json, true)
      const imgs = await imagesFor(name, r.json)
      if (CHANGES.has(r.cmd)) { const s = await syncApp(r.cmd, a, r.json); if (s) r.json.app = s }
      return reply(r.json, false, imgs)
    } catch (e) { return reply({ err: String(e.message || e) }, true) }
  }))
}

server.registerTool('ove', { description: 'Raw ove command lines, one per line; a bad line does not stop the rest.', inputSchema: { lines: S, ...SIL } }, (a) => serial(async () => {
  const out = []; let failed = []; let n = 0, changed = false, last = null
  for (const line of String(a.lines).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    n++
    try {
      const r = await oveLine(tokenize(line))
      out.push(JSON.stringify(r.json)); if (!r.ok) failed.push(n); else if (CHANGES.has(r.cmd)) { changed = true; last = r }
    } catch (e) { out.push(JSON.stringify({ err: e.message })); failed.push(n) }
  }
  if (failed.length) out.push(JSON.stringify({ summary: 1, n, ok: n - failed.length, failed }))
  if (changed && !a.silent) { const s = await syncApp(last.cmd, {}, last.json); if (s) out.push(JSON.stringify({ app: s })) }
  return reply(out.join('\n'), false)
}))

server.registerTool('project_open', { description: 'Load a .ovep as the current project (changes auto-save to it).', inputSchema: { path: S } }, (a) => serial(async () => {
  try { loadFile(path.resolve(toLocal(a.path))); ctx.history = []; ctx.sizeLocked = false; return reply({ ok: 1, clips: ctx.proj.clips.length, media: Object.keys(ctx.proj.media).length }) } catch (e) { return reply({ err: e.message }, true) }
}))

const appErr = (r) => (r == null ? { err: process.platform === 'win32' ? 'app not reachable' : 'app tools need Windows node' } : r)
async function withApp(fn) { const l = await appLaunch(); if (l.err) return reply(l, true); const r = appErr(await fn()); return reply(r.jpeg ? { ...r, jpeg: undefined } : { ...r, ...(l.launched ? { launched: 1 } : {}) }, !!r.err, r.jpeg ? [{ type: 'image', data: r.jpeg, mimeType: 'image/jpeg' }] : []) }
server.registerTool('app_launch', { description: 'Start the editor app if it is not running.', inputSchema: {} }, async () => { const r = await appLaunch(); return reply(r, !!r.err) })
server.registerTool('app_open', { description: 'Load the project in the app; refuses if the app has unsaved changes.', inputSchema: { path: OPT(S) } }, (a) => {
  const p = a.path ? path.resolve(toLocal(a.path)) : ctx.file
  if (!p) return reply({ err: 'no project path' }, true)
  return withApp(() => appCall('open', { path: p }))
})
server.registerTool('app_seek', { description: 'Move the app playhead to t or a clip start.', inputSchema: { t: OPT(S), clip: OPT(S) } }, (a) => withApp(() => appCall('seek', { t: a.t != null ? Number(a.t) : undefined, clip: a.clip })))
server.registerTool('app_selection', { description: 'Selection in the app, playhead, dirty flag.', inputSchema: {} }, async () => {
  const r = await appCall('selection', {}, 3000); return reply(appErr(r), !r || !!r.err)
})
server.registerTool('app_capture', { description: 'Preview canvas as an image, optionally after seeking to t.', inputSchema: { t: OPT(S) } }, (a) => withApp(() => appCall('capture', { t: a.t != null ? Number(a.t) : undefined }, 30000)))

// ---- resources (no ffmpeg on list) ----
const res = (uri, body, mime = 'application/json') => ({ contents: [{ uri, mimeType: mime, text: typeof body === 'string' ? body : JSON.stringify(body) }] })
server.registerResource('project', 'ove://project', { description: 'Current project (show --json)', mimeType: 'application/json' }, (u) => serial(async () => res(u.href, (await oveLine(['show', '--json'])).json)))
server.registerResource('check', 'ove://check', { description: 'Current lint', mimeType: 'application/json' }, (u) => serial(async () => res(u.href, (await oveLine(['check'])).json)))
server.registerResource('help', 'ove://help', { description: 'ove CLI help', mimeType: 'text/plain' }, (u) => res(u.href, HELP, 'text/plain'))
server.registerResource('scan', new ResourceTemplate('ove://media/{id}/scan', { list: () => ({ resources: Object.keys(ctx.proj?.media || {}).map((id) => ({ uri: `ove://media/${id}/scan`, name: `scan ${id}` })) }) }), { description: 'Cached scan of a project media (runs scan if absent)', mimeType: 'application/json' },
  (u, v) => serial(async () => res(u.href, (await oveLine(['scan', String(v.id)])).json)))

// the SDK adds {execution:{taskSupport:'forbidden'}} to every tool; it only costs tokens
for (const t of Object.values(server._registeredTools)) t.execution = undefined

await server.connect(new StdioServerTransport())
