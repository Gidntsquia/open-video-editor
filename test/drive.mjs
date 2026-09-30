// Mouse/keyboard driver for the running app (CDP Input.* = real pointer/key events, not store calls).
// Usage (Windows node): node test/drive.mjs <scenario>
const port = process.env.PORT || 9222
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
export const ev = async (js) => { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const st = (expr) => ev(`(()=>{const s=__ove.store.getState();return JSON.stringify(${expr})})()`).then(JSON.parse)
export const rect = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
export const move = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
export const click = async (x, y, o = {}) => { await move(x, y); await mouse('mousePressed', x, y, o); await mouse('mouseReleased', x, y, o) }
export const rclick = async (x, y) => { await move(x, y); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 }) }
export const drag = async (x0, y0, x1, y1, steps = 12) => {
  await move(x0, y0); await mouse('mousePressed', x0, y0)
  for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await sleep(15) }
  await mouse('mouseReleased', x1, y1)
}
export const wheel = (x, y, dy, modifiers = 2) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, modifiers })
const VK = { Delete: 46, Backspace: 8, ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35, ' ': 32, '=': 187, '-': 189 }
export const key = async (k, mods = []) => {
  const m = (mods.includes('ctrl') ? 2 : 0) | (mods.includes('shift') ? 8 : 0)
  const code = k.length === 1 && /[a-z]/i.test(k) ? 'Key' + k.toUpperCase() : k === ' ' ? 'Space' : k
  const vk = VK[k] ?? k.toUpperCase().charCodeAt(0)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, modifiers: m, windowsVirtualKeyCode: vk })
  if (k.length === 1 && !mods.includes('ctrl')) await send('Input.dispatchKeyEvent', { type: 'char', key: k, text: k, modifiers: m })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: m, windowsVirtualKeyCode: vk })
  await sleep(60)
}
export const shot = async (f) => { const r = await send('Page.captureScreenshot', { format: 'png' }); (await import('node:fs')).writeFileSync(f, Buffer.from(r.result.data, 'base64')) }
export const done = () => { ws.close(); process.exit(0) }
export const check = (name, ok, info = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`)
