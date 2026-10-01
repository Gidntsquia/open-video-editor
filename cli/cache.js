// Result cache: per source file (path+size+mtime) JSON with covered time ranges and the items found inside them.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { cacheDir, atomicWrite } from './util.js'

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex')
export const fid = (f) => { const s = fs.statSync(f); return sha(`${f}|${s.size}|${s.mtimeMs}`).slice(0, 10) }
export const hash = (s, n = 8) => sha(s).slice(0, n)
export const EPS = 0.02
const file = (id, kind, args) => path.join(cacheDir(), `r-${id}-${kind}${args ? '-' + hash(args, 6) : ''}.json`)

export function load(id, kind, args = '') {
  try { return JSON.parse(fs.readFileSync(file(id, kind, args), 'utf8')) } catch { return { cov: [], items: [] } }
}
export function store(id, kind, args, st) { atomicWrite(file(id, kind, args), JSON.stringify(st)) }

/** Parts of [a,b] not inside the sorted, merged coverage list. */
export function gaps(cov, a, b) {
  const out = []; let cur = a
  for (const [x, y] of cov) {
    if (y <= cur + EPS) continue
    if (x > cur + EPS) out.push([cur, Math.min(x, b)])
    cur = Math.max(cur, y)
    if (cur >= b - EPS) break
  }
  if (cur < b - EPS) out.push([cur, b])
  return out
}
export function addCov(cov, a, b) {
  cov.push([a, b]); cov.sort((p, q) => p[0] - q[0])
  const m = []
  for (const c of cov) { const l = m[m.length - 1]; if (l && c[0] <= l[1] + EPS) l[1] = Math.max(l[1], c[1]); else m.push([...c]) }
  cov.length = 0; cov.push(...m)
}
export const wavPath = (id) => path.join(cacheDir(), `wav-${id}.wav`)
export const proxyPath = (id) => path.join(cacheDir(), `proxy-${id}.mp4`)
