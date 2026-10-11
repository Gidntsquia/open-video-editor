// Plays an MP4 in an offscreen Chromium window (never on screen) with CDP on 9335, for the export gif.
// Usage: electron test/gif/player.cjs <file.mp4> <css width> <css height>
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const [mp4, w, h] = process.argv.slice(-3)
app.commandLine.appendSwitch('remote-debugging-port', '9335')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: +w, height: +h, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(30)
  const name = path.basename(mp4)
  const html = `<!doctype html><title>${name}</title><body style="margin:0;background:#000;height:100vh;display:flex;flex-direction:column;font:15px Segoe UI,sans-serif;color:#ddd">
<div style="padding:8px 14px;background:#202024;border-bottom:1px solid #333">▶ ${name} · exported MP4</div>
<video id="v" src="${pathToFileURL(mp4).href}" controls style="flex:1;min-height:0;width:100%;background:#000"></video></body>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html), { baseURLForDataURL: pathToFileURL(path.dirname(mp4) + path.sep).href })
})
