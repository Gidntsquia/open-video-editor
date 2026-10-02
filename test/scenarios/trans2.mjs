// Transitions + trim tools by mouse/keyboard: Effects drag, 0.50 s warning, block drag + Ctrl+Z, default + Ctrl+D,
// Ctrl-drag ripple, N / Y / U, Q / W, , / ., Ctrl+Shift+K. Run: node.exe test/run.mjs trans2 (from D:\ove-test).
import { st, ev, rect, click, rclick, drag, ctrlDrag, key, sleep, check, shot } from '../drive.mjs'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
const D = 'D:\\ove-test\\cache\\trans2\\'; fs.mkdirSync(D, { recursive: true })
const FF = 'D:\\ove-test\\node_modules\\ffmpeg-static\\ffmpeg.exe'
const Z = 100 // px per second
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e
const clip = async (id) => (await st('s.clips')).find((c) => c.id === id)
const txt = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
const cls = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.className ?? null`)
const canvasMean = () => ev(`(()=>{const cv=document.querySelector('.canvaswrap canvas');const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let q=0,n=0;for(let i=0;i<d.length;i+=4){q+=d[i]+d[i+1]+d[i+2];n+=3}return q/n})()`)
const savePng = async (f) => { const u = await ev(`document.querySelector('.canvaswrap canvas').toDataURL('image/png')`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')) }
const ff = (args) => spawnSync(FF, ['-v', 'error', ...args], { encoding: 'utf8' })
const frameMean = (mp4, t) => { const r = spawnSync(FF, ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' }); return r.stdout[0] }
const diffPct = (mp4, t, png) => { const r = ff(['-ss', String(t), '-i', mp4, '-i', png, '-frames:v', '1', '-filter_complex', '[0:v]scale=320:180[a];[1:v]scale=320:180[b];[a][b]blend=all_mode=difference,signalstats,metadata=print:file=-', '-f', 'null', '-']); const m = /YAVG=([\d.]+)/.exec(r.stdout + r.stderr); return m ? (+m[1] / 255) * 100 : -1 }

await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,popup:null,zoom:${Z},playhead:0,tool:'select'})`)
await ev(`__ove.store.getState().setPrefs({videoType:'crossdissolve',audioType:'constpower',videoDur:1,audioDur:1,alsoAudio:true})`)
{ const t = await rect('[data-tab="bin"]'); await click(t.x + t.w / 2, t.y + t.h / 2); await sleep(100) }
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
const v1 = await rect('[data-track="V1"]'), v2 = await rect('[data-track="V2"]'), a1 = await rect('[data-track="A1"]'), lane = await rect('.lane')
const b0 = await rect(`[data-media="${A.id}"]`)
await drag(b0.x + 40, b0.y + 20, lane.x + 3, v1.y + v1.h / 2); await sleep(300)
const base = await st('s.clips')
const bv = base.find((c) => c.kind === 'video'), ba = base.find((c) => c.kind === 'audio')
check('drag from bin adds linked video + audio', !!bv && !!ba && bv.link && bv.link === ba.link, JSON.stringify(base.map((c) => [c.kind, c.link])))
const X = (t) => lane.x + t * Z, VY = v1.y + v1.h / 2
/** Three linked pairs on V1/A1 (4 s each, in 10/20/30), one clip on V2 at 10 s. */
const mk = (o = {}) => {
  const out = []
  for (let i = 0; i < 3; i++) {
    const link = 'L' + i
    out.push({ ...bv, id: 'c' + i, link, start: 4 * i, dur: 4, in: 10 + 10 * i, ...(o['c' + i] || {}) })
    out.push({ ...ba, id: 'a' + i, link, start: 4 * i, dur: 4, in: 10 + 10 * i, ...(o['c' + i] || {}) })
  }
  out.push({ ...bv, id: 'd', link: undefined, trackId: 'V2', start: 10, dur: 3, in: 50 })
  return out
}
const reset = async (o) => { await ev(`__ove.store.setState({clips:${JSON.stringify(mk(o))},past:[],future:[],selection:[],selEdge:null,popup:null,playhead:0,tool:'select'})`); await sleep(150) }

