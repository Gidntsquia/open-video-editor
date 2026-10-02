// Real mouse click on a clip (CDP Input events), then app_selection must report it. App launched with --remote-debugging-port=9222.
import path from 'node:path'
import assert from 'node:assert'
import { ev, rect, click, sleep } from './drive.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const root = path.resolve(import.meta.dirname, '..')
const c = new Client({ name: 't', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'cli', 'mcp.js')] }))
const call = async (name, args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text)
console.log('open:', JSON.stringify(await call('app_open', { path: path.join(root, 'cache', 'mcp-app.ovep') })))
await sleep(1500)
await ev('__ove.store.getState().setPlayhead(0)')
const id = await ev(`document.querySelector('.clip.video')?.dataset.clip`)
const r = await rect(`[data-clip="${id}"]`); await click(r.x + r.w / 2, r.y + r.h / 2); await sleep(400)
const sel = await call('app_selection'); console.log('after click on', id, JSON.stringify(sel))
assert.ok(sel.clips.includes(id))
const sk = await call('app_seek', { t: 12 }); await sleep(300); console.log('seek', JSON.stringify(sk), JSON.stringify(await call('app_selection')))
await c.close(); process.exit(0)
