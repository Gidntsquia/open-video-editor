// ffprobe -> Media record. Used by the app (electron/main.js) and the `ove` CLI so both describe media the same way.
import { spawn } from 'node:child_process'
import path from 'node:path'

export function runBuf(bin, args) {
  return new Promise((res, rej) => {
    const c = spawn(bin, args, { windowsHide: true }); let out = Buffer.alloc(0), err = ''
    c.stdout.on('data', (d) => (out = Buffer.concat([out, d]))); c.stderr.on('data', (d) => (err += d))
    c.on('error', rej); c.on('close', (code) => (code === 0 ? res(out) : rej(new Error(err.slice(-800)))))
  })
}

export async function probeFile(ffprobe, p) {
  const out = await runBuf(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p])
  const j = JSON.parse(out.toString())
  const v = j.streams.find((s) => s.codec_type === 'video')
  const a = j.streams.find((s) => s.codec_type === 'audio')
  if (!v) throw new Error('No video stream')
  const [fn, fd] = (v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number)
  const fps = fd ? fn / fd : 30
  return { path: p, name: path.basename(p), w: v.width, h: v.height, fps, dur: parseFloat(j.format.duration || v.duration), hasAudio: !!a, vcodec: v.codec_name, bitrate: parseInt(j.format.bit_rate || 0), container: j.format.format_name }
}
