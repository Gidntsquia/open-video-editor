// One-command launcher: makes sure the Electron and ffmpeg binaries are downloaded (newer npm versions
// skip dependency install scripts), builds the UI, then opens the editor window.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: false, ...opts })
  if (r.status) process.exit(r.status)
}
const ensure = (pkg, check) => {
  const dir = path.dirname(require.resolve(pkg + '/package.json'))
  if (!fs.existsSync(path.join(dir, check))) run(process.execPath, [path.join(dir, 'install.js')])
}
const electronDir = path.dirname(require.resolve('electron/package.json'))
if (!fs.existsSync(path.join(electronDir, 'path.txt'))) run(process.execPath, [path.join(electronDir, 'install.js')])
ensure('ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
if (!process.argv.includes('--no-build')) run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'])
const electron = require('electron')
const args = ['.', ...process.argv.slice(2).filter((a) => a !== '--no-build')]
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(electron, args, { stdio: 'inherit', cwd: root, env })
process.exit(r.status ?? 0)
