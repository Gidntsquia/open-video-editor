// Preview vs export parity: effect clips built on the timeline, preview canvas frames vs exported MP4 frames.
import { st, ev, rect, drag, sleep, check } from '../drive.mjs'
import fs from 'node:fs'
const CACHE = 'D:\\ove-test\\cache\\'
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2021-04-11 15-00-15'))
const b0 = await rect(`[data-media="${A.id}"]`), v1 = await rect('[data-track="V1"]'), lane = await rect('.lane')
await drag(b0.x + 40, b0.y + 20, lane.x + 3, v1.y + v1.h / 2)
const base = (await st('s.clips')).find((c) => c.kind === 'video'), baseA = (await st('s.clips')).find((c) => c.kind === 'audio')
console.log('base clip', JSON.stringify(base))
// segments of 1.5s on V1: [label, props]
const SEG = [['color', { brightness: 1.3, contrast: 1.25, saturation: 0.4 }], ['cropscale', { crop: { l: 0.2, r: 0.1, t: 0.1, b: 0.05 }, scale: 0.7, posX: 40, posY: -30 }], ['speed2', { speed: 2 }], ['speed05', { speed: 0.5 }], ['plain', {}], ['dissolve', { transition: 1 }]]
const clips = [], D = 1.5
SEG.forEach(([, p], i) => {
  const sp = p.speed || 1, link = 'L' + i
  clips.push({ ...base, id: 'v' + i, link, start: i * D, dur: D, in: 0.3 + i * 0.1, speed: 1, ...p })
  clips[clips.length - 1].dur = D
})
// title across segment 'plain' + 'dissolve'
clips.push({ id: 't1', kind: 'title', trackId: 'V2', start: 4 * D, dur: D * 2, text: 'PARITY', font: 'Arial', size: 96, color: '#ffcc00', x: 0.5, y: 0.3 })
await ev(`__ove.store.setState({clips:${JSON.stringify(clips)}})`); await sleep(300)
const times = SEG.map((_, i) => i * D + 0.75).concat([4 * D + 0.4, 5 * D + 0.25, 5 * D + 1.2])
fs.mkdirSync('D:\\ove-test\\cache\\parity', { recursive: true })
const i = 0
for (const [k, t] of times.entries()) {
  await ev(`__ove.engine.seek(${t})`); await sleep(900)
  const url = await ev(`document.querySelector('.canvaswrap canvas').toDataURL('image/png')`)
  fs.writeFileSync(`${CACHE}parity\\prev-${k}.png`, Buffer.from(url.split(',')[1], 'base64'))
}
const OUT = CACHE + 'parity\\out.mp4'
const r = await ev(`(async()=>{const s=__ove.store.getState();const m={};for(const c of s.clips){if(c.mediaId){const x=s.media[c.mediaId];m[c.mediaId]={path:x.path,w:x.w,h:x.h,dur:x.dur,hasAudio:x.hasAudio}}}const r=await window.api.exportProject({width:s.width,height:s.height,fps:s.fps,media:m,tracks:s.tracks,clips:s.clips},${JSON.stringify(OUT)});return JSON.stringify(r)})()`)
console.log('export', r)
fs.writeFileSync(CACHE + 'parity\\times.json', JSON.stringify({ times, labels: SEG.map((s) => s[0]).concat(['title', 'dissolve-start', 'dissolve-end']) }))
