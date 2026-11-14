import { SURFACE_Y } from './constants';
import { boulderExtent, floorHeight, type Level, type Point } from './level';
import { clearLine, collide, type Body } from './physics';
import type { DiverSim } from './protocol';

/**
 * The first fight: a sick lingcod guarding its nest on the floor and a drone patrolling midwater.
 * The server runs these rules; the client only draws their results and predicts which target the
 * action key would pick.
 */

export const AIR_MAX = 100;
/** How close each action reaches, in metres of 3D distance. */
export const RANGE = { buddy: 1.9, calm: 3.4, harpoon: 7.5 };
const CALM_RATE = 0.17;
const CALM_DECAY = 0.04;
const HARPOON_RELOAD = 0.55;
const DRONE_HITS = 8;
const REVIVE_TIME = 2.5;
const REVIVE_AIR = 40;
const SHARED_AIR = 15;
const SURFACE_REFILL = 28;
const BITE_AIR = 12;
const SHOCK_AIR = 15;
export const SHOCK_RADIUS = 2.6;
const CLEAR_RESET = 20;
const WIPE_RESET = 4;
const RESCUE_WINDOW = 6;

export const LING = { guard: 0, stalk: 1, coil: 2, lunge: 3, recover: 4, calm: 5 } as const;
export const DRONE = { patrol: 0, hunt: 1, charge: 2, cooldown: 3, wrecked: 4 } as const;
export const PHASE = { dive: 0, clear: 1, wiped: 2 } as const;

export type CreatureKind = 'lingcod' | 'drone';

export interface Creature extends Body {
  id: string;
  kind: CreatureKind;
  yaw: number;
  pitch: number;
  mode: number;
  timer: number;
  /** Lingcod: how calm it is, 0 to 1. Drone: hull left, 1 to 0. */
  meter: number;
  /** 0 to 1 while a lunge coils or a shock charges, for the client's telegraph. */
  charge: number;
  cooldown: number;
  lock: Point;
  hit: boolean;
  waypoint: number;
  lost: number;
}

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
}

/** Something that happened this tick, broadcast to clients for effects and messages. */
export interface Fx {
  k: 'harpoon' | 'bite' | 'shock' | 'calmed' | 'wrecked' | 'down' | 'revived' | 'clear' | 'wiped' | 'reset';
  id?: string;
  by?: string;
  p?: [number, number, number];
  q?: [number, number, number];
  t?: number;
}

export interface Target { kind: 'buddy' | CreatureKind; id: string }

interface Located { id: string; x: number; y: number; z: number }

/**
 * What the action key would act on for a diver at `me` facing `me.yaw`: a downed buddy within
 * reach always comes first, otherwise the nearest sick lingcod or working drone in front.
 * "In front" is a wide cone that counts height at half weight, so a creature below or above
 * the diver still counts when it is ahead.
 */
export function pickTarget(
  level: Level,
  me: Located & { yaw: number },
  divers: (Located & { down: boolean })[],
  creatures: (Located & { kind: CreatureKind; mode: number })[],
): Target | null {
  let best: Target | null = null, bestD = Infinity;
  for (const d of divers) {
    if (d.id === me.id || !d.down) continue;
    const dist = Math.hypot(d.x - me.x, d.y - me.y, d.z - me.z);
    if (dist < RANGE.buddy && dist < bestD) { best = { kind: 'buddy', id: d.id }; bestD = dist; }
  }
  if (best) return best;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw);
  for (const c of creatures) {
    if (c.kind === 'lingcod' ? c.mode === LING.calm : c.mode === DRONE.wrecked) continue;
    const dx = c.x - me.x, dy = c.y - me.y, dz = c.z - me.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > (c.kind === 'lingcod' ? RANGE.calm : RANGE.harpoon) || dist >= bestD) continue;
    const ahead = (dx * fx + dz * fz) / Math.max(1e-6, Math.hypot(dx, dy * 0.5, dz));
    if (ahead < 0.2 && dist > (c.kind === 'lingcod' ? 2.2 : 1.2)) continue;
    if (c.kind === 'drone' && !clearLine(level, me, c)) continue;
    best = { kind: c.kind, id: c.id };
    bestD = dist;
  }
  return best;
}

const dist3 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Velocity that heads for `goal` at up to `speed` while bending around boulders, keeping clear of
 * the floor and staying below the surface. Each nearby boulder pushes outward along its surface
 * normal, and the part of the heading that points into the rock is removed so the creature slides
 * around it instead of stopping.
 */
