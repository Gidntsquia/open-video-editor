// Every transition type: full export + single-frame export at 25/50/75 %, audio curves, edit-model geometry.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildExport } from '../electron/exporter.js'
import { VIDEO_TRANSITIONS, AUDIO_TRANSITIONS, gainExpr, clipGain } from '../shared/math.js'
import * as E from '../shared/edit.js'

const ff = process.env.FFMPEG_BIN || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-tr-'))
const src = path.join(dir, 'src.mp4')
let r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'sine=f=440:d=8', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src])
if (r.status) throw new Error('src gen failed ' + r.stderr)
const base = { crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, brightness: 1, contrast: 1, saturation: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0, transition: 0, transOut: 0 }
const media = { m1: { path: src, w: 640, h: 360, dur: 8, hasAudio: true } }
const mk = () => [
  { ...base, id: 'c1', kind: 'video', trackId: 'V1', mediaId: 'm1', start: 0, in: 1, dur: 2, link: 'l1' },
  { ...base, id: 'c2', kind: 'video', trackId: 'V1', mediaId: 'm1', start: 2, in: 4, dur: 2, link: 'l2' },
  { ...base, id: 'a1', kind: 'audio', trackId: 'A1', mediaId: 'm1', start: 0, in: 1, dur: 2, link: 'l1' },
  { ...base, id: 'a2', kind: 'audio', trackId: 'A1', mediaId: 'm1', start: 2, in: 4, dur: 2, link: 'l2' },
]
const tracks = [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }]
const run = (project, opts, tag) => {
  const out = path.join(dir, tag + (opts.frameAt != null ? '.png' : '.mp4'))
  const scriptPath = path.join(dir, tag + '.txt')
  const b = buildExport(project, out, { fontDir: '/usr/share/fonts/truetype/dejavu', tmpDir: dir, scriptPath, ...opts })
  fs.writeFileSync(scriptPath, b.script)
  const x = spawnSync(ff, b.args, { encoding: 'utf8' })
  if (x.status) { console.log(b.script); console.log(x.stderr.slice(-1500)); throw new Error('ffmpeg failed: ' + tag) }
  return out
}
const mean = (file) => { const x = spawnSync(ff, ['-v', 'error', '-i', file, '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return x.stdout[0] }
for (const t of VIDEO_TRANSITIONS) {
  const res = E.applyEdge(mk(), media, 30, { a: 'c1', b: 'c2' }, { type: t.id, dur: 1, align: 'centre' })
  if (res.error || res.short) throw new Error(`${t.id}: ${res.error || 'short'}`)
  const project = { width: 640, height: 360, fps: 30, media, tracks, clips: res.clips }
  run(project, {}, t.id)
  for (const q of [0.25, 0.5, 0.75]) run(project, { frameAt: 1.5 + q * res.dur }, `${t.id}-${q * 100}`)
  if (t.id === 'dipblack') { const m = mean(path.join(dir, 'dipblack-50.png')); if (m > 8) throw new Error('dipblack midpoint not black: ' + m) }
  if (t.id === 'dipwhite') { const m = mean(path.join(dir, 'dipwhite-50.png')); if (m < 247) throw new Error('dipwhite midpoint not white: ' + m) }
  console.log('video', t.id, 'ok')
}
// audio: ffmpeg gain expression equals the JS curve
for (const t of AUDIO_TRANSITIONS) {
  const res = E.applyEdge(mk(), media, 30, { a: 'a1', b: 'a2' }, { type: t.id, dur: 1, align: 'centre' })
  const a2 = res.clips.find((c) => c.id === 'a2')
  for (const x of [0.25, 0.5, 0.75]) {
    const js = clipGain(a2, x * a2.transition)
    const ex = gainExpr(a2)
    const f = ex.replace(/\bt\b/g, String(x * a2.transition))
    const v = spawnSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='${f}':d=0.01:s=8000`, '-f', 'f32le', '-'], { encoding: 'buffer' })
    const got = v.stdout.readFloatLE(0)
    if (Math.abs(got - js) > 0.01) throw new Error(`${t.id} @${x}: ffmpeg ${got} vs js ${js}`)
  }
  console.log('audio', t.id, 'ok')
}
// whole project with audio transitions exports
{
  const res = E.applyEdge(mk(), media, 30, { a: 'c1', b: 'c2' }, { type: 'pushleft', dur: 1, align: 'centre', alsoAudio: true, audioType: 'expfade' })
  run({ width: 640, height: 360, fps: 30, media, tracks, clips: res.clips }, {}, 'full-av')
  console.log('full A/V ok')
}
console.log('trans test OK')
