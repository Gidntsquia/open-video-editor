// print app_selection (+ check/show of a project) via the MCP, e.g. after a bench run: node test/mcp-state.mjs [project.ovep]
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const c = new Client({ name: 't', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, '..', 'cli', 'mcp.js')] }))
const call = async (name, args = {}) => (await c.callTool({ name, arguments: args })).content[0].text
console.log(await call('app_selection'))
if (process.argv[2]) { await call('project_open', { path: process.argv[2] }); console.log(await call('check')); console.log((await call('show')).slice(0, 300)) }
await c.close()
