// CLI vs MCP parity, outside Claude: run the same ove operations through `node cli/ove.js` and through the MCP server (JSON-RPC) and compare the replies.
// Usage (WSL): node test/parity.mjs [clip] [benchDir]   Separate caches, so both sides compute independently.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const clip = process.argv[2] || 'D:\\OBS Videos\\2023-08-16 23-55-20.mp4'
const benchDir = process.argv[3] || '/mnt/d/ove-test/cache/bench'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-par-'))
const mk = (n) => { const d = path.join(dir, n); fs.mkdirSync(d); return d }
const cliEnv = { ...process.env, OVE_CACHE: mk('cache-cli'), OVE_INACTIVE: '1' }

// Drop what legitimately differs: timings, cache flags, cache-dir paths.
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'ms' || k === 'cached' ? undefined : typeof x === 'string' ? x.replace(/[^"]*cache-(cli|mcp)[\\/]/g, '<cache>/').replace(/<cache>\/(ove\/)?/g, '<cache>/') : x)))
const cli = (args, p) => { const r = spawnSync(process.execPath, [path.join(root, 'cli', 'ove.js'), ...args, ...(p ? ['-p', p] : [])], { env: cliEnv, encoding: 'utf8', maxBuffer: 1 << 28 }); const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); return lines.length === 1 ? lines[0] : { ok: 1, n: lines.length, f: lines } }
const c = new Client({ name: 'parity', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'cli', 'mcp.js')], env: { ...process.env, OVE_CACHE: mk('cache-mcp'), OVE_INACTIVE: '1' } }))
const mcp = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return JSON.parse(r.content[0].text) }

let pass = 0; const fails = []
// MCP envelopes: show --json -> {ok,project}, check -> {ok,n,f} (CLI prints {ok:1} when clean, raw lines otherwise). Compare the payloads.
const unwrap = (v) => (v && v.w ? { ok: 1, n: 1, f: [v] } : v && v.project ? v.project : v && v.f && v.n === 0 ? { ok: 1 } : v)
const same = (label, a, b) => { a = unwrap(a); b = unwrap(b); const x = JSON.stringify(norm(a)), y = JSON.stringify(norm(b)); if (x === y) { pass++; console.log('ok   ', label) } else { fails.push(label); console.log('DIFF ', label, '\n   cli:', x.slice(0, 300), '\n   mcp:', y.slice(0, 300)) } }

// 1. probes on the real clip (same range so both finish inside the default budget)
const R = ['--from', '0', '--to', '120', '--budget', '120']
const probes = [
  ['probe', [], []], ['scan', R, ['from', 0, 'to', 120, 'budget', 120]], ['scenes', R, ['from', 0, 'to', 120, 'budget', 120]],
  ['silence', ['--db', '-35', '--min', '1', ...R], ['db', -35, 'min', 1, 'from', 0, 'to', 120, 'budget', 120]],
  ['loud', ['--top', '10', '--win', '2', ...R], ['top', 10, 'win', 2, 'from', 0, 'to', 120, 'budget', 120]],
]
for (const [cmd, cargs, margs] of probes) {
  const a = {}; for (let i = 0; i < margs.length; i += 2) a[margs[i]] = margs[i + 1]
  same('probe ' + cmd, cli([cmd, clip, ...cargs]), await mcp(cmd, { m: clip, ...a }))
}

// 2. an edit sequence on both sides, then compare show --json, check and the saved file
const pc = path.join(dir, 'cli.ovep'), pm = path.join(dir, 'mcp.ovep')
cli(['new'], pc); await mcp('new', { path: pm })
const imp = cli(['import', clip], pc); const imp2 = await mcp('import', { paths: [clip] }); same('import', imp, imp2)
const steps = [
  [['add', 'm1', '@0', 'in=10', 'dur=20'], 'add', { m: 'm1', at: '0', in: '10', dur: '20' }],
  [['add', 'm1', '@20', 'in=60', 'dur=15'], 'add', { m: 'm1', at: '20', in: '60', dur: '15' }],
  [['cut', '8'], 'cut', { t: '8' }],
  [['speed', 'c1', '2'], 'speed', { id: 'c1', x: 2 }],
  [['dissolve', 'c3'], 'dissolve', { id: 'c3' }],
  [['set', 'c3', 'volume=0.5', 'fadeIn=1'], 'set', { id: 'c3', props: { volume: 0.5, fadeIn: 1 } }],
  [['title', '@1', 'dur=2', 'text=Hi'], 'title', { at: '1', dur: '2', text: 'Hi' }],
  [['rm', 'c2', '--ripple'], 'rm', { ids: ['c2'], ripple: true }],
]
for (const [ca, tool, ma] of steps) same('edit ' + ca.join(' '), cli(ca, pc), await mcp(tool, ma))
same('show --json', cli(['show', '--json'], pc), await mcp('show', { json: true }))
same('check', cli(['check'], pc), await mcp('check'))
cli(['save', pc], pc); await mcp('save')
const strip = (f) => { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j }
same('saved .ovep', strip(pc), strip(pm))

// 3. every benchmark project: CLI vs MCP show --json and check
for (const f of fs.readdirSync(benchDir).filter((x) => x.endsWith('.ovep')).sort()) {
  const p = path.join(benchDir, f)
  await mcp('project_open', { path: p })
  same('bench ' + f + ' show', cli(['show', '--json'], p), await mcp('show', { json: true }))
  same('bench ' + f + ' check', cli(['check'], p), await mcp('check'))
}

console.log(`\n${pass} identical, ${fails.length} different`)
await c.close(); fs.rmSync(dir, { recursive: true, force: true })
process.exit(fails.length ? 1 : 0)
