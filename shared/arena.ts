import { SURFACE_Y } from "./constants";
import { SPECIES } from "./creatures";
import { dist3 } from "./creatures/common";
import type { Creature, CreatureShape, World } from "./creatures/common";
import type { Level, Point } from "./level";
import { clearLine, collide } from "./physics";
import type { DiverSim } from "./protocol";

/**
 * The fight: air, buddy breathing, what the action key acts on, and the reef's phases. Each kind
 * of creature lives in its own module under `creatures/`, and this file runs them all the same
 * way. The server runs these rules; the client only draws their results and predicts which target
 * the action key would pick.
 */

export const AIR_MAX = 100;
const BUDDY_RANGE = 1.9;
const HARPOON_RELOAD = 0.55;
const REVIVE_TIME = 2.5;
const REVIVE_AIR = 40;
const SHARED_AIR = 15;
const SURFACE_REFILL = 28;
const CLEAR_RESET = 20;
const WIPE_RESET = 4;
/** Seconds every creature backs off after a diver runs out of air, so the buddy can reach them. */
const RESCUE_WINDOW = 6;

export const PHASE = { dive: 0, clear: 1, wiped: 2 } as const;

export interface ArenaDiver {
  id: string;
  sim: DiverSim;
  spawn: Point;
  air: number;
  down: boolean;
  /** Buddy-breathing progress while down, 0 to 1. */
  revive: number;
  act: boolean;
  reload: number;
  /** Seconds between harpoon shots. */
  reloadTime: number;
  /** What the action key aimed at this tick, while it was held. */
  target: Target | null;
}

/** Something that happened this tick, broadcast to clients for effects and messages. */
export interface Fx {
  k:
    | "harpoon"
    | "bite"
    | "shock"
    | "calmed"
    | "wrecked"
    | "down"
    | "revived"
    | "clear"
    | "wiped"
    | "reset"
    | "bagged"
    | "pried"
    | "dropped"
    | "returned"
    | "aboard"
    | "dived";
  id?: string;
  by?: string;
  p?: [number, number, number];
  q?: [number, number, number];
  t?: number;
  /** The item a loot event is about, by its key in `shared/loot/items.ts`. */
  item?: string;
  /** How many finds a loot event covers. */
  n?: number;
}

/** What the action key would do, and to whom: buddy-breathe a downed diver, a creature's action, or one of a `Reachable`'s. */
export interface Target {
  kind: "buddy" | "calm" | "harpoon" | Reachable["kind"];
  id: string;
}

/**
 * Something other than a diver or a creature that the action key can aim at, such as a find on
 * the floor or the station's line. Its own module decides what the action does.
 */
export interface Reachable extends Located {
  kind: "bag" | "pry" | "climb";
  /** How far the action key reaches it, in metres of 3D distance. */
  range: number;
  /** Within this distance the action key reaches it whichever way the diver faces. */
  reachAround: number;
}

interface Located {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** How squarely `dx, dy, dz` lies in front of a diver facing along `fx, fz`, counting height at half weight. */
const ahead = (fx: number, fz: number, dx: number, dy: number, dz: number) =>
  (dx * fx + dz * fz) / Math.max(1e-6, Math.hypot(dx, dy * 0.5, dz));

/** The nearest pick so far, and how far it is. */
interface Pick {
  target: Target | null;
  dist: number;
}

/** The nearest downed buddy within buddy-breathing range, if any. */
const pickBuddy = (me: Located, divers: (Located & { down: boolean })[]) => {
  let best: Target | null = null;
  let bestD = Infinity;
  for (const d of divers) {
    if (d.id === me.id || !d.down) {
      continue;
    }
    const dist = Math.hypot(d.x - me.x, d.y - me.y, d.z - me.z);
    if (dist < BUDDY_RANGE && dist < bestD) {
      best = { kind: "buddy", id: d.id };
      bestD = dist;
    }
  }
  return best;
};

/** The nearest creature still in the fight that the action key reaches from `me`, facing along `fx, fz`. */
const pickCreature = (
  level: Level,
  me: Located,
  fx: number,
  fz: number,
  creatures: (Located & CreatureShape)[]
) => {
  let best: Pick = { target: null, dist: Infinity };
  for (const c of creatures) {
    const sp = SPECIES[c.kind];
    if (!sp || sp.done(c)) {
      continue;
    }
    const dx = c.x - me.x;
    const dy = c.y - me.y;
    const dz = c.z - me.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > sp.range || dist >= best.dist) {
      continue;
    }
    if (ahead(fx, fz, dx, dy, dz) < 0.2 && dist > sp.reachAround) {
      continue;
    }
    if (sp.needsSight && !clearLine(level, me, c)) {
      continue;
    }
    best = { target: { kind: sp.action, id: c.id }, dist };
  }
  return best;
};

