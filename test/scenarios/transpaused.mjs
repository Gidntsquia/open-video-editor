// Paused preview inside a transition must not be black.
import { st, ev, rect, drag, sleep, check } from '../drive.mjs'
await ev(`__ove.store.setState({clips:[],past:[],future:[],selection:[],zoom:100,playhead:0,tool:'select'})`)
const A = Object.values(await st('s.media')).find((m) => m.name.startsWith('2023-08-16 23-55-20'))
const b0 = await rect(`[data-media="${A.id}"]`), v1 = await rect('[data-track="V1"]'), lane = await rect('.lane')
await drag(b0.x + 40, b0.y + 20, lane.x + 3, v1.y + v1.h / 2)
const base = (await st('s.clips')).find((c) => c.kind === 'video')
const c = [{ ...base, id: 'a', link: undefined, start: 0, dur: 2.5, in: 1 }, { ...base, id: 'b', link: undefined, start: 2.5, dur: 3, in: 10 }]
await ev(`__ove.store.setState({clips:${JSON.stringify(c)}})`)
await ev(`__ove.store.getState().setTransition({a:'a',b:'b'},{type:'crossdissolve',dur:1})`)
console.log(JSON.stringify((await st('s.clips')).map(({id,start,dur,in:i,transition,transOut})=>({id,start,dur,i,transition,transOut}))))
const probe = `(()=>{const cv=document.querySelector('.canvaswrap canvas');const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let q=0;for(let i=0;i<d.length;i+=40)q+=d[i];return Math.round(q/(d.length/40))+' '+JSON.stringify([...__ove.engine.els.entries()].map(([k,v])=>[k,v.el.readyState,v.el.seeking,+v.el.currentTime.toFixed(2),+v.lastSeek.toFixed(2)]))+' dirty='+__ove.engine.dirty+' ph='+__ove.store.getState().playhead})()`
for (const t of [1, 2.0, 1.75, 2.5, 3.0]) {
  await ev(`__ove.engine.seek(${t})`)
  for (let k = 0; k < 2; k++) { await sleep(1000); console.log(t, k, await ev(probe)) }
}

await ev(`__ove.engine.seek(2.5)`); await sleep(1500)
console.log(await ev(`(()=>{const cv=document.querySelector('.canvaswrap canvas');const g=cv.getContext('2d');const mean=()=>{const d=g.getImageData(0,0,cv.width,cv.height).data;let q=0;for(let i=0;i<d.length;i+=40)q+=d[i];return Math.round(q/(d.length/40))};const out=['now '+mean()];__ove.engine.draw(2.5);out.push('redraw '+mean());
const S=__ove.store;const cl=S.getState().clips;
for(const c of cl){S.setState({clips:cl.filter(x=>x.id===c.id).map(x=>({...x,transition:0,transOut:0}))});__ove.engine.draw(2.5);out.push(c.id+' alone '+mean())}
S.setState({clips:cl});return out.join('|')})()`))
