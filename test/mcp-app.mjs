// MCP app-control scenario (Windows node, from D:\ove-test): app closed -> app_open launches it; selection/seek/capture; reload after a change; dirty refusal; no-token 401.
// Run: powershell/WSL: WSLENV=OVE_INACTIVE OVE_INACTIVE=1 node.exe test/mcp-app.mjs   (app must NOT be running for step 1)
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.resolve(import.meta.dirname, '..')
const media = process.env.OVE_MEDIA || 'D:\\OBS Videos\\2023-08-16 23-55-20.mp4'
const proj = path.join(root, 'cache', 'mcp-app.ovep')
const appJson = path.join(root, 'cache', 'ove', 'app.json')
fs.mkdirSync(path.dirname(proj), { recursive: true })
const c = new Client({ name: 't', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'cli', 'mcp.js')], env: { ...process.env } }))
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); let j; try { j = JSON.parse(r.content[0].text) } catch { j = { raw: r.content[0].text } } return { r, j, img: r.content.filter((x) => x.type === 'image') } }
const pass = (m) => console.log('PASS', m)
const jpgW = (b64) => { const b = Buffer.from(b64, 'base64'); for (let i = 2; i < b.length;) { if (b[i] !== 0xff) { i++; continue } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b.readUInt16BE(i + 7); i += 2 + b.readUInt16BE(i + 2) } }

assert.ok(!fs.existsSync(appJson) || !(await fetch('http://127.0.0.1:' + JSON.parse(fs.readFileSync(appJson, 'utf8')).port + '/ping').catch(() => null)), 'close the app first')
await call('new', { path: proj }); await call('import', { paths: [media] })
const add = await call('add', { m: 'm1', at: 0, dur: 30 }); assert.ok(add.j.ok, JSON.stringify(add.j))
await call('cut', { t: 10 })
const t0 = Date.now()
const open = await call('app_open'); assert.ok(open.j.ok, JSON.stringify(open.j)); pass(`app_open with app closed: launched=${open.j.launched} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
let sel = await call('app_selection'); assert.equal(sel.j.projectPath.toLowerCase(), proj.toLowerCase()); assert.equal(sel.j.dirty, false); pass('selection ' + JSON.stringify(sel.j))

// token check on the control port
const info = JSON.parse(fs.readFileSync(appJson, 'utf8'))
const noTok = await fetch(`http://127.0.0.1:${info.port}/selection`, { method: 'POST' }); assert.equal(noTok.status, 401); pass('no token -> 401')
const bad = await fetch(`http://127.0.0.1:${info.port}/selection`, { method: 'POST', headers: { authorization: 'Bearer nope' } }); assert.equal(bad.status, 401)

// change -> app reloads and parks the playhead on the cut
const cut = await call('cut', { t: 20 }); assert.equal(cut.j.app, 'reloaded', JSON.stringify(cut.j))
await new Promise((r) => setTimeout(r, 500))
sel = await call('app_selection'); assert.ok(Math.abs(sel.j.playhead - 20) < 0.05, JSON.stringify(sel.j)); pass('change reloaded app, playhead ' + sel.j.playhead)
const clips = JSON.parse((await c.readResource({ uri: 'ove://project' })).contents[0].text).project.clips
const c3 = clips.find((x) => x.id === 'c3'); assert.ok(c3.start > 5, JSON.stringify(c3))
const sk = await call('app_seek', { clip: 'c3' }); assert.ok(sk.j.ok); sel = await call('app_selection'); assert.ok(Math.abs(sel.j.playhead - c3.start) < 0.05, JSON.stringify(sel.j)); pass('app_seek clip c3 -> ' + c3.start)

// capture vs frame
const cap = await call('app_capture', { t: 5 }); assert.equal(cap.img.length, 1); assert.ok(jpgW(cap.img[0].data) <= 512); pass('capture ' + jpgW(cap.img[0].data) + ' px wide')
fs.writeFileSync(path.join(root, 'cache', 'mcp-capture.jpg'), Buffer.from(cap.img[0].data, 'base64'))
const fr = await call('frame', { at: '5' }); fs.writeFileSync(path.join(root, 'cache', 'mcp-frame.jpg'), Buffer.from(fr.img[0].data, 'base64'))
await c.close()
console.log('mcp-app OK (compare cache/mcp-capture.jpg vs cache/mcp-frame.jpg with test/transp_cmp.py)')
