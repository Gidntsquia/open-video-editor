import { app, BrowserWindow, dialog, ipcMain, protocol, net, Menu } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildExport } from './exporter.js'
import { probeFile } from '../shared/probe.js'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const unpack = (p) => (p ? p.replace('app.asar', 'app.asar.unpacked') : p)
const FFMPEG = process.env.FFMPEG_BIN || unpack(require('ffmpeg-static'))
const FFPROBE = process.env.FFPROBE_BIN || unpack(require('ffprobe-static').path)
// All caches (thumbnails, waveforms, proxies, export temp) live here, capped and clearable from the app.
const CACHE = process.env.OVE_CACHE || path.join(root, 'cache')
const CACHE_LIMIT = 2 * 1024 ** 3
fs.mkdirSync(CACHE, { recursive: true })

app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }])

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const key = (p) => { const st = fs.statSync(p); return hash(`${p}|${st.size}|${st.mtimeMs}`) }
const run = (bin, args) => new Promise((res, rej) => {
  const c = spawn(bin, args, { windowsHide: true }); let out = Buffer.alloc(0), err = ''
  c.stdout.on('data', (d) => (out = Buffer.concat([out, d]))); c.stderr.on('data', (d) => (err += d))
  c.on('error', rej); c.on('close', (code) => (code === 0 ? res(out) : rej(new Error(err.slice(-800)))))
})

function enforceCacheLimit() {
  try {
    const files = fs.readdirSync(CACHE).map((f) => { const p = path.join(CACHE, f); const s = fs.statSync(p); return { p, s: s.size, m: s.mtimeMs } })
    let total = files.reduce((a, f) => a + f.s, 0)
    for (const f of files.sort((a, b) => a.m - b.m)) { if (total <= CACHE_LIMIT) break; fs.rmSync(f.p, { force: true }); total -= f.s }
  } catch {}
}

const probe = (p) => probeFile(FFPROBE, p)

const inflight = new Map()
const once = (k, fn) => { if (!inflight.has(k)) inflight.set(k, fn().finally(() => inflight.delete(k))); return inflight.get(k) }