export function steerVelocity(level: Level, b: Body, goal: Point, speed: number, r: number, h: number, floorGap = 0.5) {
  let gx = goal.x - b.x, gy = goal.y - b.y, gz = goal.z - b.z;
  const gl = Math.hypot(gx, gy, gz);
  const s = speed * Math.min(1, gl / 1.5);
  if (gl > 1e-6) { gx = gx / gl * s; gy = gy / gl * s; gz = gz / gl * s; }
  const px = b.x + b.vx * 0.6, py = b.y + b.vy * 0.6, pz = b.z + b.vz * 0.6;
  for (const rock of level.boulders) {
    const e = boulderExtent(rock);
    const A = e.a + r + 0.8, C = e.c + h + 0.8;
    const dx = px - rock.x, dy = py - rock.y, dz = pz - rock.z;
    if (Math.abs(dx) >= A || Math.abs(dz) >= A || Math.abs(dy) >= C) continue;
    const k = Math.hypot(dx / A, dy / C, dz / A);
    if (k >= 1) continue;
    let nx = dx / (A * A), ny = dy / (C * C), nz = dz / (A * A);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const into = gx * nx + gy * ny + gz * nz;
    if (into < 0) { gx -= into * nx; gy -= into * ny; gz -= into * nz; }
    const push = (1 - k) * speed * 1.6;
    gx += nx * push; gy += ny * push; gz += nz * push;
  }
  const floor = floorHeight(px, pz) + h + floorGap;
  if (py < floor) gy += (floor - py) * 2.5;
  const ceiling = SURFACE_Y - 1.2;
  if (py > ceiling) gy -= (py - ceiling) * 2.5;
  return { x: gx, y: gy, z: gz };
}

function moveToward(c: Body, v: Point, response: number, dt: number) {
  const k = 1 - Math.exp(-response * dt);
  c.vx += (v.x - c.vx) * k; c.vy += (v.y - c.vy) * k; c.vz += (v.z - c.vz) * k;
}

const SIZE: Record<CreatureKind, { r: number; h: number }> = {
  lingcod: { r: 0.5, h: 0.3 },
  drone: { r: 0.4, h: 0.35 },
};

function faceAlong(c: Creature, dx: number, dy: number, dz: number, dt: number, response = 6) {
  if (Math.hypot(dx, dz) < 1e-3) return;
  let d = Math.atan2(dx, dz) - c.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.yaw += d * (1 - Math.exp(-response * dt));
  const pitch = Math.atan2(-dy, Math.max(0.3, Math.hypot(dx, dz))) * 0.8;
  c.pitch += (pitch - c.pitch) * (1 - Math.exp(-4 * dt));
}

export class Arena {
  readonly divers = new Map<string, ArenaDiver>();
  creatures: Creature[] = [];
  phase: number = PHASE.dive;
  phaseTime = 0;
  /** Seconds since the reef last reset. */
  clock = 0;
  fx: Fx[] = [];
  private calming = new Set<string>();

  constructor(readonly level: Level) {
    this.resetCreatures();
  }

  addDiver(id: string, sim: DiverSim, spawn: Point) {
    this.divers.set(id, { id, sim, spawn, air: AIR_MAX, down: false, revive: 0, act: false, reload: 0, reloadTime: HARPOON_RELOAD });
  }

  removeDiver(id: string) {
    this.divers.delete(id);
  }

  private resetCreatures() {
    const n = this.level.nest, p = this.level.patrol[1];
    const base = { vx: 0, vy: 0, vz: 0, pitch: 0, timer: 0, charge: 0, cooldown: 0, hit: false, waypoint: 0, lost: 0 };
    this.creatures = [
      { ...base, id: 'lingcod', kind: 'lingcod', x: n.x + 0.8, y: n.y + 0.5, z: n.z + 0.8, yaw: 0.8, mode: LING.guard, meter: 0, lock: { ...n } },
      { ...base, id: 'drone', kind: 'drone', x: p.x, y: p.y, z: p.z, yaw: 0, mode: DRONE.patrol, meter: 1, lock: { ...p }, waypoint: 1 },
    ];
    this.phase = PHASE.dive;
    this.phaseTime = 0;
    this.clock = 0;
  }

