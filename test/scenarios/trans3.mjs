// After an app restart (run trans2, then `bash test/deploy.sh`, then this): the default transition set by right-click
// is still Film Dissolve, and Ctrl+D applies it. Run: node.exe test/run.mjs trans3
import { st, ev, rect, click, key, sleep, check } from '../drive.mjs'
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e
check('prefs.videoType survives the restart', (await st('s.prefs.videoType')) === 'filmdissolve', String(await st('s.prefs.videoType')))
{ const t = await rect('[data-tab="effects"]'); await click(t.x + t.w / 2, t.y + t.h / 2); await sleep(100) }
check('Film Dissolve shows the default tick', !!(await rect('[data-fx="filmdissolve"] .fxdef')))
{ const t = await rect('[data-tab="bin"]'); await click(t.x + t.w / 2, t.y + t.h / 2); await sleep(100) }
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,popup:null,zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
const v1 = await rect('[data-track="V1"]'), lane = await rect('.lane'), b0 = await rect(`[data-media="${A.id}"]`)
const { drag } = await import('../drive.mjs')
await drag(b0.x + 40, b0.y + 20, lane.x + 3, v1.y + v1.h / 2); await sleep(300)
const base = await st('s.clips'); const bv = base.find((c) => c.kind === 'video')
await ev(`__ove.store.setState({clips:${JSON.stringify([{ ...bv, id: 'c0', link: undefined, start: 0, dur: 4, in: 10 }, { ...bv, id: 'c1', link: undefined, start: 4, dur: 4, in: 20 }])},past:[],selection:[]})`); await sleep(150)
await click(lane.x + 400 + 2, v1.y + v1.h / 2); await sleep(150)
check('edit point selected', JSON.stringify(await st('s.selEdge')) === JSON.stringify({ a: 'c0', b: 'c1' }))
await key('d', ['ctrl']); await sleep(150)
const c1 = (await st('s.clips')).find((c) => c.id === 'c1')
check('Ctrl+D applies Film Dissolve 1 s after restart', c1.transType === 'filmdissolve' && near(c1.transition, 1), JSON.stringify([c1.transType, c1.transition]))
await ev(`__ove.store.getState().setPrefs({videoType:'crossdissolve'})`)
