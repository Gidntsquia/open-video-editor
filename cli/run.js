// ffmpeg runner with a per-command time budget, progress parsing and debug logging.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { bin, Err } from './util.js'

export const clock = { start: Date.now(), budget: 20, onPct: null }
export const setClock = (budgetSec) => { clock.start = Date.now(); clock.budget = budgetSec }
export const left = () => clock.start + clock.budget * 1000 - Date.now()
export const elapsed = () => Date.now() - clock.start
export const debug = (...a) => { if (process.env.OVE_DEBUG) process.stderr.write(`[ove-debug] ${a.join(' ')}\n`) }

/**
 * Run ffmpeg. At the budget it is stopped if it made progress (result.stopped='budget', result.t = seconds of output done);
 * with no progress it gets until 3x the budget, then it is killed (stopped='timeout').
 * onProgress(t) gets output seconds. Rejects with Err on a non-zero exit when not stopped.
 */
export function ff(args, { onProgress, budget = true, binary } = {}) {
  const exe = binary || bin().ffmpeg
  const full = ['-hide_banner', '-nostats', '-progress', 'pipe:1', ...args.map(String)]
  debug(path.basename(exe), full.map((x) => (/\s/.test(x) ? JSON.stringify(x) : x)).join(' '))
  return new Promise((res, rej) => {
    const c = spawn(exe, full, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = '', t = 0, stopped = null, fin = false, tail = ''
    const done = (v, isErr) => { if (fin) return; fin = true; clearInterval(iv); c.stdout.destroy(); c.stderr.destroy(); isErr ? rej(v) : res(v) }
    c.stdout.on('data', (d) => {
      const s = d.toString(); out = (out + s).slice(-8e6); tail = (tail + s).slice(-300)
      for (const m of s.matchAll(/out_time_us=(\d+)/g)) { const v = +m[1] / 1e6; if (v > t) { t = v; onProgress?.(t) } }
    })
    c.stderr.on('data', (d) => (err = (err + d).slice(-8e6)))
    c.on('error', (e) => done(new Err(`cannot run ${exe}: ${e.message}`), true))
    c.on('exit', (code) => setTimeout(() => {
      if (stopped) return done({ out, err, t, stopped })
      if (code === 0) return done({ out, err, t, stopped: null })
      done(new Err(`ffmpeg failed: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`), true)
    }, 150))
    const iv = setInterval(() => {
      if (!budget || stopped) return
      const over = clock.start + clock.budget * 1000
      const now = Date.now()
      if (now > over && t > 0) stopped = 'budget'
      else if (now > over + 2 * clock.budget * 1000) stopped = 'timeout'
      if (stopped) { c.kill(); setTimeout(() => done({ out, err, t, stopped }), 1500) }
    }, 100)
  })
}
