// `npm.cmd run dist`: builds release/Open-Video-Editor-<version>-win-x64.zip from a clean checkout.
// Installs dependencies if needed, makes sure the ffmpeg binary was downloaded (newer npm versions skip
// install scripts), builds the UI with Vite, then packages with electron-builder (zip, x64).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dirname, '..')
const win = process.platform === 'win32'
const run = (cmd, args) => {
  console.log('>', cmd, args.join(' '))
  // .cmd files need cmd.exe on Windows (spawn can't run them directly)
  const [c, a] = win && cmd.endsWith('.cmd') ? ['cmd.exe', ['/d', '/c', cmd, ...args]] : [cmd, args]
  const r = spawnSync(c, a, { stdio: 'inherit', cwd: root })
  if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')} (exit ${r.status ?? r.error?.message})`); process.exit(r.status || 1) }
}
if (!win) console.warn('warning: the release zip is a Windows build; run this on Windows (npm.cmd run dist).')
if (!fs.existsSync(path.join(root, 'node_modules', 'electron-builder'))) run(win ? 'npm.cmd' : 'npm', ['install'])
const require = createRequire(path.join(root, 'package.json'))
const pkgDir = (p) => path.dirname(require.resolve(p + '/package.json'))
if (!fs.existsSync(path.join(pkgDir('ffmpeg-static'), win ? 'ffmpeg.exe' : 'ffmpeg'))) run(process.execPath, [path.join(pkgDir('ffmpeg-static'), 'install.js')])
run(process.execPath, [path.join(pkgDir('vite'), 'bin', 'vite.js'), 'build'])
run(process.execPath, [path.join(pkgDir('electron-builder'), 'cli.js'), '--win', 'zip', '--x64', '--publish', 'never'])
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const zip = path.join(root, 'release', `Open-Video-Editor-${version}-win-x64.zip`)
if (!fs.existsSync(zip)) { console.error('expected output missing: ' + zip); process.exit(1) }
console.log(`built ${zip} (${(fs.statSync(zip).size / 1e6).toFixed(0)} MB)`)
