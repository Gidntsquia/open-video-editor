// Where the app and the ove CLI keep cache/. From a source checkout it is <repo>/cache. In the
// portable zip (code under <folder>/resources/app or app.asar) it is <folder>/cache, next to the exe,
// or %LOCALAPPDATA%\Open Video Editor\cache when that folder is not writable (e.g. Program Files).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The unzipped folder that holds `Open Video Editor.exe`, or null when running from source. */
export function packagedDir(root) {
  const m = /^(.*)[\\/]resources[\\/]app(\.asar)?(\.unpacked)?([\\/]|$)/.exec(root)
  return m ? m[1] : null
}

/** Binaries inside app.asar can't be executed; electron-builder unpacks them next to it. */
export const unpacked = (p) => (p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p)

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const t = path.join(dir, `.w-${process.pid}`)
    fs.writeFileSync(t, ''); fs.rmSync(t)
    return true
  } catch { return false }
}

export function cacheRoot(root) {
  if (process.env.OVE_CACHE) return process.env.OVE_CACHE
  const pkg = packagedDir(root)
  if (!pkg) return path.join(root, 'cache')
  const local = path.join(pkg, 'cache')
  if (writable(local)) return local
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Open Video Editor', 'cache')
}
