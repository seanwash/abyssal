import {
  DIVER_HALF_HEIGHT, DIVER_RADIUS, PLAY_HALF_X, PLAY_HALF_Z, SURFACE_Y,
  SWIM_RESPONSE, SWIM_SPEED, TURN_RESPONSE, VERTICAL_SPEED,
} from './constants';
import { boulderExtent, floorHeight, type Level } from './level';
import type { DiverInput, DiverSim } from './protocol';

const FLOOR_CLEARANCE = DIVER_HALF_HEIGHT + 0.05;
const CEILING = SURFACE_Y - 0.9;
const PASSES = 3;

/** Lowest height the diver's centre may reach at x, z: the floor under the middle and edges of the diver. */
function floorLimit(x: number, z: number) {
  const o = DIVER_RADIUS * 0.7;
  return Math.max(
    floorHeight(x, z),
    floorHeight(x + o, z), floorHeight(x - o, z),
    floorHeight(x, z + o), floorHeight(x, z - o),
  ) + FLOOR_CLEARANCE;
}

/**
 * Moves the diver out of every boulder it overlaps and removes the velocity that points into the
 * rock, so the diver slides along it. Each boulder is an ellipsoid grown by the diver's size.
 * Returns whether anything moved.
 */
function resolveBoulders(level: Level, s: DiverSim) {
  let moved = false;
  for (const b of level.boulders) {
    const e = boulderExtent(b);
    const A = e.a + DIVER_RADIUS, C = e.c + DIVER_HALF_HEIGHT;
    const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z;
    if (Math.abs(dx) >= A || Math.abs(dz) >= A || Math.abs(dy) >= C) continue;
    const qx = dx / A, qy = dy / C, qz = dz / A;
    const k = Math.hypot(qx, qy, qz);
    if (k >= 1) continue;
    moved = true;
    if (k < 1e-6) { s.y = b.y + C; continue; }
    s.x = b.x + dx / k; s.y = b.y + dy / k; s.z = b.z + dz / k;
    let nx = qx / A, ny = qy / C, nz = qz / A;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const vn = s.vx * nx + s.vy * ny + s.vz * nz;
    if (vn < 0) { s.vx -= vn * nx; s.vy -= vn * ny; s.vz -= vn * nz; }
  }
  return moved;
}

/**
 * Advances one diver by one fixed step. The server and client prediction both call it, so they
 * agree on where a diver ends up. The diver collides with the seafloor, the boulders, the
 * surface and the edges of the play area.
 */
export function stepDiver(level: Level, s: DiverSim, input: DiverInput, dt: number) {
  const k = 1 - Math.exp(-SWIM_RESPONSE * dt);
  s.vx += (input.x * SWIM_SPEED - s.vx) * k;
  s.vz += (input.z * SWIM_SPEED - s.vz) * k;
  s.vy += (input.y * VERTICAL_SPEED - s.vy) * k;

  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;

  for (let pass = 0; pass < PASSES; pass++) {
    let moved = resolveBoulders(level, s);
    const minY = floorLimit(s.x, s.z);
    if (s.y < minY) { s.y = minY; s.vy = Math.max(0, s.vy); moved = true; }
    if (s.y > CEILING) { s.y = CEILING; s.vy = Math.min(0, s.vy); }
    if (Math.abs(s.x) > PLAY_HALF_X) { s.x = Math.sign(s.x) * PLAY_HALF_X; s.vx *= -0.2; }
    if (Math.abs(s.z) > PLAY_HALF_Z) { s.z = Math.sign(s.z) * PLAY_HALF_Z; s.vz *= -0.2; }
    if (!moved) break;
  }

  const speed = Math.hypot(s.vx, s.vz);
  if (speed > 0.25) {
    const target = Math.atan2(s.vx, s.vz);
    let d = target - s.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    s.yaw += d * (1 - Math.exp(-TURN_RESPONSE * dt));
  }
  s.yaw = Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw));
}
