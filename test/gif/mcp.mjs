// ove-mcp gif: real MCP tool calls (cli/mcp.js over stdio) typed into the offscreen terminal page (PORT, from
// term.cjs) while castbg.mjs records the app (APP_PORT); app_open reloads the app after each step.
// Usage (Windows node, from the app folder): PORT=9335 APP_PORT=9334 node test/gif/mcp.mjs <src.mp4> <work dir>
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { ev, sleep, done, check } from '../drive.mjs'
import { start, stop } from './rec.mjs'

const [src, work] = process.argv.slice(2)
const APP = process.env.APP_PORT || '9334'
const appEv = (js) => spawnSync(process.execPath, ['test/cdp.mjs', 'eval', js], { env: { ...process.env, PORT: APP }, encoding: 'utf8' }).stdout.trim()
fs.mkdirSync(work, { recursive: true })
const proj = path.join(work, 'demo.ovep'); fs.rmSync(proj, { force: true })

// App: empty, saved, ready.
appEv(`(()=>{__ove.store.setState({clips:[],media:{},past:[],future:[],selection:[],selEdge:null,playhead:0,dirty:false,status:'Ready'});return 1})()`)

// MCP client over stdio
const srv = spawn(process.execPath, ['cli/mcp.js'], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = '', id = 0; const pend = new Map()
srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); pend.get(m.id)?.(m); pend.delete(m.id) } catch {} } })
const rpc = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n') })
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gif', version: '1' } })
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const T = (js) => ev(`window.term.${js}`)
async function call(name, args, show = args) {
  const a = Object.entries(show).map(([k, v]) => `<span class="k">${k}</span>=${esc(JSON.stringify(v))}`).join(' ')
  await T(`type(${JSON.stringify(`<span class="n">${name}</span> ${a}`)}, 28)`); await sleep(250); await T('enter()')
  const r = await rpc('tools/call', { name, arguments: args })
  const txt = r.result?.content?.[0]?.text || JSON.stringify(r.error || r)
  let j = {}; try { j = JSON.parse(txt) } catch {}
  const short = txt.length > 150 ? txt.slice(0, 147) + '…' : txt
  await T(`out(${JSON.stringify(`<span class="${r.result?.isError ? 'r' : 'ok'}">${esc(short)}</span>`)})`); await sleep(700)
  check(name, !r.result?.isError, short)
  return j
}
const appState = () => JSON.parse(appEv(`(()=>{const s=__ove.store.getState();return JSON.stringify([s.clips.length,s.clips.filter(c=>c.kind==='title').length,s.clips.filter(c=>c.transition>0).length])})()`))

// Start both recordings.
const stopFile = path.join(work, 'stop')
const cast = spawn(process.execPath, ['test/gif/castbg.mjs', path.join(work, 'app'), stopFile], { env: { ...process.env, PORT: APP }, stdio: ['ignore', 'pipe', 'inherit'] })
let castOut = ''; cast.stdout.on('data', (d) => (castOut += d))
while (!fs.existsSync(stopFile + '.started')) await sleep(100)
await ev(`document.getElementById('log').innerHTML='';document.getElementById('in').textContent=''`)
await start(path.join(work, 'term')); await ev(`document.getElementById('__cur').style.display='none'`); await sleep(800)

await call('new', { path: proj })
const imp = await call('import', { paths: [src] })
const m = imp.id || imp.media?.[0]?.id || 'm1'
const add = await call('add', { m, in: '170', dur: '40' })
await call('app_open', { path: proj }); await sleep(1500)
const s1 = appState()
await call('cut', { t: '12' }); await call('cut', { t: '24' })
const sh = JSON.parse(fs.readFileSync(proj, 'utf8'))
const mid = sh.clips?.find((c) => c.kind === 'video' && Math.abs(c.start - 12) < 0.01)
await call('rm', { ids: [mid.id], ripple: true })
const v2 = JSON.parse(fs.readFileSync(proj, 'utf8')).clips.find((c) => c.kind === 'video' && Math.abs(c.start - 12) < 0.01)
await call('dissolve', { id: v2.id, dur: '1' })
await call('title', { at: '0.5', text: 'GAME!', size: 160 })
await call('save', {}); await sleep(2500)
const s2 = appState()
check('app shows the clip after the first app_open', JSON.parse(s1)[0] === 2, s1)
check('app shows cuts, dissolve and title after the second', JSON.parse(s2)[1] === 1 && JSON.parse(s2)[2] >= 1, s2)

fs.writeFileSync(stopFile, ''); const r1 = await stop(0)
while (cast.exitCode == null) await sleep(100)
console.log('term', JSON.stringify(r1), 'app', castOut.trim())
srv.kill(); done()
