import path from 'node:path'
import { placement, colorParams, hasColor, gainExpr, sequenceEnd, FONTS } from '../shared/math.js'

const n = (x) => Number(x).toFixed(6)

function atempoChain(s) {
  const parts = []
  while (s > 2) { parts.push('atempo=2'); s /= 2 }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5 }
  if (Math.abs(s - 1) > 1e-6 || !parts.length) parts.push(`atempo=${n(s)}`)
  return parts.join(',')
}

function fontPath(font, fontDir) {
  const file = FONTS[font] || FONTS.Arial
  return `${fontDir}/${file}`.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** One-frame view of a project at timeline time `at`: only the visible clips, re-based to 0, with the dissolve alpha frozen. */
function windowAt(project, at) {
  const d = 2 / project.fps
  const clips = []
  for (const c of project.clips) {
    if (c.kind === 'audio' || !(c.start <= at + 1e-9 && at < c.start + c.dur - 1e-9)) continue
    const off = Math.max(0, at - c.start)
    clips.push({ ...c, start: 0, in: c.in + off * (c.speed || 1), dur: d, transition: 0, transOut: 0, _alpha: c.transition > 0 ? Math.min(1, off / c.transition) : 1 })
  }
  return { ...project, clips }
}

/**
 * Build ffmpeg arguments for a project.
 * project: {width,height,fps,media:{[id]:{path,w,h,dur,hasAudio}},tracks:[{id,kind,muted,hidden}],clips:[...]}
 * Returns {args, script, textFiles:[{path,text}], total}
 */
export function buildExport(project, outPath, opts = {}) {
  if (opts.frameAt != null) project = windowAt(project, opts.frameAt)
  const { width: W, height: H, fps } = project
  const fontDir = opts.fontDir || 'C:/Windows/Fonts'
  const tmpDir = opts.tmpDir || '.'
  const tIdx = new Map(project.tracks.map((t, i) => [t.id, i]))
  const trackOf = (c) => project.tracks[tIdx.get(c.trackId)]
  const total = Math.max(1 / fps, sequenceEnd(project.clips))
  const inputs = []
  const chains = []
  const textFiles = []

  const vis = project.clips
    .filter((c) => (c.kind === 'video' || c.kind === 'title') && trackOf(c) && !trackOf(c).hidden)
    .sort((a, b) => tIdx.get(a.trackId) - tIdx.get(b.trackId) || a.start - b.start)
  chains.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p[b0]`)
  let cur = 'b0', bi = 0
  for (const c of vis) {
    const next = `b${++bi}`
    const s = n(c.start), e = n(c.start + c.dur)
    if (c.kind === 'title') {
      const tf = path.join(tmpDir, `title-${c.id}.txt`)
      textFiles.push({ path: tf, text: c.text || '' })
      const col = '0x' + String(c.color || '#ffffff').replace('#', '')
      const tfp = tf.replace(/\\/g, '/').replace(/:/g, '\\:')
      chains.push(
        `[${cur}]drawtext=fontfile='${fontPath(c.font, fontDir)}':textfile='${tfp}':fontsize=${Math.round(c.size || 64)}:fontcolor=${col}:` +
          `x=${Math.round((c.x ?? 0.5) * W)}-text_w/2:y=${Math.round((c.y ?? 0.5) * H)}-text_h/2:enable='between(t,${s},${e})'[${next}]`,
      )
    } else {
      const m = project.media[c.mediaId]
      const k = inputs.length
      const sp = c.speed || 1
      inputs.push(['-ss', n(c.in), '-t', n(c.dur * sp), '-i', m.path])
      const p = placement(c, m.w, m.h, W, H)
      let f = `[${k}:v]setpts=(PTS-STARTPTS)/${n(sp)},fps=${fps},crop=${p.sw}:${p.sh}:${p.sx}:${p.sy},scale=${p.dw}:${p.dh}:flags=bicubic`
      if (hasColor(c)) {
        const q = colorParams(c)
        const lut = (ch) => `${ch}='clip((clip(val*${n(q.b)},0,255)-128)*${n(q.c)}+128,0,255)'`
        const a = 0.213, b = 0.715, d = 0.072, sat = q.s
        f += `,format=rgb24,lutrgb=${lut('r')}:${lut('g')}:${lut('b')},colorchannelmixer=` +
          `rr=${n(a + (1 - a) * sat)}:rg=${n(b - b * sat)}:rb=${n(d - d * sat)}:` +
          `gr=${n(a - a * sat)}:gg=${n(b + (1 - b) * sat)}:gb=${n(d - d * sat)}:` +
          `br=${n(a - a * sat)}:bg=${n(b - b * sat)}:bb=${n(d + (1 - d) * sat)}`
      }
      f += ',format=yuva420p'
      if (c._alpha != null && c._alpha < 1) f += `,colorchannelmixer=aa=${n(c._alpha)}`
      if (c.transition > 0) f += `,fade=t=in:st=0:d=${n(c.transition)}:alpha=1`
      f += `,setpts=PTS+${s}/TB[v${k}]`
      chains.push(f)
      chains.push(`[${cur}][v${k}]overlay=x=${p.dx}:y=${p.dy}:eof_action=pass:enable='between(t,${s},${e})':format=auto[${next}]`)
    }
    cur = next
  }
  chains.push(`[${cur}]format=yuv420p[vout]`)

  if (opts.frameAt != null) {
    const script = chains.join(';\n')
    return { args: ['-y', '-hide_banner', '-nostats', ...inputs.flat(), '-filter_complex_script', opts.scriptPath || 'filter.txt', '-map', '[vout]', '-frames:v', '1', outPath], script, textFiles, total }
  }
  const aud = project.clips.filter((c) => c.kind === 'audio' && trackOf(c) && !trackOf(c).muted && project.media[c.mediaId]?.hasAudio)
  chains.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(total)},asetpts=PTS-STARTPTS[a0]`)
  const labels = ['[a0]']
  for (const c of aud) {
    const m = project.media[c.mediaId]
    const k = inputs.length
    const sp = c.speed || 1
    inputs.push(['-ss', n(c.in), '-t', n(c.dur * sp), '-i', m.path])
    const ms = Math.round(c.start * 1000)
    chains.push(
      `[${k}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS,${atempoChain(sp)},` +
        `volume='${gainExpr(c)}':eval=frame,adelay=${ms}|${ms}[a${k}]`,
    )
    labels.push(`[a${k}]`)
  }
  chains.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=duration=${n(total)}[aout]`)

  const script = chains.join(';\n')
  const enc = opts.encArgs ? opts.encArgs : opts.nvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18']
  const args = [
    '-y', '-hide_banner', '-nostats', '-progress', 'pipe:1',
    ...inputs.flat(),
    '-filter_complex_script', opts.scriptPath || 'filter.txt',
    '-map', '[vout]', '-map', '[aout]',
    ...enc, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-t', n(total), outPath,
  ]
  return { args, script, textFiles, total }
}
