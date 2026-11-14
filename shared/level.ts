import { FLOOR_BASE_Y, PLAY_HALF_X, PLAY_HALF_Z } from './constants';
import { fbm2, mulberry32 } from './rng';

export interface Boulder { x: number; y: number; z: number; r: number; sy: number; rot: number; seed: number }
export interface Kelp { x: number; z: number; floorY: number; height: number; phase: number; lean: number }
export interface Jelly { x: number; y: number; z: number; scale: number; phase: number; hero: boolean }

export interface Level {
  seed: number;
  floorExtentX: number;
  floorExtentZ: number;
  floorRes: number;
  boulders: Boulder[];
  kelp: Kelp[];
  jellies: Jelly[];
  spawns: { x: number; y: number; z: number }[];
}

/** Seafloor height in metres. Positive z is toward the shore, so the floor rises there. */
export function floorHeight(x: number, z: number): number {
  const shore = Math.max(0, z - 6) * 0.11;
  const dunes = (fbm2(x * 0.06, z * 0.06, 4, 11) - 0.5) * 2.6;
  const ripples = Math.sin(x * 0.9 + Math.sin(z * 0.35) * 1.6) * 0.06;
  return FLOOR_BASE_Y + shore + dunes + ripples;
}

const CLEARINGS = [
  { x: 0, z: 2, r: 7 },
  { x: -14, z: -6, r: 5 },
  { x: 13, z: -9, r: 5.5 },
];

function inClearing(x: number, z: number, pad = 0) {
  return CLEARINGS.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);
}

export function buildLevel(seed = 7): Level {
  const rnd = mulberry32(seed);
  const boulders: Boulder[] = [];
  let guard = 0;
  while (boulders.length < 22 && guard++ < 2000) {
    const x = (rnd() * 2 - 1) * (PLAY_HALF_X + 6);
    const z = (rnd() * 2 - 1) * (PLAY_HALF_Z + 4);
    if (inClearing(x, z, 1)) continue;
    const r = 0.9 + rnd() * rnd() * 3.2;
    if (boulders.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + r + 0.6)) continue;
    const sy = 0.55 + rnd() * 0.35;
    boulders.push({ x, z, r, sy, y: floorHeight(x, z) + r * sy * 0.35, rot: rnd() * Math.PI * 2, seed: Math.floor(rnd() * 1e6) });
  }

  const kelp: Kelp[] = [];
  guard = 0;
  const groves = Array.from({ length: 14 }, () => ({
    x: (rnd() * 2 - 1) * (PLAY_HALF_X + 4),
    z: (rnd() * 2 - 1) * (PLAY_HALF_Z + 2),
  }));
  while (kelp.length < 170 && guard++ < 12000) {
    const g = groves[Math.floor(rnd() * groves.length)];
    const ang = rnd() * Math.PI * 2;
    const dist = Math.sqrt(rnd()) * 8;
    const x = g.x + Math.cos(ang) * dist;
    const z = g.z + Math.sin(ang) * dist;
    if (inClearing(x, z, 0.5)) continue;
    if (boulders.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.8)) continue;
    if (kelp.some((k) => Math.hypot(k.x - x, k.z - z) < 0.95)) continue;
    const floorY = floorHeight(x, z);
    kelp.push({ x, z, floorY, height: -floorY - 0.4 - rnd() * 1.5, phase: rnd() * Math.PI * 2, lean: rnd() * Math.PI * 2 });
  }

  const jellies: Jelly[] = [
    { x: 0.6, y: -4.4, z: 1.0, scale: 1.25, phase: 0, hero: true },
    { x: -6.5, y: -3.6, z: -3.0, scale: 0.6, phase: 3.3, hero: false },
    { x: 6.0, y: -2.8, z: -6.5, scale: 0.75, phase: 6.1, hero: false },
  ];
  for (let i = 0; i < 6; i++) {
    jellies.push({
      x: (rnd() * 2 - 1) * 22,
      y: -3 - rnd() * 4,
      z: (rnd() * 2 - 1) * 16,
      scale: 0.45 + rnd() * 0.4,
      phase: rnd() * 10,
      hero: false,
    });
  }

  return {
    seed,
    floorExtentX: 90,
    floorExtentZ: 70,
    floorRes: 96,
    boulders,
    kelp,
    jellies,
    spawns: [
      { x: -1.2, y: -6.5, z: 5 },
      { x: 1.2, y: -6.5, z: 5 },
    ],
  };
}
