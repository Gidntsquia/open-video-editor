import path from 'node:path'
import { placement, colorParams, hasColor, gainExpr, sequenceEnd, FONTS, transSpec, transFx, activeTrans, withP, DIP_COLOR, BLUR_FRAC } from '../shared/math.js'

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
    const tAct = c.kind === 'title' ? activeTrans(c, off) : null
    const act = c.kind === 'video' ? activeTrans(c, off) : null
    clips.push({ ...c, start: 0, in: c.in + off * (c.speed || 1), dur: d, transition: 0, transOut: 0, _fx: act && { type: act.type, role: act.role, solo: act.solo, p: act.p }, _tfx: tAct ? transFx(tAct.type, tAct.role, tAct.solo, tAct.p).alpha : null })
  }
  return { ...project, clips }
}


/** Split a video clip into [head transition | plain | tail transition] segments (timeline-relative to the clip). */
function segmentsOf(c) {
  if (c._fx) return [{ t0: 0, t1: c.dur, fx: c._fx, frame: true }]
  const din = Math.min(c.transition || 0, c.dur), dout = Math.min(c.transOut || 0, Math.max(0, c.dur - din))
  const out = []
  if (din > 0) { const a = activeTrans({ ...c, transOut: 0 }, 0); out.push({ t0: 0, t1: din, fx: { type: a.type, role: 'in', solo: a.solo, d: din } }) }
  if (c.dur - din - dout > 1e-6) out.push({ t0: din, t1: c.dur - dout, fx: null })
  if (dout > 0) { const a = activeTrans({ ...c, transition: 0 }, c.dur - 1e-6); out.push({ t0: c.dur - dout, t1: c.dur, fx: { type: a.type, role: 'out', solo: a.solo, d: dout } }) }
  return out
}

function titleAlpha(c) {
  if (c._tfx != null) return c._tfx < 1 ? `:alpha=${n(c._tfx)}` : ''
  const ex = []
  const sp = (t, role, solo) => withP(transSpec(t, role, solo).alpha, 'p')
  void sp
  if (c.transition > 0) ex.push(['in', c.transType, c.transition, c.transSolo])
  if (c.transOut > 0) ex.push(['out', c.transOutType, c.transOut, c.transOutSolo])
  if (!ex.length) return ''
  let e = '1'
  for (const [role, type, d, solo] of ex) {
    const pe = role === 'in' ? `(t-${n(c.start)})/${n(d)}` : `(t-${n(c.start + c.dur - d)})/${n(d)}`
    const a = withP(transSpec(type, role, solo).alpha, pe)
    const win = role === 'in' ? `lt(t,${n(c.start + d)})` : `gt(t,${n(c.start + c.dur - d)})`
    e = `if(${win},${a},${e})`
  }
  return `:alpha='${e}'`
}

