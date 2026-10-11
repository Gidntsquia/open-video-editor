// Inspector gif: add a title and type it, crop + scale the clip with the sliders, set speed 2x, scrub.
// Usage (Windows node, app on PORT with the Smash recording in the bin): node test/gif/inspector.mjs <frames dir>
import { st, ev, key, sleep, rect, done, check, typeText, tripleClick } from '../drive.mjs'
import { start, stop, caption, glide, tap, hold, wait } from './rec.mjs'

const [out] = process.argv.slice(2)
const m = Object.values(await st('s.media'))[0]
// Off camera: one 20 s piece of the match on V1/A1, zoomed so it fills the timeline.
await ev(`(()=>{const S=__ove.store.getState();__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,playhead:0,tool:'select'});S.addFromMedia(${JSON.stringify(m.id)},'V1',0)
  const cs=__ove.store.getState().clips.map(c=>({...c,in:170,dur:20}));__ove.store.setState({clips:cs,selection:[],dirty:false,status:'Ready'})})()`)
await ev(`document.querySelector('[data-tab="bin"]').click()`)
await ev(`__ove.store.getState().setZoom((innerWidth-300)/24)`); await sleep(1500)
const fields = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.insp .num')].map(l=>{const i=l.querySelector('input[type=range]');const n=l.querySelector('input[type=number]');const a=i?i.getBoundingClientRect():{};const b=n?n.getBoundingClientRect():{};return {label:l.querySelector('span').textContent,r:{x:a.x,y:a.y,w:a.width,h:a.height},n:{x:b.x,y:b.y,w:b.width,h:b.height}}}))`))
const L = (await rect('.lane')).x, zoom = await st('s.zoom'), X = (t) => L + t * zoom
const ruler = await rect('[data-ruler]'), RY = ruler.y + ruler.h / 2
const v1 = await rect('[data-track="V1"]'), VY = v1.y + v1.h / 2
await start(out)

await caption('Add a title'); await tap(X(3), RY, 900); await wait(500)
const tb = JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent.trim()==='+ Title');const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
await tap(tb.x, tb.y, 1000); await wait(700)
const ta = await rect('.insp textarea'); await glide(ta.x + 40, ta.y + 14, 800); await tripleClick(ta.x + 40, ta.y + 14); await wait(300)
for (const ch of 'GAME!') { await typeText(ch); await wait(180) }
await wait(500); let F = await fields(); const f = (n) => F.find((x) => x.label === n)
await tripleClick(f('Size').n.x + 12, f('Size').n.y + 8); await typeText('180'); await key('Tab'); await wait(1200)
check('title GAME! size 180', (await st('s.clips')).some((c) => c.kind === 'title' && c.text === 'GAME!' && c.size === 180))

await caption('Crop and scale the clip')
await tap(X(14), VY, 1000); await wait(700); F = await fields()
const slide = async (n, v, min, max, ms = 1100) => { const r = f(n).r; const y = r.y + r.h / 2; const cur = (await st('s.clips.find(c=>s.selection.includes(c.id)&&c.kind==="video")'))
  const v0 = n === 'Scale' ? cur.scale : n === 'Speed' ? cur.speed : cur.crop[{ 'Crop left': 'l', 'Crop right': 'r', 'Crop top': 't', 'Crop bottom': 'b' }[n]]
  await hold(r.x + (r.w * (v0 - min)) / (max - min), y, r.x + (r.w * (v - min)) / (max - min), y, ms); await wait(500) }
await slide('Crop left', 0.18, 0, 0.9); await slide('Crop right', 0.18, 0, 0.9); await slide('Scale', 1.35, 0.1, 4)
const vc = await st('s.clips.find(c=>s.selection.includes(c.id)&&c.kind==="video")')
check('crop + scale set', vc.crop.l > 0.1 && vc.crop.r > 0.1 && vc.scale > 1.2, JSON.stringify([vc.crop, vc.scale]))

await caption('Speed 2×'); F = await fields()
await glide(f('Speed').n.x + 12, f('Speed').n.y + 8, 900); await tripleClick(f('Speed').n.x + 12, f('Speed').n.y + 8); await wait(300); await typeText('2'); await wait(300); await key('Tab'); await wait(1500)
check('speed 2', (await st('s.clips.filter(c=>c.kind!=="title").every(c=>c.speed===2)')))

await caption('Scrub to check it'); await hold(X(0.5), RY, X(9.5), RY, 4200); await wait(1500)
await caption('')
console.log(JSON.stringify(await stop(0.8)))
done()
