import { Client, type Room } from '@colyseus/sdk';
import { DT, SERVER_PORT, TICK_RATE } from '../../shared/constants';
import type { Level } from '../../shared/level';
import { createWorld, DiverBody, type RAPIER } from '../../shared/physics';
import type { DiverInput, DiverSim } from '../../shared/protocol';

export interface DiverSnapshot {
  id: string;
  name: string;
  suit: number;
  local: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
}

interface RemoteSample { tick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number }

interface RemoteDiver {
  name: string;
  suit: number;
  samples: RemoteSample[];
}

interface ServerDiver {
  name: string; suit: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; ack: number;
}

interface ServerState {
  serverTick: number;
  divers: { forEach(cb: (d: ServerDiver, id: string) => void): void };
}

/** Remote divers render this many server ticks in the past so there are always two samples to blend. */
const INTERP_DELAY_TICKS = 3;
const MAX_PENDING = 120;

export type NetStatus = 'connecting' | 'online' | 'offline';

/**
 * Client netcode: local prediction with server reconciliation for this player's diver, and
 * snapshot interpolation for the other diver. Falls back to a local-only simulation when the
 * server cannot be reached, so the scene is still explorable.
 */
export class Net {
  status: NetStatus = 'connecting';
  sessionId = 'local';
  localName = '';
  localSuit = 0;
  room?: Room;
  readonly sim: DiverSim;
  /** Visual-only correction that decays to zero so reconciliation never pops. */
  readonly offset = { x: 0, y: 0, z: 0 };
  private world: RAPIER.World;
  private body: DiverBody;
  private seq = 0;
  private pending: DiverInput[] = [];
  private remotes = new Map<string, RemoteDiver>();
  private tickOffset: number | null = null;
  private lastAck = 0;
  private placed = false;
  rtt = 0;
  corrections = 0;

  constructor(private level: Level) {
    this.world = createWorld(level);
    const spawn = level.spawns[0];
    this.sim = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI };
    this.body = new DiverBody(this.world, this.sim);
  }

  async connect(name: string) {
    const params = new URLSearchParams(location.search);
    const url = params.get('server')
      ?? (import.meta.env.DEV ? '/colyseus' : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:${SERVER_PORT}`);
    const client = new Client(url);
    try {
      const room = await Promise.race([
        client.joinOrCreate('dive', { name }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
      this.room = room;
      this.sessionId = room.sessionId;
      this.status = 'online';
      room.onStateChange((state: ServerState) => this.onState(state));
      room.onLeave(() => { this.status = 'offline'; });
    } catch (err) {
      console.warn('[abyssal] server unreachable, diving solo', err);
      this.status = 'offline';
      this.localName = name || 'Diver I';
    }
  }

  /** One fixed step of local input: predicted immediately, sent to the server for authority. */
  step(dir: { x: number; y: number; z: number }) {
    const input: DiverInput = { seq: ++this.seq, x: dir.x, y: dir.y, z: dir.z };
    this.body.step(this.sim, input, DT);
    if (this.status === 'online' && this.room) {
      this.pending.push(input);
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      this.room.send('input', input);
    }
  }

  decayOffset(dt: number) {
    const k = Math.exp(-12 * dt);
    this.offset.x *= k; this.offset.y *= k; this.offset.z *= k;
  }

  private onState(state: ServerState) {
    const now = performance.now() / 1000;
    const est = state.serverTick - now * TICK_RATE;
    if (this.tickOffset === null) this.tickOffset = est;
    else this.tickOffset += (est - this.tickOffset) * (est > this.tickOffset ? 0.2 : 0.02);

    const seen = new Set<string>();
    state.divers.forEach((d, id) => {
      seen.add(id);
      if (id === this.sessionId) {
        this.localName = d.name;
        this.localSuit = d.suit;
        if (!this.placed) {
          this.placed = true;
          Object.assign(this.sim, { x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw });
          this.pending = this.pending.filter((p) => p.seq > d.ack);
          for (const input of this.pending) this.body.step(this.sim, input, DT);
          return;
        }
        if (d.ack > this.lastAck) this.reconcile(d);
        return;
      }
      let r = this.remotes.get(id);
      if (!r) { r = { name: d.name, suit: d.suit, samples: [] }; this.remotes.set(id, r); }
      r.name = d.name; r.suit = d.suit;
      const last = r.samples[r.samples.length - 1];
      if (!last || last.tick !== state.serverTick) {
        r.samples.push({ tick: state.serverTick, x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw });
        if (r.samples.length > 40) r.samples.shift();
      }
    });
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);
  }

  private reconcile(d: ServerDiver) {
    this.lastAck = d.ack;
    const before = { x: this.sim.x, y: this.sim.y, z: this.sim.z };
    Object.assign(this.sim, { x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw });
    this.pending = this.pending.filter((p) => p.seq > d.ack);
    for (const input of this.pending) this.body.step(this.sim, input, DT);
    const ex = before.x - this.sim.x, ey = before.y - this.sim.y, ez = before.z - this.sim.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 1e-4) {
      this.corrections++;
      if (err > 3) { this.offset.x = this.offset.y = this.offset.z = 0; return; }
      this.offset.x += ex; this.offset.y += ey; this.offset.z += ez;
    }
  }

  /** Every diver as it should be drawn this frame. */
  snapshot(): DiverSnapshot[] {
    const out: DiverSnapshot[] = [{
      id: this.sessionId, name: this.localName || 'Diver I', suit: this.localSuit, local: true,
      x: this.sim.x + this.offset.x, y: this.sim.y + this.offset.y, z: this.sim.z + this.offset.z,
      vx: this.sim.vx, vy: this.sim.vy, vz: this.sim.vz, yaw: this.sim.yaw,
    }];
    if (this.tickOffset === null) return out;
    const renderTick = performance.now() / 1000 * TICK_RATE + this.tickOffset - INTERP_DELAY_TICKS;
    for (const [id, r] of this.remotes) {
      const s = r.samples;
      if (!s.length) continue;
      let a = s[0], b = s[0];
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i].tick <= renderTick) { a = s[i]; b = s[Math.min(i + 1, s.length - 1)]; break; }
      }
      const span = b.tick - a.tick;
      let t = span > 0 ? (renderTick - a.tick) / span : 0;
      t = Math.max(0, Math.min(1, t));
      const extra = a === b ? Math.min(0.25, (renderTick - a.tick) / TICK_RATE) : 0;
      let dy = b.yaw - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      out.push({
        id, name: r.name, suit: r.suit, local: false,
        x: a.x + (b.x - a.x) * t + a.vx * extra,
        y: a.y + (b.y - a.y) * t + a.vy * extra,
        z: a.z + (b.z - a.z) * t + a.vz * extra,
        vx: a.vx + (b.vx - a.vx) * t, vy: a.vy + (b.vy - a.vy) * t, vz: a.vz + (b.vz - a.vz) * t,
        yaw: a.yaw + dy * t,
      });
    }
    return out;
  }

  get levelSeed() { return this.level.seed; }
}