/** Emit the filters for one segment of clip c (placement pl, input k). Returns the new base label. */
function segmentChain(chains, c, pl, k, i, sg, cur, outLabel) {
  const W = pl.W, H = pl.H
  const S = c.start + sg.t0, d = sg.t1 - sg.t0
  const lab = (x) => `[${x}]`
  let head = `[s${k}_${i}]trim=start=${n(sg.t0)}:end=${n(sg.t1)},setpts=PTS-STARTPTS`
  if (!sg.fx) {
    chains.push(`${head},setpts=PTS+${n(S)}/TB[l${k}_${i}]`)
    chains.push(`[${cur}][l${k}_${i}]overlay=x=${pl.dx}:y=${pl.dy}:eof_action=pass:enable='between(t,${n(S)},${n(S + d)})':format=auto${lab(outLabel)}`)
    return outLabel
  }
  const f = sg.fx
  const spec = transSpec(f.type, f.role, f.solo)
  const frame = sg.frame
  const pConst = frame ? n(f.p) : null
  const pG = pConst ?? `T/${n(d)}` // inside geq (local time T)
  const pO = pConst ?? `(t-${n(S)})/${n(d)}` // inside overlay (timeline time t)
  const zoom = spec.s !== '1'
  // Zoom: pad the layer to the full frame and magnify about the layer centre with zoompan (constant frame size;
  // a per-frame `scale` changes the frame size on the fly, which overlay does not follow). zoompan: time = local
  // seconds from 0, zoom >= 1 (Cross Zoom only magnifies).
  if (zoom) {
    const zE = `max(1,${withP(spec.s, pConst ?? `time/${n(d)}`)})`
    const cx = pl.dx + pl.dw / 2, cy = pl.dy + pl.dh / 2
    head += `,pad=${W}:${H}:${pl.dx}:${pl.dy}:color=black@0,zoompan=z='${zE}':x='${cx}*(1-1/zoom)':y='${cy}*(1-1/zoom)':d=1:fps=${pl.fps}:s=${W}x${H},format=yuva420p`
  }
  const blur = spec.blur !== '0'
  const alphaE = withP(spec.alpha, pG)
  const rectE = spec.rect ? spec.rect.map((r) => withP(r, pG)) : null
  const lx = zoom ? 0 : pl.dx, ly = zoom ? 0 : pl.dy
  const rect = rectE ? `*gte(X+${lx},(${rectE[0]})*${W})*lt(X+${lx},(${rectE[2]})*${W})*gte(Y+${ly},(${rectE[1]})*${H})*lt(Y+${ly},(${rectE[3]})*${H})` : ''
  const geq = (aexpr) => `geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${aexpr}'`
  const ox = spec.dx === '0' ? `${lx}` : `'${lx}+(${withP(spec.dx, pO)})*${W}'`
  const oy = spec.dy === '0' ? `${ly}` : `'${ly}+(${withP(spec.dy, pO)})*${H}'`
  const en = `enable='between(t,${n(S)},${n(S + d)})'`
  const shift = `setpts=PTS+${n(S)}/TB`
  let base = cur
  if (blur) {
    chains.push(`${head},split=2[m${k}_${i}][b${k}_${i}]`)
    chains.push(`[m${k}_${i}]${geq(`alpha(X,Y)*(${alphaE})${rect}`)},${shift}[l${k}_${i}]`)
    chains.push(`[b${k}_${i}]gblur=sigma=${Math.round(W * BLUR_FRAC)},${geq(`alpha(X,Y)*(${alphaE})*(${withP(spec.blur, pG)})${rect}`)},${shift}[q${k}_${i}]`)
    chains.push(`[${base}][l${k}_${i}]overlay=x=${ox}:y=${oy}:eof_action=pass:${en}:format=auto[o${k}_${i}a]`)
    chains.push(`[o${k}_${i}a][q${k}_${i}]overlay=x=${ox}:y=${oy}:eof_action=pass:${en}:format=auto[o${k}_${i}]`)
  } else {
    const needA = spec.alpha !== '1' || rect
    chains.push(`${head}${needA ? ',' + geq(`alpha(X,Y)*(${alphaE})${rect}`) : ''},${shift}[l${k}_${i}]`)
    chains.push(`[${base}][l${k}_${i}]overlay=x=${ox}:y=${oy}:eof_action=pass:${en}:format=auto[o${k}_${i}]`)
  }
  base = `o${k}_${i}`
  if (spec.dip !== '0' && DIP_COLOR[f.type]) {
    const col = '0x' + DIP_COLOR[f.type].map((v) => v.toString(16).padStart(2, '0')).join('')
    chains.push(`color=c=${col}:s=${W}x${H}:r=${pl.fps}:d=${n(d)},format=yuva420p,${geq(`255*(${withP(spec.dip, pG)})`)},${shift}[d${k}_${i}]`)
    chains.push(`[${base}][d${k}_${i}]overlay=x=0:y=0:eof_action=pass:${en}:format=auto[${outLabel}]`)
  } else chains.push(`[${base}]null[${outLabel}]`)
  return outLabel
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
          `x=${Math.round((c.x ?? 0.5) * W)}-text_w/2:y=${Math.round((c.y ?? 0.5) * H)}-text_h/2:enable='between(t,${s},${e})'${titleAlpha(c)}[${next}]`,
      )
    } else {
      const m = project.media[c.mediaId]
      const k = inputs.length
      const sp = c.speed || 1
      inputs.push(['-ss', n(c.in), '-t', n(c.dur * sp), '-i', m.path])
      const p = { ...placement(c, m.w, m.h, W, H), W, H, fps }
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
      const segs = segmentsOf(c)
      if (segs.length === 1 && !segs[0].fx) {
        chains.push(f + `,setpts=PTS+${s}/TB[v${k}]`)
        chains.push(`[${cur}][v${k}]overlay=x=${p.dx}:y=${p.dy}:eof_action=pass:enable='between(t,${s},${e})':format=auto[${next}]`)
      } else {
        chains.push(f + (segs.length > 1 ? `,split=${segs.length}${segs.map((_, i) => `[s${k}_${i}]`).join('')}` : `[s${k}_0]`))
        let ci = cur
        segs.forEach((sg, i) => { ci = segmentChain(chains, c, p, k, i, sg, ci, `${next}_${i}`) })
        // rename the last label to `next`
        chains.push(`[${ci}]null[${next}]`)
      }
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
