// ove CLI project opened in the app by the real Open dialog, compared to `ove show --json`; then exported by the Export dialog.
import { st, ev, rect, click, sleep, check, shot } from '../drive.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
const C = 'D:\\ove-test\\cache\\ove\\'
const PROJ = C + 'app.ovep', OUT = C + 'app-export.mp4'
const btn = async (t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});const r=b.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
const dlg = (title, path) => new Promise((res) => { const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'D:\\ove-test\\test\\dialog.ps1', '-Title', title, '-Path', path]); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o.trim())) })
await ev(`__ove.store.setState({clips:[],media:{},past:[],future:[],selection:[],projectPath:null,dirty:false})`)
const ob = await btn('Open'); const d = dlg('Open project', PROJ); await sleep(300); await click(ob.x + ob.w / 2, ob.y + ob.h / 2)
const o = await d; await sleep(2500)
const app = await st('({w:s.width,h:s.height,fps:s.fps,clips:s.clips,tracks:s.tracks,media:s.media})')
const file = JSON.parse(fs.readFileSync(PROJ, 'utf8'))
check('Open dialog → app clips deep-equal the saved .ovep', o === 'OK' && JSON.stringify(app.clips) === JSON.stringify(file.clips), o + ' ' + app.clips.length + ' clips')
check('sequence + tracks + media equal', JSON.stringify([app.w, app.h, app.fps, app.tracks]) === JSON.stringify([file.width, file.height, file.fps, file.tracks]) && JSON.stringify(Object.keys(app.media)) === JSON.stringify(Object.keys(file.media)))
await ev(`__ove.store.setState({zoom:40,playhead:0})`); await sleep(1000); await ev(`__ove.engine.seek(2)`); await sleep(1500)
await shot(C + 'app-open.png')
fs.rmSync(OUT, { force: true })
const eb = await btn('Export…'); await click(eb.x + 5, eb.y + 5); await sleep(500)
const go = await btn('Choose file and export…')
const d2 = dlg('Export MP4', OUT); await sleep(300); await click(go.x + 5, go.y + 5)
const o2 = await d2
for (let i = 0; i < 120 && !(fs.existsSync(OUT) && (await ev(`document.body.innerText.includes('Export again')`))); i++) await sleep(1000)
check('Export dialog → MP4 written', o2 === 'OK' && fs.existsSync(OUT) && fs.statSync(OUT).size > 1e5, fs.existsSync(OUT) ? fs.statSync(OUT).size + ' B' : 'missing')
