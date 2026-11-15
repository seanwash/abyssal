import type { Point } from '../level';
import { baseCreature, dist3, faceAlong, glide, moveToward, type Creature, type Species } from './common';

/**
 * The operator's survey drone. It patrols a midwater loop, hunts a diver it can see, and charges
 * an electric shock. The action key harpoons it; a hit while it charges knocks it out of the charge.
 */

export const DRONE = { patrol: 0, hunt: 1, charge: 2, cooldown: 3, wrecked: 4 } as const;
export const SHOCK_RADIUS = 2.6;

const HITS = 8;
const SHOCK_AIR = 15;
const SIGHT = 8;

interface Drone extends Creature {
  timer: number;
  cooldown: number;
  /** The last place it saw its prey. */
  lock: Point;
  route: Point[];
  waypoint: number;
  /** Seconds since it last saw its prey. */
  lost: number;
}

const size = { r: 0.4, h: 0.35 };

export const drone: Species<Drone> = {
  name: 'the drone',
  size,
  action: 'harpoon',
  range: 7.5,
  reachAround: 1.2,
  needsSight: true,
  drops: 'drone-housing',

  spawn(s) {
    return {
      ...baseCreature(s), mode: DRONE.patrol, meter: 1,
      timer: 0, cooldown: 0, lock: { ...s.at }, route: s.route ?? [s.at], waypoint: 0, lost: 0,
    };
  },

  done: (c) => c.mode === DRONE.wrecked,
  busy: () => false,

  acted(c, world, by) {
    c.meter = Math.max(0, c.meter - 1 / HITS);
    const dx = c.x - by.sim.x, dy = c.y - by.sim.y, dz = c.z - by.sim.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    c.vx += dx / l * 2.2; c.vy += dy / l * 2.2; c.vz += dz / l * 2.2;
    if (c.meter <= 1e-6) {
      c.mode = DRONE.wrecked; c.charge = 0;
      world.emit({ k: 'wrecked', id: c.id, by: by.id });
    } else if (c.mode === DRONE.charge) {
      c.mode = DRONE.cooldown; c.timer = 0.9; c.charge = 0;
    }
  },

  backOff(c, seconds) {
    c.cooldown = Math.max(c.cooldown, seconds);
    if (c.mode === DRONE.charge) { c.mode = DRONE.cooldown; c.timer = 1.6; c.charge = 0; }
  },

  think(c, world, dt) {
    c.cooldown = Math.max(0, c.cooldown - dt);
    if (c.mode === DRONE.wrecked) {
      c.vy -= 2.5 * dt;
      c.vx *= Math.exp(-2 * dt); c.vz *= Math.exp(-2 * dt);
      c.pitch += (0.9 - c.pitch) * (1 - Math.exp(-1.5 * dt));
      return;
    }
    const prey = world.nearest(c, SIGHT, c, true);
    switch (c.mode) {
      case DRONE.patrol: {
        const wp = c.route[c.waypoint % c.route.length];
        if (dist3(c, wp) < 1.5) c.waypoint = (c.waypoint + 1) % c.route.length;
        glide(world.level, c, size, wp, 1.7, 2, dt);
        faceAlong(c, c.vx, c.vy, c.vz, dt, 3);
        if (prey) { c.mode = DRONE.hunt; c.lost = 0; }
        break;
      }
      case DRONE.hunt: {
        if (!prey) {
          c.lost += dt;
          if (c.lost > 2.5) { c.mode = DRONE.patrol; break; }
        } else {
          c.lost = 0;
          c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z };
        }
        const p = c.lock;
        const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1;
        const goal = { x: p.x + dx / l * 1.8, y: p.y + 0.6, z: p.z + dz / l * 1.8 };
        glide(world.level, c, size, goal, 2.6, 2.5, dt);
        faceAlong(c, p.x - c.x, p.y - c.y, p.z - c.z, dt);
        if (prey && dist3(c, prey.sim) < 2.8 && c.cooldown <= 0) { c.mode = DRONE.charge; c.timer = 1.0; }
        break;
      }
      case DRONE.charge: {
        c.timer -= dt;
        c.charge = 1 - c.timer;
        moveToward(c, { x: 0, y: 0, z: 0 }, 3, dt);
        if (c.timer <= 0) {
          c.charge = 0;
          world.emit({ k: 'shock', id: c.id, p: [c.x, c.y, c.z] });
          for (const d of world.alive()) {
            const dd = dist3(c, d.sim);
            if (dd > SHOCK_RADIUS) continue;
            const l = dd || 1;
            d.sim.vx += (d.sim.x - c.x) / l * 3.5; d.sim.vy += (d.sim.y - c.y) / l * 3.5; d.sim.vz += (d.sim.z - c.z) / l * 3.5;
            world.hurt(d, SHOCK_AIR);
            world.emit({ k: 'bite', id: d.id, p: [d.sim.x, d.sim.y, d.sim.z] });
          }
          c.mode = DRONE.cooldown; c.timer = 1.6;
        }
        break;
      }
      case DRONE.cooldown: {
        c.timer -= dt;
        const away = prey ? { x: c.x * 2 - prey.sim.x, y: c.y + 0.5, z: c.z * 2 - prey.sim.z } : c;
        glide(world.level, c, size, away, 1.4, 2, dt);
        if (c.timer <= 0) { c.mode = prey ? DRONE.hunt : DRONE.patrol; c.cooldown = Math.max(c.cooldown, 1.2); }
        break;
      }
    }
  },
};
