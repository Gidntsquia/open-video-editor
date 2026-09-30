// Builds a project with every feature, exports with the system ffmpeg, checks with ffprobe.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildExport } from '../electron/exporter.js'

const ff = process.env.FFMPEG_BIN || 'ffmpeg'
const fp = process.env.FFPROBE_BIN || 'ffprobe'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-'))
const src = path.join(dir, 'src.mp4')
let r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src])
if (r.status) throw new Error('src gen failed ' + r.stderr)
const base = { id: 'x', crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, brightness: 1, contrast: 1, saturation: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0, transition: 0, transOut: 0 }
const project = {
  width: 1920, height: 1080, fps: 30,
  media: { m1: { path: src, w: 1280, h: 720, dur: 6, hasAudio: true } },
  tracks: [{ id: 'V1', kind: 'video' }, { id: 'V2', kind: 'video' }, { id: 'A1', kind: 'audio' }],
  clips: [
    { ...base, id: 'c1', kind: 'video', trackId: 'V1', mediaId: 'm1', start: 0, in: 0, dur: 3, transOut: 1 },
    { ...base, id: 'c2', kind: 'video', trackId: 'V1', mediaId: 'm1', start: 2, in: 3, dur: 2, transition: 1, brightness: 1.3, contrast: 1.2, saturation: 0.5 },
    { ...base, id: 'c3', kind: 'video', trackId: 'V2', mediaId: 'm1', start: 1, in: 0, dur: 2, speed: 2, scale: 0.4, posX: 500, posY: -300, crop: { l: 0.1, r: 0.1, t: 0, b: 0 } },
    { ...base, id: 't1', kind: 'title', trackId: 'V2', start: 0.5, dur: 2, text: 'Hello title', font: 'Arial', size: 80, color: '#ffcc00', x: 0.5, y: 0.2 },
    { ...base, id: 'a1', kind: 'audio', trackId: 'A1', mediaId: 'm1', start: 0, in: 0, dur: 3, fadeOut: 0.5, keys: [{ t: 0, v: 0.5 }, { t: 1, v: 1 }] },
    { ...base, id: 'a3', kind: 'audio', trackId: 'A1', mediaId: 'm1', start: 3, in: 0, dur: 1, speed: 0.5, volume: 0.8 },
  ],
}
const out = path.join(dir, 'out.mp4')
const scriptPath = path.join(dir, 'filter.txt')
const b = buildExport(project, out, { fontDir: process.env.FONT_DIR || '/usr/share/fonts/truetype/dejavu', tmpDir: dir, scriptPath })
fs.writeFileSync(scriptPath, b.script)
for (const t of b.textFiles) fs.writeFileSync(t.path, t.text)
r = spawnSync(ff, b.args, { encoding: 'utf8' })
if (r.status) { console.log(b.script); console.log(r.stderr); process.exit(1) }
const p = JSON.parse(spawnSync(fp, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,duration', '-of', 'json', out], { encoding: 'utf8' }).stdout)
console.log(JSON.stringify(p.streams), 'expected total', b.total)
const v = p.streams.find((s) => s.codec_name === 'h264')
if (!v || v.width !== 1920 || v.height !== 1080) throw new Error('bad video')
if (Math.abs(parseFloat(v.duration) - b.total) > 1 / 30 + 0.01) throw new Error('bad duration')
console.log('export test OK', out)
