import { groundHeight } from "../level";
import { baseCreature } from "./common";
import type { Creature, Species, World } from "./common";

/**
 * A patch of purple urchins (Strongylocentrotus purpuratus) on the Urchin Barren, one creature for
 * the whole patch: its position is the patch's centre on the floor, and the view draws the urchins.
 * They never move and are never in the fight, but a diver who swims low over a patch is spined and
 * loses air. `charge` rises as a diver comes low and close, so the spines can warn before they bite.
 */

/** A diver was spined by the patch: `by` is the diver. */
export type UrchinEvent = "spined";

/** How far from the centre the patch reaches, in metres across the floor. */
export const PATCH = 2.6;
/** A diver lower than this over the rock or sand of a patch is spined. */
const LOW = 0.9;
/** How far out, and how high, `charge` starts to warn. */
const WARN = PATCH + 2;
const WARN_LOW = 2.4;
const SPINE_AIR = 4;
/** Seconds before the same diver can be spined again. */
const AGAIN = 1.6;

interface Patch extends Creature {
  /** Seconds before each diver, by id, can be spined again. */
  again: Record<string, number>;
}

export const isPatch = (c: Creature): c is Patch => c.kind === "urchins";

/** How close diver `d` is to being spined, 0 (well clear) to 1 (in the spines), and whether it is. */
const closeness = (
  c: Patch,
  world: World,
  at: { x: number; y: number; z: number }
) => {
  const across = Math.hypot(at.x - c.x, at.z - c.z);
  const above = at.y - groundHeight(world.level, at.x, at.z, at.y);
  const spined = across < PATCH && above < LOW;
  const near =
    Math.min(1, Math.max(0, (WARN - across) / (WARN - PATCH))) *
    Math.min(1, Math.max(0, (WARN_LOW - above) / (WARN_LOW - LOW)));
  return { near, spined };
};

export const urchins: Species<Patch> = {
  name: "the purple urchins",
  latin: "Strongylocentrotus purpuratus",
  size: { r: 0.3, h: 0.1 },
  action: "calm",
  range: 0,
  reachAround: 0,
  needsSight: false,

  spawn(s) {
    return { ...baseCreature(s), again: {} };
  },

  done: () => true,
  busy: () => true,
  acted: () => null,
  backOff: () => null,

  think(c, world, dt) {
    let warn = 0;
    for (const d of world.alive()) {
      const { near, spined } = closeness(c, world, d.sim);
      warn = Math.max(warn, near);
      const again = Math.max(0, (c.again[d.id] ?? 0) - dt);
      c.again[d.id] = again;
      if (spined && again <= 0) {
        c.again[d.id] = AGAIN;
        world.hurt(d, SPINE_AIR);
        const p: [number, number, number] = [d.sim.x, d.sim.y, d.sim.z];
        world.emit({ k: "bite", id: d.id, p });
        world.emit({
          k: "spined",
          id: c.id,
          by: d.id,
          p,
        });
      }
    }
    c.charge += (warn - c.charge) * Math.min(1, dt * 6);
  },
};
