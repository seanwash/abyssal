import { Room, ServerError, type Client } from '@colyseus/core';
import { DT, MAX_DIVERS, TICK_RATE } from '../shared/constants';
import { Arena, type ArenaDiver } from '../shared/arena';
import { buildLevel, type Level } from '../shared/level';
import { stepDiver } from '../shared/physics';
import { CLOSE_REPLACED, ERROR_DIVE_FULL, sanitizeInput, swimInput, type DiverInput, type DiverSim, type JoinOptions } from '../shared/protocol';
import { buddyInput } from './buddy';
import { CreatureState, DiveState, DiverState } from './schema';

interface Seat {
  diver: string;
  sim: DiverSim;
  queue: DiverInput[];
  lastSeq: number;
}

const MAX_INPUTS_PER_TICK = 4;
const MAX_QUEUE = 20;
const BOT_ID = 'buddy-bot';
/** How long a dropped diver's seat and position wait for the same tab to come back. */
const AWAY_MS = 15 * 60 * 1000;

interface AwaySeat {
  seat: Seat;
  /** The diver's fight state (air, down, revive), out of the arena while its tab is away. */
  fight: ArenaDiver;
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
  private seats = new Map<string, Seat>();
  private away = new Map<string, AwaySeat>();

  onCreate() {
    this.state = new DiveState();
    this.level = buildLevel(7);
    this.arena = new Arena(this.level);
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
    for (const [id, seat] of this.seats) {
      if (seat.diver !== diver) continue;
      const old = this.state.divers.get(id)!;
      const fight = this.arena.divers.get(id)!;
      this.seats.delete(id);
      this.arena.removeDiver(id);
      this.state.divers.delete(id);
      this.sit(client.sessionId, seat, fight, old.name, old.suit, 'came back');
      this.clients.get(id)?.leave(CLOSE_REPLACED);
      return;
    }
    const away = this.away.get(diver);
    if (away) {
      away.expires.clear();
      this.away.delete(diver);
      this.freeBotSeat();
      this.sit(client.sessionId, away.seat, away.fight, away.name, away.suit, 'came back');
      return;
    }
    // A held seat gives way to a new diver once the party would otherwise be full.
    const people = [...this.seats.values()].filter((s) => s.diver !== BOT_ID).length;
    if (people + this.away.size >= MAX_DIVERS) this.release(this.away.keys().next().value!);
    this.freeBotSeat();
    this.addDiver(client.sessionId, diver, String(options.name ?? '').slice(0, 24));
  }

  onLeave(client: Client) {
    const id = client.sessionId;
    const seat = this.seats.get(id);
    const d = this.state.divers.get(id);
    const fight = this.arena.divers.get(id);
    // A connection replaced by its own diver's newer one has already handed its seat over.
    if (!seat || !d || !fight) return;
    this.seats.delete(id);
    this.arena.removeDiver(id);
    this.state.divers.delete(id);
    const expires = this.clock.setTimeout(() => this.release(seat.diver), AWAY_MS);
    this.away.set(seat.diver, { seat, fight, name: d.name, suit: d.suit, expires });
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
    this.sit(id, { diver, sim, queue: [], lastSeq: 0 }, fight, name || (suit === 0 ? 'Diver I' : 'Diver II'), suit, 'joined');
  }

  private sit(id: string, seat: Seat, fight: ArenaDiver, name: string, suit: number, verb: string) {
    // The tab may have reloaded and restarted its input numbering.
    seat.queue = [];
    seat.lastSeq = 0;
    fight.id = id;
    this.arena.divers.set(id, fight);
    const d = new DiverState();
    d.name = name;
    d.suit = suit;
    this.write(d, fight, 0);
    this.seats.set(id, seat);
    this.state.divers.set(id, d);
    console.log(`[dive ${this.roomId}] ${name} ${verb} (${this.seats.size}/${MAX_DIVERS})`);
  }

  private removeDiver(id: string) {
    console.log(`[dive ${this.roomId}] ${this.state.divers.get(id)?.name ?? id} left`);
    this.seats.delete(id);
    this.arena.removeDiver(id);
    this.state.divers.delete(id);
  }

  private release(diver: string) {
    const away = this.away.get(diver);
    if (!away) return;
    away.expires.clear();
    this.away.delete(diver);
  }

  private tick() {
    this.state.serverTick += 1;
    for (const [id, seat] of this.seats) {
      const d = this.state.divers.get(id);
      const a = this.arena.divers.get(id);
      if (!d || !a) continue;
      if (id === BOT_ID) {
        const input = { seq: d.ack + 1, ...buddyInput(this.arena, a) };
        stepDiver(this.level, seat.sim, swimInput(input, a.down), DT);
        a.act = !!input.act;
        d.ack = input.seq;
        continue;
      }
      const batch = seat.queue.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        stepDiver(this.level, seat.sim, swimInput(input, a.down), DT);
        a.act = !!input.act;
        d.ack = input.seq;
      }
    }
    this.arena.tick(DT);
    for (const [id, a] of this.arena.divers) {
      const d = this.state.divers.get(id);
      if (d) this.write(d, a, d.ack);
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

  private write(d: DiverState, a: ArenaDiver, ack: number) {
    const s = a.sim;
    d.x = s.x; d.y = s.y; d.z = s.z;
    d.vx = s.vx; d.vy = s.vy; d.vz = s.vz;
    d.yaw = s.yaw; d.ack = ack;
    d.air = a.air; d.down = a.down ? 1 : 0; d.revive = a.revive;
  }
}
