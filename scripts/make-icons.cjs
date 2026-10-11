// Renders assets/icon.svg (simplified icon-16.svg for 16-20 px, icon-small.svg for 24-32 px) to the PNG, ICO and
// social-preview files. Run with Electron so Chromium does the SVG rendering:  npx electron scripts/make-icons.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(__dirname, '..', 'assets')
const svg = (f) => 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(dir, f)).toString('base64')

// Runs in the page: draws an SVG at each size and returns PNG data URLs.
const pageCode = (big, small, tiny, sizes, tagline) => `(async () => {
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src })
  const B = await load(${JSON.stringify(big)}), S = await load(${JSON.stringify(small)}), T = await load(${JSON.stringify(tiny)})
  const out = {}
  for (const n of ${JSON.stringify(sizes)}) {
    const c = document.createElement('canvas'); c.width = c.height = n
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(n <= 20 ? T : n <= 32 ? S : B, 0, 0, n, n)
    out[n] = c.toDataURL('image/png')
  }
  const c = document.createElement('canvas'); c.width = 1280; c.height = 640
  const g = c.getContext('2d'); g.fillStyle = '#1b1b1f'; g.fillRect(0, 0, 1280, 640)
  g.drawImage(B, 110, 180, 280, 280)
  g.fillStyle = '#e6e6ea'; g.font = '600 68px "Segoe UI", sans-serif'; g.textBaseline = 'alphabetic'
  g.fillText('Open Video Editor', 440, 318)
  g.fillStyle = '#9a9aa6'; g.font = '36px "Segoe UI", sans-serif'
  ;${JSON.stringify(tagline)}.forEach((l, i) => g.fillText(l, 444, 388 + i * 48))
  out.social = c.toDataURL('image/png')
  return out
})()`

function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4)
  let off = head.length
  pngs.forEach(([n, buf], i) => {
    const e = 6 + 16 * i
    head[e] = n >= 256 ? 0 : n; head[e + 1] = n >= 256 ? 0 : n
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12)
    off += buf.length
  })
  return Buffer.concat([head, ...pngs.map((p) => p[1])])
}

app.whenReady().then(async () => { try {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<body></body>')
  const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  const r = await win.webContents.executeJavaScript(pageCode(svg('icon.svg'), svg('icon-small.svg'), svg('icon-16.svg'), [...icoSizes, 512, 1024],
    ['A Windows video editor for OBS recordings,', 'with a CLI and MCP server for AI edits.']))
  const png = (u) => Buffer.from(u.split(',')[1], 'base64')
  fs.writeFileSync(path.join(dir, 'icon.png'), png(r[512]))
  fs.writeFileSync(path.join(dir, 'icon-1024.png'), png(r[1024]))
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(icoSizes.map((n) => [n, png(r[n])])))
  fs.writeFileSync(path.join(dir, 'social-preview.png'), png(r.social))
  const sheet = process.env.ICON_SHEET_DIR
  if (sheet) for (const n of [16, 32, 256]) fs.writeFileSync(path.join(sheet, `icon-${n}.png`), png(r[n]))
  console.log('wrote', fs.readdirSync(dir).join(' '))
  } catch (e) { fs.writeFileSync(path.join(dir, '..', 'make-icons-error.txt'), String(e.stack || e)); process.exitCode = 1 }
  app.quit()
})
