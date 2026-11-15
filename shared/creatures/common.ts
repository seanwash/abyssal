import { SURFACE_Y } from '../constants';
import type { ArenaDiver, Fx } from '../arena';
import { boulderExtent, floorHeight, type CreatureSpawn, type Level, type Point } from '../level';
import type { Body } from '../physics';

/** The part of a creature's state that clients see: enough to draw it and to know what the action key does to it. */
export interface CreatureShape {
  kind: string;
  mode: number;
  /** Calm creatures: how calm, 0 to 1. Machines: hull left, 1 to 0. */
  meter: number;
  /** 0 to 1 while an attack winds up, for the client's telegraph. */
  charge: number;
}

export interface Creature extends Body, CreatureShape {
  id: string;
  /** Where the level placed it, such as the lingcod's nest. */
  home: Point;
  yaw: number;
  pitch: number;
  /** Whether a diver held the action key on it this tick. */
  tended: boolean;
}

/** What a species can see and do in the fight. The arena provides it. */
export interface World {
  level: Level;
  /** Seconds since the reef last reset. */
  clock: number;
  alive(): ArenaDiver[];
  /** The diver nearest `from` that is within `within` of `origin`, optionally only one in clear sight of `from`. */
  nearest(from: Point, within: number, origin?: Point, needSight?: boolean): ArenaDiver | null;
  /** Takes air from a diver, which goes down when it runs out. */
  hurt(d: ArenaDiver, air: number): void;
  emit(f: Fx): void;
}

/**
 * Everything the fight needs to know about one kind of creature. Each species lives in its own
 * file in this folder; the arena runs them all the same way and never names a species.
 */
export interface Species<C extends Creature = Creature> {
  /** How fight messages name it, such as "the lingcod". */
  name: string;
  size: { r: number; h: number };
  /** What the action key does to it: hold to calm a sick animal, or press to harpoon a machine. */
  action: 'calm' | 'harpoon';
  /** How far the action key reaches it, in metres of 3D distance. */
  range: number;
  /** Within this distance the action key reaches it whichever way the diver faces. */
  reachAround: number;
  /** Whether the action key needs a clear line from the diver to it. */
  needsSight: boolean;
  /** How far from its home it is dangerous; the bot buddy keeps out of this. */
  territory?: number;
  /** The item it leaves behind once calmed or wrecked, by its key in `shared/loot/items.ts`. */
  drops?: string;
  spawn(at: CreatureSpawn): C;
  /** Whether it is out of the fight: calmed or wrecked. */
  done(c: CreatureShape): boolean;
  /** Whether the action key cannot affect it right now, such as a lingcod mid-lunge. */
  busy(c: CreatureShape): boolean;
  /** A diver used the action key on it this tick. */
  acted(c: C, world: World, by: ArenaDiver, dt: number): void;
  /** One fixed step of behaviour. The arena moves and collides it afterwards. */
  think(c: C, world: World, dt: number): void;
  /** A diver just ran out of air: back off for `seconds` so the other diver can reach them. */
  backOff(c: C, seconds: number): void;
}

export const dist3 = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Velocity that heads for `goal` at up to `speed` while bending around boulders, keeping clear of
 * the floor and staying below the surface. Each nearby boulder pushes outward along its surface
 * normal, and the part of the heading that points into the rock is removed so the body slides
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

/** Eases a body's velocity toward `v`. */
export function moveToward(c: Body, v: Point, response: number, dt: number) {
  const k = 1 - Math.exp(-response * dt);
  c.vx += (v.x - c.vx) * k; c.vy += (v.y - c.vy) * k; c.vz += (v.z - c.vz) * k;
}

/** Eases velocity toward a steered heading for `goal`. */
export function glide(level: Level, c: Creature, size: Species['size'], goal: Point, speed: number, response: number, dt: number, floorGap = 0.5) {
  moveToward(c, steerVelocity(level, c, goal, speed, size.r, size.h, floorGap), response, dt);
}

/** Turns a creature's yaw and pitch toward the direction dx, dy, dz. */
export function faceAlong(c: Creature, dx: number, dy: number, dz: number, dt: number, response = 6) {
  if (Math.hypot(dx, dz) < 1e-3) return;
  let d = Math.atan2(dx, dz) - c.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.yaw += d * (1 - Math.exp(-response * dt));
  const pitch = Math.atan2(-dy, Math.max(0.3, Math.hypot(dx, dz))) * 0.8;
  c.pitch += (pitch - c.pitch) * (1 - Math.exp(-4 * dt));
}

/** The fields every creature starts with; a species adds its own. */
export function baseCreature(at: CreatureSpawn) {
  return {
    id: at.id, kind: at.kind, home: { ...at.at }, x: at.at.x, y: at.at.y, z: at.at.z, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, mode: 0, meter: 0, charge: 0, tended: false,
  };
}
