import { Room, ServerError, type Client } from '@colyseus/core';
import { DT, MAX_DIVERS, TICK_RATE } from '../shared/constants';
import { AIR_MAX, Arena, type ArenaDiver } from '../shared/arena';
import { SPECIES } from '../shared/creatures';
import { buildLevel, type Level } from '../shared/level';
import { Haul } from '../shared/loot/haul';
import { stepDiver } from '../shared/physics';
import { BOT_ID, CLOSE_REPLACED, ERROR_DIVE_FULL, sanitizeInput, swimInput, type DiverInput, type DiverSim, type JoinOptions } from '../shared/protocol';
import { canClimb, foundSpots, logTrip, newLog, stationReach, type StationLog, type StationMessage } from '../shared/station';
import { buddyInput } from './buddy';
import { loadLog, writeLog } from './save';
import { CreatureState, DiveState, DiverState, LootState } from './schema';

interface Seat {
  diver: string;
  sim: DiverSim;
  /** The diver's fight state. It is in the arena only while the diver is in the water. */
  fight: ArenaDiver;
  queue: DiverInput[];
  lastSeq: number;
  /** Out of the water at the field station. */
  aboard: boolean;
}

const MAX_INPUTS_PER_TICK = 4;
const MAX_QUEUE = 20;
/** How long a dropped diver's seat and position wait for the same tab to come back. */
const AWAY_MS = 15 * 60 * 1000;

interface AwaySeat {
  /** The diver's seat, with its fight state and bag, while its tab is away. */
  seat: Seat;
  name: string;
  suit: number;
  expires: { clear(): void };
}

/** The tab's own id when it sent a usable one, so a reload or a dropped connection finds its seat again. */
function diverKey(client: Client, options: JoinOptions) {
  const id = options.diver;
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : `session:${client.sessionId}`;
}

export class DiveRoom extends Room {
  // Extra connections let a returning tab in before the server notices its old connection dropped;
  // onAuth enforces MAX_DIVERS. A locked room would make matchmaking open a second room for the party.
  maxClients = MAX_DIVERS * 2;
  autoDispose = false;
  declare state: DiveState;
  private level!: Level;
  private arena!: Arena;
  private haul!: Haul;
  private log!: StationLog;
  /** Whether this party's log goes to disk; not without a usable party code. */
  private saving = false;
  private seats = new Map<string, Seat>();
  private away = new Map<string, AwaySeat>();

  onCreate(options: JoinOptions = {}) {
    this.state = new DiveState();
    this.level = buildLevel(7);
    this.arena = new Arena(this.level);
    const party = typeof options.party === 'string' && /^[A-Z0-9]{1,12}$/.test(options.party) ? options.party : '';
    this.saving = !!party;
    this.log = party ? loadLog(party) : newLog('');
    this.haul = new Haul(this.level, foundSpots(this.log));
    this.arena.reach = () => [...this.haul.reachable(), stationReach(this.level)];
    for (const l of this.haul.loot) this.state.loot.set(l.id, Object.assign(new LootState(), { item: l.item }));
    this.state.seed = this.level.seed;
    this.state.serverTick = 0;
    for (const c of this.arena.creatures) {
      const s = new CreatureState();
      s.kind = c.kind;
      this.state.creatures.set(c.id, s);
    }
    this.setPatchRate(1000 / TICK_RATE);
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
    // The room outlives its last connection while dropped divers may return.
    this.clock.setInterval(() => { if (!this.clients.length && !this.away.size) this.disconnect(); }, 60_000);

    this.onMessage('input', (client: Client, raw: unknown) => {
      const seat = this.seats.get(client.sessionId);
      const input = sanitizeInput(raw);
      if (!seat || !input || input.seq <= seat.lastSeq) return;
      seat.lastSeq = input.seq;
      seat.queue.push(input);
      if (seat.queue.length > MAX_QUEUE) seat.queue.splice(0, seat.queue.length - MAX_QUEUE);
    });
    this.onMessage('climb', (client: Client) => {
      const seat = this.seats.get(client.sessionId);
      if (seat && !seat.aboard && !seat.fight.down && canClimb(this.level, seat.sim)) this.climb(client.sessionId);
    });
    this.onMessage('dive', (client: Client) => {
      if (this.seats.get(client.sessionId)?.aboard) this.dive(client.sessionId);
    });
    this.onMessage('buddy', () => {
      if (this.state.divers.has(BOT_ID)) this.removeDiver(BOT_ID);
      else if (this.state.divers.size < MAX_DIVERS) this.addDiver(BOT_ID, BOT_ID, 'Buddy (bot)');
    });
  }

  onAuth(client: Client, options: JoinOptions = {}) {
    const diver = diverKey(client, options);
    // The bot's seat goes to a person, so it does not count here.
    const others = [...this.seats.values()].filter((s) => s.diver !== diver && s.diver !== BOT_ID).length;
    if (others >= MAX_DIVERS) throw new ServerError(ERROR_DIVE_FULL, 'This dive already has two divers.');
    return true;
  }

