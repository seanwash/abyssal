import { Room, type Client } from '@colyseus/core';
import { DT, MAX_DIVERS, TICK_RATE } from '../shared/constants';
import { Arena, type ArenaDiver } from '../shared/arena';
import { buildLevel, type Level } from '../shared/level';
import { stepDiver } from '../shared/physics';
import { sanitizeInput, swimInput, type DiverInput, type DiverSim } from '../shared/protocol';
import { buddyInput } from './buddy';
import { CreatureState, DiveState, DiverState } from './schema';

interface Seat {
  sim: DiverSim;
  queue: DiverInput[];
  lastSeq: number;
}

const MAX_INPUTS_PER_TICK = 4;
const MAX_QUEUE = 20;
const BOT_ID = 'buddy-bot';

export class DiveRoom extends Room {
  maxClients = MAX_DIVERS;
  declare state: DiveState;
  private level!: Level;
  private arena!: Arena;
  private seats = new Map<string, Seat>();

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
      else if (this.state.divers.size < MAX_DIVERS) this.addDiver(BOT_ID, 'Buddy (bot)');
    });
  }

  onJoin(client: Client, options: { name?: string } = {}) {
    // A second person takes the seat from the bot.
    if (this.state.divers.has(BOT_ID)) this.removeDiver(BOT_ID);
    this.addDiver(client.sessionId, String(options.name ?? '').slice(0, 24));
  }

  onLeave(client: Client) {
    this.removeDiver(client.sessionId);
  }

  private addDiver(id: string, name: string) {
    const used = new Set([...this.state.divers.values()].map((d) => d.suit));
    const suit = used.has(0) ? 1 : 0;
    const spawn = this.level.spawns[suit];
    const sim: DiverSim = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI };
    const d = new DiverState();
    d.name = name || (suit === 0 ? 'Diver I' : 'Diver II');
    d.suit = suit;
    this.seats.set(id, { sim, queue: [], lastSeq: 0 });
    this.arena.addDiver(id, sim, spawn);
    // The bot shoots at a third of a person's rate, so it helps with the drone without winning the fight alone.
    if (id === BOT_ID) this.arena.divers.get(id)!.reloadTime = 1.6;
    this.write(d, this.arena.divers.get(id)!, 0);
    this.state.divers.set(id, d);
    console.log(`[dive ${this.roomId}] ${d.name} joined (${this.state.divers.size}/${MAX_DIVERS})`);
  }

  private removeDiver(id: string) {
    console.log(`[dive ${this.roomId}] ${this.state.divers.get(id)?.name ?? id} left`);
    this.seats.delete(id);
    this.arena.removeDiver(id);
    this.state.divers.delete(id);
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
