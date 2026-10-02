// dirty app: app_open must refuse and change nothing. Needs the app launched with --remote-debugging-port=9222 (to make it dirty without a mouse).
import path from 'node:path'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const root = path.resolve(import.meta.dirname, '..')
const c = new Client({ name: 't', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'cli', 'mcp.js')] }))
const call = async (name, args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text)
const cdp = (js) => spawnSync(process.execPath, [path.join(root, 'test', 'cdp.mjs'), 'eval', js], { encoding: 'utf8' }).stdout.trim()
const proj = path.join(root, 'cache', 'mcp-app.ovep')
console.log('open clean:', JSON.stringify(await call('app_open', { path: proj })))
cdp('window.__ove.store.setState({dirty:true, status:"dirty-test"})')
const before = await call('app_selection')
const r = await call('app_open', { path: proj }); console.log('open dirty:', JSON.stringify(r))
assert.equal(r.err, 'unsaved changes in app')
const after = await call('app_selection'); assert.deepEqual(after, before); assert.equal(after.dirty, true)
console.log('selection unchanged while dirty: PASS')
await c.close()
