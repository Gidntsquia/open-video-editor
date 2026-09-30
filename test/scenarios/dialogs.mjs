// Native dialogs by real clicks: Save, Open, Import, Export. dialog.ps1 fills each native dialog via UI Automation.
import { st, ev, rect, click, key, sleep, check } from '../drive.mjs'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
const C = 'D:\\ove-test\\cache\\'
const btn = async (t) => { const r = JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});const r=b.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`)); return r }
const dlg = (title, path) => new Promise((res) => { const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'D:\\ove-test\\test\\dialog.ps1', '-Title', title, '-Path', path]); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o.trim())) })
const press = async (label, title, path) => { const b = await btn(label); const d = dlg(title, path); await sleep(300); await click(b.x + b.w / 2, b.y + b.h / 2); const o = await d; await sleep(1200); return o }
const PROJ = C + 'dialog-test.ovep'; fs.rmSync(PROJ, { force: true })
const before = await st('({clips:s.clips,tracks:s.tracks,w:s.width,h:s.height,fps:s.fps})')
check('project has effect clips before save', before.clips.length >= 7, before.clips.length + ' clips')
let o = await press('Save', 'Save project', PROJ)
check('Save dialog → file written', o === 'OK' && fs.existsSync(PROJ), o + ' ' + (fs.existsSync(PROJ) ? fs.statSync(PROJ).size + ' B' : ''))
check('title/dirty updated', (await st('({p:s.projectPath,d:s.dirty})')).p === PROJ)
// wipe, then reopen via dialog
await ev(`__ove.store.setState({clips:[],media:{},past:[],future:[],selection:[],projectPath:null,dirty:false})`)
o = await press('Open', 'Open project', PROJ)
const after = await st('({clips:s.clips,tracks:s.tracks,w:s.width,h:s.height,fps:s.fps,media:Object.keys(s.media).length})')
check('Open dialog → clips identical', o === 'OK' && JSON.stringify(after.clips) === JSON.stringify(before.clips), o + ' media ' + after.media)
check('tracks/sequence identical', JSON.stringify([after.tracks, after.w, after.h, after.fps]) === JSON.stringify([before.tracks, before.w, before.h, before.fps]))
await sleep(1500)
await ev(`__ove.engine.seek(0.75)`); await sleep(1200)
const px = await ev(`(()=>{const c=document.querySelector('.canvaswrap canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s=0;for(let i=0;i<d.length;i+=4000)s+=d[i]+d[i+1]+d[i+2];return s})()`)
check('reopened project renders a non-black frame', px > 1000, String(px))
// Import dialog
const SRC = 'D:\\OBS Videos\\2023-08-16 23-55-20.mp4'
const n0 = Object.keys(await st('s.media')).length
o = await press('Import', 'Import media', SRC)
await sleep(2500)
const media = Object.values(await st('s.media'))
check('Import dialog → media in bin', media.some((m) => m.path === SRC), o + ' ' + media.length + ' items (was ' + n0 + ')')
// Export dialog
const OUT = C + 'dialog-export.mp4'; fs.rmSync(OUT, { force: true })
const eb = await btn('Export…'); await click(eb.x + 5, eb.y + 5); await sleep(500)
const go = await btn('Choose file and export…')
const d = dlg('Export MP4', OUT); await sleep(300); await click(go.x + 5, go.y + 5)
o = await d
for (let i = 0; i < 90 && !(fs.existsSync(OUT) && (await ev(`document.body.innerText.includes('Export again')`))); i++) await sleep(1000)
check('Export dialog → MP4 written', o === 'OK' && fs.existsSync(OUT) && fs.statSync(OUT).size > 1e5, o + ' ' + (fs.existsSync(OUT) ? fs.statSync(OUT).size + ' B' : 'missing'))
