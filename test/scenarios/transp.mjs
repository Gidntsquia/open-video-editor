// Preview vs export for every video transition at 25/50/75 %. Preview seeks to exact frame times k/fps.
import { st, ev, rect, drag, sleep } from '../drive.mjs'
import fs from 'node:fs'
const D = 'D:\\ove-test\\cache\\transp\\'
fs.mkdirSync(D, { recursive: true })
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
const b0 = await rect(`[data-media="${A.id}"]`), v1 = await rect('[data-track="V1"]'), lane = await rect('.lane')
await drag(b0.x + 40, b0.y + 20, lane.x + 3, v1.y + v1.h / 2)
const base = (await st('s.clips')).find((c) => c.kind === 'video')
const TYPES = ['crossdissolve','dipblack','dipwhite','filmdissolve','wipeleft','wiperight','wipeup','wipedown','pushleft','pushright','pushup','pushdown','crosszoom','blurdissolve']
const clips = []
for (let i = 0; i < 15; i++) clips.push({ ...base, id: 'c' + i, link: undefined, start: 3 * i, dur: 3, in: 4 + 5 * i })
await ev(`__ove.store.setState({clips:${JSON.stringify(clips)}})`)
for (let i = 0; i < 14; i++) await ev(`__ove.store.getState().setTransition({a:'c${i}',b:'c${i + 1}'},{type:'${TYPES[i]}',dur:1})`)
const fps = 30, frames = []
for (let i = 0; i < 14; i++) {
  const cut = 3 * (i + 1)
  for (const q of [0.25, 0.5, 0.75]) frames.push({ type: TYPES[i], q, k: Math.round((cut - 0.5 + q) * fps) })
}
for (const [n, f] of frames.entries()) {
  await ev(`__ove.engine.seek(${f.k / fps})`); await sleep(700)
  const url = await ev(`document.querySelector('.canvaswrap canvas').toDataURL('image/png')`)
  fs.writeFileSync(`${D}p${n}.png`, Buffer.from(url.split(',')[1], 'base64'))
}
fs.writeFileSync(D + 'frames.json', JSON.stringify(frames))
const OUT = D + 'out.mp4'
const r = await ev(`(async()=>{const s=__ove.store.getState();const m={};for(const c of s.clips){if(c.mediaId){const x=s.media[c.mediaId];m[c.mediaId]={path:x.path,w:x.w,h:x.h,dur:x.dur,hasAudio:x.hasAudio}}}const r=await window.api.exportProject({width:s.width,height:s.height,fps:s.fps,media:m,tracks:s.tracks,clips:s.clips},${JSON.stringify(OUT)});return JSON.stringify(r)})()`)
console.log('export', r)
