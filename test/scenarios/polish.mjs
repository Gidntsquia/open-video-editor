import { done, st, ev, rect, click, drag, rclick, key, sleep, check } from '../drive.mjs'
const media = Object.values(await st('s.media')); const A = media.find((m) => m.name.startsWith('2021-04-11 15-00-15'))
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`)
await ev(`__ove.store.getState().addFromMedia('${A.id}','V1',0)`); await sleep(200)
const v = (await st('s.clips')).find((c) => c.kind === 'video'); const a = (await st('s.clips')).find((c) => c.kind === 'audio')
const lane = await rect('.lane'); const r1 = await rect('[data-track="V3"]'); const r2 = await rect('[data-track="A1"]')
// click in empty lane area deselects
let r = await rect(`[data-clip="${v.id}"]`); await click(r.x + 20, r.y + r.h / 2)
check('click selects clip', (await st('s.selection')).length >= 1)
await click(lane.x + 900, r1.y + r1.h / 2)
check('click on empty lane deselects', (await st('s.selection')).length === 0)
// marquee
await drag(lane.x + 20, r1.y + 10, lane.x + 200, r2.y + r2.h - 5)
const sel = await st('s.selection'); check('drag-select box selects video+audio', sel.includes(v.id) && sel.includes(a.id), JSON.stringify(sel.length))
await click(lane.x + 900, r1.y + r1.h / 2)
// context menu → unlink
r = await rect(`[data-clip="${v.id}"]`); await rclick(r.x + 30, r.y + r.h / 2); await sleep(100)
const items = await ev(`[...document.querySelectorAll('.ctx div')].map(d=>d.textContent)`)
check('right-click opens clip menu', items.includes('Unlink audio/video') && items.includes('Ripple delete'), JSON.stringify(items))
const un = await rect('.ctx div:last-child'); await click(un.x + 10, un.y + 5); await sleep(100)
check('Unlink clears the link', (await st('s.clips')).every((c) => !c.link))
await key('z', ['ctrl']); check('undo unlink', (await st('s.clips')).some((c) => c.link))
// Space after a toolbar click must only play/pause
const snap0 = await st('s.snap'); const sb = await rect('.toolbar button.on:not(.primary)'); 
const btn = await ev(`(()=>{const b=[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent==='Snap');const r=b.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
await click(btn.x + 5, btn.y + 5); const snap1 = await st('s.snap'); await key(' '); await sleep(400)
check('Space after clicking Snap does not toggle Snap again', (await st('s.snap')) === snap1 && snap1 !== snap0 && (await ev('__ove.engine.playing')))
await key(' ')
// playhead follow
await ev(`__ove.store.setState({zoom:200})`); await ev(`__ove.engine.seek(0)`); await sleep(200)
await ev(`__ove.engine.seek(25)`); await sleep(300)
const sl = await ev(`document.querySelector('.timeline').scrollLeft`); check('timeline scrolls to keep playhead in view', sl > 1000, String(sl))
check('window title shows project state', (await ev('document.title')).includes('Open Video Editor'), await ev('document.title'))
done()
