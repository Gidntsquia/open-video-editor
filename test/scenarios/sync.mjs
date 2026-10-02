// Playback sync at a cut with a 1 s transition: every element (outgoing/incoming audio and video) stays within 2 frames
// of its timeline target while playing through the cut. Run: node.exe test/run.mjs sync
import { st, ev, sleep, check } from '../drive.mjs'
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],selEdge:null,popup:null,zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
await ev(`__ove.store.getState().addFromMedia(${JSON.stringify(A.id)}, 'V1', 0)`); await sleep(300)
const base = await st('s.clips'); const bv = base.find((c) => c.kind === 'video'), ba = base.find((c) => c.kind === 'audio')
const clips = [0, 1].map((i) => [{ ...bv, id: 'c' + i, link: 'L' + i, start: 4 * i, dur: 4, in: 30 + 40 * i }, { ...ba, id: 'a' + i, link: 'L' + i, start: 4 * i, dur: 4, in: 30 + 40 * i }]).flat()
await ev(`__ove.store.setState({clips:${JSON.stringify(clips)},past:[],selection:[],selEdge:null})`); await sleep(100)
await ev(`__ove.store.getState().setTransition({a:'c0',b:'c1'},{type:'crossdissolve',dur:1})`)
await ev(`__ove.engine.seek(2.5)`); await sleep(1500)
const rows = JSON.parse(await ev(`(async()=>{const E=__ove.engine;const S=__ove.store;const out=[];const t0=performance.now();E.play();
  while(performance.now()-t0<3000){const s=S.getState();const ph=s.playhead;const row={ph:+ph.toFixed(3)};for(const id of ['c0','a0','c1','a1']){const v=E.els.get(id);const c=s.clips.find(c=>c.id===id);if(!v||!c||ph<c.start||ph>=c.start+c.dur)continue;row[id]=+(v.el.currentTime-(c.in+(ph-c.start))).toFixed(3)}out.push(row);await new Promise(r=>setTimeout(r,100))}
  E.pause();return JSON.stringify(out)})()`))
const bad = []
for (const r of rows) for (const id of ['c0', 'a0', 'c1', 'a1']) if (id in r && Math.abs(r[id]) > 2 / 30 && r.ph > 2.7) bad.push(`${r.ph}s ${id} ${r[id]}`)
check('all active elements within 2 frames (67 ms) of their target while playing through the cut', !bad.length, bad.slice(0, 6).join(', ') || rows.filter((_, i) => i % 5 === 0).map((r) => JSON.stringify(r)).join(' '))
