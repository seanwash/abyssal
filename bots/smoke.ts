import { Client, type Room } from '@colyseus/sdk';
import { CLOSE_REPLACED, ERROR_DIVE_FULL } from '../shared/protocol';

/**
 * Checks the dive server alone: party rooms, input acknowledgement, a full party, a dropped diver
 * rejoining its own seat, position and air, and the bot buddy giving its seat to a person.
 *
 *   SERVER_URL=ws://127.0.0.1:2567 npx tsx bots/smoke.ts
 */
const url = process.env.SERVER_URL ?? 'ws://127.0.0.1:2567';
const party = `SMOKE${Date.now() % 100000}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed = true; };

const join = (diver: string, name: string, p = party) => {
  const room = new Client(url).joinOrCreate('dive', { name, party: p, diver });
  return room.then((r) => { r.reconnection.enabled = false; return r; });
};
const me = (r: Room) => (r.state as any).divers.get(r.sessionId);

const a = await join('smoke-diver-aaaa', 'Bot A');
const b = await join('smoke-diver-bbbb', 'Bot B');
const other = await join('smoke-diver-cccc', 'Bot C', `${party}X`);
check(a.roomId === b.roomId, 'two divers with one party code share a dive');
check(other.roomId !== a.roomId, 'another party code gets its own dive');

const third = await join('smoke-diver-dddd', 'Bot D').then(() => 0, (e) => e.code);
check(third === ERROR_DIVE_FULL, 'a third diver is turned away from a full party');

let seq = 0;
for (let i = 0; i < 60; i++) {
  seq++;
  a.send('input', { seq, x: 1, y: 0, z: 0 });
  b.send('input', { seq, x: 0, y: 0.5, z: -1 });
  await sleep(1000 / 30);
}
await sleep(300);
check(me(a).ack === seq && me(b).ack === seq, `server acknowledged every input (ack ${me(a).ack}, ${me(b).ack})`);
const before = { x: me(a).x, y: me(a).y, z: me(a).z, suit: me(a).suit, air: me(a).air };

// A dropped connection, like a closed laptop lid, then the same tab coming back.
await a.leave(false);
await sleep(300);
check((b.state as any).divers.size === 1, 'the partner sees the dropped diver leave');
const back = await join('smoke-diver-aaaa', 'Bot A');
await sleep(300);
const d = me(back);
check(back.roomId === b.roomId, 'the dropped diver rejoins the same dive');
check(d.suit === before.suit && Math.hypot(d.x - before.x, d.y - before.y, d.z - before.z) < 1e-3,
  `the dropped diver keeps its suit and position (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`);
check(before.air < 100 && Math.abs(d.air - before.air) < 0.5, `the dropped diver keeps its air (${before.air.toFixed(1)} then ${d.air.toFixed(1)})`);
back.send('input', { seq: 1, x: -1, y: 0, z: 0 });
await sleep(300);
check(me(back).ack === 1, 'the rejoined tab can restart its input numbering');

// The same tab joining again before the server noticed the old connection drop takes the seat over.
const replacedCode = new Promise<number>((resolve) => back.onLeave((code) => resolve(code)));
const again = await join('smoke-diver-aaaa', 'Bot A');
check(await Promise.race([replacedCode, sleep(2000).then(() => -1)]) === CLOSE_REPLACED, 'a newer connection for the same diver replaces the old one');
await sleep(300);
check((b.state as any).divers.size === 2, `the party still has two divers (${(b.state as any).divers.size})`);

await Promise.all([again, b, other].map((r) => r.leave()));

// The bot buddy fills an empty second seat and gives it to a person.
const names = (r: Room) => [...(r.state as any).divers.values()].map((x: any) => x.name).sort().join(', ');
const botParty = `${party}B`;
const solo = await join('smoke-diver-eeee', 'Bot E', botParty);
solo.send('buddy');
await sleep(300);
check(names(solo) === 'Bot E, Buddy (bot)', `the bot buddy takes the empty seat (${names(solo)})`);
const second = await join('smoke-diver-ffff', 'Bot F', botParty);
await sleep(300);
check(names(solo) === 'Bot E, Bot F', `a second person takes the bot's seat (${names(solo)})`);
await second.leave(false);
await sleep(300);
solo.send('buddy');
await sleep(300);
check(names(solo) === 'Bot E, Buddy (bot)', `the bot fills in while the second diver is away (${names(solo)})`);
const secondBack = await join('smoke-diver-ffff', 'Bot F', botParty);
await sleep(300);
check(names(solo) === 'Bot E, Bot F' && secondBack.roomId === solo.roomId, `the returning diver takes the seat back from the bot (${names(solo)})`);
await Promise.all([solo, secondBack].map((r) => r.leave()));
process.exit(failed ? 1 : 0);
