// Audio transition parity: the preview's WebAudio output (tapped before the destination, raw samples) vs the exported
// audio, RMS per 250 ms window across a 1 s audio transition of each type, within 1 dB.
// Run: node.exe test/run.mjs trans5 (from D:\ove-test). Needs a fresh app (the tap is installed once per app run).
import { st, ev, sleep, check } from '../drive.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
const D = 'D:\\ove-test\\cache\\trans5\\'; fs.mkdirSync(D, { recursive: true })
const FF = 'D:\\ove-test\\node_modules\\ffmpeg-static\\ffmpeg.exe'
const WIN = 0.25, T0 = 2.5, LEN = 3.2, SR = 48000
const db = (x) => 20 * Math.log10(Math.max(x, 1e-6))
const rmsOf = (a, i0, i1) => { let q = 0, n = 0; for (let i = Math.max(0, i0); i < i1 && i < a.length; i++) { q += a[i] * a[i]; n++ } return n ? Math.sqrt(q / n) : 0 }

await ev(`(()=>{const e=document.querySelector('[data-tab="bin"]');e&&e.click();return 1})()`)
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,popup:null,zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
await ev(`__ove.store.getState().addFromMedia(${JSON.stringify(A.id)}, 'V1', 0)`); await sleep(300)
const base = await st('s.clips'); const bv = base.find((c) => c.kind === 'video'), ba = base.find((c) => c.kind === 'audio')
check('media added with audio', !!bv && !!ba)
const mk = () => [0, 1].map((i) => [{ ...bv, id: 'c' + i, link: 'L' + i, start: 4 * i, dur: 4, in: 30 + 40 * i }, { ...ba, id: 'a' + i, link: 'L' + i, start: 4 * i, dur: 4, in: 30 + 40 * i }]).flat()

// tap: every clip gain connects to a ScriptProcessor instead of the destination; it records stereo samples on demand
const tap = await ev(`(()=>{if(window.__tap)return 'again';const E=__ove.engine;if(!E.audio)E.audio=new AudioContext();const ac=E.audio
  const sp=ac.createScriptProcessor(1024,2,2);sp.connect(ac.destination);window.__tap={sp,rec:null,start:()=>{const T=window.__tap;T.rec={l:[],r:[]};sp.onaudioprocess=(e)=>{const b=e.inputBuffer;T.rec.l.push(new Float32Array(b.getChannelData(0)));T.rec.r.push(new Float32Array(b.getChannelData(1)))}},
    stop:()=>{sp.onaudioprocess=null;const T=window.__tap;const n=T.rec.l.reduce((s,a)=>s+a.length,0);const m=new Float32Array(n);let w=0;for(let i=0;i<T.rec.l.length;i++){const l=T.rec.l[i],r=T.rec.r[i];for(let j=0;j<l.length;j++)m[w++]=(l[j]+r[j])/2}
      const u=new Uint8Array(m.buffer);let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)}}
  const cg=ac.createGain.bind(ac);ac.createGain=()=>{const g=cg();const oc=g.connect.bind(g);g.connect=(d,...r)=>oc(d===ac.destination?sp:d,...r);return g};return 'ok'})()`)
check('audio tap installed in a fresh app', tap === 'ok', tap)