  onJoin(client: Client, options: JoinOptions = {}) {
    const diver = diverKey(client, options);
    const held = [...this.seats].find(([, seat]) => seat.diver === diver);
    if (held) {
      const [id, seat] = held;
      const old = this.state.divers.get(id)!;
      this.seats.delete(id);
      this.arena.removeDiver(id);
      this.state.divers.delete(id);
      this.sit(client.sessionId, seat, old.name, old.suit, 'came back');
      this.clients.get(id)?.leave(CLOSE_REPLACED);
    } else if (this.away.has(diver)) {
      const away = this.away.get(diver)!;
      away.expires.clear();
      this.away.delete(diver);
      this.freeBotSeat();
      this.sit(client.sessionId, away.seat, away.name, away.suit, 'came back');
    } else {
      // A held seat gives way to a new diver once the party would otherwise be full.
      const people = [...this.seats.values()].filter((s) => s.diver !== BOT_ID).length;
      if (people + this.away.size >= MAX_DIVERS) this.release(this.away.keys().next().value!);
      this.freeBotSeat();
      this.addDiver(client.sessionId, diver, String(options.name ?? '').slice(0, 24));
    }
    client.send('station', { log: this.log } satisfies StationMessage);
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    const seat = this.seats.get(id);
    const d = this.state.divers.get(id);
    // A connection replaced by its own diver's newer one has already handed its seat over.
    if (!seat || !d) return;
    this.seats.delete(id);
    this.arena.removeDiver(id);
    this.state.divers.delete(id);
    const expires = this.clock.setTimeout(() => this.release(seat.diver), AWAY_MS);
    this.away.set(seat.diver, { seat, name: d.name, suit: d.suit, expires });
    console.log(`[dive ${this.roomId}] ${d.name} dropped; holding the seat for ${AWAY_MS / 60000} min`);
  }

  /** A person arriving takes the seat from the bot when the party would otherwise be over two. */
  private freeBotSeat() {
    if (this.seats.size >= MAX_DIVERS && this.seats.has(BOT_ID)) this.removeDiver(BOT_ID);
  }

