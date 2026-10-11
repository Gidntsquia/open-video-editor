// Offscreen "terminal" page (never on screen) with CDP on 9335; test/gif/mcp.mjs types into it.
// Usage: electron test/gif/term.cjs <css width> <css height>
const { app, BrowserWindow } = require('electron')
const [w, h] = process.argv.slice(-2)
app.commandLine.appendSwitch('remote-debugging-port', '9335')
app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, width: +w, height: +h, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(30)
  const html = `<!doctype html><title>ove-mcp</title><style>
body{margin:0;background:#0c0c0c;color:#cccccc;font:17px/1.42 Consolas,monospace;height:100vh;display:flex;flex-direction:column}
#bar{background:#1f1f1f;color:#fff;padding:7px 14px;font:14px Segoe UI,sans-serif;border-bottom:1px solid #333}
#t{flex:1;padding:10px 14px;overflow:hidden;white-space:pre-wrap;word-break:break-all;display:flex;flex-direction:column;justify-content:flex-end}
.p{color:#6fd36f}.c{color:#fff}.k{color:#61afef}.r{color:#9a9a9a}.ok{color:#e5c07b}.n{color:#c678dd}
#cur{display:inline-block;width:9px;height:18px;background:#ccc;vertical-align:-3px;animation:b 1s steps(1) infinite}@keyframes b{50%{opacity:0}}
</style><div id="bar">Terminal — ove-mcp (MCP over stdio)</div><div id="t"><div id="log"></div><div id="line"><span class="p">&gt; </span><span id="in" class="c"></span><span id="cur"></span></div></div>
<script>
const log=document.getElementById('log'),inp=document.getElementById('in')
window.term={
  type:async(html,ms)=>{const tmp=document.createElement('span');tmp.innerHTML=html;const txt=tmp.textContent;for(let i=1;i<=txt.length;i++){inp.textContent=txt.slice(0,i);await new Promise(r=>setTimeout(r,ms))}inp.innerHTML=html},
  enter:()=>{const d=document.createElement('div');d.innerHTML='<span class="p">&gt; </span><span class="c">'+inp.innerHTML+'</span>';log.appendChild(d);inp.textContent=''},
  out:(html)=>{const d=document.createElement('div');d.innerHTML=html;log.appendChild(d)},
}
</script>`
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
})
