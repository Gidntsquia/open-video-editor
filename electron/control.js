// Local control channel for the MCP server (cli/mcp.js). Loopback only, per-launch token, port + token in cache/ove/app.json.
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function startControl(cacheRoot, getWin) {
  const token = crypto.randomBytes(24).toString('hex')
  const dir = path.join(cacheRoot, 'ove'); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'app.json')
  const js = (code) => getWin()?.webContents.executeJavaScript(code, true)
  const handlers = {
    selection: () => js(`(() => { const s = window.__ove.store.getState(); return { clips: s.selection, edge: s.selEdge, playhead: s.playhead, projectPath: s.projectPath, dirty: s.dirty } })()`),
    seek: (b) => js(`(() => { const o = window.__ove, s = o.store.getState(); let t = ${JSON.stringify(b.t ?? null)}; if (${JSON.stringify(b.clip ?? null)}) { const c = s.clips.find((x) => x.id === ${JSON.stringify(b.clip ?? null)}); if (!c) return { err: 'no clip ' + ${JSON.stringify(b.clip ?? null)} }; t = c.start }
      if (t == null) return { err: 'seek needs t or clip' }; o.engine.seek(t); return { ok: 1, playhead: o.store.getState().playhead } })()`),
    open: (b) => {
      let data; try { data = JSON.parse(fs.readFileSync(b.path, 'utf8')) } catch (e) { return { err: 'cannot read ' + b.path } }
      return js(`(() => { const o = window.__ove, s = o.store.getState(); if (s.dirty && !${b.force ? 'true' : 'false'}) return { err: 'unsaved changes in app' }; o.openData(${JSON.stringify(data)}, ${JSON.stringify(b.path)}); return { ok: 1, projectPath: ${JSON.stringify(b.path)} } })()`)
    },
    // wait for the frame to be painted (video decode after a seek), then grab the canvas
    capture: async (b) => {
      if (b.t != null) await js(`window.__ove.engine.seek(${Number(b.t)})`)
      await new Promise((r) => setTimeout(r, 1200))
      const d = await js(`window.__ove.capture()`)
      return d ? { ok: 1, jpeg: d.split(',')[1], playhead: await js(`window.__ove.store.getState().playhead`) } : { err: 'no preview canvas' }
    },
    ping: () => ({ ok: 1 }),
  }
  const srv = http.createServer((req, res) => {
    const send = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (req.headers.authorization !== 'Bearer ' + token) return send(401, { err: 'unauthorized' })
    const name = (req.url || '').slice(1)
    if (req.method !== 'POST' || !handlers[name]) return send(404, { err: 'not found' })
    let body = ''; req.on('data', (d) => (body += d))
    req.on('end', async () => {
      try { send(200, (await handlers[name](body ? JSON.parse(body) : {})) ?? { err: 'no window' }) } catch (e) { send(500, { err: String(e.message || e) }) }
    })
  })
  srv.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(file, JSON.stringify({ port: srv.address().port, token, pid: process.pid }))
  })
  const cleanup = () => { try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.rmSync(file) } catch {} }
  return { srv, cleanup }
}
