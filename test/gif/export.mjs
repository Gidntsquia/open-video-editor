// Export gif, part 1 (app): open Export, pick the budget, Export… -> native Save dialog -> progress -> Saved.
// Usage (Windows node, app on PORT, Smash recording in the bin): node test/gif/export.mjs <frames dir> <out.mp4>
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { st, ev, sleep, rect, done, check } from '../drive.mjs'
import { start, stop, caption, glide, tap, wait } from './rec.mjs'

const [out, mp4] = process.argv.slice(2)
const here = path.dirname(fileURLToPath(import.meta.url))
const dlg = (title, p) => new Promise((res) => { const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, '..', 'dialog.ps1'), '-Title', title, '-Path', p, '-Timeout', '30']); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(o.trim())) })
const btn = async (sel, t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(t)});if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
const until = async (js, s = 60) => { for (let i = 0; i < s * 4; i++) { if (await ev(js)) return true; await sleep(250) } return false }

// Off camera: a 50 s edit = title + two pieces of the match joined by a 1 s dissolve.
const m = Object.values(await st('s.media'))[0]
await ev(`(()=>{const S=__ove.store.getState();__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,playhead:0,tool:'select'});S.addFromMedia(${JSON.stringify(m.id)},'V1',0);S.addFromMedia(${JSON.stringify(m.id)},'V1',600)
  const ids=[...new Set(__ove.store.getState().clips.map(c=>c.link))];const cs=__ove.store.getState().clips.map(c=>c.link===ids[0]?{...c,in:170,dur:25}:{...c,in:300,start:25,dur:25})
  __ove.store.setState({clips:cs,selection:[]});const v=__ove.store.getState().clips.find(c=>c.kind==='video'&&c.start>1);__ove.store.getState().addTransition(v.id,1)
  S.addTitle(1);const t=__ove.store.getState().clips.find(c=>c.kind==='title');__ove.store.getState().setProps([t.id],{text:'GAME!',size:180});__ove.store.setState({selection:[],dirty:false,status:'Ready'})})()`)
await ev(`__ove.store.getState().setZoom((innerWidth-300)/55)`); await ev(`__ove.store.getState().setPlayhead(2)`); await sleep(2000)
check('edit ready', (await st('s.clips.filter(c=>c.kind==="video").length')) === 2)
fs.rmSync(mp4, { force: true }); fs.mkdirSync(path.dirname(mp4), { recursive: true })
await start(out)

await caption('Export…'); const e1 = await btn('.toolbar button', 'Export…'); await tap(e1.x, e1.y, 1000); await wait(1200)
const sel = await rect('.dlg select'); await glide(sel.x + sel.w / 2, sel.y + sel.h / 2, 800); await wait(900)
await caption('Pick a file name, then it encodes')
const e2 = await btn('.dlg button', 'Export…'); const d2 = dlg('Export MP4', mp4); await tap(e2.x, e2.y, 900)
check('Save dialog filled', (await d2) === 'OK')
const ok = await until(`document.querySelector('.msg')?.textContent.startsWith('Saved')`, 240)
check('export finished', ok, await ev(`document.querySelector('.msg')?.textContent||''`))
await wait(2500); await caption('')
console.log(JSON.stringify(await stop(0.5)))
await ev(`[...document.querySelectorAll('.dlg button')].find(b=>/Close/.test(b.textContent))?.click()`)
done()
