import { setTimeout as sleep } from "node:timers/promises";

import { Client } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";

import { CLOSE_REPLACED, ERROR_DIVE_FULL } from "../shared/protocol";

/** The parts of a diver's synced state this script reads. */
interface DiverView {
  name: string;
  suit: number;
  x: number;
  y: number;
  z: number;
  ack: number;
  air: number;
  aboard: number;
}
/** The parts of the dive's synced state this script reads. */
interface DiveView {
  divers: {
    size: number;
    get: (id: string) => DiverView | undefined;
    values: () => Iterable<DiverView>;
  };
}

/**
 * Checks the dive server alone: party rooms, starting at the field station, input acknowledgement,
 * a full party, a dropped diver rejoining its own seat, position and air, and the bot buddy giving
 * its seat to a person. `bots/save.ts` checks bagging, the station and the save.
 *
 *   SERVER_URL=ws://127.0.0.1:2567 npx tsx bots/smoke.ts
 */
const url = process.env.SERVER_URL ?? "ws://127.0.0.1:2567";
const party = `SMOKE${Date.now() % 100_000}`;
let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) {
    failed = true;
  }
};

const join = (diver: string, name: string, p = party) => {
  const room = new Client(url).joinOrCreate("dive", { name, party: p, diver });
  return room.then((r) => {
    r.reconnection.enabled = false;
    return r;
  });
};
const dive = (r: Room): DiveView => r.state;
const me = (r: Room) => {
  const d = dive(r).divers.get(r.sessionId);
  if (!d) {
    throw new Error(`diver ${r.sessionId} is not in the dive state`);
  }
  return d;
};

const a = await join("smoke-diver-aaaa", "Bot A");
const b = await join("smoke-diver-bbbb", "Bot B");
const other = await join("smoke-diver-cccc", "Bot C", `${party}X`);
check(a.roomId === b.roomId, "two divers with one party code share a dive");
check(other.roomId !== a.roomId, "another party code gets its own dive");

const third = await join("smoke-diver-dddd", "Bot D")
  .then(() => 0)
  .catch((error) => error.code);
check(
  third === ERROR_DIVE_FULL,
  "a third diver is turned away from a full party"
);

// Divers start at the field station and go in from there.
check(
  me(a).aboard === 1 && me(b).aboard === 1,
  "new divers start at the field station"
);
a.send("dive");
b.send("dive");
await sleep(300);
check(me(a).aboard === 0 && me(b).aboard === 0, "both divers go in the water");

let seq = 0;
const swim = async (left: number): Promise<void> => {
  if (left === 0) {
    return;
  }
  seq += 1;
  a.send("input", { seq, x: 1, y: 0, z: 0 });
  b.send("input", { seq, x: 0, y: 0.5, z: -1 });
  await sleep(1000 / 30);
  await swim(left - 1);
};
await swim(60);
await sleep(300);
check(
  me(a).ack === seq && me(b).ack === seq,
  `server acknowledged every input (ack ${me(a).ack}, ${me(b).ack})`
);
const before = {
  x: me(a).x,
  y: me(a).y,
  z: me(a).z,
  suit: me(a).suit,
  air: me(a).air,
};

// A dropped connection, like a closed laptop lid, then the same tab coming back.
await a.leave(false);
await sleep(300);
check(dive(b).divers.size === 1, "the partner sees the dropped diver leave");
const back = await join("smoke-diver-aaaa", "Bot A");
await sleep(300);
const d = me(back);
check(back.roomId === b.roomId, "the dropped diver rejoins the same dive");
check(
  d.suit === before.suit &&
    Math.hypot(d.x - before.x, d.y - before.y, d.z - before.z) < 1e-3,
  `the dropped diver keeps its suit and position (${d.x.toFixed(2)}, ${d.y.toFixed(2)}, ${d.z.toFixed(2)})`
);
check(
  before.air < 100 && Math.abs(d.air - before.air) < 0.5,
  `the dropped diver keeps its air (${before.air.toFixed(1)} then ${d.air.toFixed(1)})`
);
back.send("input", { seq: 1, x: -1, y: 0, z: 0 });
await sleep(300);
check(me(back).ack === 1, "the rejoined tab can restart its input numbering");

// The same tab joining again before the server noticed the old connection drop takes the seat over.
const replacedCode = Promise.withResolvers<number>();
back.onLeave((code) => replacedCode.resolve(code));
const again = await join("smoke-diver-aaaa", "Bot A");
check(
  (await Promise.race([replacedCode.promise, sleep(2000, -1)])) ===
    CLOSE_REPLACED,
  "a newer connection for the same diver replaces the old one"
);
await sleep(300);
check(
  dive(b).divers.size === 2,
  `the party still has two divers (${dive(b).divers.size})`
);

await Promise.all([again, b, other].map((r) => r.leave()));

// The bot buddy fills an empty second seat and gives it to a person.
const names = (r: Room) =>
  [...dive(r).divers.values()]
    .map((x) => x.name)
    .toSorted()
    .join(", ");
const botParty = `${party}B`;
const solo = await join("smoke-diver-eeee", "Bot E", botParty);
solo.send("buddy");
await sleep(300);
check(
  names(solo) === "Bot E, Buddy (bot)",
  `the bot buddy takes the empty seat (${names(solo)})`
);
const second = await join("smoke-diver-ffff", "Bot F", botParty);
await sleep(300);
check(
  names(solo) === "Bot E, Bot F",
  `a second person takes the bot's seat (${names(solo)})`
);
await second.leave(false);
await sleep(300);
solo.send("buddy");
await sleep(300);
check(
  names(solo) === "Bot E, Buddy (bot)",
  `the bot fills in while the second diver is away (${names(solo)})`
);
const secondBack = await join("smoke-diver-ffff", "Bot F", botParty);
await sleep(300);
check(
  names(solo) === "Bot E, Bot F" && secondBack.roomId === solo.roomId,
  `the returning diver takes the seat back from the bot (${names(solo)})`
);
await Promise.all([solo, secondBack].map((r) => r.leave()));
process.exit(failed ? 1 : 0);
