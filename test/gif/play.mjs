// Export gif, part 2: record the offscreen player (PORT=9335) playing the MP4 for N seconds.
// Usage: PORT=9335 node test/gif/play.mjs <frames dir> <seconds>
import { ev, sleep, done } from '../drive.mjs'
import { start, stop, caption } from './rec.mjs'
const [out, secs] = process.argv.slice(2)
for (let i = 0; i < 40 && !(await ev(`document.getElementById('v')?.readyState>=2`)); i++) await sleep(250)
await start(out); await ev(`document.getElementById('__cur').style.display='none'`); await caption('The exported MP4'); await ev(`document.getElementById('v').play()`)
await sleep(+secs * 1000); await ev(`document.getElementById('v').pause()`)
console.log(JSON.stringify(await stop(0.3)), await ev(`document.getElementById('v').currentTime`))
done()
