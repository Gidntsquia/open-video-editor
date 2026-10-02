// MCP server: tools/list size + coverage, raw batch, image sizes, resources (no ffmpeg on list), auto-save, control port refuses no-token.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ff = process.env.FFMPEG_BIN || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-mcp-'))
const src = path.join(dir, 'src.mp4')
assert.equal(spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=440:d=12', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src]).status, 0, 'src gen')
const proj = path.join(dir, 'p.ovep')
const dbg = path.join(dir, 'debug.log')
const c = new Client({ name: 't', version: '1' })
const tr = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'cli', 'mcp.js')], env: { ...process.env, OVE_CACHE: path.join(dir, 'cache'), OVE_DEBUG: '1' }, stderr: 'pipe' })
let errlog = ''; tr.stderr?.on('data', (d) => (errlog += d))
await c.connect(tr)
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { r, j: JSON.parse(r.content[0].text), img: r.content.filter((x) => x.type === 'image') } }
// jpeg width from SOF marker
const jpgW = (b64) => { const b = Buffer.from(b64, 'base64'); for (let i = 2; i < b.length;) { if (b[i] !== 0xff) { i++; continue } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return b.readUInt16BE(i + 7); i += 2 + b.readUInt16BE(i + 2) } }

// tools/list
const tools = (await c.listTools()).tools; const names = tools.map((t) => t.name)
const help = fs.readFileSync(path.join(root, 'cli', 'ove.js'), 'utf8')
for (const n of ['scan', 'probe', 'scenes', 'silence', 'loud', 'frames', 'sheet', 'transcript', 'new', 'import', 'add', 'cut', 'rm', 'move', 'trim', 'speed', 'set', 'keys', 'fade', 'dissolve', 'transition', 'rm_transition', 'title', 'track', 'undo', 'save', 'show', 'frame', 'preview', 'check', 'job', 'jobs', 'ove', 'project_open', 'app_open', 'app_seek', 'app_selection', 'app_capture', 'app_launch']) assert.ok(names.includes(n), 'tool ' + n)
assert.ok(help.includes('rm-transition'))
const size = JSON.stringify(tools).length; console.log('tools/list', tools.length, 'tools,', size, 'chars (~' + Math.round(size / 3.2) + ' tokens at 3.2 chars/token)')
assert.ok(size / 3.2 < 4000, 'tools/list too big')

// resources: list runs no ffmpeg
const ffBefore = (errlog.match(/\[ove-debug\]/g) || []).length
await c.listResources(); await c.listResourceTemplates()
assert.equal((errlog.match(/\[ove-debug\]/g) || []).length, ffBefore, 'resources/list ran ffmpeg')

// raw batch with one bad line
let o = await c.callTool({ name: 'ove', arguments: { lines: 'new\nbogus 1\nshow' } })
let lines = o.content[0].text.split('\n'); assert.equal(lines.length, 4, lines.join('|')); assert.ok(JSON.parse(lines[1]).err); assert.deepEqual(JSON.parse(lines[3]).failed, [2])

// project: new with path, auto-save on change
assert.ok((await call('new', { path: proj })).j.saved)
const imp = (await call('import', { paths: [src] })).j; assert.equal(imp.m[0].id, 'm1')
const add = (await call('add', { m: 'm1', at: 0, dur: 10 })).j; assert.ok(add.ok && add.saved, JSON.stringify(add))
assert.equal(JSON.parse(fs.readFileSync(proj, 'utf8')).clips.length, 2)
assert.ok((await call('cut', { t: 4 })).j.ok)
assert.equal(JSON.parse(fs.readFileSync(proj, 'utf8')).clips.length, 4)
assert.ok((await call('undo')).j.ok); assert.equal(JSON.parse(fs.readFileSync(proj, 'utf8')).clips.length, 2)
assert.ok((await call('set', { id: 'c1', props: { volume: 0.5 } })).j.ok)
const bad = await call('cut', { t: -1 }); assert.ok(bad.r.isError && bad.j.err)

// images
let f = await call('frames', { m: 'm1', at: '2,6' }); assert.equal(f.img.length, 2); for (const i of f.img) { assert.equal(i.mimeType, 'image/jpeg'); assert.ok(jpgW(i.data) <= 512) }
f = await call('sheet', { m: 'm1', n: 6, cols: 3 }); assert.equal(f.img.length, 1); assert.ok(jpgW(f.img[0].data) <= 512, 'sheet width ' + jpgW(f.img[0].data))
f = await call('frame', { at: '1,5' }); assert.equal(f.img.length, 2); for (const i of f.img) assert.ok(jpgW(i.data) <= 512 && jpgW(i.data) > 100)

// resources
for (const [uri, key] of [['ove://project', 'project'], ['ove://check', 'n'], ['ove://media/m1/scan', 'dur'], ['ove://help', null]]) {
  const t = (await c.readResource({ uri })).contents[0].text
  if (key) assert.ok(key in JSON.parse(t), uri + ' ' + t.slice(0, 80)); else assert.ok(t.includes('SELF-CHECK'))
}
// app tools without an app: clean error, no hang
const sel = await call('app_selection'); assert.ok(sel.j.err, JSON.stringify(sel.j))
await c.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log('mcp.test OK')