/** The nearest `Reachable` the action key reaches, if it is nearer than `best`; otherwise `best`. */
const pickReachable = (
  me: Located,
  fx: number,
  fz: number,
  reach: Reachable[],
  nearest: Pick
) => {
  let best = nearest;
  for (const r of reach) {
    const dx = r.x - me.x;
    const dy = r.y - me.y;
    const dz = r.z - me.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > r.range || dist >= best.dist) {
      continue;
    }
    if (ahead(fx, fz, dx, dy, dz) < 0.2 && dist > r.reachAround) {
      continue;
    }
    best = { target: { kind: r.kind, id: r.id }, dist };
  }
  return best;
};

/**
 * What the action key would act on for a diver at `me` facing `me.yaw`: a downed buddy within
 * reach always comes first, otherwise the nearest creature still in the fight that is in front.
 * "In front" is a wide cone that counts height at half weight, so a creature below or above
 * the diver still counts when it is ahead.
 */
export const pickTarget = (
  level: Level,
  me: Located & { yaw: number },
  divers: (Located & { down: boolean })[],
  creatures: (Located & CreatureShape)[],
  reach: Reachable[] = []
): Target | null => {
  const buddy = pickBuddy(me, divers);
  if (buddy) {
    return buddy;
  }
  const fx = Math.sin(me.yaw);
  const fz = Math.cos(me.yaw);
  return pickReachable(
    me,
    fx,
    fz,
    reach,
    pickCreature(level, me, fx, fz, creatures)
  ).target;
};

/** No `Reachable`s, until the server fills them in. */
const noReach = (): Reachable[] => [];

export class Arena implements World {
  readonly divers = new Map<string, ArenaDiver>();
  creatures: Creature[] = [];
  phase: number = PHASE.dive;
  phaseTime = 0;
  /** Seconds since the reef last reset. */
  clock = 0;
  fx: Fx[] = [];
  /** Everything besides divers and creatures the action key can aim at; the server fills it in. */
  reach: () => Reachable[] = noReach;
  readonly level: Level;

  constructor(level: Level) {
    this.level = level;
    this.resetCreatures();
  }

  addDiver(id: string, sim: DiverSim, spawn: Point) {
    this.divers.set(id, {
      id,
      sim,
      spawn,
      air: AIR_MAX,
      down: false,
      revive: 0,
      act: false,
      reload: 0,
      reloadTime: HARPOON_RELOAD,
      target: null,
    });
  }

  removeDiver(id: string) {
    this.divers.delete(id);
  }

  private resetCreatures() {
    this.creatures = this.level.creatures.map((s) => SPECIES[s.kind].spawn(s));
    this.phase = PHASE.dive;
    this.phaseTime = 0;
    this.clock = 0;
  }

  private reset(respawn: boolean) {
    this.resetCreatures();
    for (const d of this.divers.values()) {
      d.air = AIR_MAX;
      d.down = false;
      d.revive = 0;
      if (respawn) {
        Object.assign(d.sim, {
          x: d.spawn.x,
          y: d.spawn.y,
          z: d.spawn.z,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: Math.PI,
        });
      }
    }
    this.fx.push({ k: "reset" });
  }

  /** Runs one fixed step of the fight, after every diver has moved. */
  tick(dt: number) {
    for (const d of this.divers.values()) {
      d.target = null;
    }
    if (this.phase === PHASE.dive) {
      this.clock += dt;
    } else {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) {
        this.reset(this.phase === PHASE.wiped);
        return;
      }
      if (this.phase === PHASE.wiped) {
        return;
      }
    }
    this.breathe(dt);
    this.act(dt);
    for (const c of this.creatures) {
      const sp = SPECIES[c.kind];
      sp.think(c, this, dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      collide(this.level, c, sp.size.r, sp.size.h);
    }
    this.checkPhase();
  }

  alive() {
    return [...this.divers.values()].filter((d) => !d.down);
  }

