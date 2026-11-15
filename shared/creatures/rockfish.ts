import type { Point } from "../level";
import { baseCreature, faceAlong, glide } from "./common";
import type { Creature, Species, World } from "./common";

/**
 * A school of blue rockfish (Sebastes mystinus), one creature for the whole school: its position
 * is the school's centre, and the view draws the fish. It mills over its home in the kelp, and
 * scatters away from a diver who swims into it or from any creature nearby that starts hunting,
 * so a scatter warns divers of a nest ahead. It is neutral: never in the fight, and the action key
 * passes over it.
 */

export const ROCKFISH = { school: 0, scatter: 1 } as const;

/** The school bolts, from the hunting creature `by`, or from a diver when `by` is unset. */
export type SchoolEvent = "scattered";

/** A creature hunting within this distance spooks the school. */
const SPOOK = 7;
/** A diver this close spooks the school. */
const CROWD = 2.5;
/** Seconds the alarm takes to fade, after which the school regroups. */
const ALARM = 3;
const MILL = 2;

interface School extends Creature {
  /** Seconds before it can be spooked again. */
  calmFor: number;
  /** The point it fled from. */
  from: Point;
}

export const isSchool = (c: Creature): c is School => c.kind === "rockfish";

const size = { r: 0.5, h: 0.4 };

/** What spooks the school now: a hunting creature nearby, else a diver crowding it. */
const spooker = (c: School, world: World) => {
  const o = world.hunting(c, SPOOK);
  if (o) {
    return { at: { x: o.x, y: o.y, z: o.z }, by: o.id };
  }
  const d = world.nearest(c, CROWD);
  return d ? { at: { ...d.sim }, by: undefined } : null;
};

export const rockfish: Species<School> = {
  name: "the blue rockfish",
  latin: "Sebastes mystinus",
  size,
  action: "calm",
  range: 0,
  reachAround: 0,
  needsSight: false,

  spawn(s) {
    return { ...baseCreature(s), calmFor: 0, from: { ...s.at } };
  },

  done: () => true,
  busy: () => true,
  acted: () => null,
  backOff: () => null,

  think(c, world, dt) {
    c.calmFor = Math.max(0, c.calmFor - dt);
    c.charge = Math.max(0, c.charge - dt / ALARM);
    const spook = c.calmFor > 0 ? null : spooker(c, world);
    if (spook) {
      c.mode = ROCKFISH.scatter;
      c.charge = 1;
      c.calmFor = ALARM;
      c.from = spook.at;
      world.emit({
        k: "scattered",
        id: c.id,
        by: spook.by,
        p: [c.x, c.y, c.z],
      });
    }
    if (c.mode === ROCKFISH.scatter) {
      const dx = c.x - c.from.x;
      const dy = c.y - c.from.y;
      const dz = c.z - c.from.z;
      const l = Math.hypot(dx, dz) || 1;
      const flee = {
        x: c.x + (dx / l) * 4,
        y: c.y + Math.max(-1, Math.min(1, dy)),
        z: c.z + (dz / l) * 4,
      };
      glide(world.level, c, size, flee, 3.5 * c.charge, 4, dt);
      faceAlong(c, dx, 0, dz, dt, 8);
      if (c.charge < 0.05) {
        c.mode = ROCKFISH.school;
      }
      return;
    }
    const t = world.clock * 0.3 + c.home.x;
    const goal = {
      x: c.home.x + Math.cos(t) * MILL,
      y: c.home.y + Math.sin(t * 1.7) * 0.4,
      z: c.home.z + Math.sin(t) * MILL,
    };
    glide(world.level, c, size, goal, 0.9, 1.5, dt, 1);
    faceAlong(c, c.vx, c.vy, c.vz, dt, 3);
  },
};
