// Hero gif: import the Smash recording, drag to V1, razor out the middle, dissolve across the cut, open Export.
// Usage (Windows node, app on PORT with an empty project): node test/gif/hero.mjs <src.mp4> <frames dir>
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { st, ev, key, sleep, rect, done, check } from '../drive.mjs'
import { start, stop, caption, glide, tap, hold, wait } from './rec.mjs'

const [src, out] = process.argv.slice(2)
const here = path.dirname(fileURLToPath(import.meta.url))
const dlg = (title, p) => new Promise((res) => { const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, '..', 'dialog.ps1'), '-Title', title, '-Path', p, '-Timeout', '30']); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(o.trim())) })
const btn = async (sel, t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(t)});if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
const until = async (js, s = 60) => { for (let i = 0; i < s * 4; i++) { if (await ev(js)) return true; await sleep(250) } return false }
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

await ev(`__ove.store.setState({clips:[],media:{},past:[],future:[],selection:[],selEdge:null,playhead:0,tool:'select',dirty:false,status:'Ready'})`)
{ const t = await rect('[data-tab="bin"]'); if (t) await ev(`document.querySelector('[data-tab="bin"]').click()`) }
await start(out)

await caption('Import a recording'); await wait(900)
const imp = await btn('.toolbar button', 'Import'); const d1 = dlg('Import media', src); await wait(200)
await tap(imp.x, imp.y, 900)
check('import dialog', (await d1) === 'OK')
await until(`Object.values(__ove.store.getState().media).some(m=>m.dur>0)`)
const m = Object.values(await st('s.media'))[0]
await until(`!!document.querySelector('[data-media="${m.id}"] img')`); await wait(1500)

await caption('Drag it onto the timeline')
const b = await rect(`[data-media="${m.id}"]`); const lane = await rect('.lane'); const v1 = await rect('[data-track="V1"]')
await hold(b.x + b.w / 2, b.y + b.h / 2, lane.x + 4, v1.y + v1.h / 2, 1500)
check('clip on timeline', (await st('s.clips')).length === 2)
await wait(500); await key('\\'); await wait(1500)

await caption('Razor (C): cut out the middle')
const zoom = await st('s.zoom'); const L = (await rect('.lane')).x; const V = await rect('[data-track="V1"]'); const VY = V.y + V.h / 2
const X = (t) => L + t * zoom
await key('c'); await wait(600)
const cutA = Math.round(m.dur * 0.3), cutB = Math.round(m.dur * 0.62)
await tap(X(cutA), VY, 900); await wait(500); await tap(X(cutB), VY, 900); await wait(600)
await key('v'); await wait(400)
check('two cuts', (await st('s.clips.filter(c=>c.trackId==="V1").length')) === 3)
await caption('Ripple delete (Shift+Delete)')
await tap(X((cutA + cutB) / 2), VY, 800); await wait(700); await key('Delete', ['shift']); await wait(1200)
check('ripple deleted', (await st('s.clips.filter(c=>c.trackId==="V1").length')) === 2)
await key('\\'); await wait(1200)

await caption('Drop a Cross Dissolve on the cut')
const z2 = await st('s.zoom'); const L2 = (await rect('.lane')).x; const X2 = (t) => L2 + t * z2
const tab = await rect('[data-tab="effects"]'); await tap(tab.x + tab.w / 2, tab.y + tab.h / 2, 900); await wait(800)
const fx = await rect('[data-fx="crossdissolve"]')
await hold(fx.x + 40, fx.y + fx.h / 2, X2(cutA), VY, 1600); await wait(800)
check('dissolve on the cut', (await st('s.clips')).some((c) => c.trackId === 'V1' && c.transition > 0 && c.transType === 'crossdissolve'))

await caption('Play across it'); const r = await rect('[data-ruler]')
await tap(X2(cutA - 3), r.y + r.h / 2, 900); await wait(500); await key(' '); await sleep(8000); await key(' '); await wait(600)

await caption('Export to MP4')
const e1 = await btn('.toolbar button', 'Export…'); await tap(e1.x, e1.y, 1000); await wait(1200)
const e2 = await btn('.dlg button', 'Export…'); await glide(e2.x, e2.y, 1000); await wait(2500)
await caption('')
console.log(JSON.stringify(await stop(1)))
await ev(`[...document.querySelectorAll('.dlg button')].find(b=>/Close/.test(b.textContent))?.click()`)
done()
