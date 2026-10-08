// Export dialog in the real app: layout shot, encoder named while running, forced failure shows stderr + log.
import { st, ev, click, sleep, check, shot } from '../drive.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
const C = 'D:\\ove-test\\cache\\'
const btn = async (t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});const r=b.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
const dlg = (title, path) => new Promise((res) => { const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'D:\\ove-test\\test\\dialog.ps1', '-Title', title, '-Path', path]); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o.trim())) })
const dlgBtn = async (t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('.dlg button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});const r=b.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
const data = fs.readFileSync(C + 'hl.ovep', 'utf8')
await ev(`__ove.openData(${data}, 'x.ovep')`); await sleep(3000)
const b0 = await btn('Export…'); await click(b0.x + 5, b0.y + 5); await sleep(500)
await shot(C + 'exportdlg-1.png')
await ev(`document.querySelector('[data-advanced] summary').click()`); await sleep(300)
await shot(C + 'exportdlg-2.png')
// failure: break a source path
const n = await st('s.clips.filter(c=>c.mediaId).length')
await ev(`__ove.store.setState(s=>({media:Object.fromEntries(Object.entries(s.media).map(([k,m])=>[k,{...m,path:'D:\\\\nope\\\\missing.mp4'}]))}))`)
check('project has media clips', n > 0, n + ' clips')
const logsBefore = fs.readdirSync(C).filter((f) => f.startsWith('export-') && f.endsWith('.log')).length
let g = await dlgBtn('Export…'); const d = dlg('Export MP4', C + 'fail.mp4'); await sleep(300); await click(g.x + 5, g.y + 5); await d
for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('.msg')`)); i++) await sleep(1000)
await sleep(500); await shot(C + 'exportdlg-fail.png')
const msg = await ev(`document.querySelector('.msg')?.textContent||''`)
const logs = fs.readdirSync(C).filter((f) => f.startsWith('export-') && f.endsWith('.log'))
check('failure shows stderr tail + log path', /export-\d{8}-\d{6}\.log/.test(msg), msg.slice(-300))
check('log file written', logs.length > logsBefore, logs.join(','))
check('no partial file', !fs.existsSync(C + 'fail.mp4') && !fs.existsSync(C + 'fail.part.mp4'))
// real export: running panel names the encoder; default save folder exists
await ev(`__ove.openData(${data}, 'x.ovep')`); await sleep(2500)
fs.rmSync(C + 'ok.mp4', { force: true })
g = await dlgBtn('Export…'); const d2 = dlg('Export MP4', C + 'ok.mp4'); await sleep(300); await click(g.x + 5, g.y + 5); await d2
await sleep(6000); await shot(C + 'exportdlg-run.png')
const run = await ev(`document.querySelector('.dlg .hint')?.textContent||''`)
check('running panel names encoder', /h264_nvenc|libx264/.test(run), run)
for (let i = 0; i < 150 && !(await ev(`document.querySelector('.msg')?.textContent.startsWith('Saved')`)); i++) await sleep(1000)
check('export done', fs.existsSync(C + 'ok.mp4') && fs.statSync(C + 'ok.mp4').size > 1e6, await ev(`document.querySelector('.msg')?.textContent||''`))
check('default folder created', fs.existsSync('D:\\Open Video Editor Videos'))
