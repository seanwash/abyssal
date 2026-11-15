import { Client } from "@colyseus/sdk";
import type { Room } from "@colyseus/sdk";

import type { Fx } from "../../shared/arena";
import { DT, TICK_RATE } from "../../shared/constants";
import type { Level } from "../../shared/level";
import { stepDiver } from "../../shared/physics";
import {
  CLOSE_REPLACED,
  ERROR_DIVE_FULL,
  swimInput,
} from "../../shared/protocol";
import type { DiverInput, DiverSim, JoinOptions } from "../../shared/protocol";
import type { StationMessage } from "../../shared/station";
import { DIVER_ID, PARTY } from "./party";

export interface DiverSnapshot {
  id: string;
  name: string;
  suit: number;
  local: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  air: number;
  down: boolean;
  revive: number;
  /** Out of the water at the field station. */
  aboard: boolean;
  /** Item keys in the diver's dive bag. */
  bag: string[];
}

export interface LootSnapshot {
  id: string;
  item: string;
  x: number;
  y: number;
  z: number;
  state: number;
  work: number;
  hands: number;
}

export interface CreatureSnapshot {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: number;
  meter: number;
  charge: number;
}

interface Sample {
  tick: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
}

interface RemoteDiver {
  name: string;
  suit: number;
  air: number;
  down: boolean;
  revive: number;
  aboard: boolean;
  bag: string[];
  samples: Sample[];
}

interface RemoteCreature {
  kind: string;
  mode: number;
  meter: number;
  charge: number;
  samples: Sample[];
}

interface ServerDiver {
  name: string;
  suit: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  ack: number;
  air: number;
  down: number;
  revive: number;
  aboard: number;
  bag: Iterable<string>;
}

interface ServerCreature {
  kind: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  mode: number;
  meter: number;
  charge: number;
}

interface ServerState {
  serverTick: number;
  phase: number;
  phaseTime: number;
  clock: number;
  divers: Iterable<[string, ServerDiver]>;
  creatures?: Iterable<[string, ServerCreature]>;
  loot?: Iterable<[string, Omit<LootSnapshot, "id">]>;
}

/** Remote divers and creatures render this many server ticks in the past so there are always two samples to blend. */
const INTERP_DELAY_TICKS = 3;
const MAX_PENDING = 120;
/** How long the first join may take before the tab dives solo while it keeps trying. */
const SOLO_AFTER_MS = 4000;
/** A join attempt that takes longer than this is abandoned and retried. */
const JOIN_TIMEOUT_MS = 15_000;
const MAX_RETRY_MS = 5000;

export type NetStatus = "connecting" | "online" | "offline";

const pushSample = (samples: Sample[], s: Sample) => {
  const last = samples.at(-1);
  if (last && last.tick === s.tick) {
    return;
  }
  samples.push(s);
  if (samples.length > 40) {
    samples.shift();
  }
};

/** The sample at `renderTick`, blended between the two server samples around it and extrapolated briefly past the last. */
const sampleAt = (s: Sample[], renderTick: number) => {
  let [a] = s;
  let b = a;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    if (s[i].tick <= renderTick) {
      a = s[i];
      b = s[Math.min(i + 1, s.length - 1)];
      break;
    }
  }
  const span = b.tick - a.tick;
  const t = Math.max(
    0,
    Math.min(1, span > 0 ? (renderTick - a.tick) / span : 0)
  );
  const extra =
    a === b
      ? Math.max(0, Math.min(0.25, (renderTick - a.tick) / TICK_RATE))
      : 0;
  const turn = (p: number, q: number) =>
    p + Math.atan2(Math.sin(q - p), Math.cos(q - p)) * t;
  return {
    x: a.x + (b.x - a.x) * t + a.vx * extra,
    y: a.y + (b.y - a.y) * t + a.vy * extra,
    z: a.z + (b.z - a.z) * t + a.vz * extra,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    vz: a.vz + (b.vz - a.vz) * t,
    yaw: turn(a.yaw, b.yaw),
    pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
};

/**
 * Client netcode: local prediction with server reconciliation for this player's diver, and
 * snapshot interpolation for the other diver and the creatures. Falls back to a local-only
 * simulation when the server cannot be reached, so the scene is still explorable, and keeps
 * trying to rejoin the party, where the server holds this tab's seat and position.
 */
