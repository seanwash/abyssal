import { baseCreature, dist3 } from "./common";
import type { Creature, Species } from "./common";

/**
 * A drift of dead northern anchovies (Engraulis mordax), one creature for the whole drift: its
 * position is the drift's centre, and the view draws the fish. Drifts lie one after another in a
 * line out into the bay toward Moss Landing, the Anchovy Line's clue trail. They turn slowly on
 * the current and are never in the fight. A drift is news the first time a diver comes close.
 */

/** A diver, `by`, came upon the drift for the first time this dive. */
export type AnchovyEvent = "sighted";

/** A diver this close comes upon the drift. */
const SIGHT = 6;
/** How far the current carries the drift around its home, and how fast. */
const SWAY = 0.9;
const TURN = 0.07;

interface Drift extends Creature {
  /** Whether a diver has come upon it since the reef last reset. */
  seen: boolean;
}

export const isDrift = (c: Creature): c is Drift => c.kind === "anchovies";

export const anchovies: Species<Drift> = {
  name: "the dead anchovies",
  latin: "Engraulis mordax",
  size: { r: 0.6, h: 0.3 },
  action: "calm",
  range: 0,
  reachAround: 0,
  needsSight: false,

  spawn(s) {
    return { ...baseCreature(s), seen: false };
  },

  done: () => true,
  busy: () => true,
  acted: () => null,
  backOff: () => null,

  think(c, world) {
    const t = world.clock * TURN + c.home.x;
    c.x = c.home.x + Math.cos(t) * SWAY;
    c.z = c.home.z + Math.sin(t) * SWAY;
    c.y = c.home.y + Math.sin(t * 2.3) * 0.25;
    c.yaw = t + Math.PI / 2;
    if (c.seen) {
      return;
    }
    const d = world.alive().find((a) => dist3(a.sim, c) < SIGHT);
    if (d) {
      c.seen = true;
      world.emit({ k: "sighted", id: c.id, by: d.id, p: [c.x, c.y, c.z] });
    }
  },
};
