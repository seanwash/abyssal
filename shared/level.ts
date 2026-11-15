/**
 * What a level is made of, and the geometry queries the server and both clients share. A zone
 * module in `shared/zones` authors one: its ground, rocks, kelp, creatures, finds, stations and
 * areas. Everything here is deterministic, so the server and each browser build the same level.
 */

/** A granite boulder or a lump of dumped fill: a vertical ellipsoid `r` wide and `r * sy` tall, centred at x, y, z. */
export interface Boulder {
  x: number;
  y: number;
  z: number;
  r: number;
  sy: number;
  rot: number;
  seed: number;
  stone: "granite" | "fill";
}
export interface Kelp {
  x: number;
  z: number;
  floorY: number;
  height: number;
  phase: number;
  lean: number;
}
export interface Jelly {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
  hero: boolean;
}
export interface Point {
  x: number;
  y: number;
  z: number;
}
/** A point in the map frame: `u` metres east and `v` metres north. */
export interface MapPoint {
  u: number;
  v: number;
}
/** Where a creature starts. `kind` names its module in `shared/creatures`; `route` is a loop to patrol, for creatures that patrol. */
export interface CreatureSpawn {
  id: string;
  kind: string;
  at: Point;
  route?: Point[];
}
/** Where a find lies. `item` names its entry in `shared/loot/items.ts`. */
export interface LootSpot {
  id: string;
  item: string;
  at: Point;
}
/** A field station's descent line: a float on the surface above x, z, where divers climb out. */
export interface Station {
  id: string;
  name: string;
  x: number;
  z: number;
}

/** How the water looks in one part of a zone: its colour, how far it lets a lamp see, and how much daylight reaches in. */
export interface WaterLight {
  /** Colour the water fades to away from the lamps. */
  water: number;
  /** How much of a far scene the water hides, 0 to 1. */
  dark: number;
  /** Lamp reach, as a multiple of the default. */
  reach: number;
  /** Daylight through the surface: sun, god rays and caustics, 0 to 1. */
  sun: number;
}

/** One beat of a zone's route: a named place divers enter, with its own light. */
export interface Area {
  id: string;
  /** Its number on the route, counting from 1. */
  beat: number;
  name: string;
  sub: string;
  /** How long the beat is meant to take, in minutes. */
  minutes: number;
  optional?: boolean;
  at: MapPoint;
  /** Its extent around `at`, in metres. */
  r: number;
  light: WaterLight;
}

/**
 * The seafloor, sampled every `step` metres on a grid in the map frame, with what it is made of at
 * each sample: `reef` granite, `barren` grazed bare rock, and `fill` dumped rubble, each 0 to 255.
 * Wherever all three are 0 it is sand.
 */
export interface Ground {
  u0: number;
  v0: number;
  step: number;
  nu: number;
  nv: number;
  height: Float32Array;
  reef: Uint8Array;
  barren: Uint8Array;
  fill: Uint8Array;
}

export interface Level {
  seed: number;
  name: string;
  ground: Ground;
  /** The swimmable area in the map frame. */
  bounds: { u0: number; u1: number; v0: number; v1: number };
  boulders: Boulder[];
  rocks: RockGrid;
  kelp: Kelp[];
  jellies: Jelly[];
  spawns: Point[];
  creatures: CreatureSpawn[];
  loot: LootSpot[];
  stations: Station[];
  areas: Area[];
}

/**
 * The map frame is the zone as its plate draws it: u east and v north, with the shore to the
 * south. North is straight up the screen in the isometric view and east is to the right, so the
 * route reads the same in the dive as on the map.
 */
export const toWorld = (u: number, v: number) => ({
  x: (u - v) * Math.SQRT1_2,
  z: -(u + v) * Math.SQRT1_2,
});
export const toMap = (x: number, z: number): MapPoint => ({
  u: (x - z) * Math.SQRT1_2,
  v: -(x + z) * Math.SQRT1_2,
});

/** Seafloor height in metres at world x, z: the ground grid, blended between its samples. */
export const floorHeight = (level: Level, x: number, z: number): number => {
  const g = level.ground;
  const fu = Math.min(
    Math.max(((x - z) * Math.SQRT1_2 - g.u0) / g.step, 0),
    g.nu - 1.0001
  );
  const fv = Math.min(
    Math.max((-(x + z) * Math.SQRT1_2 - g.v0) / g.step, 0),
    g.nv - 1.0001
  );
  const i = Math.floor(fu);
  const j = Math.floor(fv);
  const a = fu - i;
  const b = fv - j;
  const k = j * g.nu + i;
  const h = g.height;
  return (
    (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) +
    (h[k + g.nu] * (1 - a) + h[k + g.nu + 1] * a) * b
  );
};

/** Collision half-heights and radii of a boulder, slightly inside the rendered rock. */
export const boulderExtent = (b: Boulder) => ({
  a: b.r * 0.92,
  c: b.r * b.sy * 0.92,
});

/** How far past a boulder's edge `RockGrid.near` still finds it: enough for any body's size and steering margin. */
const NEAR_PAD = 3;
const CELL = 8;

/**
 * The boulders bucketed on an 8 m grid, so collision and steering look only at the rocks near a
 * point instead of every rock in the zone.
 */
export class RockGrid {
  private cells = new Map<number, Boulder[]>();
  private static readonly none: readonly Boulder[] = [];

  constructor(boulders: Boulder[]) {
    for (const b of boulders) {
      const reach = b.r + NEAR_PAD;
      const i0 = Math.floor((b.x - reach) / CELL);
      const i1 = Math.floor((b.x + reach) / CELL);
      const j0 = Math.floor((b.z - reach) / CELL);
      const j1 = Math.floor((b.z + reach) / CELL);
      for (let i = i0; i <= i1; i += 1) {
        for (let j = j0; j <= j1; j += 1) {
          const key = RockGrid.key(i, j);
          const list = this.cells.get(key);
          if (list) {
            list.push(b);
          } else {
            this.cells.set(key, [b]);
          }
        }
      }
    }
  }

  private static key(i: number, j: number) {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** The boulders within about three metres of their edge from x, z, and possibly a few more. */
  near(x: number, z: number): readonly Boulder[] {
    return (
      this.cells.get(
        RockGrid.key(Math.floor(x / CELL), Math.floor(z / CELL))
      ) ?? RockGrid.none
    );
  }
}

/** Height of the first surface straight below x, z: the top of a boulder there, or else the seafloor. */
export const groundHeight = (
  level: Level,
  x: number,
  z: number,
  below = Infinity
) => {
  let y = floorHeight(level, x, z);
  for (const b of level.rocks.near(x, z)) {
    const e = boulderExtent(b);
    const q = 1 - ((x - b.x) ** 2 + (z - b.z) ** 2) / (e.a * e.a);
    if (q <= 0) {
      continue;
    }
    const top = b.y + e.c * Math.sqrt(q);
    if (top > y && top < below) {
      y = top;
    }
  }
  return y;
};

/** The area of the route a point belongs to: the one whose extent it lies deepest inside, or nearest outside. */
export const areaAt = (level: Level, x: number, z: number) => {
  const p = toMap(x, z);
  let best: Area | null = null;
  let bestK = Infinity;
  for (const a of level.areas) {
    const k = Math.hypot(p.u - a.at.u, p.v - a.at.v) / a.r;
    if (k < bestK) {
      best = a;
      bestK = k;
    }
  }
  return best;
};

/** The station whose line is nearest x, z. */
export const nearestStation = (level: Level, x: number, z: number) => {
  let [best] = level.stations;
  let bestD = Infinity;
  for (const s of level.stations) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
};
