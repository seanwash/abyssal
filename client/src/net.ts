import { Client, type Room } from '@colyseus/sdk';
import { DT, SERVER_PORT, TICK_RATE } from '../../shared/constants';
import type { CreatureKind, Fx } from '../../shared/arena';
import type { Level } from '../../shared/level';
import { stepDiver } from '../../shared/physics';
import { swimInput, type DiverInput, type DiverSim } from '../../shared/protocol';

export interface DiverSnapshot {
  id: string;
  name: string;
  suit: number;
  local: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  air: number;
  down: boolean;
  revive: number;
}

export interface CreatureSnapshot {
  id: string;
  kind: CreatureKind;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  mode: number; meter: number; charge: number;
}

interface Sample { tick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number }

interface RemoteDiver {
  name: string;
  suit: number;
  air: number;
  down: boolean;
  revive: number;
  samples: Sample[];
}

interface RemoteCreature { kind: CreatureKind; mode: number; meter: number; charge: number; samples: Sample[] }

interface ServerDiver {
  name: string; suit: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; ack: number;
  air: number; down: number; revive: number;
}

interface ServerCreature { kind: string; x: number; y: number; z: number; yaw: number; pitch: number; mode: number; meter: number; charge: number }

interface ServerState {
  serverTick: number;
  phase: number;
  phaseTime: number;
  clock: number;
  divers: { forEach(cb: (d: ServerDiver, id: string) => void): void };
  creatures?: { forEach(cb: (c: ServerCreature, id: string) => void): void };
}

/** Remote divers and creatures render this many server ticks in the past so there are always two samples to blend. */
const INTERP_DELAY_TICKS = 3;
const MAX_PENDING = 120;

export type NetStatus = 'connecting' | 'online' | 'offline';

function pushSample(samples: Sample[], s: Sample) {
  const last = samples[samples.length - 1];
  if (last && last.tick === s.tick) return;
  samples.push(s);
  if (samples.length > 40) samples.shift();
}

/** The sample at `renderTick`, blended between the two server samples around it and extrapolated briefly past the last. */
function sampleAt(s: Sample[], renderTick: number) {
  let a = s[0], b = s[0];
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i].tick <= renderTick) { a = s[i]; b = s[Math.min(i + 1, s.length - 1)]; break; }
  }
  const span = b.tick - a.tick;
  const t = Math.max(0, Math.min(1, span > 0 ? (renderTick - a.tick) / span : 0));
  const extra = a === b ? Math.max(0, Math.min(0.25, (renderTick - a.tick) / TICK_RATE)) : 0;
  const turn = (p: number, q: number) => p + Math.atan2(Math.sin(q - p), Math.cos(q - p)) * t;
  return {
    x: a.x + (b.x - a.x) * t + a.vx * extra,
    y: a.y + (b.y - a.y) * t + a.vy * extra,
    z: a.z + (b.z - a.z) * t + a.vz * extra,
    vx: a.vx + (b.vx - a.vx) * t, vy: a.vy + (b.vy - a.vy) * t, vz: a.vz + (b.vz - a.vz) * t,
    yaw: turn(a.yaw, b.yaw), pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
}

