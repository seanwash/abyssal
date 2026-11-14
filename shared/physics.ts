import RAPIER from '@dimforge/rapier3d-compat';
import {
  DIVER_HALF_LENGTH, DIVER_RADIUS, PLAY_HALF_X, PLAY_HALF_Z, SURFACE_Y,
  SWIM_RESPONSE, SWIM_SPEED, TURN_RESPONSE, VERTICAL_SPEED,
} from './constants';
import { floorHeight, type Level } from './level';
import type { DiverInput, DiverSim } from './protocol';

export { RAPIER };

let ready: Promise<void> | null = null;
export function initPhysics() {
  ready ??= RAPIER.init();
  return ready;
}

const STATIC_GROUPS = (0x0001 << 16) | 0xffff;
const DIVER_GROUPS = (0x0002 << 16) | 0x0001;

/** Static collision world built identically on client and server from the level description. */
export function createWorld(level: Level) {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const n = 64;
  const ex = PLAY_HALF_X + 10, ez = PLAY_HALF_Z + 10;
  const verts = new Float32Array((n + 1) * (n + 1) * 3);
  const idx = new Uint32Array(n * n * 6);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -ex + (2 * ex * i) / n, z = -ez + (2 * ez * j) / n;
      const o = (j * (n + 1) + i) * 3;
      verts[o] = x; verts[o + 1] = floorHeight(x, z); verts[o + 2] = z;
    }
  }
  let k = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.set([a, c, b, b, c, d], k); k += 6;
    }
  }
  world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setCollisionGroups(STATIC_GROUPS));
  for (const b of level.boulders) {
    const desc = RAPIER.ColliderDesc.ball(b.r * 0.92)
      .setTranslation(b.x, b.y, b.z)
      .setCollisionGroups(STATIC_GROUPS);
    world.createCollider(desc);
  }
  world.step();
  return world;
}

export class DiverBody {
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;

  constructor(private world: RAPIER.World, sim: DiverSim) {
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(DIVER_HALF_LENGTH * 0.5, DIVER_RADIUS)
        .setTranslation(sim.x, sim.y, sim.z)
        .setCollisionGroups(DIVER_GROUPS),
    );
    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
    this.controller.disableAutostep();
    this.controller.disableSnapToGround();
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.removeCollider(this.collider, false);
  }

  /** Advances one diver by one fixed step. Used verbatim by the server and by client prediction. */
  step(s: DiverSim, input: DiverInput, dt: number) {
    const k = 1 - Math.exp(-SWIM_RESPONSE * dt);
    s.vx += (input.x * SWIM_SPEED - s.vx) * k;
    s.vz += (input.z * SWIM_SPEED - s.vz) * k;
    s.vy += (input.y * VERTICAL_SPEED - s.vy) * k;

    this.collider.setTranslation({ x: s.x, y: s.y, z: s.z });
    this.controller.computeColliderMovement(
      this.collider,
      { x: s.vx * dt, y: s.vy * dt, z: s.vz * dt },
      undefined,
      DIVER_GROUPS,
    );
    const m = this.controller.computedMovement();
    s.x += m.x; s.y += m.y; s.z += m.z;

    const minY = floorHeight(s.x, s.z) + DIVER_RADIUS + 0.15;
    const maxY = SURFACE_Y - 0.9;
    if (s.y < minY) { s.y = minY; s.vy = Math.max(0, s.vy); }
    if (s.y > maxY) { s.y = maxY; s.vy = Math.min(0, s.vy); }
    const lx = PLAY_HALF_X, lz = PLAY_HALF_Z;
    if (Math.abs(s.x) > lx) { s.x = Math.sign(s.x) * lx; s.vx *= -0.2; }
    if (Math.abs(s.z) > lz) { s.z = Math.sign(s.z) * lz; s.vz *= -0.2; }
    if (dt > 0) {
      const blockedX = Math.abs(m.x) < Math.abs(s.vx * dt) * 0.5;
      const blockedZ = Math.abs(m.z) < Math.abs(s.vz * dt) * 0.5;
      if (blockedX) s.vx *= 0.5;
      if (blockedZ) s.vz *= 0.5;
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
}
