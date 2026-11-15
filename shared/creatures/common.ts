import type { ArenaDiver, Fx } from "../arena";
import { SURFACE_Y } from "../constants";
import { boulderExtent, floorHeight } from "../level";
import type { CreatureSpawn, Level, Point } from "../level";
import type { ItemKey } from "../loot/items";
import type { Body } from "../physics";

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
  /** The nearest creature within `within` of `from` that is hunting a diver, such as one that spooks a school. */
  hunting: (from: Point, within: number) => Creature | null;
  alive: () => ArenaDiver[];
  /** The diver nearest `from` that is within `within` of `origin`, optionally only one in clear sight of `from`. */
  nearest: (
    from: Point,
    within: number,
    origin?: Point,
    needSight?: boolean
  ) => ArenaDiver | null;
  /** Takes air from a diver, which goes down when it runs out. */
  hurt: (d: ArenaDiver, air: number) => void;
  emit: (f: Fx) => void;
}

/**
 * Everything the fight needs to know about one kind of creature. Each species lives in its own
 * file in this folder; the arena runs them all the same way and never names a species.
 */
export interface Species<C extends Creature = Creature> {
  /** How fight messages name it, such as "the lingcod". */
  name: string;
  /** The binomial the HUD captions it with; machines have none. */
  latin?: string;
  size: { r: number; h: number };
  /** What the action key does to it: hold to calm a sick animal, or press to harpoon a machine. */
  action: "calm" | "harpoon";
  /** How far the action key reaches it, in metres of 3D distance. */
  range: number;
  /** Within this distance the action key reaches it whichever way the diver faces. */
  reachAround: number;
  /** Whether the action key needs a clear line from the diver to it. */
  needsSight: boolean;
  /** How far from its home it is dangerous; the bot buddy keeps out of this. */
  territory?: number;
  /** The item it leaves behind once calmed or wrecked, by its key in `shared/loot/items.ts`. */
  drops?: ItemKey;
  spawn: (at: CreatureSpawn) => C;
  /** Whether it is out of the fight: calmed or wrecked, or never in it, like a school of fish. */
  done: (c: CreatureShape) => boolean;
  /** Whether it is hiding, such as a cabezon camouflaged on the rock: the action key and the HUD pass over it. */
  hidden?: (c: CreatureShape) => boolean;
  /** Whether it is out of the water, such as a sea lion hauled out on the rocks: the arena neither moves nor collides it. */
  ashore?: (c: CreatureShape) => boolean;
  /** Whether it is hunting a diver right now, which spooks fish nearby. */
  threat?: (c: Creature, world: World) => boolean;
  /** Whether the action key cannot affect it right now, such as a lingcod mid-lunge. */
  busy: (c: CreatureShape) => boolean;
  /** A diver used the action key on it this tick. */
  acted: (c: C, world: World, by: ArenaDiver, dt: number) => void;
  /** One fixed step of behaviour. The arena moves and collides it afterwards. */
  think: (c: C, world: World, dt: number) => void;
  /** A diver just ran out of air: back off for `seconds` so the other diver can reach them. */
  backOff: (c: C, seconds: number) => void;
}

/**
 * A species as the arena holds it, taking any creature. The arena only hands a species creatures
 * it spawned, and `owns` checks that before each call reaches the species' own code.
 */
export const anySpecies = <C extends Creature>(
  sp: Species<C>,
  owns: (c: Creature) => c is C
): Species => {
  const own = (c: Creature) => {
    if (!owns(c)) {
      throw new Error(`${sp.name} was handed a creature of kind ${c.kind}`);
    }
    return c;
  };
  return {
    ...sp,
    acted: (c, world, by, dt) => sp.acted(own(c), world, by, dt),
    think: (c, world, dt) => sp.think(own(c), world, dt),
    backOff: (c, seconds) => sp.backOff(own(c), seconds),
  };
};