// ---------- 1. Effects tab: drag Dip to Black onto the c0/c1 join; midpoint is black in preview and export ----------
await reset()
{ const t = await rect('[data-tab="effects"]'); await click(t.x + t.w / 2, t.y + t.h / 2) }
check('Effects tab opens', !!(await rect('[data-effects]')))
const fx = await rect('[data-fx="dipblack"]')
await drag(fx.x + 30, fx.y + fx.h / 2, X(4), VY, 20)
let c1 = await clip('c1')
check('drop on join applies Dip to Black 1 s centred', c1.transType === 'dipblack' && near(c1.transition, 1) && near(c1.transAlign, 0.5) && near(c1.start, 3.5), JSON.stringify([c1.transType, c1.transition, c1.transAlign, c1.start]))
check('block drawn on the timeline', !!(await rect('[data-tblock="c1"]')))
await ev(`__ove.engine.seek(4)`); await sleep(1200)
const pm = await canvasMean(); await savePng(D + 'dip.png')
const OUT1 = D + 'dip.mp4'
await ev(`(async()=>{const s=__ove.store.getState();const m={};for(const c of s.clips){if(c.mediaId){const x=s.media[c.mediaId];m[c.mediaId]={path:x.path,w:x.w,h:x.h,dur:x.dur,hasAudio:x.hasAudio}}}return JSON.stringify(await window.api.exportProject({width:s.width,height:s.height,fps:s.fps,media:m,tracks:s.tracks,clips:s.clips},${JSON.stringify(OUT1)}))})()`)
const em = frameMean(OUT1, 4)
check('midpoint black in preview and export', pm < 2 && em < 2, `preview mean ${pm.toFixed(1)} export mean ${em}`)
const dd = diffPct(OUT1, 4, D + 'dip.png'); check('preview vs export at midpoint < 2 %', dd >= 0 && dd < 2, dd.toFixed(2) + ' %')

// ---------- 2. Insufficient media: incoming clip starts at source 0 -> 0.50 s, striped, inspector text ----------
await reset({ c1: { in: 0 } })
await click(X(4) + 2, VY); await sleep(200)
check('click on the join opens the popup', !!(await rect('[data-tpopup]')))
{ const t = await rect('[data-ttype="crossdissolve"]'); await click(t.x + 10, t.y + t.h / 2); const ap = await rect('[data-tapply]'); await click(ap.x + 5, ap.y + 5); await sleep(200) }
c1 = await clip('c1')
check('shortened to 0.50 s, end at cut', near(c1.transition, 0.5) && near(c1.transReq, 1) && near(c1.transAlign, 0) && near(c1.start, 4), JSON.stringify([c1.transition, c1.transReq, c1.transAlign, c1.start]))
check('block striped (class short), width 0.5 s', String(await cls('[data-tblock="c1"]')).includes('short') && near((await rect('[data-tblock="c1"]')).w, 0.5 * Z, 2))
check('popup warns', (await txt('[data-tpopup] .twarn')) === 'Insufficient media: shortened to 0.50 s', String(await txt('[data-tpopup] .twarn')))
check('inspector warns', (await txt('[data-short]')) === 'Insufficient media: shortened to 0.50 s', String(await txt('[data-short]')))
await shot(D + 'short.png')

// ---------- 3. Block right edge drag = whole frames; block drag = alignment; Ctrl+Z one step each ----------
await reset(); await key('Escape')
await ev(`__ove.store.getState().setTransition({a:'c0',b:'c1'},{type:'wipeleft',dur:1})`); await sleep(150)
let bk = await rect('[data-tblock="c1"]')
await drag(bk.x + bk.w - 2, bk.y + bk.h / 2, bk.x + bk.w - 2 + 37, bk.y + bk.h / 2); await sleep(150)
c1 = await clip('c1')
const fr = c1.transition * 30
check('right edge +37 px -> duration 1.37 s snapped to whole frames (41)', near(fr, Math.round(fr), 1e-6) && Math.round(fr) === 41, `${c1.transition} s = ${fr} frames`)
bk = await rect('[data-tblock="c1"]')
await drag(bk.x + bk.w / 2, bk.y + bk.h / 2, bk.x + bk.w / 2 - 30, bk.y + bk.h / 2); await sleep(150)
const c1b = await clip('c1')
check('block drag changes alignment, keeps duration', c1b.transAlign > 0.6 && near(c1b.transition, c1.transition), `align 0.5 -> ${c1b.transAlign.toFixed(3)} dur ${c1b.transition}`)
await key('z', ['ctrl']); const u1 = await clip('c1')
check('Ctrl+Z reverts the alignment drag in one step', near(u1.transAlign, c1.transAlign) && near(u1.transition, c1.transition), JSON.stringify([u1.transAlign, u1.transition]))
await key('z', ['ctrl']); const u2 = await clip('c1')
check('Ctrl+Z again reverts the edge drag', near(u2.transition, 1), String(u2.transition))

