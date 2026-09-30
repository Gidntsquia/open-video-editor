// ove CLI: bad input never changes the .ovep, batch output is one JSON line per command, save/reload round-trips.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ove = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'ove.js')
const ff = process.env.FFMPEG_BIN || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ove-cli-'))
const src = path.join(dir, 'src.mp4')
let r = spawnSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=8', '-f', 'lavfi', '-i', 'sine=f=440:d=8', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src])
assert.equal(r.status, 0, 'src gen')
const proj = path.join(dir, 'p.ovep')
const run = (args, input) => { const o = spawnSync(process.execPath, [ove, ...args], { input, encoding: 'utf8', env: { ...process.env, OVE_CACHE: path.join(dir, 'cache') } }); return { code: o.status, out: o.stdout.trim().split('\n').filter(Boolean), err: o.stderr } }

// batch: >= 12 commands, one JSON line each, nothing else
const script = ['new', `import "${src}"`, 'add m1 V1 @0 dur=6', 'cut 2', 'cut 4', 'rm c3 --ripple', 'dissolve c5 dur=0.5', 'speed c5 2', 'title @0.5 dur=1 text="Hi"', 'fade c2 in=0.2 out=0.2', 'set c1 saturation=1.2', 'check', 'show', `save ${proj}`].join('\n')
r = run([], script)
assert.equal(r.out.length, 14, r.out.join('\n')); assert.equal(r.err, ''); assert.equal(r.code, 0, r.out.join('\n'))
for (const l of r.out) { const j = JSON.parse(l); assert.ok(j.ok === 1, l) }
const before = fs.readFileSync(proj)
// round trip
const a = run(['show', '--json', '-p', proj]); const saved = JSON.parse(before)
assert.deepStrictEqual(JSON.parse(a.out[0]).clips, saved.clips)
assert.deepStrictEqual(run(['show', '-p', proj]).out, JSON.parse(r.out[12]).show)
// 8 bad inputs: {"err"}, exit 1, file unchanged
const bad = [
  ['missing file', ['import', path.join(dir, 'nope.mp4'), '-p', proj]],
  ['unknown id', ['cut', '1', 'c99', '-p', proj]],
  ['negative time', ['cut', '-3', '-p', proj]],
  ['in past media end', ['add', 'm1', 'V1', '@0', 'in=7', 'dur=5', '-p', proj]],
  ['unknown track', ['add', 'm1', 'V9', '@0', '-p', proj]],
  ['unknown prop', ['set', 'c1', 'wobble=3', '-p', proj]],
  ['overlapping title', ['title', '@1', 'dur=2', 'text=x', '-p', proj]],
  ['unwritable save', ['save', path.join(dir, 'no', 'such', 'dir', 'x.ovep'), '-p', proj]],
]
for (const [name, args] of bad) {
  const o = run(args)
  assert.equal(o.code, 1, name + ' exit'); assert.equal(o.out.length, 1, name); assert.ok(JSON.parse(o.out[0]).err, name + ' ' + o.out[0])
  assert.ok(before.equals(fs.readFileSync(proj)), name + ' changed the file')
}
// frame + preview
const f = run(['frame', '--at', '1,2.5', '-p', proj]); assert.equal(JSON.parse(f.out[0]).f.length, 2, f.out[0])
const pv = run(['preview', '-p', proj, '-o', path.join(dir, 'pv.mp4')]); assert.equal(JSON.parse(pv.out[0]).ok, 1, pv.out[0])
// transcript without whisper
assert.equal(JSON.parse(run(['transcript', src]).out[0]).err, 'set OVE_WHISPER to a whisper CLI')
console.log('ove test OK (8 bad inputs, 14-line batch, round trip, frame, preview)')
fs.rmSync(dir, { recursive: true, force: true })