export class Net {
  status: NetStatus = "connecting";
  sessionId = "local";
  localName = "";
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
  aboard = false;
  bag: string[] = [];
  /** Finds on the reef, as of the latest server state. */
  loot: LootSnapshot[] = [];
  /** The party's station log, and station messages since the caller last drained them. */
  station: StationMessage | null = null;
  stationNews: StationMessage[] = [];
  phase = 0;
  phaseTime = 0;
  clock = 0;
  /** Effects from the server since the caller last drained them. */
  fx: Fx[] = [];
  rtt = 0;
  corrections = 0;
  /** Why this tab is not in the party, when the reason is more specific than the status. */
  notice = "";
  private joinOptions: JoinOptions = { party: PARTY, diver: DIVER_ID };
  private retry?: ReturnType<typeof setTimeout>;
  private retryMs = 1000;
  private level: Level;

  constructor(level: Level) {
    this.level = level;
    const [spawn] = level.spawns;
    this.sim = {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: Math.PI,
    };
    this.syncPrev();
  }

  private syncPrev() {
    this.prev.x = this.sim.x;
    this.prev.y = this.sim.y;
    this.prev.z = this.sim.z;
  }

  async connect(name: string) {
    this.joinOptions.name = name;
    this.localName = name || "Diver I";
    const joined = this.joinDive();
    const solo = Promise.withResolvers<undefined>();
    setTimeout(solo.resolve, SOLO_AFTER_MS);
    await Promise.race([joined, solo.promise]);
    if (this.status === "connecting") {
      this.status = "offline";
    }
    // A laptop waking or a network coming back should not wait out the retry delay.
    const now = () => {
      if (this.retry) {
        this.scheduleJoin(0);
      }
    };
    addEventListener("online", now);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        now();
      }
    });
    setInterval(
      () =>
        this.room?.ping((ms) => {
          this.rtt = ms;
        }),
      2000
    );
  }

  private scheduleJoin(ms: number) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.joinDive();
    }, ms);
  }

  private async joinDive() {
    const params = new URLSearchParams(location.search);
    const client = new Client(
      params.get("server") ?? (import.meta.env.DEV ? "/colyseus" : undefined)
    );
    const joining = client.joinOrCreate("dive", this.joinOptions);
    let room: Room;
    try {
      const timeout = Promise.withResolvers<never>();
      setTimeout(() => timeout.reject(new Error("timeout")), JOIN_TIMEOUT_MS);
      room = await Promise.race([joining, timeout.promise]);
    } catch (error) {
      // A join that lands after the timeout would hold a second seat for this diver. A join that
      // failed is handled here already, so its rejection is ignored.
      joining.then((late) => late.leave()).catch(() => null);
      const full = (error as { code?: number }).code === ERROR_DIVE_FULL;
      this.notice = full ? "This party already has two divers." : "";
      if (!full) {
        console.warn("[abyssal] could not join the dive, retrying", error);
      }
      this.scheduleJoin(this.retryMs);
      this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
      return;
    }
    // Rejoining is handled here, with the seat the server holds for this diver, rather than by
    // the SDK's own reconnection, which cannot survive a reload.
    room.reconnection.enabled = false;
    this.room = room;
    this.sessionId = room.sessionId;
    this.status = "online";
    this.notice = "";
    this.retryMs = 1000;
    this.placed = false;
    this.pending = [];
    this.lastAck = 0;
    this.tickOffset = null;
    this.remotes.clear();
    this.creatures.clear();
    room.onStateChange((state: ServerState) => this.onState(state));
    room.onMessage("fx", (list: Fx[]) => {
      this.fx.push(...list);
    });
    room.onMessage("station", (m: StationMessage) => {
      this.station = m;
      this.stationNews.push(m);
    });
    room.onLeave((code) => {
      if (this.room !== room) {
        return;
      }
      this.room = undefined;
      if (code === CLOSE_REPLACED) {
        this.status = "offline";
        this.notice = "This diver is now playing in another tab.";
        return;
      }
      this.status = "connecting";
      this.scheduleJoin(0);
    });
    // The first state lists the divers already in the dive, so callers can set up the scene with them.
    const first = Promise.withResolvers<undefined>();
    room.onStateChange.once(() => first.resolve(undefined));
    setTimeout(first.resolve, 1000);
    await first.promise;
  }

  /** Asks the server to seat a computer buddy in the empty second seat, or to remove it. */
  toggleBuddy() {
    this.room?.send("buddy");
  }

  /** Climbs out at the station's line; the server checks the diver is close enough. */
  climb() {
    this.room?.send("climb");
  }

  /** Leaves the station and goes back in the water. */
  dive() {
    this.room?.send("dive");
  }

  /** One fixed step of local input: predicted immediately, sent to the server for authority. */
  step(dir: { x: number; y: number; z: number }, act: boolean) {
    // A diver at the station doesn't move; the server still acknowledges its inputs.
    this.seq += 1;
    const input: DiverInput = this.aboard
      ? { seq: this.seq, x: 0, y: 0, z: 0, act: 0 }
      : { seq: this.seq, x: dir.x, y: dir.y, z: dir.z, act: act ? 1 : 0 };
    this.syncPrev();
    if (!this.aboard) {
      stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
    }
    if (this.status === "online" && this.room) {
      this.pending.push(input);
      if (this.pending.length > MAX_PENDING) {
        this.pending.shift();
      }
      this.room.send("input", input);
    }
  }

  decayOffset(dt: number) {
    const k = Math.exp(-12 * dt);
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.z *= k;
  }

  private onState(state: ServerState) {
    const now = performance.now() / 1000;
    const est = state.serverTick - now * TICK_RATE;
    if (this.tickOffset === null) {
      this.tickOffset = est;
    } else {
      this.tickOffset +=
        (est - this.tickOffset) * (est > this.tickOffset ? 0.2 : 0.02);
    }
    this.phase = state.phase ?? 0;
    this.phaseTime = state.phaseTime ?? 0;
    this.clock = state.clock ?? 0;

    const seen = new Set<string>();
    for (const [id, d] of state.divers) {
      seen.add(id);
      if (id === this.sessionId) {
        this.onLocalDiver(d);
      } else {
        this.onRemoteDiver(id, d, state.serverTick);
      }
    }
    for (const id of this.remotes.keys()) {
      if (!seen.has(id)) {
        this.remotes.delete(id);
      }
    }

    const loot: LootSnapshot[] = [];
    for (const [id, l] of state.loot ?? []) {
      loot.push({
        id,
        item: l.item,
        x: l.x,
        y: l.y,
        z: l.z,
        state: l.state,
        work: l.work,
        hands: l.hands,
      });
    }
    this.loot = loot;

    for (const [id, c] of state.creatures ?? []) {
      this.onCreature(id, c, state.serverTick);
    }
  }

  /** This tab's diver: placed from the first state, reconciled from later ones. */
  private onLocalDiver(d: ServerDiver) {
    this.localName = d.name;
    this.localSuit = d.suit;
    this.air = d.air;
    this.down = !!d.down;
    this.revive = d.revive;
    this.aboard = !!d.aboard;
    this.bag = [...d.bag];
    if (!this.placed) {
      this.placed = true;
      Object.assign(this.sim, {
        x: d.x,
        y: d.y,
        z: d.z,
        vx: d.vx,
        vy: d.vy,
        vz: d.vz,
        yaw: d.yaw,
      });
      this.pending = this.pending.filter((p) => p.seq > d.ack);
      for (const input of this.pending) {
        stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
      }
      this.syncPrev();
      return;
    }
    if (d.ack > this.lastAck) {
      this.reconcile(d);
    }
  }

  private onRemoteDiver(id: string, d: ServerDiver, tick: number) {
    let r = this.remotes.get(id);
    if (!r) {
      r = {
        name: d.name,
        suit: d.suit,
        air: d.air,
        down: false,
        revive: 0,
        aboard: false,
        bag: [],
        samples: [],
      };
      this.remotes.set(id, r);
    }
    // A diver going back in reappears at its spawn; drop the old samples so it doesn't glide there.
    if (r.aboard && !d.aboard) {
      r.samples.length = 0;
    }
    r.name = d.name;
    r.suit = d.suit;
    r.air = d.air;
    r.down = !!d.down;
    r.revive = d.revive;
    r.aboard = !!d.aboard;
    r.bag = [...d.bag];
    pushSample(r.samples, {
      tick,
      x: d.x,
      y: d.y,
      z: d.z,
      vx: d.vx,
      vy: d.vy,
      vz: d.vz,
      yaw: d.yaw,
      pitch: 0,
    });
  }

  private onCreature(id: string, c: ServerCreature, tick: number) {
    let r = this.creatures.get(id);
    if (!r) {
      r = { kind: c.kind, mode: 0, meter: 0, charge: 0, samples: [] };
      this.creatures.set(id, r);
    }
    const last = r.samples.at(-1);
    // A reef reset moves a creature home in one tick; drop the old samples so it doesn't glide there.
    if (last && Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) > 3) {
      r.samples.length = 0;
    }
    r.mode = c.mode;
    r.meter = c.meter;
    r.charge = c.charge;
    const vx = last ? (c.x - last.x) * TICK_RATE : 0;
    const vy = last ? (c.y - last.y) * TICK_RATE : 0;
    const vz = last ? (c.z - last.z) * TICK_RATE : 0;
    pushSample(r.samples, {
      tick,
      x: c.x,
      y: c.y,
      z: c.z,
      vx,
      vy,
      vz,
      yaw: c.yaw,
      pitch: c.pitch,
    });
  }

  private reconcile(d: ServerDiver) {
    this.lastAck = d.ack;
    const before = { x: this.sim.x, y: this.sim.y, z: this.sim.z };
    Object.assign(this.sim, {
      x: d.x,
      y: d.y,
      z: d.z,
      vx: d.vx,
      vy: d.vy,
      vz: d.vz,
      yaw: d.yaw,
    });
    this.pending = this.pending.filter((p) => p.seq > d.ack);
    for (const input of this.pending) {
      stepDiver(this.level, this.sim, swimInput(input, this.down), DT);
    }
    const ex = before.x - this.sim.x;
    const ey = before.y - this.sim.y;
    const ez = before.z - this.sim.z;
    const err = Math.hypot(ex, ey, ez);
    if (err > 1e-4) {
      this.corrections += 1;
      if (err > 3) {
        this.offset.x = 0;
        this.offset.y = 0;
        this.offset.z = 0;
        this.syncPrev();
        return;
      }
      this.offset.x += ex;
      this.offset.y += ey;
      this.offset.z += ez;
      this.prev.x -= ex;
      this.prev.y -= ey;
      this.prev.z -= ez;
    }
  }

  private renderTick() {
    return this.tickOffset === null
      ? null
      : (performance.now() / 1000) * TICK_RATE +
          this.tickOffset -
          INTERP_DELAY_TICKS;
  }

  /** Every diver as it should be drawn this frame; `alpha` is the fraction of a fixed step elapsed since the last one. */
  snapshot(alpha: number): DiverSnapshot[] {
    const p = this.prev;
    const s = this.sim;
    const out: DiverSnapshot[] = [
      {
        id: this.sessionId,
        name: this.localName || "Diver I",
        suit: this.localSuit,
        local: true,
        x: p.x + (s.x - p.x) * alpha + this.offset.x,
        y: p.y + (s.y - p.y) * alpha + this.offset.y,
        z: p.z + (s.z - p.z) * alpha + this.offset.z,
        vx: this.sim.vx,
        vy: this.sim.vy,
        vz: this.sim.vz,
        yaw: this.sim.yaw,
        air: this.air,
        down: this.down,
        revive: this.revive,
        aboard: this.aboard,
        bag: this.bag,
      },
    ];
    const rt = this.renderTick();
    if (rt === null) {
      return out;
    }
    for (const [id, r] of this.remotes) {
      if (!r.samples.length) {
        continue;
      }
      const q = sampleAt(r.samples, rt);
      out.push({
        id,
        name: r.name,
        suit: r.suit,
        local: false,
        ...q,
        air: r.air,
        down: r.down,
        revive: r.revive,
        aboard: r.aboard,
        bag: r.bag,
      });
    }
    return out;
  }

  creatureSnapshot(): CreatureSnapshot[] {
    const rt = this.renderTick();
    const out: CreatureSnapshot[] = [];
    if (rt === null) {
      return out;
    }
    for (const [id, r] of this.creatures) {
      if (!r.samples.length) {
        continue;
      }
      const q = sampleAt(r.samples, rt);
      out.push({
        id,
        kind: r.kind,
        x: q.x,
        y: q.y,
        z: q.z,
        yaw: q.yaw,
        pitch: q.pitch,
        mode: r.mode,
        meter: r.meter,
        charge: r.charge,
      });
    }
    return out;
  }

  get levelSeed() {
    return this.level.seed;
  }
}
