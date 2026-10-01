// Background jobs: a detached `ove` child runs one command; state lives in cache/ove/jobs/jN.json so any later process can poll it.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cacheDir, atomicWrite, fail } from './util.js'

const OVE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ove.js')
const dir = () => { const d = path.join(cacheDir(), 'jobs'); fs.mkdirSync(d, { recursive: true }); return d }
const jf = (id) => path.join(dir(), id + '.json')
export const read = (id) => { try { return JSON.parse(fs.readFileSync(jf(id), 'utf8')) } catch { return null } }
export const write = (id, st) => atomicWrite(jf(id), JSON.stringify(st))

export function start(tokens, cmdText) {
  const n = fs.readdirSync(dir()).map((f) => /^j(\d+)\.json$/.exec(f)).filter(Boolean).map((m) => +m[1])
  const id = 'j' + (Math.max(0, ...n) + 1)
  write(id, { job: id, state: 'running', pct: 0, cmd: cmdText, t0: Date.now() })
  const c = spawn(process.execPath, [OVE_JS, ...tokens], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OVE_JOB: id } })
  c.unref()
  return id
}

/** Child side: progress writer (throttled) and the final result. */
export function reporter(id) {
  let last = 0; const st = read(id) || { job: id }
  st.pid = process.pid; st.platform = process.platform; write(id, st)
  return {
    pct(f, t) { const now = Date.now(); if (now - last < 400) return; last = now; const s = read(id) || st; if (s.state !== 'running') return; write(id, { ...s, pid: process.pid, platform: process.platform, pct: Math.round(f * 100), done_to: Math.round(t * 100) / 100 }) },
    finish(json, ok) { const s = read(id) || st; if (s.state === 'cancelled') return; write(id, { ...s, state: ok ? 'done' : 'err', pct: ok ? 100 : s.pct, result: json, ms: Date.now() - s.t0 }) },
  }
}

const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
export function view(id, cancel) {
  const st = read(id); if (!st) fail(`no job ${id} (try: jobs)`)
  if (st.state === 'running' && st.pid && st.platform === process.platform && !alive(st.pid)) { st.state = 'err'; st.result = { err: 'job process died; run the command again' }; write(id, st) }
  if (cancel) {
    if (st.state !== 'running') fail(`job ${id} is already ${st.state}`)
    if (st.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(st.pid), '/T', '/F'], { windowsHide: true }); else try { process.kill(-st.pid) } catch { try { process.kill(st.pid) } catch {} } }
    st.state = 'cancelled'; write(id, st)
  }
  const o = { ok: 1, job: id, state: st.state, pct: st.pct ?? 0 }
  if (st.done_to != null) o.done_to = st.done_to
  if (st.result) o.result = st.result
  return o
}
export function list() {
  return fs.readdirSync(dir()).filter((f) => /^j\d+\.json$/.test(f)).map((f) => view(f.slice(0, -5))).map((o) => ({ job: o.job, state: o.state, pct: o.pct })).sort((a, b) => +a.job.slice(1) - +b.job.slice(1))
}
