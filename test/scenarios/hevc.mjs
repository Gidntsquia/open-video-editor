import { st, ev, check, sleep } from '../drive.mjs'
await ev(`__ove.importPaths(['D:\\\\ove-test\\\\cache\\\\hevc-test.mp4'])`); await sleep(6000)
const m = Object.values(await st('s.media')).find((m) => m.name === 'hevc-test.mp4')
check('HEVC imported', !!m && m.vcodec === 'hevc', JSON.stringify(m && [m.vcodec, m.w, m.h, m.fps, m.proxy]))
check('proxy built automatically', !!(m && m.proxy))
