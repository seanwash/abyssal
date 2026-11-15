import { FLOOR_BASE_Y, PLAY_HALF_X, PLAY_HALF_Z } from "./constants";
import { fbm2, mulberry32 } from "./rng";

/** A granite boulder: a vertical ellipsoid `r` wide and `r * sy` tall, centred at x, y, z. */
export interface Boulder {
  x: number;
  y: number;
  z: number;
  r: number;
  sy: number;
  rot: number;
  seed: number;
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
/** Where a creature starts. `kind` names its module in `shared/creatures`; `route` is a loop to patrol, for creatures that patrol. */
export interface CreatureSpawn {
  id: string;
  kind: string;
  at: Point;
  route?: Point[];
}
/** Where a find lies on the reef. `item` names its entry in `shared/loot/items.ts`. */
export interface LootSpot {
  id: string;
  item: string;
  at: Point;
}

export interface Level {
  seed: number;
  floorExtentX: number;
  floorExtentZ: number;
  floorRes: number;
  boulders: Boulder[];
  kelp: Kelp[];
  jellies: Jelly[];
  spawns: Point[];
  creatures: CreatureSpawn[];
  loot: LootSpot[];
  /** The field station's descent line: a float on the surface above x, z, where divers climb out. */
  station: { x: number; z: number };
}

/**
 * The Hollow: a sand channel about six metres deeper than the reef flat, running away from the
 * spawn along the camera's line of sight so its walls never hide a diver inside it.
 */
const HOLLOW = { x0: -2, z0: -1, x1: -16, z1: -15, halfWidth: 9, depth: 6 };

const hollowDepth = (x: number, z: number) => {
  const ax = HOLLOW.x1 - HOLLOW.x0;
  const az = HOLLOW.z1 - HOLLOW.z0;
  const len = Math.hypot(ax, az);
  const ux = ax / len;
  const uz = az / len;
  const px = x - HOLLOW.x0;
  const pz = z - HOLLOW.z0;
  const along = px * ux + pz * uz;
  const across = px * -uz + pz * ux;
  // Stretching the ends makes them ramp more gently than the sides.
  const beyond = along < 0 ? -along : Math.max(0, along - len);
  const d = Math.hypot(across, beyond * 0.6) / HOLLOW.halfWidth;
  return d < 1 ? HOLLOW.depth * (0.5 + 0.5 * Math.cos(Math.PI * d)) : 0;
};

/**
 * Narrow slots in the reef flat, about two metres deep, each running from a closed far end toward
 * the camera and ramping up to the reef at the near end, so their walls never hide a diver in
 * one. The lamp lights by 3D distance, so what lies at the far end shows only to a diver who
 * swims down into the slot.
 */
const CREVICES = [
  { x0: 13.5, z0: -9.5, len: 4, halfWidth: 1.6, depth: 2.2 },
  { x0: 15.6, z0: -2, len: 4, halfWidth: 1.6, depth: 2.2 },
  { x0: -18.5, z0: 1.5, len: 4, halfWidth: 1.5, depth: 2.6 },
];
/** Length of the ramp at a crevice's near end. */
const CREVICE_RAMP = 3.5;
/** Crevices run along the camera's line of sight, away from it toward lower x and z. */
const SLOT = Math.SQRT1_2;

const creviceDepth = (x: number, z: number) => {
  let deepest = 0;
  for (const c of CREVICES) {
    const px = x - c.x0;
    const pz = z - c.z0;
    const along = (px + pz) * SLOT;
    const across = Math.abs(pz - px) * SLOT;
    if (
      across >= c.halfWidth ||
      along <= -c.halfWidth ||
      along >= c.len + CREVICE_RAMP
    ) {
      continue;
    }
    const d = Math.hypot(across, Math.min(0, along)) / c.halfWidth;
    if (d >= 1) {
      continue;
    }
    // A flat bottom with steep walls, rising to the reef along the ramp.
    const k = Math.max(0, (d - 0.5) / 0.5);
    const r = Math.max(0, Math.min(1, (along - c.len) / CREVICE_RAMP));
    deepest = Math.max(
      deepest,
      c.depth * (1 - k * k * (3 - 2 * k)) * (1 - r * r * (3 - 2 * r))
    );
  }
  return deepest;
};

/** Seafloor height in metres. Positive z is toward the shore, so the floor rises there. */
export const floorHeight = (x: number, z: number): number => {
  const shore = Math.max(0, z - 4) * 0.28;
  const dunes = (fbm2(x * 0.08, z * 0.08, 4, 11) - 0.5) * 1.6;
  const ripples = Math.sin(x * 0.9 + Math.sin(z * 0.35) * 1.6) * 0.06;
  return (
    FLOOR_BASE_Y +
    shore +
    dunes +
    ripples -
    hollowDepth(x, z) -
    creviceDepth(x, z)
  );
};

/** Collision half-heights and radii of a boulder, slightly inside the rendered rock. */
export const boulderExtent = (b: Boulder) => ({
  a: b.r * 0.92,
  c: b.r * b.sy * 0.92,
});

/** Height of the first surface straight below x, z: the top of a boulder there, or else the seafloor. */
export const groundHeight = (
  level: Level,
  x: number,
  z: number,
  below = Infinity
) => {
  let y = floorHeight(x, z);
  for (const b of level.boulders) {
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

const spot = (id: string, item: string, x: number, z: number): LootSpot => ({
  id,
  item,
  at: { x, y: floorHeight(x, z) + 0.08, z },
});

const CLEARINGS = [{ x: 0, z: 6, r: 3 }];

const inClearing = (x: number, z: number, pad = 0) =>
  CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);

/**
 * The test reef: a reef flat at about 8 m with a spawn on the shore side, the Hollow dropping to
 * about 14 m, a boulder pinnacle that rises to within 2 m of the surface, an arch you have to
 * dive under, and kelp groves that reach the surface. Small enough to cross in about 15 seconds.
 */
export const buildLevel = (seed = 7): Level => {
  const rnd = mulberry32(seed);
  const boulders: Boulder[] = [];
  const rock = (
    x: number,
    z: number,
    r: number,
    sy: number,
    y = floorHeight(x, z) + r * sy * 0.35
  ) => {
    const b = {
      x,
      y,
      z,
      r,
      sy,
      rot: rnd() * Math.PI * 2,
      seed: Math.floor(rnd() * 1e6),
    };
    boulders.push(b);
    return b;
  };
  const onTop = (below: Boulder, r: number, sy: number, dx = 0, dz = 0) => {
    const { c } = boulderExtent(below);
    return rock(
      below.x + dx,
      below.z + dz,
      r,
      sy,
      below.y + c * 0.8 + r * sy * 0.5
    );
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
  rock(-13.5, -12, 2, 0.7);
  rock(-6.5, -5.5, 0.9, 0.9);
  rock(-1, -10, 2.4, 0.65);
  rock(-16, -3, 2.2, 0.7);

  // Around the edges.
  rock(16, 8, 2.8, 0.65);
  rock(18, -12, 3, 0.6);
  rock(-19, 12, 2.5, 0.6);
  rock(5, 12, 1.6, 0.7);
  rock(13, -14, 2, 0.7);
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
    let guard = 0;
    let placed = 0;
    while (placed < g.n && guard < 2000) {
      guard += 1;
      const ang = rnd() * Math.PI * 2;
      const dist = Math.sqrt(rnd()) * g.r;
      const x = g.x + Math.cos(ang) * dist;
      const z = g.z + Math.sin(ang) * dist;
      if (inClearing(x, z, 0.5)) {
        continue;
      }
      if (boulders.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.95)) {
        continue;
      }
      if (kelp.some((k) => Math.hypot(k.x - x, k.z - z) < 0.95)) {
        continue;
      }
      const floorY = floorHeight(x, z);
      kelp.push({
        x,
        z,
        floorY,
        height: -floorY - 0.4 - rnd() * 1.5,
        phase: rnd() * Math.PI * 2,
        lean: rnd() * Math.PI * 2,
      });
      placed += 1;
    }
  }

  const jellies: Jelly[] = [
    { x: -6, y: -6.5, z: -5, scale: 1.25, phase: 0, hero: true },
    { x: 5, y: -3.5, z: -4, scale: 0.6, phase: 3.3, hero: false },
    { x: 8, y: -3, z: 7, scale: 0.75, phase: 6.1, hero: false },
  ];
  for (let i = 0; i < 3; i += 1) {
    jellies.push({
      x: (rnd() * 2 - 1) * (PLAY_HALF_X - 4),
      y: -2.5 - rnd() * 3,
      z: (rnd() * 2 - 1) * (PLAY_HALF_Z - 3),
      scale: 0.45 + rnd() * 0.4,
      phase: rnd() * 10,
      hero: false,
    });
  }

  // The drone's midwater loop passes either side of the pinnacle, so it has to steer around it.
  const patrol = [
    { x: 13, y: -4, z: -12 },
    { x: 17, y: -5, z: -2 },
    { x: 12, y: -3.5, z: 4 },
    { x: 3, y: -4.5, z: -1 },
  ];

  return {
    seed,
    floorExtentX: (PLAY_HALF_X + 14) * 2,
    floorExtentZ: (PLAY_HALF_Z + 12) * 2,
    // Fine enough that the crevices' walls stay steep.
    floorRes: 144,
    boulders,
    kelp,
    jellies,
    spawns: [
      { x: -1.2, y: -4.5, z: 6 },
      { x: 1.2, y: -4.5, z: 6 },
    ],
    creatures: [
      // The lingcod guards its egg mass on the floor of the Hollow.
      {
        id: "lingcod",
        kind: "lingcod",
        at: { x: -8.3, y: floorHeight(-8.3, -7), z: -7 },
      },
      { id: "drone", kind: "drone", at: patrol[0], route: patrol },
    ],
    loot: [
      // On open sand near the line, so the first find teaches bagging.
      spot("urchin-flat", "urchin-test", 3.5, 9),
      spot("urchin-pinnacle", "urchin-test", 12.8, -2.3),
      // Low in the kelp groves.
      spot("snail-grove", "turban-snail", 7.2, 0.2),
      spot("snail-north", "turban-snail", 13.5, 10.5),
      // Under the arch's cap.
      spot("abalone-arch", "abalone-shell", -9, 9.3),
      // At the far ends of the crevices.
      spot("star-crevice", "sunflower-star", 14.15, -8.85),
      spot("shells-crevice", "capitola-shells", 16.25, -1.35),
      spot("tooth-crevice", "megalodon-tooth", -17.85, 2.15),
      // On the floor of the Hollow, past the lingcod.
      spot("bloom-hollow", "bloom-sample", -11, -13.5),
    ],
    station: { x: 0, z: 7.2 },
  };
};