  private addDiver(id: string, diver: string, name: string) {
    const used = new Set([...this.state.divers.values(), ...this.away.values()].map((d) => d.suit));
    const suit = used.has(0) ? 1 : 0;
    const spawn = this.level.spawns[suit];
    const sim: DiverSim = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI };
    this.arena.addDiver(id, sim, spawn);
    const fight = this.arena.divers.get(id)!;
    // The bot shoots at a third of a person's rate, so it helps with the drone without winning the fight alone.
    if (id === BOT_ID) fight.reloadTime = 1.6;
    // People start the evening at the station, with yesterday's finds on the shelf; the bot starts wherever they are.
    const aboard = id === BOT_ID ? [...this.seats.values()].every((s) => s.aboard) : true;
    this.sit(id, { diver, sim, fight, queue: [], lastSeq: 0, aboard }, name || (suit === 0 ? 'Diver I' : 'Diver II'), suit, 'joined');
  }

  private sit(id: string, seat: Seat, name: string, suit: number, verb: string) {
    // The tab may have reloaded and restarted its input numbering.
    seat.queue = [];
    seat.lastSeq = 0;
    seat.fight.id = id;
    if (seat.aboard) this.arena.removeDiver(id);
    else this.arena.divers.set(id, seat.fight);
    this.haul.join(seat.fight, name);
    const d = new DiverState();
    d.name = name;
    d.suit = suit;
    this.seats.set(id, seat);
    this.write(d, seat, 0);
    this.state.divers.set(id, d);
    console.log(`[dive ${this.roomId}] ${name} ${verb} (${this.seats.size}/${MAX_DIVERS})`);
  }

  private removeDiver(id: string) {
    console.log(`[dive ${this.roomId}] ${this.state.divers.get(id)?.name ?? id} left`);
    const seat = this.seats.get(id);
    if (seat) this.haul.leave(seat.fight);
    this.seats.delete(id);
    this.arena.removeDiver(id);
    this.state.divers.delete(id);
  }

  private release(diver: string) {
    const away = this.away.get(diver);
    if (!away) return;
    away.expires.clear();
    this.away.delete(diver);
    this.haul.leave(away.seat.fight);
  }

  /** The diver climbs out at the station: its bag is logged and saved, and it leaves the water. */
  private climb(id: string) {
    const seat = this.seats.get(id)!;
    const name = this.state.divers.get(id)?.name ?? '';
    const bag = this.haul.unload(seat.fight).map((c) => ({ item: c.loot.item, spot: c.loot.id, by: c.by }));
    // An empty bag leaves the log as it was.
    const fresh = bag.length ? logTrip(this.log, bag) : [];
    seat.aboard = true;
    this.arena.removeDiver(id);
    Object.assign(seat.fight, { air: AIR_MAX, down: false, revive: 0, act: false, target: null });
    Object.assign(seat.sim, { vx: 0, vy: 0, vz: 0 });
    this.arena.fx.push({ k: 'aboard', id, n: fresh.length });
    const msg: StationMessage = { log: this.log, fresh, by: id };
    if (fresh.length && !this.saving) msg.error = 'No party code, so this log is not saved.';
    else if (fresh.length) {
      try {
        writeLog(this.log);
        msg.savedAt = Date.now();
      } catch (err) {
        msg.error = `Could not save: ${(err as Error).message}`;
        console.error(`[dive ${this.roomId}] ${msg.error}`);
      }
    }
    this.broadcast('station', msg);
    console.log(`[dive ${this.roomId}] ${name} climbed out and logged ${fresh.length} find(s)${msg.savedAt ? ', saved' : ''}`);
  }

  /** The diver goes back in at its spawn below the station, with full air. */
  private dive(id: string) {
    const seat = this.seats.get(id)!;
    const d = this.state.divers.get(id);
    const spawn = this.level.spawns[d?.suit ?? 0];
    seat.aboard = false;
    Object.assign(seat.sim, { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI });
    Object.assign(seat.fight, { air: AIR_MAX, down: false, revive: 0, reload: 0, act: false, target: null });
    this.arena.divers.set(id, seat.fight);
    this.arena.fx.push({ k: 'dived', id });
  }

  private tick() {
    this.state.serverTick += 1;
    for (const [id, seat] of this.seats) {
      const d = this.state.divers.get(id);
      if (!d) continue;
      const a = seat.fight;
      if (id === BOT_ID) {
        // The bot climbs out and dives with the person it follows.
        const lead = [...this.seats.values()].find((s) => s !== seat);
        if (lead && seat.aboard && !lead.aboard) this.dive(id);
        else if (lead?.aboard && !seat.aboard && !a.down && canClimb(this.level, seat.sim)) this.climb(id);
        if (seat.aboard) continue;
        const input = { seq: d.ack + 1, ...buddyInput(this.arena, a, { leadAboard: !!lead?.aboard, station: this.level.station, loot: this.haul.loot }) };
        stepDiver(this.level, seat.sim, swimInput(input, a.down), DT);
        a.act = !!input.act;
        d.ack = input.seq;
        continue;
      }
      const batch = seat.queue.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        // A diver at the station stays put, but its inputs are still acknowledged.
        if (!seat.aboard) stepDiver(this.level, seat.sim, swimInput(input, a.down), DT);
        a.act = !seat.aboard && !!input.act;
        d.ack = input.seq;
      }
    }
    this.arena.tick(DT);
    this.haul.tick(this.arena.divers.values(), DT);
    for (const f of this.arena.fx) {
      if (f.k === 'wiped') for (const a of this.arena.divers.values()) this.haul.giveBack(a);
      else if (f.k === 'reset') this.haul.restock();
      else if (f.k === 'calmed' || f.k === 'wrecked') {
        const c = this.arena.creatures.find((x) => x.id === f.id);
        const drops = c && SPECIES[c.kind].drops;
        if (c && drops) this.haul.drop(drops, { x: c.x, y: c.y, z: c.z });
      }
    }
    this.arena.fx.push(...this.haul.fx);
    this.haul.fx = [];
    for (const [id, seat] of this.seats) {
      const d = this.state.divers.get(id);
      if (d) this.write(d, seat, d.ack);
    }
    for (const l of this.haul.loot) {
      let s = this.state.loot.get(l.id);
      if (!s) { s = Object.assign(new LootState(), { item: l.item }); this.state.loot.set(l.id, s); }
      s.x = l.x; s.y = l.y; s.z = l.z; s.state = l.state; s.work = l.work; s.hands = l.hands;
    }
    for (const c of this.arena.creatures) {
      const s = this.state.creatures.get(c.id)!;
      s.x = c.x; s.y = c.y; s.z = c.z; s.yaw = c.yaw; s.pitch = c.pitch;
      s.mode = c.mode; s.meter = c.meter; s.charge = c.charge;
    }
    this.state.phase = this.arena.phase;
    this.state.phaseTime = this.arena.phaseTime;
    this.state.clock = this.arena.clock;
    if (this.arena.fx.length) {
      this.broadcast('fx', this.arena.fx);
      this.arena.fx = [];
    }
  }

  private write(d: DiverState, seat: Seat, ack: number) {
    const s = seat.sim, a = seat.fight;
    d.x = s.x; d.y = s.y; d.z = s.z;
    d.vx = s.vx; d.vy = s.vy; d.vz = s.vz;
    d.yaw = s.yaw; d.ack = ack;
    d.air = a.air; d.down = a.down ? 1 : 0; d.revive = a.revive;
    d.aboard = seat.aboard ? 1 : 0;
    const bag = this.haul.bag(a);
    if ([...d.bag].join() !== bag.join()) { d.bag.clear(); d.bag.push(...bag); }
  }
}