// ---------- 4. Right-click Film Dissolve -> default; Ctrl+D / Ctrl+Shift+D on a selected edit point ----------
await reset()
await ev(`__ove.store.getState().setPrefs({alsoAudio:false})`)
{ const f = await rect('[data-fx="filmdissolve"]'); await rclick(f.x + 30, f.y + f.h / 2); await sleep(150)
  const it = await ev(`(()=>{const e=[...document.querySelectorAll('.ctx div')].find(d=>d.textContent==='Set as default transition');if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()`)
  check('context menu has "Set as default transition"', !!it); if (it) { const r = JSON.parse(it); await click(r.x + 10, r.y + r.h / 2) } }
check('default video type is Film Dissolve (tick shown)', (await st('s.prefs.videoType')) === 'filmdissolve' && !!(await rect('[data-fx="filmdissolve"] .fxdef')))
check('default persisted to localStorage', JSON.parse(await ev(`localStorage.getItem('ove.prefs')`)).videoType === 'filmdissolve')
await click(X(8) + 2, VY); await sleep(150)
check('edit point c1/c2 selected', JSON.stringify(await st('s.selEdge')) === JSON.stringify({ a: 'c1', b: 'c2' }))
check('prefs: alsoAudio off', (await st('s.prefs.alsoAudio')) === false, JSON.stringify(await st('s.prefs')))
await key('d', ['ctrl']); await sleep(150)
let c2 = await clip('c2'), a2 = await clip('a2')
// linked audio keeps the overlap (stays in sync) but with type 'none' = hard cut
check('Ctrl+D applies Film Dissolve 1 s to the selected edit point (audio: none)', c2.transType === 'filmdissolve' && near(c2.transition, 1) && a2.transType === 'none', JSON.stringify([c2.transType, c2.transition, a2.transType]))
await key('d', ['ctrl', 'shift']); await sleep(150)
a2 = await clip('a2')
check('Ctrl+Shift+D applies Constant Power to the linked audio', a2.transType === 'constpower' && near(a2.transition, 1), JSON.stringify([a2.transType, a2.transition]))
await shot(D + 'default.png')

// ---------- 5. Ctrl-drag out edge 1 s shorter ripples all tracks; plain drag leaves a gap ----------
await reset(); await key('Escape')
await ctrlDrag(X(4) - 2, VY, X(3) - 2, VY); await sleep(150)
let S = await st('s.clips'); const g = (id) => S.find((c) => c.id === id)
check('Ctrl-drag: c0 1 s shorter, c1/c2/a1/a2 and V2 clip all move 1 s earlier, no gap', near(g('c0').dur, 3) && near(g('a0').dur, 3) && near(g('c1').start, 3) && near(g('a1').start, 3) && near(g('c2').start, 7) && near(g('d').start, 9), JSON.stringify(S.map((c) => [c.id, c.start, c.dur])))
await key('z', ['ctrl'])
await drag(X(4) - 2, VY, X(3) - 2, VY); await sleep(150)
S = await st('s.clips')
check('plain drag: c0 1 s shorter, 1 s gap, nothing moves', near(g('c0').dur, 3) && near(g('c1').start, 4) && near(g('d').start, 10), JSON.stringify(S.map((c) => [c.id, c.start, c.dur])))

// ---------- 6. N rolling edit: join 0.5 s right ----------
await reset(); await key('n'); check('N selects the rolling edit tool', (await st('s.tool')) === 'roll')
await drag(X(4) + 2, VY, X(4.5) + 2, VY); await sleep(150)
S = await st('s.clips')
check('roll: c0 4.5 s, c1 starts 4.5 s at in 20.5, dur 3.5; end unchanged 12 s', near(g('c0').dur, 4.5) && near(g('c1').start, 4.5) && near(g('c1').in, 20.5) && near(g('c1').dur, 3.5) && near(g('c2').start + g('c2').dur, 12) && near(g('a1').in, 20.5), JSON.stringify(S.map((c) => [c.id, c.start, c.dur, c.in])))

