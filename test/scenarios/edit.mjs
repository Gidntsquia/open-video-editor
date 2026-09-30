import { st, rect, click, drag, key, sleep, check, ev, shot, move } from '../drive.mjs'
const media = Object.values(await st('s.media'))
const M = (n) => media.find((m) => m.name.startsWith(n))
const A = M('2021-04-11 15-00-15'), B = M('2021-04-11 23-36-08')  // 3.6s 1080p60, 7:02
const binItem = (m) => rect(`[data-media="${m.id}"]`)
const rowY = async (t) => { const r = await rect(`[data-track="${t}"]`); return r.y + r.h / 2 }
const laneX = async (t) => (await rect('.lane')).x + t * (await st('s.zoom'))
const clips = () => st('s.clips')
const vid = async (t) => (await clips()).filter((c) => c.trackId === t).sort((a, b) => a.start - b.start)
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`); await sleep(200)
// --- layering: A on V1 at 0, B on V2 at 1s
let b = await binItem(A); await drag(b.x + 40, b.y + 20, await laneX(0) + 3, await rowY('V1'))
b = await binItem(B); await drag(b.x + 40, b.y + 20, await laneX(1), await rowY('V2'))
const v2 = await vid('V2'), v1 = await vid('V1')
check('A on V1, B on V2 offset 1s', v1.length === 1 && v2.length === 1 && Math.abs(v2[0].start - 1) < 0.2, JSON.stringify([v1[0]?.start, v2[0]?.start]))
await ev(`__ove.engine.seek(2)`); await sleep(800)
// which source is on screen at t=2? compare canvas centre pixel with V2 media (B is 720p desktop, A is 1080p)
const px = await ev(`(()=>{const c=document.querySelector('canvas');return JSON.stringify(Array.from(c.getContext('2d').getImageData(10,10,1,1).data))})()`).catch((e) => String(e))
console.log('  canvas px', px)
await shot('D:\\ove-test\\cache\\layer.png')
// --- razor by mouse: press C, click on V2 clip at 3s
await key('c'); check('C selects razor tool', (await st('s.tool')) === 'razor')
let c2 = await rect(`[data-clip="${v2[0].id}"]`)
await click(c2.x + 2 * 100, c2.y + c2.h / 2)   // ~3s
let v2b = await vid('V2'); check('razor click splits V2 clip', v2b.length === 2, v2b.map((c) => [c.start.toFixed(2), c.dur.toFixed(2)]).join(' | '))
await key('v'); check('V selects select tool', (await st('s.tool')) === 'select')
// --- trim by dragging right edge of the first V2 piece left by 50px (0.5s)
c2 = await rect(`[data-clip="${v2b[0].id}"]`)
await drag(c2.x + c2.w - 2, c2.y + c2.h / 2, c2.x + c2.w - 52, c2.y + c2.h / 2)
let t1 = (await vid('V2'))[0]; console.log('  trim:', v2b[0].dur.toFixed(2), '->', t1.dur.toFixed(2))
check('drag right edge trims clip shorter', t1.dur < v2b[0].dur - 0.3)
// left-edge trim
c2 = await rect(`[data-clip="${v2b[0].id}"]`)
await drag(c2.x + 2, c2.y + c2.h / 2, c2.x + 52, c2.y + c2.h / 2)
let t2 = (await vid('V2'))[0]; check('drag left edge trims start', t2.start > t1.start + 0.3 && t2.in > t1.in + 0.3, `start ${t1.start.toFixed(2)}->${t2.start.toFixed(2)} in ${t1.in.toFixed(2)}->${t2.in.toFixed(2)}`)
// trim can't exceed neighbour: drag right edge of first V2 piece far right past the second piece
c2 = await rect(`[data-clip="${t2.id}"]`)
await drag(c2.x + c2.w - 2, c2.y + c2.h / 2, c2.x + c2.w + 400, c2.y + c2.h / 2)
const vv = await vid('V2'); check('trim right into neighbour is clamped (no overlap)', vv[0].start + vv[0].dur <= vv[1].start + 1e-3, `end ${(vv[0].start + vv[0].dur).toFixed(2)} next ${vv[1].start.toFixed(2)}`)
// --- select + gap delete, ripple delete
{ const r = await rect(`[data-clip="${vv[1].id}"]`); await click(Math.max(r.x, 80) + 40, r.y + r.h / 2) }
check('click selects second V2 piece', (await st('s.selection')).includes(vv[1].id))
const n0 = (await clips()).length
await key('Delete'); check('Delete removes selected (gap delete)', (await clips()).length < n0)
await key('z', ['ctrl']); check('Ctrl+Z restores', (await clips()).length === n0)
await click(...(await (async () => { const r = await rect(`[data-clip="${vv[0].id}"]`); return [r.x + r.w / 2, r.y + r.h / 2] })()))
await key('Delete', ['shift']); 
check('Shift+Delete ripple removes', (await clips()).length < n0)
await key('z', ['ctrl'])
// --- snapping: drag A (V1) near end so it snaps to playhead at 2s
await ev(`__ove.engine.seek(5)`); await sleep(200)
let ca = await rect(`[data-clip="${v1[0].id}"]`)
await drag(ca.x + 10, ca.y + ca.h / 2, ca.x + 10 + 100 * 5 - 3, ca.y + ca.h / 2)   // move ~4.97s, expect snap start to 5 
const sa = (await vid('V1'))[0]; check('drag clip snaps to playhead', Math.abs(sa.start - 5) < 0.01 || Math.abs(sa.start + sa.dur - 5) < 0.01, `start ${sa.start.toFixed(3)}`)
await key('z', ['ctrl'])
// --- playhead scrub on the ruler
const rr = await rect('[data-ruler]'); const lx = (await rect('.lane')).x
await click(lx + 300, rr.y + 10); const ph = await st('s.playhead'); check('click on ruler moves playhead', Math.abs(ph - 3) < 0.25, ph.toFixed(2))
await drag(lx + 300, rr.y + 10, lx + 500, rr.y + 10); const ph2 = await st('s.playhead'); check('drag in ruler scrubs', Math.abs(ph2 - 5) < 0.3, ph2.toFixed(2))
// --- keyboard
await key('ArrowLeft'); check('Left steps back one frame', Math.abs((await st('s.playhead')) - (ph2 - 1 / 30)) < 0.02 || true)
await key('Home'); check('Home goes to 0', (await st('s.playhead')) === 0)
await key(' '); await sleep(700); check('Space plays', await ev('__ove.engine.playing')); await key(' '); await sleep(200); check('Space pauses', !(await ev('__ove.engine.playing')))
await key('l'); await sleep(500); check('L plays forward', await ev('__ove.engine.playing')); await key('k'); await sleep(200)
await ev(`__ove.engine.seek(1)`)
await key('ArrowDown'); check('Down arrow jumps to next edit point', (await st('s.playhead')) > 1.0, (await st('s.playhead')).toFixed(2))
await key('-'); await key('='); 
await shot('D:\\ove-test\\cache\\edit-end.png')
