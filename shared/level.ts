import { FLOOR_BASE_Y, PLAY_HALF_X, PLAY_HALF_Z } from './constants';
import { fbm2, mulberry32 } from './rng';

/** A granite boulder: a vertical ellipsoid `r` wide and `r * sy` tall, centred at x, y, z. */
export interface Boulder { x: number; y: number; z: number; r: number; sy: number; rot: number; seed: number }
export interface Kelp { x: number; z: number; floorY: number; height: number; phase: number; lean: number }
export interface Jelly { x: number; y: number; z: number; scale: number; phase: number; hero: boolean }
export interface Point { x: number; y: number; z: number }

export interface Level {
  seed: number;
  floorExtentX: number;
  floorExtentZ: number;
  floorRes: number;
  boulders: Boulder[];
  kelp: Kelp[];
  jellies: Jelly[];
  spawns: Point[];
  /** The lingcod's egg mass on the floor of the Hollow, and the loop the drone patrols midwater. */
  nest: Point;
  patrol: Point[];
}

/**
 * The Hollow: a sand channel about six metres deeper than the reef flat, running away from the
 * spawn along the camera's line of sight so its walls never hide a diver inside it.
 */
const HOLLOW = { x0: -2, z0: -1, x1: -16, z1: -15, halfWidth: 9, depth: 6 };

function hollowDepth(x: number, z: number) {
  const ax = HOLLOW.x1 - HOLLOW.x0, az = HOLLOW.z1 - HOLLOW.z0;
  const len = Math.hypot(ax, az);
  const ux = ax / len, uz = az / len;
  const px = x - HOLLOW.x0, pz = z - HOLLOW.z0;
  const along = px * ux + pz * uz;
  const across = px * -uz + pz * ux;
  // Stretching the ends makes them ramp more gently than the sides.
  const beyond = along < 0 ? -along : Math.max(0, along - len);
  const d = Math.hypot(across, beyond * 0.6) / HOLLOW.halfWidth;
  return d < 1 ? HOLLOW.depth * (0.5 + 0.5 * Math.cos(Math.PI * d)) : 0;
}

/** Seafloor height in metres. Positive z is toward the shore, so the floor rises there. */
export function floorHeight(x: number, z: number): number {
  const shore = Math.max(0, z - 4) * 0.28;
  const dunes = (fbm2(x * 0.08, z * 0.08, 4, 11) - 0.5) * 1.6;
  const ripples = Math.sin(x * 0.9 + Math.sin(z * 0.35) * 1.6) * 0.06;
  return FLOOR_BASE_Y + shore + dunes + ripples - hollowDepth(x, z);
}

/** Collision half-heights and radii of a boulder, slightly inside the rendered rock. */
export function boulderExtent(b: Boulder) {
  return { a: b.r * 0.92, c: b.r * b.sy * 0.92 };
}

/** Height of the first surface straight below x, z: the top of a boulder there, or else the seafloor. */
export function groundHeight(level: Level, x: number, z: number, below = Infinity) {
  let y = floorHeight(x, z);
  for (const b of level.boulders) {
    const e = boulderExtent(b);
    const q = 1 - ((x - b.x) ** 2 + (z - b.z) ** 2) / (e.a * e.a);
    if (q <= 0) continue;
    const top = b.y + e.c * Math.sqrt(q);
    if (top > y && top < below) y = top;
  }
  return y;
}

const CLEARINGS = [{ x: 0, z: 6, r: 3 }];

function inClearing(x: number, z: number, pad = 0) {
  return CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);
}

/**
 * The test reef: a reef flat at about 8 m with a spawn on the shore side, the Hollow dropping to
 * about 14 m, a boulder pinnacle that rises to within 2 m of the surface, an arch you have to
 * dive under, and kelp groves that reach the surface. Small enough to cross in about 15 seconds.
 */
