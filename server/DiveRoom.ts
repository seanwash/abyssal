import { Room, type Client } from '@colyseus/core';
import { DT, MAX_DIVERS, TICK_RATE } from '../shared/constants';
import { buildLevel, type Level } from '../shared/level';
import { createWorld, DiverBody, RAPIER } from '../shared/physics';
import { sanitizeInput, type DiverInput, type DiverSim } from '../shared/protocol';
import { DiveState, DiverState } from './schema';

interface Seat {
  sim: DiverSim;
  body: DiverBody;
  queue: DiverInput[];
  lastSeq: number;
}

const MAX_INPUTS_PER_TICK = 4;
const MAX_QUEUE = 20;

export class DiveRoom extends Room {
  maxClients = MAX_DIVERS;
  declare state: DiveState;
  private level!: Level;
  private world!: RAPIER.World;
  private seats = new Map<string, Seat>();

  onCreate() {
    this.state = new DiveState();
    this.level = buildLevel(7);
    this.state.seed = this.level.seed;
    this.state.serverTick = 0;
    this.world = createWorld(this.level);
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
  }

  onJoin(client: Client, options: { name?: string } = {}) {
    const used = new Set([...this.state.divers.values()].map((d) => d.suit));
    const suit = used.has(0) ? 1 : 0;
    const spawn = this.level.spawns[suit];
    const sim: DiverSim = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI };
    const d = new DiverState();
    d.name = String(options.name ?? '').slice(0, 24) || (suit === 0 ? 'Diver I' : 'Diver II');
    d.suit = suit;
    this.seats.set(client.sessionId, { sim, body: new DiverBody(this.world, sim), queue: [], lastSeq: 0 });
    this.write(d, sim, 0);
    this.state.divers.set(client.sessionId, d);
    console.log(`[dive ${this.roomId}] ${d.name} joined (${this.clients.length}/${this.maxClients})`);
  }

  onLeave(client: Client) {
    console.log(`[dive ${this.roomId}] ${this.state.divers.get(client.sessionId)?.name ?? client.sessionId} left`);
    this.seats.get(client.sessionId)?.body.dispose();
    this.seats.delete(client.sessionId);
    this.state.divers.delete(client.sessionId);
  }

  private tick() {
    this.state.serverTick += 1;
    for (const [id, seat] of this.seats) {
      const d = this.state.divers.get(id);
      if (!d) continue;
      const batch = seat.queue.splice(0, MAX_INPUTS_PER_TICK);
      for (const input of batch) {
        seat.body.step(seat.sim, input, DT);
        d.ack = input.seq;
      }
      this.write(d, seat.sim, d.ack);
    }
  }

  private write(d: DiverState, s: DiverSim, ack: number) {
    d.x = s.x; d.y = s.y; d.z = s.z;
    d.vx = s.vx; d.vy = s.vy; d.vz = s.vz;
    d.yaw = s.yaw; d.ack = ack;
  }
}