ipcMain.handle('probe', (_e, p) => probe(p))
ipcMain.handle('thumb', (_e, p, t = 1) => once('t' + p, async () => {
  const f = path.join(CACHE, `th-${key(p)}.jpg`)
  if (!fs.existsSync(f)) {
    await run(FFMPEG, ['-y', '-v', 'error', '-ss', String(t), '-i', p, '-frames:v', '1', '-vf', 'scale=160:-2', f]).catch(() =>
      run(FFMPEG, ['-y', '-v', 'error', '-i', p, '-frames:v', '1', '-vf', 'scale=160:-2', f]))
    enforceCacheLimit()
  }
  return 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64')
}))
ipcMain.handle('waveform', (_e, p) => once('w' + p, async () => {
  const f = path.join(CACHE, `wf-${key(p)}.json`)
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
  // 200 peaks per second from 8 kHz mono PCM
  const pcm = await run(FFMPEG, ['-v', 'error', '-i', p, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'])
  const n = pcm.length >> 1, per = 40, peaks = []
  for (let i = 0; i < n; i += per) {
    let m = 0
    for (let j = i; j < Math.min(n, i + per); j++) m = Math.max(m, Math.abs(pcm.readInt16LE(j * 2)))
    peaks.push(Math.round((m / 32768) * 255))
  }
  const r = { pps: 200, peaks }
  fs.writeFileSync(f, JSON.stringify(r)); enforceCacheLimit()
  return r
}))
ipcMain.handle('proxy', (_e, p) => once('p' + p, async () => {
  const f = path.join(CACHE, `px-${key(p)}.mp4`)
  if (!fs.existsSync(f)) {
    const tmp = f + '.part.mp4'
    await run(FFMPEG, ['-y', '-v', 'error', '-i', p, '-vf', "scale='min(960,iw)':-2", '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-crf', '26', '-an', tmp])
    fs.renameSync(tmp, f); enforceCacheLimit()
  }
  return f
}))
ipcMain.handle('import-dialog', async () => {
  const r = await dialog.showOpenDialog({ title: 'Import media', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'm4v', 'webm', 'avi'] }] })
  return r.canceled ? [] : r.filePaths
})
ipcMain.handle('save-project', async (_e, data, p) => {
  if (!p) {
    const r = await dialog.showSaveDialog({ title: 'Save project', defaultPath: 'project.ovep', filters: [{ name: 'Video Editor Project', extensions: ['ovep'] }] })
    if (r.canceled) return null
    p = r.filePath
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 1)); return p
})
ipcMain.handle('open-project', async (_e, p) => {
  if (!p) {
    const r = await dialog.showOpenDialog({ title: 'Open project', properties: ['openFile'], filters: [{ name: 'Video Editor Project', extensions: ['ovep'] }] })
    if (r.canceled) return null
    p = r.filePaths[0]
  }
  return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) }
})
ipcMain.handle('export-dialog', async () => {
  const r = await dialog.showSaveDialog({ title: 'Export MP4', defaultPath: 'export.mp4', filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
  return r.canceled ? null : r.filePath
})

let nvencOk
function hasNvenc() {
  if (nvencOk === undefined) {
    const t = spawnSync(FFMPEG, ['-hide_banner', '-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { windowsHide: true })
    nvencOk = t.status === 0
  }
  return nvencOk
}
let exportProc = null
ipcMain.handle('export-cancel', () => { exportProc?.kill(); return true })
ipcMain.handle('export', (e, project, out) => new Promise((resolve, reject) => {
  const dir = fs.mkdtempSync(path.join(CACHE, 'export-'))
  const scriptPath = path.join(dir, 'filter.txt')
  const b = buildExport(project, out, { tmpDir: dir, scriptPath, nvenc: hasNvenc() })
  fs.writeFileSync(scriptPath, b.script)
  for (const t of b.textFiles) fs.writeFileSync(t.path, t.text, 'utf8')
  const c = (exportProc = spawn(FFMPEG, b.args, { windowsHide: true }))
  let buf = '', err = ''
  const done = (fn, v) => { exportProc = null; fs.rmSync(dir, { recursive: true, force: true }); fn(v) }
  c.stdout.on('data', (d) => {
    buf += d
    const m = [...buf.matchAll(/out_time_us=(\d+)/g)].pop()
    if (m) e.sender.send('export-progress', Math.min(1, Number(m[1]) / 1e6 / b.total))
  })
  c.stderr.on('data', (d) => (err = (err + d).slice(-1500)))
  c.on('error', (x) => done(reject, x))
  c.on('close', (code, sig) => (code === 0 ? done(resolve, { out, total: b.total, encoder: hasNvenc() ? 'h264_nvenc' : 'libx264' }) : done(reject, new Error(sig ? 'Cancelled' : err))))
}))
function cacheInfo() {
  let size = 0
  try { for (const f of fs.readdirSync(CACHE)) { const p = path.join(CACHE, f); const s = fs.statSync(p); size += s.isDirectory() ? 0 : s.size } } catch {}
  return { dir: CACHE, size, limit: CACHE_LIMIT }
}
ipcMain.handle('cache-info', cacheInfo)
ipcMain.handle('cache-clear', () => { for (const f of fs.readdirSync(CACHE)) fs.rmSync(path.join(CACHE, f), { recursive: true, force: true }); return cacheInfo() })
// Read-only: list a few clips from the OBS folder (never writes there).
ipcMain.handle('sample-clips', () => {
  const dir = process.env.OVE_SAMPLES || 'D:\\OBS Videos'
  try {
    const want = ['2026-09-15 01-52-36.mkv', '2023-08-16 23-55-20.mp4']
    const files = fs.readdirSync(dir).filter((f) => /\.(mp4|mkv|mov)$/i.test(f)).sort()
    const pick = want.filter((w) => files.includes(w))
    for (const f of files) { if (pick.length >= 4) break; if (!pick.includes(f) && fs.statSync(path.join(dir, f)).size < 150e6) pick.push(f) }
    return pick.map((f) => path.join(dir, f))
  } catch { return [] }
})
ipcMain.handle('argv', () => process.argv)

function createWindow() {
  const win = new BrowserWindow({
    show: !process.env.OVE_INACTIVE, width: 1600, height: 950, backgroundColor: '#1b1b1f', title: 'Open Video Editor',
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: false, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Import media…', accelerator: 'CmdOrCtrl+I', click: () => win.webContents.send('menu', 'import') },
      { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu', 'open') },
      { label: 'Save project', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu', 'save') },
      { label: 'Save project as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => win.webContents.send('menu', 'saveas') },
      { label: 'Export MP4…', accelerator: 'CmdOrCtrl+M', click: () => win.webContents.send('menu', 'export') },
      { type: 'separator' }, { role: 'quit' } ] },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] },
  ]))
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Discard and quit', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Unsaved changes', message: 'This project has unsaved changes.' })
    if (r === 0) e.preventDefault()
  })
  if (process.env.OVE_INACTIVE) win.once('ready-to-show', () => win.showInactive())
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173'); else win.loadFile(path.join(root, 'dist', 'index.html'))
}

app.whenReady().then(() => {
  protocol.handle('media', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1))
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers, method: req.method }).then((r) => {
      const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*')
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h })
    })
  })
  createWindow()
})
app.on('window-all-closed', () => app.quit())