  nearest(
    from: Point,
    within: number,
    origin: Point = from,
    needSight = false
  ) {
    let best: ArenaDiver | null = null;
    let bestD = Infinity;
    for (const d of this.alive()) {
      if (dist3(d.sim, origin) > within) {
        continue;
      }
      const dd = dist3(d.sim, from);
      if (dd >= bestD) {
        continue;
      }
      if (needSight && !clearLine(this.level, from, d.sim)) {
        continue;
      }
      best = d;
      bestD = dd;
    }
    return best;
  }

  hurt(d: ArenaDiver, air: number) {
    d.air -= air;
    if (d.air <= 0) {
      this.goDown(d);
    }
  }

  emit(f: Fx) {
    this.fx.push(f);
  }

  private breathe(dt: number) {
    for (const d of this.divers.values()) {
      d.reload = Math.max(0, d.reload - dt);
      if (d.down) {
        continue;
      }
      const depth = Math.max(0, -d.sim.y);
      if (d.sim.y > SURFACE_Y - 1.6) {
        d.air = Math.min(AIR_MAX, d.air + SURFACE_REFILL * dt);
      } else {
        d.air -= (0.75 + depth * 0.06) * dt;
      }
      if (d.air <= 0) {
        this.goDown(d);
      }
    }
  }

  private goDown(d: ArenaDiver) {
    if (d.down) {
      return;
    }
    d.air = 0;
    d.down = true;
    d.revive = 0;
    this.fx.push({ k: "down", id: d.id });
    for (const c of this.creatures) {
      SPECIES[c.kind].backOff(c, RESCUE_WINDOW);
    }
  }

  private act(dt: number) {
    for (const c of this.creatures) {
      c.tended = false;
    }
    const reviving = new Set<string>();
    const all = [...this.divers.values()];
    const others = all.map((d) => ({
      id: d.id,
      x: d.sim.x,
      y: d.sim.y,
      z: d.sim.z,
      down: d.down,
    }));
    const reach = this.reach();
    for (const d of all) {
      if (d.down || !d.act) {
        continue;
      }
      const t = pickTarget(
        this.level,
        { id: d.id, ...d.sim },
        others,
        this.creatures,
        reach
      );
      d.target = t;
      if (
        !t ||
        (t.kind !== "buddy" && t.kind !== "calm" && t.kind !== "harpoon")
      ) {
        continue;
      }
      if (t.kind === "buddy") {
        const buddy = this.divers.get(t.id);
        if (!buddy) {
          throw new Error(
            `Diver ${d.id} aimed at buddy ${t.id}, who is not in the arena`
          );
        }
        reviving.add(buddy.id);
        buddy.revive += dt / REVIVE_TIME;
        if (buddy.revive >= 1) {
          buddy.down = false;
          buddy.revive = 0;
          buddy.air = REVIVE_AIR;
          d.air = Math.max(5, d.air - SHARED_AIR);
          this.fx.push({ k: "revived", id: buddy.id, by: d.id });
        }
        continue;
      }
      const c = this.creatures.find((x) => x.id === t.id);
      if (!c) {
        throw new Error(
          `Diver ${d.id} aimed at creature ${t.id}, which is not in the arena`
        );
      }
      const sp = SPECIES[c.kind];
      c.tended = true;
      if (sp.busy(c)) {
        continue;
      }
      if (sp.action === "harpoon") {
        if (d.reload > 0) {
          continue;
        }
        d.reload = d.reloadTime;
        this.fx.push({
          k: "harpoon",
          id: c.id,
          by: d.id,
          p: [d.sim.x, d.sim.y, d.sim.z],
          q: [c.x, c.y, c.z],
        });
      }
      sp.acted(c, this, d, dt);
    }
    for (const d of all) {
      if (d.down && !reviving.has(d.id)) {
        d.revive = Math.max(0, d.revive - 0.25 * dt);
      }
    }
  }

  private checkPhase() {
    if (this.phase !== PHASE.dive) {
      return;
    }
    const all = [...this.divers.values()];
    if (all.length && all.every((d) => d.down)) {
      this.phase = PHASE.wiped;
      this.phaseTime = WIPE_RESET;
      this.fx.push({ k: "wiped" });
      return;
    }
    if (this.creatures.every((c) => SPECIES[c.kind].done(c))) {
      this.phase = PHASE.clear;
      this.phaseTime = CLEAR_RESET;
      this.fx.push({ k: "clear", t: this.clock });
    }
  }
}
