// Tiny DevTools-protocol driver for testing the running app: node test/cdp.mjs eval "<js>" | shot <file.png>
import fs from 'node:fs'
let [cmd, arg, outFile] = process.argv.slice(2)
if (arg && arg.startsWith('file:')) arg = fs.readFileSync(arg.slice(5), 'utf8')
const port = process.env.PORT || 9222
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
if (cmd === 'reload') {
  await send('Runtime.enable'); const errs = []
  const old = ws.onmessage; ws.onmessage = (m) => { old(m); const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ')) }
  await send('Page.reload'); await new Promise((r) => setTimeout(r, 2500)); console.log('errors:', JSON.stringify(errs, null, 1).slice(0, 3000))
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
  if (outFile) { fs.writeFileSync(outFile, String(r.result.result.value)); console.log('wrote', outFile) } else console.log(JSON.stringify(r.result.exceptionDetails ? r.result.exceptionDetails.exception?.description : r.result.result.value, null, 1))
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64')); console.log('saved', arg)
} else if (cmd === 'key') {
  const [k, mods] = arg.split('+').reverse().length ? [arg.split('+').pop(), arg.split('+').slice(0, -1)] : [arg, []]
  const modv = (mods.includes('ctrl') ? 2 : 0) | (mods.includes('shift') ? 8 : 0)
  const code = k.length === 1 ? 'Key' + k.toUpperCase() : k
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, modifiers: modv, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : ({ Delete: 46, ArrowLeft: 37, ArrowRight: 39, ' ': 32 })[k] || 0 })
  console.log('key', arg)
}
ws.close(); process.exit(0)