  private reset(respawn: boolean) {
    this.resetCreatures();
    for (const d of this.divers.values()) {
      d.air = AIR_MAX; d.down = false; d.revive = 0;
      if (respawn) Object.assign(d.sim, { x: d.spawn.x, y: d.spawn.y, z: d.spawn.z, vx: 0, vy: 0, vz: 0, yaw: Math.PI });
    }
    this.fx.push({ k: 'reset' });
  }

  /** Runs one fixed step of the fight, after every diver has moved. */
  tick(dt: number) {
    if (this.phase !== PHASE.dive) {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) { this.reset(this.phase === PHASE.wiped); return; }
      if (this.phase === PHASE.wiped) return;
    } else {
      this.clock += dt;
    }
    this.breathe(dt);
    this.act(dt);
    for (const c of this.creatures) {
      if (c.kind === 'lingcod') this.lingcod(c, dt); else this.drone(c, dt);
    }
    this.checkPhase();
  }

  private alive() {
    return [...this.divers.values()].filter((d) => !d.down);
  }

  private breathe(dt: number) {
    for (const d of this.divers.values()) {
      d.reload = Math.max(0, d.reload - dt);
      if (d.down) continue;
      const depth = Math.max(0, -d.sim.y);
      if (d.sim.y > SURFACE_Y - 1.6) d.air = Math.min(AIR_MAX, d.air + SURFACE_REFILL * dt);
      else d.air -= (0.75 + depth * 0.06) * dt;
      if (d.air <= 0) this.goDown(d);
    }
  }

  private hurt(d: ArenaDiver, air: number) {
    d.air -= air;
    if (d.air <= 0) this.goDown(d);
  }

  private goDown(d: ArenaDiver) {
    if (d.down) return;
    d.air = 0; d.down = true; d.revive = 0;
    this.fx.push({ k: 'down', id: d.id });
    // Having driven one diver off, both creatures back away for a while, which gives the buddy time to reach them.
    for (const c of this.creatures) {
      c.cooldown = Math.max(c.cooldown, RESCUE_WINDOW);
      if (c.kind === 'lingcod' && c.mode !== LING.calm) { c.mode = LING.recover; c.timer = 0.9; c.charge = 0; }
      if (c.kind === 'drone' && c.mode === DRONE.charge) { c.mode = DRONE.cooldown; c.timer = 1.6; c.charge = 0; }
    }
  }

  private act(dt: number) {
    this.calming.clear();
    const reviving = new Set<string>();
    const all = [...this.divers.values()];
    const others = all.map((d) => ({ id: d.id, x: d.sim.x, y: d.sim.y, z: d.sim.z, down: d.down }));
    for (const d of all) {
      if (d.down || !d.act) continue;
      const t = pickTarget(this.level, { id: d.id, ...d.sim }, others, this.creatures);
      if (!t) continue;
      if (t.kind === 'buddy') {
        const buddy = this.divers.get(t.id)!;
        reviving.add(buddy.id);
        buddy.revive += dt / REVIVE_TIME;
        if (buddy.revive >= 1) {
          buddy.down = false; buddy.revive = 0; buddy.air = REVIVE_AIR;
          d.air = Math.max(5, d.air - SHARED_AIR);
          this.fx.push({ k: 'revived', id: buddy.id, by: d.id });
        }
      } else if (t.kind === 'lingcod') {
        const c = this.creatures.find((x) => x.id === t.id)!;
        this.calming.add(c.id);
        // A lingcod coiling or lunging is too worked up to calm, so calming happens between lunges.
        if (c.mode === LING.coil || c.mode === LING.lunge) continue;
        c.meter = Math.min(1, c.meter + CALM_RATE * dt);
        if (c.meter >= 1) {
          c.mode = LING.calm; c.charge = 0;
          this.fx.push({ k: 'calmed', id: c.id, by: d.id });
        }
      } else if (d.reload <= 0) {
        const c = this.creatures.find((x) => x.id === t.id)!;
        d.reload = d.reloadTime;
        c.meter = Math.max(0, c.meter - 1 / DRONE_HITS);
        const dx = c.x - d.sim.x, dy = c.y - d.sim.y, dz = c.z - d.sim.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        c.vx += dx / l * 2.2; c.vy += dy / l * 2.2; c.vz += dz / l * 2.2;
        this.fx.push({ k: 'harpoon', id: c.id, by: d.id, p: [d.sim.x, d.sim.y, d.sim.z], q: [c.x, c.y, c.z] });
        if (c.meter <= 1e-6) {
          c.mode = DRONE.wrecked; c.charge = 0;
          this.fx.push({ k: 'wrecked', id: c.id, by: d.id });
        } else if (c.mode === DRONE.charge) {
          // A hit while the shock charges knocks it out of the charge.
          c.mode = DRONE.cooldown; c.timer = 0.9; c.charge = 0;
        }
      }
    }
    for (const d of all) if (d.down && !reviving.has(d.id)) d.revive = Math.max(0, d.revive - 0.25 * dt);
  }

  private nearest(from: Point, within: number, origin: Point = from, needSight = false) {
    let best: ArenaDiver | null = null, bestD = Infinity;
    for (const d of this.alive()) {
      if (dist3(d.sim, origin) > within) continue;
      const dd = dist3(d.sim, from);
      if (dd >= bestD) continue;
      if (needSight && !clearLine(this.level, from, d.sim)) continue;
      best = d; bestD = dd;
    }
    return best;
  }

  private glide(c: Creature, goal: Point, speed: number, response: number, dt: number, floorGap = 0.5) {
    const { r, h } = SIZE[c.kind];
    moveToward(c, steerVelocity(this.level, c, goal, speed, r, h, floorGap), response, dt);
  }

  private integrate(c: Creature, dt: number) {
    c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    const { r, h } = SIZE[c.kind];
    collide(this.level, c, r, h);
  }

  private lingcod(c: Creature, dt: number) {
    const nest = this.level.nest;
    const home = { x: nest.x + 0.9, y: nest.y + 0.45, z: nest.z + 0.6 };
    if (c.mode !== LING.calm && !this.calming.has(c.id)) c.meter = Math.max(0, c.meter - CALM_DECAY * dt);
    c.cooldown = Math.max(0, c.cooldown - dt);
    const prey = c.mode === LING.calm ? null : this.nearest(c, 6.5, nest);
    const toward = (p: Point, gap: number) => {
      const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x - dx / l * gap, y: p.y, z: p.z - dz / l * gap };
    };
    switch (c.mode) {
      case LING.calm:
      case LING.guard: {
        const t = this.clock * 0.35;
        const goal = { x: home.x + Math.cos(t) * 0.6, y: home.y, z: home.z + Math.sin(t) * 0.6 };
        this.glide(c, goal, 0.6, 2, dt, 0.15);
        faceAlong(c, c.vx, c.vy, c.vz, dt, 3);
        if (prey && c.mode === LING.guard && c.cooldown <= 0) c.mode = LING.stalk;
        break;
      }
      case LING.stalk: {
        if (!prey) { c.mode = LING.guard; break; }
        const goal = toward(prey.sim, 2.2);
        goal.y = Math.min(prey.sim.y, floorHeight(goal.x, goal.z) + 3);
        this.glide(c, goal, 2.4, 3, dt, 0.15);
        faceAlong(c, prey.sim.x - c.x, prey.sim.y - c.y, prey.sim.z - c.z, dt);
        if (dist3(c, prey.sim) < 3.2 && c.cooldown <= 0) {
          c.mode = LING.coil; c.timer = 0.55; c.lock = { ...prey.sim };
        }
        break;
      }
      case LING.coil: {
        c.timer -= dt;
        c.charge = 1 - c.timer / 0.55;
        if (prey) { c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z }; }
        const dx = c.lock.x - c.x, dy = c.lock.y - c.y, dz = c.lock.z - c.z;
        faceAlong(c, dx, dy, dz, dt, 10);
        const l = Math.hypot(dx, dy, dz) || 1;
        moveToward(c, { x: -dx / l * 0.5, y: -dy / l * 0.5, z: -dz / l * 0.5 }, 6, dt);
        if (c.timer <= 0) {
          c.mode = LING.lunge; c.timer = 0.32; c.charge = 0; c.hit = false;
          c.vx = dx / l * 9; c.vy = dy / l * 9; c.vz = dz / l * 9;
        }
        break;
      }
      case LING.lunge: {
        c.timer -= dt;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const head = { x: c.x + fx * 0.8, y: c.y, z: c.z + fz * 0.8 };
        if (!c.hit) {
          for (const d of this.alive()) {
            if (dist3(head, d.sim) > 0.95) continue;
            c.hit = true;
            const l = Math.hypot(c.vx, c.vy, c.vz) || 1;
            d.sim.vx += c.vx / l * 4; d.sim.vy += c.vy / l * 4; d.sim.vz += c.vz / l * 4;
            this.hurt(d, BITE_AIR);
            this.fx.push({ k: 'bite', id: d.id, p: [head.x, head.y, head.z] });
            break;
          }
        }
        if (c.timer <= 0) { c.mode = LING.recover; c.timer = 0.9; }
        break;
      }
      case LING.recover: {
        c.timer -= dt;
        this.glide(c, home, 1.2, 2.5, dt, 0.15);
        faceAlong(c, c.vx, c.vy, c.vz, dt, 4);
        if (c.timer <= 0) { c.mode = LING.guard; c.cooldown = Math.max(c.cooldown, 0.9 + c.meter * 1.6); }
        break;
      }
    }
    this.integrate(c, dt);
  }

  private drone(c: Creature, dt: number) {
    c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.mode === DRONE.wrecked) {
      c.vy -= 2.5 * dt;
      c.vx *= Math.exp(-2 * dt); c.vz *= Math.exp(-2 * dt);
      c.pitch += (0.9 - c.pitch) * (1 - Math.exp(-1.5 * dt));
      this.integrate(c, dt);
      return;
    }
    const prey = this.nearest(c, 8, c, true);
    switch (c.mode) {
      case DRONE.patrol: {
        const route = this.level.patrol;
        const wp = route[c.waypoint % route.length];
        if (dist3(c, wp) < 1.5) c.waypoint = (c.waypoint + 1) % route.length;
        this.glide(c, wp, 1.7, 2, dt);
        faceAlong(c, c.vx, c.vy, c.vz, dt, 3);
        if (prey) { c.mode = DRONE.hunt; c.lost = 0; }
        break;
      }
      case DRONE.hunt: {
        if (!prey) {
          c.lost += dt;
          if (c.lost > 2.5) { c.mode = DRONE.patrol; break; }
        } else {
          c.lost = 0;
          c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z };
        }
        const p = c.lock;
        const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1;
        const goal = { x: p.x + dx / l * 1.8, y: p.y + 0.6, z: p.z + dz / l * 1.8 };
        this.glide(c, goal, 2.6, 2.5, dt);
        faceAlong(c, p.x - c.x, p.y - c.y, p.z - c.z, dt);
        if (prey && dist3(c, prey.sim) < 2.8 && c.cooldown <= 0) { c.mode = DRONE.charge; c.timer = 1.0; }
        break;
      }
      case DRONE.charge: {
        c.timer -= dt;
        c.charge = 1 - c.timer;
        moveToward(c, { x: 0, y: 0, z: 0 }, 3, dt);
        if (c.timer <= 0) {
          c.charge = 0;
          this.fx.push({ k: 'shock', id: c.id, p: [c.x, c.y, c.z] });
          for (const d of this.alive()) {
            const dd = dist3(c, d.sim);
            if (dd > SHOCK_RADIUS) continue;
            const l = dd || 1;
            d.sim.vx += (d.sim.x - c.x) / l * 3.5; d.sim.vy += (d.sim.y - c.y) / l * 3.5; d.sim.vz += (d.sim.z - c.z) / l * 3.5;
            this.hurt(d, SHOCK_AIR);
            this.fx.push({ k: 'bite', id: d.id, p: [d.sim.x, d.sim.y, d.sim.z] });
          }
          c.mode = DRONE.cooldown; c.timer = 1.6;
        }
        break;
      }
      case DRONE.cooldown: {
        c.timer -= dt;
        const away = prey ? { x: c.x * 2 - prey.sim.x, y: c.y + 0.5, z: c.z * 2 - prey.sim.z } : c;
        this.glide(c, away, 1.4, 2, dt);
        if (c.timer <= 0) { c.mode = prey ? DRONE.hunt : DRONE.patrol; c.cooldown = Math.max(c.cooldown, 1.2); }
        break;
      }
    }
    this.integrate(c, dt);
  }

  private checkPhase() {
    if (this.phase !== PHASE.dive) return;
    const all = [...this.divers.values()];
    if (all.length && all.every((d) => d.down)) {
      this.phase = PHASE.wiped; this.phaseTime = WIPE_RESET;
      this.fx.push({ k: 'wiped' });
      return;
    }
    const calm = this.creatures.every((c) => (c.kind === 'lingcod' ? c.mode === LING.calm : c.mode === DRONE.wrecked));
    if (calm) {
      this.phase = PHASE.clear; this.phaseTime = CLEAR_RESET;
      this.fx.push({ k: 'clear', t: this.clock });
    }
  }
}