export const dist3 = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Velocity that heads for `goal` at up to `speed` while bending around boulders, keeping clear of
 * the floor and staying below the surface. Each nearby boulder pushes outward along its surface
 * normal, and the part of the heading that points into the rock is removed so the body slides
 * around it instead of stopping.
 */
export const steerVelocity = (
  level: Level,
  b: Body,
  goal: Point,
  speed: number,
  r: number,
  h: number,
  floorGap = 0.5
) => {
  let gx = goal.x - b.x;
  let gy = goal.y - b.y;
  let gz = goal.z - b.z;
  const gl = Math.hypot(gx, gy, gz);
  const s = speed * Math.min(1, gl / 1.5);
  if (gl > 1e-6) {
    gx = (gx / gl) * s;
    gy = (gy / gl) * s;
    gz = (gz / gl) * s;
  }
  const px = b.x + b.vx * 0.6;
  const py = b.y + b.vy * 0.6;
  const pz = b.z + b.vz * 0.6;
  for (const rock of level.rocks.near(px, pz)) {
    const e = boulderExtent(rock);
    const A = e.a + r + 0.8;
    const C = e.c + h + 0.8;
    const dx = px - rock.x;
    const dy = py - rock.y;
    const dz = pz - rock.z;
    if (Math.abs(dx) >= A || Math.abs(dz) >= A || Math.abs(dy) >= C) {
      continue;
    }
    const k = Math.hypot(dx / A, dy / C, dz / A);
    if (k >= 1) {
      continue;
    }
    let nx = dx / (A * A);
    let ny = dy / (C * C);
    let nz = dz / (A * A);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const into = gx * nx + gy * ny + gz * nz;
    if (into < 0) {
      gx -= into * nx;
      gy -= into * ny;
      gz -= into * nz;
    }
    const push = (1 - k) * speed * 1.6;
    gx += nx * push;
    gy += ny * push;
    gz += nz * push;
  }
  const floor = floorHeight(level, px, pz) + h + floorGap;
  if (py < floor) {
    gy += (floor - py) * 2.5;
  }
  const ceiling = SURFACE_Y - 1.2;
  if (py > ceiling) {
    gy -= (py - ceiling) * 2.5;
  }
  return { x: gx, y: gy, z: gz };
};

/** Eases a body's velocity toward `v`. */
export const moveToward = (c: Body, v: Point, response: number, dt: number) => {
  const k = 1 - Math.exp(-response * dt);
  c.vx += (v.x - c.vx) * k;
  c.vy += (v.y - c.vy) * k;
  c.vz += (v.z - c.vz) * k;
};

/** Eases velocity toward a steered heading for `goal`. */
export const glide = (
  level: Level,
  c: Creature,
  size: Species["size"],
  goal: Point,
  speed: number,
  response: number,
  dt: number,
  floorGap = 0.5
) => {
  moveToward(
    c,
    steerVelocity(level, c, goal, speed, size.r, size.h, floorGap),
    response,
    dt
  );
};

/** Turns a creature's yaw and pitch toward the direction dx, dy, dz. */
export const faceAlong = (
  c: Creature,
  dx: number,
  dy: number,
  dz: number,
  dt: number,
  response = 6
) => {
  if (Math.hypot(dx, dz) < 1e-3) {
    return;
  }
  let d = Math.atan2(dx, dz) - c.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  c.yaw += d * (1 - Math.exp(-response * dt));
  const pitch = Math.atan2(-dy, Math.max(0.3, Math.hypot(dx, dz))) * 0.8;
  c.pitch += (pitch - c.pitch) * (1 - Math.exp(-4 * dt));
};

/** The fields every creature starts with; a species adds its own. */
export const baseCreature = (at: CreatureSpawn) => ({
  id: at.id,
  kind: at.kind,
  home: { ...at.at },
  x: at.at.x,
  y: at.at.y,
  z: at.at.z,
  vx: 0,
  vy: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  mode: 0,
  meter: 0,
  charge: 0,
  tended: false,
});
