import {
  DIVER_HALF_HEIGHT, DIVER_RADIUS, PLAY_HALF_X, PLAY_HALF_Z, SURFACE_Y,
  SWIM_RESPONSE, SWIM_SPEED, TURN_RESPONSE, VERTICAL_SPEED,
} from './constants';
import { boulderExtent, floorHeight } from './level';
import type { Level } from './level';
import type { DiverInput, DiverSim } from './protocol';

export interface Body { x: number; y: number; z: number; vx: number; vy: number; vz: number }

const CEILING = SURFACE_Y - 0.9;
const PASSES = 3;

/** Lowest height the centre of a body `r` wide and `h` half-tall may reach at x, z: the floor under its middle and edges. */
export const floorLimit = (x: number, z: number, r: number, h: number) => {
  const o = r * 0.7;
  return Math.max(
    floorHeight(x, z),
    floorHeight(x + o, z), floorHeight(x - o, z),
    floorHeight(x, z + o), floorHeight(x, z - o),
  ) + h + 0.05;
};

/**
 * Moves the body out of every boulder it overlaps and removes the velocity that points into the
 * rock, so it slides along it. Each boulder is an ellipsoid grown by the body's size.
 * Returns whether anything moved.
 */
const resolveBoulders = (level: Level, s: Body, r: number, h: number) => {
  let moved = false;
  for (const b of level.boulders) {
    const e = boulderExtent(b);
    const A = e.a + r; const C = e.c + h;
    const dx = s.x - b.x; const dy = s.y - b.y; const dz = s.z - b.z;
    if (Math.abs(dx) >= A || Math.abs(dz) >= A || Math.abs(dy) >= C) {continue;}
    const qx = dx / A; const qy = dy / C; const qz = dz / A;
    const k = Math.hypot(qx, qy, qz);
    if (k >= 1) {continue;}
    moved = true;
    if (k < 1e-6) { s.y = b.y + C; continue; }
    s.x = b.x + dx / k; s.y = b.y + dy / k; s.z = b.z + dz / k;
    let nx = qx / A; let ny = qy / C; let nz = qz / A;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const vn = s.vx * nx + s.vy * ny + s.vz * nz;
    if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; s.vz -= vn * nz; }
  }
  return moved;
};

/** Keeps a body `r` wide and `h` half-tall out of the boulders and the seafloor, below the surface and inside the play area. */
export const collide = (level: Level, s: Body, r: number, h: number) => {
  for (let pass = 0; pass < PASSES; pass += 1) {
    let moved = resolveBoulders(level, s, r, h);
    const minY = floorLimit(s.x, s.z, r, h);
    if (s.y < minY) { s.y = minY; s.vy = Math.max(0, s.vy); moved = true; }
    if (s.y > CEILING) { s.y = CEILING; s.vy = Math.min(0, s.vy); }
    if (Math.abs(s.x) > PLAY_HALF_X) { s.x = Math.sign(s.x) * PLAY_HALF_X; s.vx *= -0.2; }
    if (Math.abs(s.z) > PLAY_HALF_Z) { s.z = Math.sign(s.z) * PLAY_HALF_Z; s.vz *= -0.2; }
    if (!moved) {break;}
  }
};

/** Whether the straight line from a to b passes clear of every boulder. */
export const clearLine = (level: Level, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / 0.3));
  for (let i = 1; i < n; i += 1) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t; const y = a.y + (b.y - a.y) * t; const z = a.z + (b.z - a.z) * t;
    if (y < floorHeight(x, z)) {return false;}
    for (const r of level.boulders) {
      const e = boulderExtent(r);
      if (((x - r.x) ** 2 + (z - r.z) ** 2) / (e.a * e.a) + ((y - r.y) / e.c) ** 2 < 1) {return false;}
    }
  }
  return true;
};

/**
 * Advances one diver by one fixed step. The server and client prediction both call it, so they
 * agree on where a diver ends up. The diver collides with the seafloor, the boulders, the
 * surface and the edges of the play area.
 */
export const stepDiver = (level: Level, s: DiverSim, input: DiverInput, dt: number) => {
  const k = 1 - Math.exp(-SWIM_RESPONSE * dt);
  s.vx += (input.x * SWIM_SPEED - s.vx) * k;
  s.vz += (input.z * SWIM_SPEED - s.vz) * k;
  s.vy += (input.y * VERTICAL_SPEED - s.vy) * k;

  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;

  collide(level, s, DIVER_RADIUS, DIVER_HALF_HEIGHT);

  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0.25) {
    const target = Math.atan2(s.vx, s.vz);
    let d = target - s.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += d * (1 - Math.exp(-TURN_RESPONSE * dt));
  }
  s.yaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
};