/**
 * Client netcode: local prediction with server reconciliation for this player's diver, and
 * snapshot interpolation for the other diver and the creatures. Falls back to a local-only
 * simulation when the server cannot be reached, so the scene is still explorable.
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
  /** Local position before the latest fixed step, blended with `sim` so motion is smooth between ticks. */
  private prev = { x: 0, y: 0, z: 0 };
  private seq = 0;
  private pending: DiverInput[] = [];
  private remotes = new Map<string, RemoteDiver>();
  private creatures = new Map<string, RemoteCreature>();
  private tickOffset: number | null = null;
  private lastAck = 0;
  private placed = false;
  /** The local diver's server-owned state. */
  air = 100;
  down = false;
  revive = 0;
  phase = 0;
  phaseTime = 0;
  clock = 0;
  /** Effects from the server since the caller last drained them. */
  fx: Fx[] = [];
  rtt = 0;
  corrections = 0;

  constructor(private level: Level) {
    const spawn = level.spawns[0];
    this.sim = { x: spawn.x, y: spawn.y, z: spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI };
    this.syncPrev();
  }

  private syncPrev() {
    this.prev.x = this.sim.x; this.prev.y = this.sim.y; this.prev.z = this.sim.z;
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
      room.onMessage('fx', (list: Fx[]) => { this.fx.push(...list); });
      room.onLeave(() => { this.status = 'offline'; });
      // The first state lists the divers already in the dive, so callers can set up the scene with them.
      await new Promise<void>((resolve) => { room.onStateChange.once(() => resolve()); setTimeout(resolve, 1000); });
    } catch (err) {
      console.warn('[abyssal] server unreachable, diving solo', err);
      this.status = 'offline';
      this.localName = name || 'Diver I';
    }
  }

  /** Asks the server to seat a computer buddy in the empty second seat, or to remove it. */
  toggleBuddy() {
    this.room?.send('buddy');
  }

  /** One fixed step of local input: predicted immediately, sent to the server for authority. */
  step(dir: { x: number; y: number; z: number }, act: boolean) {
    const input: DiverInput = { seq: ++this.seq, x: dir.x, y: dir.y, z: dir.z, act: act ? 1 : 0 };
    this.syncPrev();
    stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
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
    this.phase = state.phase ?? 0;
    this.phaseTime = state.phaseTime ?? 0;
    this.clock = state.clock ?? 0;

    const seen = new Set<string>();
    state.divers.forEach((d, id) => {
      seen.add(id);
      if (id === this.sessionId) {
        this.localName = d.name;
        this.localSuit = d.suit;
        this.air = d.air; this.down = !!d.down; this.revive = d.revive;
        if (!this.placed) {
          this.placed = true;
          Object.assign(this.sim, { x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw });
          this.pending = this.pending.filter((p) => p.seq > d.ack);
          for (const input of this.pending) stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
          this.syncPrev();
          return;
        }
        if (d.ack > this.lastAck) this.reconcile(d);
        return;
      }
      let r = this.remotes.get(id);
      if (!r) { r = { name: d.name, suit: d.suit, air: d.air, down: false, revive: 0, samples: [] }; this.remotes.set(id, r); }
      r.name = d.name; r.suit = d.suit; r.air = d.air; r.down = !!d.down; r.revive = d.revive;
      pushSample(r.samples, { tick: state.serverTick, x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw, pitch: 0 });
    });
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);

    state.creatures?.forEach((c, id) => {
      let r = this.creatures.get(id);
      if (!r) { r = { kind: c.kind as CreatureKind, mode: 0, meter: 0, charge: 0, samples: [] }; this.creatures.set(id, r); }
      const last = r.samples[r.samples.length - 1];
      // A reef reset moves a creature home in one tick; drop the old samples so it doesn't glide there.
      if (last && Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) > 3) r.samples.length = 0;
      r.mode = c.mode; r.meter = c.meter; r.charge = c.charge;
      const vx = last ? (c.x - last.x) * TICK_RATE : 0, vy = last ? (c.y - last.y) * TICK_RATE : 0, vz = last ? (c.z - last.z) * TICK_RATE : 0;
      pushSample(r.samples, { tick: state.serverTick, x: c.x, y: c.y, z: c.z, vx, vy, vz, yaw: c.yaw, pitch: c.pitch });
    });
  }

  private reconcile(d: ServerDiver) {
    this.lastAck = d.ack;
    const before = { x: this.sim.x, y: this.sim.y, z: this.sim.z };
    Object.assign(this.sim, { x: d.x, y: d.y, z: d.z, vx: d.vx, vy: d.vy, vz: d.vz, yaw: d.yaw });
    this.pending = this.pending.filter((p) => p.seq > d.ack);
    for (const input of this.pending) stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
    const ex = before.x - this.sim.x, ey = before.y - this.sim.y, ez = before.z - this.sim.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 1e-4) {
      this.corrections++;
      if (err > 3) { this.offset.x = this.offset.y = this.offset.z = 0; this.syncPrev(); return; }
      this.offset.x += ex; this.offset.y += ey; this.offset.z += ez;
      this.prev.x -= ex; this.prev.y -= ey; this.prev.z -= ez;
    }
  }

  private renderTick() {
    return this.tickOffset === null ? null : performance.now() / 1000 * TICK_RATE + this.tickOffset - INTERP_DELAY_TICKS;
  }

  /** Every diver as it should be drawn this frame; `alpha` is the fraction of a fixed step elapsed since the last one. */
  snapshot(alpha: number): DiverSnapshot[] {
    const p = this.prev, s = this.sim;
    const out: DiverSnapshot[] = [{
      id: this.sessionId, name: this.localName || 'Diver I', suit: this.localSuit, local: true,
      x: p.x + (s.x - p.x) * alpha + this.offset.x,
      y: p.y + (s.y - p.y) * alpha + this.offset.y,
      z: p.z + (s.z - p.z) * alpha + this.offset.z,
      vx: this.sim.vx, vy: this.sim.vy, vz: this.sim.vz, yaw: this.sim.yaw,
      air: this.air, down: this.down, revive: this.revive,
    }];
    const rt = this.renderTick();
    if (rt === null) return out;
    for (const [id, r] of this.remotes) {
      if (!r.samples.length) continue;
      const q = sampleAt(r.samples, rt);
      out.push({ id, name: r.name, suit: r.suit, local: false, ...q, air: r.air, down: r.down, revive: r.revive });
    }
    return out;
  }

  creatureSnapshot(): CreatureSnapshot[] {
    const rt = this.renderTick();
    const out: CreatureSnapshot[] = [];
    if (rt === null) return out;
    for (const [id, r] of this.creatures) {
      if (!r.samples.length) continue;
      const q = sampleAt(r.samples, rt);
      out.push({ id, kind: r.kind, x: q.x, y: q.y, z: q.z, yaw: q.yaw, pitch: q.pitch, mode: r.mode, meter: r.meter, charge: r.charge });
    }
    return out;
  }

  get levelSeed() { return this.level.seed; }
}
