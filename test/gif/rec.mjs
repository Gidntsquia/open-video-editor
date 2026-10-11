// Gif recorder for the running app: CDP screencast frames (with timestamps) + an injected cursor, click ring and
// caption, so the gif shows where the (CDP-driven) pointer is. Real UI input only, through drive.mjs.
// Frames go to <dir>/f-<n>.jpg plus <dir>/frames.txt (ffconcat with real durations); test/gif/encode.sh makes the gif.
import fs from 'node:fs'
import path from 'node:path'
import { send, ev, sleep, move, mouse } from '../drive.mjs'

const OVERLAY = `(() => { if (window.__rec) return; const d = document.createElement('div'); d.id = '__rec'
  d.innerHTML = '<svg id="__cur" width="26" height="26" viewBox="0 0 26 26" style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px #000)"><path d="M3 2 L3 21 L8 16 L11.5 24 L14.5 22.7 L11 15 L18 15 Z" fill="#fff" stroke="#000" stroke-width="1.4"/></svg>' +
    '<div id="__ring" style="position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border:3px solid #4d8dff;border-radius:50%;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .35s, transform .35s"></div>' +
    '<div id="__cap" style="position:fixed;left:50%;bottom:var(--capb,7%);transform:translateX(-50%);z-index:2147483647;pointer-events:none;background:rgba(20,20,26,.92);color:#fff;font:600 22px Segoe UI, sans-serif;padding:10px 22px;border-radius:10px;border:2px solid #4d8dff;opacity:0;transition:opacity .25s;white-space:nowrap"></div>'
  document.documentElement.appendChild(d); const c = d.querySelector('#__cur'), r = d.querySelector('#__ring')
  const at = (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)' }
  addEventListener('pointermove', at, true); addEventListener('mousemove', at, true); addEventListener('dragover', at, true)
  addEventListener('pointerdown', (e) => { at(e); r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; r.style.transition = 'none'; r.style.opacity = 1; r.style.transform = 'scale(.6)'; requestAnimationFrame(() => { r.style.transition = 'opacity .45s, transform .45s'; r.style.opacity = 0; r.style.transform = 'scale(1.3)' }) }, true)
  window.__rec = { cap: (t) => { const k = d.querySelector('#__cap'); k.textContent = t || ''; k.style.opacity = t ? 1 : 0 } } })()`

export let PACE = +(process.env.PACE || 1)
export const wait = (ms) => sleep(ms * PACE)
let pos = { x: 40, y: 40 }, frames = [], dir = null, n = 0, onFrame = null
export async function start(outDir) {
  dir = outDir; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); frames = []; n = 0
  await ev(OVERLAY); await move(pos.x, pos.y)
  onFrame = (m) => { const f = path.join(dir, `f-${String(n++).padStart(5, '0')}.jpg`); fs.writeFileSync(f, Buffer.from(m.data, 'base64')); frames.push([path.basename(f), m.metadata.timestamp]); send('Page.screencastFrameAck', { sessionId: m.sessionId }) }
  globalThis.__cdpEvents = globalThis.__cdpEvents || new Map(); globalThis.__cdpEvents.set('Page.screencastFrame', onFrame)
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })
  // Chromium only sends frames on change; a ticking element keeps a steady stream (it's 1 px, transparent).
  await ev(`(()=>{const t=document.createElement('div');t.id='__tick';t.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:2147483647;pointer-events:none';document.documentElement.appendChild(t);let i=0;window.__tickT=setInterval(()=>{t.style.background='rgba(0,0,0,'+((i++%2)?0.01:0.02)+')'},40)})()`)
  await sleep(400)
}
export async function stop(tail = 1.5) {
  await sleep(tail * 1000); await send('Page.stopScreencast'); await ev(`clearInterval(window.__tickT);document.getElementById('__tick')?.remove()`); await sleep(300)
  const lines = ['ffconcat version 1.0']
  for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? frames[i + 1][1] - frames[i][1] : 0.1; lines.push(`file ${frames[i][0]}`, `duration ${Math.max(0.001, d).toFixed(4)}`) }
  lines.push(`file ${frames.at(-1)[0]}`)
  fs.writeFileSync(path.join(dir, 'frames.txt'), lines.join('\n') + '\n'); fs.writeFileSync(path.join(dir, 't0.txt'), String(frames[0][1]))
  return { frames: frames.length, secs: frames.at(-1)[1] - frames[0][1] }
}
export const caption = (t) => ev(`window.__rec.cap(${JSON.stringify(t)})`)
/** Move the pointer to (x, y) over `ms` like a hand would (ease in/out). */
export async function glide(x, y, ms = 700, extra = null) {
  ms *= PACE
  const steps = Math.max(2, Math.round(ms / 25)), x0 = pos.x, y0 = pos.y
  for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
    const px = x0 + (x - x0) * e, py = y0 + (y - y0) * e
    if (extra) await mouse('mouseMoved', px, py, extra); else await move(px, py); await sleep(ms / steps) }
  pos = { x, y }
}
export async function tap(x, y, ms = 600) { await glide(x, y, ms); await wait(120); await mouse('mousePressed', x, y); await sleep(70); await mouse('mouseReleased', x, y); await sleep(150) }
export async function hold(x0, y0, x1, y1, ms = 1200, extra = {}) {
  await glide(x0, y0, 500); await mouse('mousePressed', x0, y0, extra); await wait(200)
  await glide(x1, y1, ms, extra); await sleep(120); await mouse('mouseReleased', x1, y1, extra); await sleep(150)
}
