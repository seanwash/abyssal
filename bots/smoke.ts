import { Client } from '@colyseus/sdk';

const url = process.env.SERVER_URL ?? 'ws://127.0.0.1:2567';
const a = await new Client(url).joinOrCreate('dive', { name: 'Bot A' });
const b = await new Client(url).joinOrCreate('dive', { name: 'Bot B' });
console.log('same room:', a.roomId === b.roomId);
let seq = 0;
for (let i = 0; i < 60; i++) {
  seq++;
  a.send('input', { seq, x: 1, y: 0, z: 0 });
  b.send('input', { seq, x: 0, y: 0.5, z: -1 });
  await new Promise((r) => setTimeout(r, 1000 / 30));
}
await new Promise((r) => setTimeout(r, 300));
for (const [id, d] of (a.state as any).divers) console.log(id === a.sessionId ? 'A' : 'B', d.name, d.suit, d.x.toFixed(2), d.y.toFixed(2), d.z.toFixed(2), 'ack', d.ack);
await a.leave(); await b.leave();
process.exit(0);
