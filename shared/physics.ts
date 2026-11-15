import {
  DIVER_HALF_HEIGHT,
  DIVER_RADIUS,
  SURFACE_Y,
  SWIM_RESPONSE,
  SWIM_SPEED,
  TURN_RESPONSE,
  VERTICAL_SPEED,
} from "./constants";
import { boulderExtent, floorHeight, toMap, toWorld } from "./level";
import type { Level } from "./level";
import type { DiverInput, DiverSim } from "./protocol";

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

const CEILING = SURFACE_Y - 0.9;
const PASSES = 3;

/** Lowest height the centre of a body `r` wide and `h` half-tall may reach at x, z: the floor under its middle and edges. */
export const floorLimit = (
  level: Level,
  x: number,
  z: number,
  r: number,
  h: number
) => {
  const o = r * 0.7;
  return (
    Math.max(
      floorHeight(level, x, z),
      floorHeight(level, x + o, z),
      floorHeight(level, x - o, z),
      floorHeight(level, x, z + o),
      floorHeight(level, x, z - o)
    ) +
    h +
    0.05
  );
};

/**
 * Moves the body out of every boulder it overlaps and removes the velocity that points into the
 * rock, so it slides along it. Each boulder is an ellipsoid grown by the body's size.
 * Returns whether anything moved.
 */
const resolveBoulders = (level: Level, s: Body, r: number, h: number) => {
  let moved = false;
  for (const b of level.rocks.near(s.x, s.z)) {
    const e = boulderExtent(b);
    const A = e.a + r;
    const C = e.c + h;
    const dx = s.x - b.x;
    const dy = s.y - b.y;
    const dz = s.z - b.z;
    if (Math.abs(dx) >= A || Math.abs(dz) >= A || Math.abs(dy) >= C) {
      continue;
    }
    const qx = dx / A;
    const qy = dy / C;
    const qz = dz / A;
    const k = Math.hypot(qx, qy, qz);
    if (k >= 1) {
      continue;
    }
    moved = true;
    if (k < 1e-6) {
      s.y = b.y + C;
      continue;
    }
    s.x = b.x + dx / k;
    s.y = b.y + dy / k;
    s.z = b.z + dz / k;
    let nx = qx / A;
    let ny = qy / C;
    let nz = qz / A;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const vn = s.vx * nx + s.vy * ny + s.vz * nz;
    if (vn < 0) {
      s.vx -= vn * nx;
      s.vy -= vn * ny;
      s.vz -= vn * nz;
    }
  }
  return moved;
};

/** Keeps a body inside the zone's bounds, which are a rectangle in the map frame, and stops its velocity outward. */
const keepInBounds = (level: Level, s: Body) => {
  const { u0, u1, v0, v1 } = level.bounds;
  const p = toMap(s.x, s.z);
  const u = Math.min(u1, Math.max(u0, p.u));
  const v = Math.min(v1, Math.max(v0, p.v));
  if (u === p.u && v === p.v) {
    return;
  }
  const w = toWorld(u, v);
  s.x = w.x;
  s.z = w.z;
  const m = toMap(s.vx, s.vz);
  const vu = u === p.u ? m.u : 0;
  const vv = v === p.v ? m.v : 0;
  const back = toWorld(vu, vv);
  s.vx = back.x;
  s.vz = back.z;
};

/**
 * Keeps a body `r` wide and `h` half-tall out of the boulders and the seafloor, below the surface
 * and inside the zone. Ground too shallow to swim over, such as the beach, stops it like a wall:
 * given where it was before this step, `from`, it slides along the shallows instead of crossing.
 */
export const collide = (
  level: Level,
  s: Body,
  r: number,
  h: number,
  from?: { x: number; z: number }
) => {
  if (from && floorLimit(level, s.x, s.z, r, h) > CEILING) {
    if (floorLimit(level, s.x, from.z, r, h) <= CEILING) {
      s.z = from.z;
      s.vz = 0;
    } else if (floorLimit(level, from.x, s.z, r, h) <= CEILING) {
      s.x = from.x;
      s.vx = 0;
    } else {
      s.x = from.x;
      s.z = from.z;
      s.vx = 0;
      s.vz = 0;
    }
  }
  for (let pass = 0; pass < PASSES; pass += 1) {
    let moved = resolveBoulders(level, s, r, h);
    const minY = floorLimit(level, s.x, s.z, r, h);
    if (s.y < minY) {
      s.y = minY;
      s.vy = Math.max(0, s.vy);
      moved = true;
    }
    if (s.y > CEILING) {
      s.y = CEILING;
      s.vy = Math.min(0, s.vy);
    }
    keepInBounds(level, s);
    if (!moved) {
      break;
    }
  }
};

/** Whether the straight line from a to b passes clear of every boulder. */
export const clearLine = (
  level: Level,
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.3));
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const z = a.z + (b.z - a.z) * t;
    if (y < floorHeight(level, x, z)) {
      return false;
    }
    for (const r of level.rocks.near(x, z)) {
      const e = boulderExtent(r);
      if (
        ((x - r.x) ** 2 + (z - r.z) ** 2) / (e.a * e.a) +
          ((y - r.y) / e.c) ** 2 <
        1
      ) {
        return false;
      }
    }
  }
  return true;
};

/**
 * Advances one diver by one fixed step. The server and client prediction both call it, so they
 * agree on where a diver ends up. The diver collides with the seafloor, the boulders, the
 * surface, the shallows and the edges of the zone.
 */
export const stepDiver = (
  level: Level,
  s: DiverSim,
  input: DiverInput,
  dt: number
) => {
  const k = 1 - Math.exp(-SWIM_RESPONSE * dt);
  s.vx += (input.x * SWIM_SPEED - s.vx) * k;
  s.vz += (input.z * SWIM_SPEED - s.vz) * k;
  s.vy += (input.y * VERTICAL_SPEED - s.vy) * k;

  const from = { x: s.x, z: s.z };
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.z += s.vz * dt;

  collide(level, s, DIVER_RADIUS, DIVER_HALF_HEIGHT, from);

  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0.25) {
    const target = Math.atan2(s.vx, s.vz);
    let d = target - s.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += d * (1 - Math.exp(-TURN_RESPONSE * dt));
  }
  s.yaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
};
