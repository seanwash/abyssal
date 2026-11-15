import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildLevel } from '../shared/level';
import type { Point } from '../shared/level';
import type { StationMessage } from '../shared/station';

/** The parts of a diver's synced state this script reads. */
interface DiverView { name: string; x: number; y: number; z: number; aboard: number; bag: Iterable<string> }
/** The parts of a loot spot's synced state this script reads. */
interface LootView { state: number; work: number; hands: number }
/** The parts of the dive's synced state this script reads. */
interface DiveView {
  divers: { get: (id: string) => DiverView | undefined; values: () => Iterable<DiverView> };
  loot: { get: (id: string) => LootView | undefined };
}

/**
 * Checks bagging, the field station and the save against the built server, the way an Amp Box
 * runs it: each release is a read-only copy of build/ and dist/, and saves go in
 * AMP_DEPLOYMENT_DATA_DIRECTORY. One diver bags a specimen, pries a fossil free with the bot
 * buddy, and climbs out to log both. The server then stops, a second release starts as a deploy
 * would, and the same party comes back to find both on the shelf and the fossil gone from the reef.
 *
 *   npm run build && npx tsx bots/save.ts
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 2600 + (Date.now() % 300);
const url = `ws://127.0.0.1:${PORT}`;
const work = mkdtempSync(path.join(tmpdir(), 'abyssal-save-'));
const data = path.join(work, 'data');
const party = `SAVE${Date.now() % 100_000}`;
const level = buildLevel(7);
const spot = (id: string) => {
  const s = level.loot.find((l) => l.id === id);
  if (!s) {throw new Error(`no loot spot ${id} in the level`);}
  return s.at;
};
let failed = false;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) {failed = true;} };

/** Copies the build into its own read-only folder, like a Box release, and starts it. */
const release = async (name: string) => {
  const dir = path.join(work, name);
  for (const d of ['build', 'dist']) {cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });}
  chmodSync(dir, 0o555);
  const server = spawn('node', [path.join(dir, 'build/server.mjs')], {
    cwd: dir, env: { ...process.env, PORT: String(PORT), AMP_DEPLOYMENT_DATA_DIRECTORY: data }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const { stdout } = server;
  if (!stdout) {throw new Error(`${name} has no stdout pipe`);}
  stdout.on('data', (b) => process.stdout.write(`    [${name}] ${b}`));
  const listening = Promise.withResolvers<undefined>();
  stdout.on('data', (b) => { if (String(b).includes('listening')) {listening.resolve(undefined);} });
  server.once('exit', (code) => listening.reject(new Error(`server exited with ${code}`)));
  await listening.promise;
  return server;
};

const stop = async (server: ChildProcess) => {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
};

class Diver {
  seq = 0;
  station: StationMessage[] = [];
  fx: { k: string; item?: string; by?: string }[] = [];
  readonly room: Room;
  private constructor(room: Room) {
    this.room = room;
    room.onMessage('station', (m: StationMessage) => this.station.push(m));
    room.onMessage('fx', (list: { k: string }[]) => this.fx.push(...list));
  }

  static async join(name: string, p = party) {
    const room = await new Client(url).joinOrCreate('dive', { name, party: p, diver: `save-${name.toLowerCase()}-diver` });
    room.reconnection.enabled = false;
    const d = new Diver(room);
    await sleep(400);
    return d;
  }

  get dive(): DiveView { return this.room.state; }
  get me() {
    const d = this.dive.divers.get(this.room.sessionId);
    if (!d) {throw new Error(`diver ${this.room.sessionId} is not in the dive state`);}
    return d;
  }
  loot(id: string) {
    const l = this.dive.loot.get(id);
    if (!l) {throw new Error(`loot ${id} is not in the dive state`);}
    return l;
  }

  private send(x: number, y: number, z: number, act: boolean) {
    this.seq += 1;
    this.room.send('input', { seq: this.seq, x, y, z, act: act ? 1 : 0 });
  }

  /** Swims straight for `goal` until within `within` metres. */
  swimTo(goal: Point, within = 0.5, ms = 25_000) {
    const end = Date.now() + ms;
    const step = async (): Promise<boolean> => {
      if (Date.now() >= end) {return false;}
      const m = this.me;
      const dx = goal.x - m.x; const dy = goal.y - m.y; const dz = goal.z - m.z;
      if (Math.hypot(dx, dy, dz) < within) {return true;}
      const l = Math.hypot(dx, dz);
      const k = l > 1e-3 ? Math.min(1, l / 1.2) / l : 0;
      this.send(dx * k, Math.max(-1, Math.min(1, dy * 1.5)), dz * k, false);
      await sleep(1000 / 30);
      return step();
    };
    return step();
  }

  /** Holds the action key in place until `done` or the time runs out. */
  async hold(done: () => boolean, ms: number) {
    const end = Date.now() + ms;
    const step = async (): Promise<void> => {
      if (Date.now() >= end || done()) {return;}
      this.send(0, 0, 0, true);
      await sleep(1000 / 30);
      await step();
    };
    await step();
    this.send(0, 0, 0, false);
    return done();
  }
}

const first = await release('release-1');
const a = await Diver.join('Sean');
check(a.me.aboard === 1, 'a new party starts at the field station');
check(a.station.length === 1 && a.station[0].log.finds.length === 0, 'with an empty log');

a.room.send('dive');
await sleep(300);
check(a.me.aboard === 0, 'the diver goes in the water');

// The first find lies on open sand near the line.
const urchin = spot('urchin-flat');
await a.swimTo({ x: urchin.x - 0.6, y: urchin.y + 0.55, z: urchin.z }, 0.45);
const bagged = await a.hold(() => [...a.me.bag].includes('urchin-test'), 3000);
check(bagged && a.loot('urchin-flat').state === 1, `the diver bags the purple urchin test (bag: ${[...a.me.bag].join(', ')})`);

// A fossil at the bottom of a crevice needs two divers: the bot buddy comes to help.
const shells = spot('shells-crevice');
await a.swimTo({ x: 8, y: -2.5, z: 9 }, 1.2);
await a.swimTo({ x: shells.x, y: -2.5, z: shells.z }, 1);
await a.swimTo({ x: shells.x, y: shells.y + 0.5, z: shells.z }, 0.5);
await a.hold(() => false, 3000);
const lone = a.loot('shells-crevice');
check(lone.state === 0 && lone.work === 0 && lone.hands === 1, `one diver alone cannot pry a fossil (hands ${lone.hands}, progress ${lone.work})`);
a.room.send('buddy');
const pried = await a.hold(() => [...a.me.bag].includes('capitola-shells'), 20_000);
check(pried, `the bot buddy helps pry the Capitola shells free, and they go in the bag of the diver who started (bag: ${[...a.me.bag].join(', ')})`);
check(a.fx.some((f) => f.k === 'pried' && f.item === 'capitola-shells'), 'prying it free is announced to the clients');

// Climbing out at the line logs the bag and saves it.
await a.swimTo({ x: level.station.x + 0.5, y: -0.9, z: level.station.z }, 0.8);
a.room.send('climb');
await sleep(500);
const logged = a.station.at(-1);
if (!logged) {throw new Error('the server sent no station message');}
check(a.me.aboard === 1, 'the diver climbs out at the station');
check(logged.fresh?.map((f) => f.item).toSorted().join(",") === 'capitola-shells,urchin-test', `the climb-out logs both finds (${logged.fresh?.map((f) => f.item).join(', ')})`);
check(!!logged.savedAt && !logged.error, `the log is saved (${logged.error ?? 'no error'})`);
check(logged.fresh?.find((f) => f.item === 'capitola-shells')?.by.join(' & ') === 'Sean & Buddy (bot)', 'the fossil is logged as found by both divers');
const file = path.join(data, 'saves', `${party}.json`);
check(existsSync(file) && JSON.parse(readFileSync(file, 'utf-8')).finds.length === 2, `the save is in the deployment's data directory (${path.relative(work, file)})`);
check(!readdirSync(path.dirname(file)).some((f) => f.endsWith('.tmp')), 'no half-written file is left behind');
const bot = () => [...a.dive.divers.values()].find((d) => d.name === 'Buddy (bot)');
const waitForBot = async (tries: number): Promise<void> => {
  if (tries >= 60 || bot()?.aboard) {return;}
  await sleep(250);
  await waitForBot(tries + 1);
};
await waitForBot(0);
const last = a.station.at(-1);
check(bot()?.aboard === 1 && last?.log.finds.length === 2 && last.log.trips === 1, 'the bot follows the diver out at the line, and its empty bag leaves the log as it was');

// The evening ends: the server stops, and the next day a new release starts.
await a.room.leave();
await stop(first);
const second = await release('release-2');
const back = await Diver.join('Sean');
const log = back.station[0]?.log;
check(back.me.aboard === 1, 'the next day the diver starts at the station');
check(log?.finds.map((f) => f.item).toSorted().join(",") === 'capitola-shells,urchin-test' && log.trips === 1, `the shelf still has both finds after the restart (${log?.finds.map((f) => f.item).join(', ')})`);
check(back.loot('shells-crevice').state === 2, 'the logged fossil is gone from its crevice for good');
check(back.loot('urchin-flat').state === 0, 'specimens are back on the reef for the new dive');
await back.room.leave();

// A save that cannot be read is set aside rather than overwritten.
const broken = `BROKEN${Date.now() % 1000}`;
writeFileSync(path.join(data, 'saves', `${broken}.json`), '{"version":1,');
const fresh = await Diver.join('Sean', broken);
check(fresh.station[0]?.log.finds.length === 0, 'a party whose save is unreadable starts a new log');
check(readdirSync(path.join(data, 'saves')).some((f) => f.startsWith(`${broken}.json.unreadable-`)), 'and the unreadable file is kept beside it');
await fresh.room.leave();

await stop(second);
console.log(`work folder: ${work}`);
process.exit(failed ? 1 : 0);
