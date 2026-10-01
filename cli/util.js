import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const CACHE = path.join(process.env.OVE_CACHE || path.join(ROOT, 'cache'), 'ove')
export class Err extends Error {}
export const fail = (m) => { throw new Err(m) }

function works(bin) { try { return spawnSync(bin, ['-version'], { windowsHide: true }).status === 0 } catch { return false } }
let bins
export function bin() {
  if (bins) return bins
  const pick = (env, stat, sys) => {
    if (process.env[env]) return process.env[env]
    if (process.platform === 'linux' && works(sys)) return sys // the bundled Linux ffmpeg has no drawtext
    try { const s = stat(); if (s && fs.existsSync(s) && works(s)) return s } catch {}
    return sys
  }
  bins = {
    ffmpeg: pick('FFMPEG_BIN', () => require('ffmpeg-static'), 'ffmpeg'),
    ffprobe: pick('FFPROBE_BIN', () => require('ffprobe-static').path, 'ffprobe'),
  }
  return bins
}

/** Run a binary, collect stdout/stderr. */
export function exec(b, args, { input } = {}) {
  return new Promise((res, rej) => {
    const c = spawn(b, args, { windowsHide: true }); let out = Buffer.alloc(0), err = ''
    c.stdout.on('data', (d) => (out = Buffer.concat([out, d]))); c.stderr.on('data', (d) => (err = (err + d).slice(-400000)))
    c.on('error', (e) => rej(new Err(`cannot run ${b}: ${e.message}`)))
    c.on('close', (code) => (code === 0 ? res({ out, err }) : rej(new Err(`${path.basename(b)} failed: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`))))
    if (input) c.stdin.end(input)
  })
}

// Project files store Windows paths; under WSL map them to /mnt/x/ when running tools, and back when saving.
const isWsl = process.platform === 'linux'
export function toLocal(p) {
  if (isWsl) { const m = /^([A-Za-z]):[\\/](.*)$/.exec(p); if (m) return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` }
  return p
}
export function toStored(p) {
  if (isWsl) { const m = /^\/mnt\/([a-z])\/(.*)$/.exec(p); if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}` }
  return p
}

export function parseTime(s, what = 'time') {
  if (typeof s === 'number') return s
  const m = /^(-?)(?:(?:(\d+):)?(\d+):)?(\d+(?:\.\d+)?|\.\d+)s?$/.exec(String(s).trim())
  if (!m) fail(`bad ${what} "${s}" (use 12.5, mm:ss or hh:mm:ss.ms)`)
  const v = (m[2] ? +m[2] * 3600 : 0) + (m[3] ? +m[3] * 60 : 0) + +m[4]
  return m[1] ? -v : v
}
export const r2 = (x) => Math.round(x * 100) / 100
export const r3 = (x) => Math.round(x * 1000) / 1000

/** Shell-like tokenizer: "..." and '...' group, backslash is literal except \" inside double quotes. */
export function tokenize(line) {
  const out = []; let cur = '', q = null, has = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (q === '"' && ch === '\\' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === q) q = null; else cur += ch
    } else if (ch === '"' || ch === "'") { q = ch; has = true }
    else if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ''; has = false }
    else cur += ch
  }
  if (q) fail('unterminated quote')
  if (cur || has) out.push(cur)
  return out
}

const VALUE_FLAGS = new Set(['-w', '-h', '-fps', '-p', '-o', '--every', '--at', '--cols', '--n', '--thr', '--db', '--min', '--top', '--win', '--from', '--to', '--budget'])
/** -> {pos:[], kv:{}, flags:{}} ; `k=v` named, `-x v`/`--x v` value flags, other `--x` booleans, `@t` start. */
export function parseArgs(tokens) {
  const a = { pos: [], kv: {}, flags: {}, at: undefined }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (VALUE_FLAGS.has(t)) { if (i + 1 >= tokens.length) fail(`${t} needs a value`); a.flags[t.replace(/^-+/, '')] = tokens[++i] }
    else if (t.startsWith('--')) a.flags[t.slice(2)] = true
    else if (/^@/.test(t)) a.at = t.slice(1)
    else if (/^[A-Za-z][\w.]*=/.test(t)) { const k = t.indexOf('='); a.kv[t.slice(0, k)] = t.slice(k + 1) }
    else a.pos.push(t)
  }
  return a
}

export function num(v, what) {
  const n = Number(v)
  if (v === '' || v == null || !Number.isFinite(n)) fail(`${what} must be a number, got "${v}"`)
  return n
}

export function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file) } catch (e) { try { fs.rmSync(tmp, { force: true }) } catch {} ; fail(`cannot write ${file}: ${e.code || e.message}`) }
}

export function cacheDir() { fs.mkdirSync(CACHE, { recursive: true }); return CACHE }
export function tmpDir() { return fs.mkdtempSync(path.join(cacheDir(), 'tmp-')) }
const LIMIT = 2 * 1024 ** 3
export function enforceCache() {
  try {
    const files = fs.readdirSync(CACHE).map((f) => { const p = path.join(CACHE, f); const s = fs.statSync(p); return { p, s: s.isDirectory() ? 0 : s.size, m: s.mtimeMs, d: s.isDirectory() } }).filter((f) => !f.d)
    let total = files.reduce((a, f) => a + f.s, 0)
    for (const f of files.sort((a, b) => a.m - b.m)) { if (total <= LIMIT) break; fs.rmSync(f.p, { force: true }); total -= f.s }
  } catch {}
}

export function fontDir() {
  if (process.env.OVE_FONTDIR) return process.env.OVE_FONTDIR
  if (process.platform === 'win32') return 'C:/Windows/Fonts'
  if (fs.existsSync('/mnt/c/Windows/Fonts/arial.ttf')) return '/mnt/c/Windows/Fonts'
  const dv = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  if (fs.existsSync(dv)) { // map the app's font files onto DejaVu so drawtext still works
    const d = path.join(cacheDir(), 'fonts'); fs.mkdirSync(d, { recursive: true })
    for (const f of ['arial.ttf', 'segoeui.ttf', 'consola.ttf', 'impact.ttf', 'times.ttf', 'verdana.ttf']) if (!fs.existsSync(path.join(d, f))) fs.copyFileSync(dv, path.join(d, f))
    return d
  }
  return 'C:/Windows/Fonts'
}
export { os }
