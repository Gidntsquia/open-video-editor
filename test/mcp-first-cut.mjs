// project_open + app_open (no t): app shows the project with the playhead on the first cut
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const c = new Client({ name: 't', version: '1' })
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(import.meta.dirname, '..', 'cli', 'mcp.js')] }))
const call = async (name, args = {}) => (await c.callTool({ name, arguments: args })).content[0].text
await call('project_open', { path: process.argv[2] })
console.log(await call('app_open')); console.log(await call('app_selection'))
await c.close()
