// Records the page on PORT (screencast frames, no cursor) until <stop file> exists. For side-by-side gifs.
// Usage: PORT=9334 node test/gif/castbg.mjs <frames dir> <stop file>
import fs from 'node:fs'
import { ev, sleep, done } from '../drive.mjs'
import { start, stop } from './rec.mjs'
const [dir, stopFile] = process.argv.slice(2)
fs.rmSync(stopFile, { force: true })
await start(dir); await ev(`document.getElementById('__cur').style.display='none'`)
fs.writeFileSync(stopFile + '.started', '')
while (!fs.existsSync(stopFile)) await sleep(100)
console.log(JSON.stringify(await stop(0))); fs.rmSync(stopFile + '.started', { force: true }); done()
