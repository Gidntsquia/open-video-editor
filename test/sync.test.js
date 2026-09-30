// A/V sync: source has a white flash + 1 kHz beep together at every whole second. After cuts and a 2x
// speed change the flashes and beeps in the export must still coincide and land where the timeline says.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildExport } from '../electron/exporter.js'
const ff = process.env.FFMPEG_BIN || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-sync-'))
const src = path.join(dir, 'src.mp4')
const on = 'lt(mod(t,1),0.1)'
let r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', `color=black:s=640x360:r=30:d=12,drawbox=w=iw:h=ih:c=white:t=fill:enable='${on}'`,
  '-f', 'lavfi', '-i', `sine=f=1000:r=48000:d=12,volume='if(${on},1,0)':eval=frame`, '-c:v', 'libx264', '-g', '15', '-c:a', 'aac', '-shortest', src])
if (r.status) throw new Error(r.stderr.toString())
const base = { crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, brightness: 1, contrast: 1, saturation: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0, transition: 0, transOut: 0 }
const seg = [[0, 0, 3, 1], [3, 5, 3, 1], [6, 8, 2, 2]]
const clips = []
seg.forEach(([start, i, srcDur, sp], n) => {
  const dur = srcDur / sp
  clips.push({ ...base, id: 'v' + n, kind: 'video', trackId: 'V1', mediaId: 'm', start, in: i, dur, speed: sp })
  clips.push({ ...base, id: 'a' + n, kind: 'audio', trackId: 'A1', mediaId: 'm', start, in: i, dur, speed: sp })
})
const project = { width: 640, height: 360, fps: 30, media: { m: { path: src, w: 640, h: 360, dur: 12, hasAudio: true } }, tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }], clips }
const out = path.join(dir, 'out.mp4'), scriptPath = path.join(dir, 'f.txt')
const b = buildExport(project, out, { fontDir: process.env.FONT_DIR || '/usr/share/fonts/truetype/dejavu', tmpDir: dir, scriptPath })
fs.writeFileSync(scriptPath, b.script)
r = spawnSync(ff, b.args, { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr)
// video flash onsets
const raw = spawnSync(ff, ['-v', 'error', '-i', out, '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1e9 }).stdout
const vOn = []; let prev = false
for (let f = 0; f < raw.length / 64; f++) { let s = 0; for (let k = 0; k < 64; k++) s += raw[f * 64 + k]; const hi = s / 64 > 128; if (hi && !prev) vOn.push(f / 30); prev = hi }
const pcm = spawnSync(ff, ['-v', 'error', '-i', out, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1e9 }).stdout
const aOn = []; prev = false
for (let i = 0; i + 40 <= pcm.length / 2; i += 40) { let e = 0; for (let k = 0; k < 40; k++) { const v = pcm.readInt16LE((i + k) * 2); e += v * v } const hi = Math.sqrt(e / 40) > 800; if (hi && !prev) aOn.push(i / 8000); prev = hi }
const want = [0, 1, 2, 3, 4, 5, 6, 6.5]
console.log('video', vOn.map((x) => x.toFixed(3)).join(' ')); console.log('audio', aOn.map((x) => x.toFixed(3)).join(' '))
let worst = 0
want.forEach((w, i) => { if (vOn[i] === undefined || aOn[i] === undefined) throw new Error('missing event ' + w); worst = Math.max(worst, Math.abs(vOn[i] - w), Math.abs(aOn[i] - w), Math.abs(vOn[i] - aOn[i])) })
console.log('worst offset', worst.toFixed(3), 's'); if (worst > 0.05) throw new Error('sync off'); console.log('sync test OK')
