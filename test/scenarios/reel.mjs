// Highlight reel from a Smash Bros recording, built with real mouse/keys. Source is read-only.
import { done, st, ev, rect, click, drag, key, sleep, check, shot, typeText, tripleClick } from '../drive.mjs'
const SRC = 'D:\\OBS Videos\\2023-08-16 23-55-20.mp4'
const OUT = 'D:\\ove-test\\cache\\smash-highlight-reel.mp4'
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`)
let media = Object.values(await st('s.media')).find((m) => m.path === SRC)
if (!media) { await ev(`__ove.importPaths([${JSON.stringify(SRC)}])`); await sleep(2500); media = Object.values(await st('s.media')).find((m) => m.path === SRC) }
check('source in bin', !!media, media && media.dur.toFixed(1) + 's')
// drag bin item onto V1 at t=0
const item = await rect('[data-media="'+media.id+'"]')
const lane = await rect('.lane'); const v1 = await rect('[data-track="V1"]')
await drag(item.x + 20, item.y + 20, lane.x + 5, v1.y + v1.h / 2, 20); await sleep(300)
let clips = await st('s.clips'); check('clip on V1 by mouse drag', clips.some((c) => c.kind === 'video'), clips.length + ' clips')
await key('\\'); await sleep(200) // zoom to fit
const KEEP = [[20, 28], [86, 94], [122, 130], [218, 226]]
const pts = KEEP.flat()
await key('c', []); await key('v') // razor then back to select (exercise tool keys)
for (const t of pts) { await ev(`__ove.engine.seek(${t})`); await sleep(120); await key('k', ['ctrl']); await sleep(120) }
clips = (await st('s.clips')).filter((c) => c.kind === 'video').sort((a, b) => a.start - b.start)
check('9 video pieces after 8 cuts', clips.length === 9, String(clips.length))
// ripple-delete the non-highlight pieces (even indices), last to first, by clicking each clip then Shift+Delete
for (let i = 8; i >= 0; i -= 2) {
  const c = (await st('s.clips')).filter((x) => x.kind === 'video').sort((a, b) => a.start - b.start)[i]
  const r = await rect(`[data-clip="${c.id}"]`)
  await click(r.x + Math.min(r.w / 2, 40), r.y + r.h / 2); await sleep(80)
  await key('Delete', ['shift']); await sleep(120)
}
clips = (await st('s.clips')).filter((x) => x.kind === 'video').sort((a, b) => a.start - b.start)
check('4 highlight clips, contiguous', clips.length === 4 && clips.every((c, i) => i === 0 || Math.abs(c.start - (clips[i - 1].start + clips[i - 1].dur)) < 0.05), clips.map((c) => `${c.start.toFixed(1)}+${c.dur.toFixed(1)}@${c.in?.toFixed?.(1)}`).join(' '))
// cross-dissolve between clips 1-2 etc. if UI offers it: select clip 2 and press the inspector button
// title at 0
await ev(`__ove.engine.seek(0)`); await sleep(100)
const tb = await ev(`(()=>{const b=[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent==='+ Title');const r=b.getBoundingClientRect();return {x:r.x,y:r.y}})()`)
await click(tb.x + 5, tb.y + 5); await sleep(200)
const ta = await rect('.inspector textarea'); await tripleClick(ta.x + 10, ta.y + 10); await key('a', ['ctrl']); await typeText('SMASH HIGHLIGHTS\nBowser vs Mario'); await sleep(200)
const t = (await st('s.clips')).find((c) => c.kind === 'title'); check('title typed', t && t.text.includes('SMASH'), t && t.text)
await ev(`__ove.engine.seek(1)`); await sleep(500); await shot('D:\\ove-test\\cache\\reel-title.png')
await ev(`__ove.engine.seek(12)`); await sleep(500); await shot('D:\\ove-test\\cache\\reel-mid.png')
await shot('D:\\ove-test\\cache\\reel-timeline.png')
// export (native save dialog can't be driven; call the same IPC the dialog does, to a cache path)
const r = await ev(`(async()=>{const s=__ove.store.getState();const m={};for(const c of s.clips){if(c.mediaId){const x=s.media[c.mediaId];m[c.mediaId]={path:x.path,w:x.w,h:x.h,dur:x.dur,hasAudio:x.hasAudio}}}const r=await window.api.exportProject({width:s.width,height:s.height,fps:s.fps,media:m,tracks:s.tracks,clips:s.clips},${JSON.stringify(OUT)});return JSON.stringify(r)})()`)
console.log('export', r)
done()