// ---------- 7. Y slip 2 s (clamped at media end); U slide 1 s ----------
await reset({ c2: { in: A.dur - 5 } }); await key('y'); check('Y selects slip', (await st('s.tool')) === 'slip')
await drag(X(6), VY, X(8), VY); await sleep(150)
S = await st('s.clips')
check('slip c1 by 2 s: start/dur unchanged, in 20 -> 22 (audio too)', near(g('c1').start, 4) && near(g('c1').dur, 4) && near(g('c1').in, 22) && near(g('a1').in, 22), JSON.stringify([g('c1').start, g('c1').dur, g('c1').in]))
const four = await ev(`(()=>{let seen=false;const o=__ove.store.subscribe(s=>{if(s.fourUp)seen=true});window.__four=()=>{o();return seen};return true})()`)
await drag(X(10), VY, X(12), VY); await sleep(150)
S = await st('s.clips')
check('slip c2 clamps at the media end', near(g('c2').in, A.dur - 4, 1e-2), `${g('c2').in} vs ${A.dur - 4}`)
check('four-up shown during slip', four && (await ev('window.__four()')))
await reset()
await key('u'); check('U selects slide', (await st('s.tool')) === 'slide')
await drag(X(6), VY, X(7), VY); await sleep(150)
S = await st('s.clips')
check('slide c1 1 s right: c0 5 s, c1 at 5, c2 starts 9 / dur 3 / in 31; total 12 s', near(g('c0').dur, 5) && near(g('c1').start, 5) && near(g('c1').dur, 4) && near(g('c2').start, 9) && near(g('c2').dur, 3) && near(g('c2').in, 31) && near(g('a2').in, 31), JSON.stringify(S.map((c) => [c.id, c.start, c.dur, c.in])))
await key('v')

// ---------- 8. Q / W, , / . , Ctrl+Shift+K ----------
await reset(); await ev(`__ove.engine.seek(5)`); await sleep(200)
await key('q'); S = await st('s.clips')
check('Q: c1 trimmed to the playhead and ripple (c1 in 21 dur 3, c2 at 7, V2 clip at 9)', near(g('c1').in, 21) && near(g('c1').dur, 3) && near(g('c1').start, 4) && near(g('c2').start, 7) && near(g('d').start, 9), JSON.stringify(S.map((c) => [c.id, c.start, c.dur, c.in])))
await reset(); await ev(`__ove.engine.seek(5)`); await sleep(200)
await key('w'); S = await st('s.clips')
check('W: c1 ends at the playhead and ripple (dur 1, c2 at 5, V2 clip at 7)', near(g('c1').dur, 1) && near(g('c2').start, 5) && near(g('d').start, 7), JSON.stringify(S.map((c) => [c.id, c.start, c.dur])))
await reset(); await click(X(6), VY); await sleep(100)
check('click selects c1', (await st('s.selection')).includes('c1'))
await key('.'); let n1 = await clip('c1')
check('. nudges +1 frame (1/30 s)', near(n1.start, 4 + 1 / 30, 1e-6), String(n1.start))
await key(',', ['shift']); n1 = await clip('c1')
check('Shift+, nudges -5 frames', near(n1.start, 4 - 4 / 30, 1e-6), String(n1.start))
await key('.', ['shift']); n1 = await clip('c1')
check('Shift+. nudges +5 frames', near(n1.start, 4 + 1 / 30, 1e-6), String(n1.start))
await reset(); await ev(`__ove.engine.seek(11)`); await sleep(200)
const n0 = (await st('s.clips')).length
await key('k', ['ctrl', 'shift']); S = await st('s.clips')
check('Ctrl+Shift+K cuts every clip under the playhead on all tracks (c2, a2, V2 clip)', S.length === n0 + 3 && S.filter((c) => near(c.start, 11)).length === 3, `${n0} -> ${S.length}`)
await shot(D + 'end.png')
