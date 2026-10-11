// Clean-machine check of the portable zip: drives the unzipped app (started with --remote-debugging-port)
// through native Import dialog -> drag to V1 -> razor cuts -> ripple deletes -> Export dialog -> MP4,
// then checks cache/ next to the exe and the Clear cache button.
// Usage (Windows node, any folder): PORT=9333 node test/fresh.mjs <unzipped folder> <source.mp4> <out.mp4>
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { st, ev, click, drag, key, sleep, check, shot, rect, done } from './drive.mjs'

const [dir, src, out] = process.argv.slice(2)
const here = path.dirname(fileURLToPath(import.meta.url))
// OVE_DLG_DIR: the app runs as another Windows user, whose dialogs only that user can drive; a helper running as
// that user (D:\ove-r13\r13-dlg.ps1 style) answers <dir>\dlg-req.txt "title|path" with dlg-res.txt.
const dlgDir = process.env.OVE_DLG_DIR
const dlgProxy = async (title, p) => { const res = path.join(dlgDir, 'dlg-res.txt'); fs.rmSync(res, { force: true }); fs.writeFileSync(path.join(dlgDir, 'dlg-req.txt'), `${title}|${p}`)
  for (let i = 0; i < 400 && !fs.existsSync(res); i++) await sleep(100); await sleep(100); return fs.existsSync(res) ? fs.readFileSync(res, 'utf8').trim() : 'NO_REPLY' }
const dlg = (title, p) => dlgDir ? dlgProxy(title, p) : new Promise((res) => { const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'dialog.ps1'), '-Title', title, '-Path', p, '-Timeout', '30']); let o = ''; c.stdout.on('data', (d) => (o += d)); c.on('close', () => res(o.trim())) })
const btn = async (sel, t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(t)});if(!b)return 'null';const r=b.getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()`))
const shots = path.join(dir, 'fresh-shots'); fs.mkdirSync(shots, { recursive: true })
const until = async (js, s = 60) => { for (let i = 0; i < s * 2; i++) { if (await ev(js)) return true; await sleep(500) } return false }

await until(`!!window.__ove && !!window.__ove.ready`, 30); await ev(`window.__ove.ready`)
check('app window loaded', true, await ev('document.title'))
const cacheDir = (await ev(`window.api.cacheInfo()`)).dir
check('cache folder is next to the exe', path.resolve(cacheDir).toLowerCase() === path.resolve(dir, 'cache').toLowerCase(), cacheDir)

// Import through the toolbar button and the native file dialog
const imp = await btn('.toolbar button', 'Import'); const d1 = dlg('Import media', src); await sleep(300); await click(imp.x, imp.y)
check('Import dialog filled', (await d1) === 'OK')
check('media probed', await until(`Object.values(__ove.store.getState().media).some(m=>m.dur>0&&m.path.toLowerCase()===${JSON.stringify(src.toLowerCase())})`, 60))
const m = Object.values(await st('s.media')).find((x) => x.path.toLowerCase() === src.toLowerCase())
check('thumbnail made', await until(`!!document.querySelector('[data-media="${m.id}"] img')`, 60))
await shot(path.join(shots, '1-imported.png'))

// Drag the bin item onto V1
await ev(`document.querySelector('[data-media="${m.id}"]').scrollIntoView({block:'center'})`); await sleep(300)
const b = await rect(`[data-media="${m.id}"]`); const lane = await rect('.lane'); const v1 = await rect('[data-track="V1"]')
await drag(b.x + 40, b.y + 20, lane.x + 5, v1.y + v1.h / 2, 20)
check('clip on V1 + A1', (await st('s.clips')).length === 2)
await key('Escape'); await ev(`__ove.store.getState().setZoom((document.querySelector('.timeline').clientWidth-110)/40)`); await ev(`document.querySelector('.timeline').scrollLeft=0`); await sleep(300)

// Razor at 10 s and 25 s, then ripple-delete everything outside 10-25 s
const zoom = await st('s.zoom'); const L = (await rect('.lane')).x; const V = await rect('[data-track="V1"]')
await ev(`document.activeElement?.blur()`); await key('c'); const tool = await st('s.tool'); for (const t of [10, 25]) { await click(L + t * zoom, V.y + V.h / 2); await sleep(150) } await key('v')
check('two razor cuts', (await st('s.clips.filter(c=>c.trackId==="V1").length')) === 3, `tool ${tool}, zoom ${zoom}, lane x ${L}, V1 ${JSON.stringify(V)}, active ${await ev('document.activeElement?.tagName+" "+document.activeElement?.className')}`)
for (const t of [27, 2]) { await click(L + t * zoom, V.y + V.h / 2); await sleep(100); await key('Delete', ['shift']); await sleep(200) }
const v = await st('s.clips.filter(c=>c.trackId==="V1")')
check('one 15 s clip left at 0', v.length === 1 && Math.abs(v[0].dur - 15) < 0.1 && v[0].start < 0.01, JSON.stringify(v.map((c) => [c.start, c.dur])))
await shot(path.join(shots, '2-cut.png'))

// Export through the dialog and the native Save dialog
fs.rmSync(out, { force: true }); fs.mkdirSync(path.dirname(out), { recursive: true })
const e1 = await btn('.toolbar button', 'Export…'); await click(e1.x, e1.y); await sleep(500)
const e2 = await btn('.dlg button', 'Export…'); const d2 = dlg('Export MP4', out); await sleep(300); await click(e2.x, e2.y)
check('Save dialog filled', (await d2) === 'OK')
const ok = await until(`document.querySelector('.msg')?.textContent.startsWith('Saved ' + ${JSON.stringify(out)})`, 240)
check('export finished', ok, await ev(`document.querySelector('.msg')?.textContent||''`))
await shot(path.join(shots, '3-exported.png'))
const ffprobe = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe')
const pr = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', out], { encoding: 'utf8' })
const info = JSON.parse(pr.stdout || '{}')
check('MP4 is H.264 + AAC, 15 s', info.streams?.some((s) => s.codec_name === 'h264') && info.streams?.some((s) => s.codec_name === 'aac') && Math.abs(+info.format.duration - 15) < 0.2, pr.stdout.replace(/\s+/g, ' '))
await key('Escape'); await ev(`[...document.querySelectorAll('.dlg button')].find(b=>/Close/.test(b.textContent))?.click()`); await sleep(300)

// Cache next to the exe holds thumbnails etc.; Clear cache empties it
const files = fs.readdirSync(cacheDir).filter((f) => fs.statSync(path.join(cacheDir, f)).isFile())
check('cache has files after import', files.length > 0, files.slice(0, 5).join(', '))
const cb = await ev(`(()=>{const b=[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent.startsWith('Clear cache'));const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
await click(cb.x, cb.y); await sleep(1000)
const left = fs.readdirSync(cacheDir)
check('Clear cache empties it', left.length === 0, left.join(', '))
done()
