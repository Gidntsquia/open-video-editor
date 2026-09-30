import { ev, click } from '../drive.mjs'
console.log('a', await ev('1+1'))
await click(400, 300); console.log('clicked')