for (const type of ['constpower', 'constgain', 'expfade']) {
  await ev(`__ove.store.setState({clips:${JSON.stringify(mk())},past:[],selection:[],selEdge:null})`); await sleep(100)
  const r = await ev(`JSON.stringify(__ove.store.getState().setTransition({a:'a0',b:'a1'},{type:${JSON.stringify(type)},dur:1}))`)
  const a1 = (await st('s.clips')).find((c) => c.id === 'a1')
  check(`${type}: 1 s audio transition applied (a1 starts ${a1.start})`, a1.transType === type && Math.abs(a1.transition - 1) < 1e-6, r)
  const OUT = D + type + '.mp4'; fs.rmSync(OUT, { force: true })
  await ev(`(async()=>{const s=__ove.store.getState();const m={};for(const c of s.clips){if(c.mediaId){const x=s.media[c.mediaId];m[c.mediaId]={path:x.path,w:x.w,h:x.h,dur:x.dur,hasAudio:x.hasAudio}}}return JSON.stringify(await window.api.exportProject({width:s.width,height:s.height,fps:s.fps,media:m,tracks:s.tracks,clips:s.clips},${JSON.stringify(OUT)}))})()`)
  check(`${type}: exported`, fs.existsSync(OUT) && fs.statSync(OUT).size > 1e4)
  const pcm = spawnSync(FF, ['-v', 'error', '-i', OUT, '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout
  const st2 = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
  const ex = new Float32Array(st2.length / 2); for (let i = 0; i < ex.length; i++) ex[i] = (st2[2 * i] + st2[2 * i + 1]) / 2
  // preview: seek, play LEN seconds through the tap
  await ev(`__ove.engine.seek(${T0})`); await sleep(1500)
  await ev(`(async()=>{const E=__ove.engine;await E.audio.resume();E.play();window.__tap.start();return 1})()`)
  await sleep(LEN * 1000)
  const b64 = await ev(`(()=>{const s=window.__tap.stop();__ove.engine.pause();return s})()`)
  const pb = Buffer.from(b64, 'base64'); const pv = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4)
  fs.writeFileSync(D + type + '-preview.f32', pb)
  // align: the first 0.6 s (a0 alone) by waveform cross-correlation against the export at T0 (search ±0.3 s)
  let f = 0; while (f < pv.length && Math.abs(pv[f]) < 1e-4) f++
  // skip Chromium's first ~0.3 s of clock warp after play()
  const s0 = f + Math.floor(0.4 * SR), n = Math.floor(0.5 * SR); const seg = pv.subarray(s0, s0 + n)
  let best = [-1, 0]
  for (let L = -0.3 * SR; L <= 0.3 * SR; L += 4) { const o = Math.round(T0 * SR + s0 + L); let c = 0, se = 0; for (let i = 0; i < n; i++) { c += seg[i] * ex[o + i]; se += ex[o + i] * ex[o + i] } const rr = c / Math.sqrt(se * n * rmsOf(seg, 0, n) ** 2); if (rr > best[0]) best = [rr, L] }
  const off = Math.round(T0 * SR + best[1]) // export sample index of preview sample 0
  check(`${type}: preview waveform aligned with the export (r ${best[0].toFixed(3)} on 0.5 s, start latency ${((f + best[1]) / SR * 1000).toFixed(0)} ms)`, best[0] > 0.25)
  const rows = []; let worst = 0
  // per window: the preview element may drift a few ms (Chromium clock), so align each window locally (±40 ms) by
  // correlation before comparing levels
  const corr = (i0, o, n) => { let c = 0, se = 0, sp = 0; for (let i = 0; i < n; i++) { c += pv[i0 + i] * ex[o + i]; se += ex[o + i] ** 2; sp += pv[i0 + i] ** 2 } return c / Math.sqrt(se * sp + 1e-12) }
  for (let t = T0 + 0.25; t + WIN <= T0 + LEN - 0.25; t += WIN) {
    const n = Math.round(WIN * SR), e0 = Math.round(t * SR); let i0 = e0 - off; if (i0 < f) continue
    let bl = [corr(i0, e0, n), 0]; for (let L = -0.04 * SR; L <= 0.04 * SR; L += 8) { const r = corr(i0 + L, e0, n); if (r > bl[0]) bl = [r, L] }
    i0 += bl[1]
    const p = rmsOf(pv, i0, i0 + n), e = rmsOf(ex, e0, e0 + n)
    const d = db(p) - db(e); if (db(e) > -50) worst = Math.max(worst, Math.abs(d))
    rows.push(`${t.toFixed(2)}s preview ${db(p).toFixed(1)} export ${db(e).toFixed(1)} Δ ${d.toFixed(2)} (r ${bl[0].toFixed(2)} ${(bl[1] / SR * 1000).toFixed(0)} ms)`)
  }
  fs.writeFileSync(D + type + '.txt', rows.join('\n'))
  check(`${type}: preview vs export RMS within 1 dB over ${rows.length} windows (worst ${worst.toFixed(2)} dB)`, rows.length >= 8 && worst <= 1, rows.map((r) => r.replace(/preview |export |\(.*\)/g, '')).join(' | '))
}
