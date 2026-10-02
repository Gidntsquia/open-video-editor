// Old .ovep (numeric `transition: 1`, no type) opens as a 1 s Cross Dissolve; `ove transition` on it then opens in the
// app with the same block; `ove frame --at` matches the app preview. Run: node.exe test/run.mjs trans4 (from D:\ove-test)
import { st, ev, rect, click, sleep, check, shot } from '../drive.mjs'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
const C = 'D:\\ove-test\\cache\\trans4\\'; fs.mkdirSync(C, { recursive: true })
const PROJ = C + 'old.ovep'
const FF = 'D:\\ove-test\\node_modules\\ffmpeg-static\\ffmpeg.exe'
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e
const btn = async (t) => JSON.parse(await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});const r=b.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`))
const dlg = (title, path) => new Promise((res) => { const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'D:\\ove-test\\test\\dialog.ps1', '-Title', title, '-Path', path]); let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('close', () => res(o.trim())) })
const open = async () => { await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,popup:null,projectPath:null,dirty:false})`); const ob = await btn('Open'); const d = dlg('Open project', PROJ); await sleep(300); await click(ob.x + ob.w / 2, ob.y + ob.h / 2); const o = await d; await sleep(2500); return o }
const ove = (...args) => { const r = spawnSync('node.exe', ['cli/ove.js', ...args, '-p', PROJ], { cwd: 'D:\\ove-test', encoding: 'utf8' }); try { return JSON.parse(r.stdout.trim().split('\n').pop()) } catch { return { err: r.stdout + r.stderr } } }
const savePng = async (f) => { const u = await ev(`document.querySelector('.canvaswrap canvas').toDataURL('image/png')`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')) }
const diffPct = (a, b) => { const r = spawnSync(FF, ['-v', 'error', '-i', a, '-i', b, '-filter_complex', '[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]blend=all_mode=difference,signalstats,metadata=print:file=-', '-f', 'null', '-'], { encoding: 'utf8' }); const m = /YAVG=([\d.]+)/.exec(r.stdout + r.stderr); return m ? (+m[1] / 255) * 100 : -1 }

// --- write an old-format project from the app's media entry (same fields an old app saved: numeric transition only)
const S0 = await st('({media:s.media,tracks:s.tracks,w:s.width,h:s.height,fps:s.fps})')
const [mid, M] = Object.entries(S0.media).find(([, m]) => m.name.startsWith('2023-08-16 23-55-20'))
const base = { crop: { l: 0, r: 0, t: 0, b: 0 }, scale: 1, posX: 0, posY: 0, brightness: 1, contrast: 1, saturation: 1, speed: 1, volume: 1, keys: [], fadeIn: 0, fadeOut: 0, transition: 0, transOut: 0, mediaId: mid }
const old = { version: 1, width: S0.w, height: S0.h, fps: S0.fps, media: { [mid]: M }, tracks: S0.tracks, clips: [
  { ...base, id: 'c1', kind: 'video', trackId: 'V1', start: 0, in: 10, dur: 4 },
  { ...base, id: 'c2', kind: 'video', trackId: 'V1', start: 3, in: 20, dur: 4, transition: 1 },
  { ...base, id: 'c3', kind: 'video', trackId: 'V1', start: 7, in: 30, dur: 4 },
] }
fs.writeFileSync(PROJ, JSON.stringify(old, null, 1))
let o = await open()
let c2 = (await st('s.clips')).find((c) => c.id === 'c2')
check('old .ovep opens: c2 has a 1 s Cross Dissolve', o === 'OK' && c2.transType === 'crossdissolve' && near(c2.transition, 1), JSON.stringify([o, c2.transType, c2.transition, c2.transAlign]))
check('block drawn for c2, 1 s wide at 100 px/s', !!(await rect('[data-tblock="c2"]')) && near((await rect('[data-tblock="c2"]')).w, (await st('s.zoom')), 2), JSON.stringify(await rect('[data-tblock="c2"]')))
await shot(C + 'old-open.png')

// --- ove transition on the same file, then reopen
const r1 = ove('transition', 'c3:in', 'type=wipeleft', 'dur=0.8')
check('ove transition c3:in wipeleft 0.8', r1.ok === 1 || r1.ok === true, JSON.stringify(r1))
const show = ove('show', '--json')
const f3 = (show.clips || []).find((c) => c.id === 'c3')
check('ove show: c3 Wipe Left 0.8 s centred', f3 && f3.transType === 'wipeleft' && near(f3.transition, 0.8) && near(f3.transAlign, 0.5), JSON.stringify(f3 && [f3.transType, f3.transition, f3.transAlign, f3.start]))
o = await open()
const S = await st('s.clips'); const a3 = S.find((c) => c.id === 'c3')
check('reopened in the app: c3 block Wipe Left 0.8 s, same clips as ove show', o === 'OK' && a3.transType === 'wipeleft' && near(a3.transition, 0.8) && JSON.stringify(S) === JSON.stringify(show.clips), JSON.stringify([a3.transType, a3.transition]))
check('block drawn for c3, 0.8 s wide', near((await rect('[data-tblock="c3"]')).w, 0.8 * (await st('s.zoom')), 2))
await shot(C + 'ove-open.png')

// --- ove frame --at vs the preview canvas (midpoints of both transitions, and a plain frame)
const mids = [3.5, a3.start + 0.4, 5.5]
const fr = ove('frame', '--at', mids.join(','))
check('ove frame renders 3 PNGs', fr.ok === 1 && fr.f && fr.f.length === 3, JSON.stringify(fr).slice(0, 200))
for (const [i, t] of mids.entries()) {
  await ev(`__ove.engine.seek(${t})`); await sleep(1200)
  const png = C + `prev-${i}.png`; await savePng(png)
  const d = diffPct(fr.f[i][1], png)
  check(`ove frame --at ${t.toFixed(2)} vs preview diff < 3 %`, d >= 0 && d < 3, d.toFixed(2) + ' %  ' + fr.f[i][1])
}