export function buildLevel(seed = 7): Level {
  const rnd = mulberry32(seed);
  const boulders: Boulder[] = [];
  const rock = (x: number, z: number, r: number, sy: number, y = floorHeight(x, z) + r * sy * 0.35) => {
    const b = { x, y, z, r, sy, rot: rnd() * Math.PI * 2, seed: Math.floor(rnd() * 1e6) };
    boulders.push(b);
    return b;
  };
  const onTop = (below: Boulder, r: number, sy: number, dx = 0, dz = 0) => {
    const c = boulderExtent(below).c;
    return rock(below.x + dx, below.z + dz, r, sy, below.y + c * 0.8 + r * sy * 0.5);
  };

  // The pinnacle.
  const base = rock(10, -5, 3.2, 0.7);
  const mid = onTop(base, 2.2, 0.75, -0.4, 0.3);
  onTop(mid, 1.3, 0.8, 0.3, -0.2);

  // The arch: two pillars and a cap, with about a metre of water under the cap.
  const archFloor = floorHeight(-9, 9);
  rock(-12, 9, 1.8, 1.2, archFloor + 0.9);
  rock(-6, 9, 1.8, 1.2, archFloor + 0.9);
  rock(-9, 9, 3.4, 0.4, archFloor + 3.3);

  // In and along the Hollow.
  rock(-10, -8.5, 1.4, 0.8);
  rock(-13.5, -12, 2.0, 0.7);
  rock(-6.5, -5.5, 0.9, 0.9);
  rock(-1, -10, 2.4, 0.65);
  rock(-16, -3, 2.2, 0.7);

  // Around the edges.
  rock(16, 8, 2.8, 0.65);
  rock(18, -12, 3.0, 0.6);
  rock(-19, 12, 2.5, 0.6);
  rock(5, 12, 1.6, 0.7);
  rock(13, -14, 2.0, 0.7);
  rock(-21, -9, 2.6, 0.6);
  rock(3, -14, 1.5, 0.75);

  const groves = [
    { x: 6, z: 1, r: 4, n: 22 },
    { x: 14, z: -7, r: 4.5, n: 24 },
    { x: -15, z: 2, r: 4, n: 18 },
    { x: 14, z: 11, r: 4, n: 18 },
    { x: -5, z: -15, r: 3.5, n: 14 },
  ];
  const kelp: Kelp[] = [];
  for (const g of groves) {
    let placed = 0, guard = 0;
    while (placed < g.n && guard++ < 2000) {
      const ang = rnd() * Math.PI * 2;
      const dist = Math.sqrt(rnd()) * g.r;
      const x = g.x + Math.cos(ang) * dist;
      const z = g.z + Math.sin(ang) * dist;
      if (inClearing(x, z, 0.5)) continue;
      if (boulders.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.95)) continue;
      if (kelp.some((k) => Math.hypot(k.x - x, k.z - z) < 0.95)) continue;
      const floorY = floorHeight(x, z);
      kelp.push({ x, z, floorY, height: -floorY - 0.4 - rnd() * 1.5, phase: rnd() * Math.PI * 2, lean: rnd() * Math.PI * 2 });
      placed++;
    }
  }

  const jellies: Jelly[] = [
    { x: -6, y: -6.5, z: -5, scale: 1.25, phase: 0, hero: true },
    { x: 5, y: -3.5, z: -4, scale: 0.6, phase: 3.3, hero: false },
    { x: 8, y: -3, z: 7, scale: 0.75, phase: 6.1, hero: false },
  ];
  for (let i = 0; i < 3; i++) {
    jellies.push({
      x: (rnd() * 2 - 1) * (PLAY_HALF_X - 4),
      y: -2.5 - rnd() * 3,
      z: (rnd() * 2 - 1) * (PLAY_HALF_Z - 3),
      scale: 0.45 + rnd() * 0.4,
      phase: rnd() * 10,
      hero: false,
    });
  }

  return {
    seed,
    floorExtentX: (PLAY_HALF_X + 14) * 2,
    floorExtentZ: (PLAY_HALF_Z + 12) * 2,
    floorRes: 80,
    boulders,
    kelp,
    jellies,
    spawns: [
      { x: -1.2, y: -4.5, z: 6 },
      { x: 1.2, y: -4.5, z: 6 },
    ],
    nest: { x: -8.3, y: floorHeight(-8.3, -7), z: -7 },
    // The loop passes either side of the pinnacle, so the drone has to steer around it.
    patrol: [
      { x: 3, y: -4.5, z: -1 },
      { x: 13, y: -4, z: -12 },
      { x: 17, y: -5, z: -2 },
      { x: 12, y: -3.5, z: 4 },
    ],
  };
}
