import type { Arena, ArenaDiver } from "../shared/arena";
import {
  DIVER_HALF_HEIGHT,
  DIVER_RADIUS,
  SURFACE_Y,
  SWIM_SPEED,
  VERTICAL_SPEED,
} from "../shared/constants";
import { SPECIES } from "../shared/creatures";
import { steerVelocity } from "../shared/creatures/common";
import type { Point } from "../shared/level";
import { LOOT } from "../shared/loot/haul";
import type { Loot } from "../shared/loot/haul";
import type { DiverSim } from "../shared/protocol";

export interface BuddyContext {
  /** Whether the person it follows has climbed out at the station. */
  leadAboard: boolean;
  station: { x: number; z: number };
  loot: Loot[];
}

/** Where the buddy swims, whether it uses its tool, and whether it only edges forward. */
interface Plan {
  goal: Point;
  act: boolean;
  slow: boolean;
}

const dist = (p: Point, s: Point) =>
  Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);

/** The fossil the lead is prying, while it still lies there. */
const pryingLoot = (lead: ArenaDiver | undefined, loot: Loot[]) => {
  const target = lead?.target;
  return target?.kind === "pry"
    ? loot.find((l) => l.id === target.id && l.state === LOOT.lying)
    : undefined;
};

/** Whether the machine is near the buddy or the person it follows. */
const droneNear = (drone: Point, s: Point, lead: ArenaDiver | undefined) =>
  dist(drone, s) < 8 || (lead !== undefined && dist(drone, lead.sim) < 8);

/** Behind the lead, but at the edge of a creature's territory, such as the lingcod's nest, rather than following into it. */
const followGoal = (arena: Arena, l: DiverSim) => {
  let goal: Point = {
    x: l.x - Math.sin(l.yaw) * 2,
    y: l.y + 0.3,
    z: l.z - Math.cos(l.yaw) * 2,
  };
  for (const c of arena.creatures) {
    const keep = SPECIES[c.kind].territory;
    if (!keep) {
      continue;
    }
    const n = c.home;
    const dx = goal.x - n.x;
    const dz = goal.z - n.z;
    const r = Math.hypot(dx, dz);
    if (r < keep) {
      goal = {
        x: n.x + (dx / (r || 1)) * keep,
        y: goal.y + 1.5,
        z: n.z + (dz / (r || 1)) * keep,
      };
    }
  }
  return goal;
};

/** What the buddy does this tick, in order of priority. */
const plan = (arena: Arena, me: ArenaDiver, ctx: BuddyContext): Plan => {
  const s = me.sim;
  const lead = [...arena.divers.values()].find((d) => d !== me);
  const drone = arena.creatures.find(
    (c) => SPECIES[c.kind].action === "harpoon" && !SPECIES[c.kind].done(c)
  );
  const prying = pryingLoot(lead, ctx.loot);
  if (ctx.leadAboard) {
    return {
      goal: { x: ctx.station.x, y: SURFACE_Y - 0.9, z: ctx.station.z },
      act: false,
      slow: false,
    };
  }
  if (lead?.down) {
    return { goal: lead.sim, act: dist(lead.sim, s) < 2.2, slow: false };
  }
  if (prying && me.air >= 22) {
    const close = dist(prying, s) < 1.1;
    return {
      goal: { x: prying.x, y: prying.y + 0.5, z: prying.z },
      act: close,
      slow: close,
    };
  }
  if (me.air < 22) {
    return {
      goal: { x: s.x, y: SURFACE_Y - 0.9, z: s.z },
      act: false,
      slow: false,
    };
  }
  if (drone && droneNear(drone, s, lead)) {
    // Inside harpoon range it only edges forward, so it keeps facing the machine while it fires.
    const close = dist(drone, s) < 5;
    return { goal: drone, act: close, slow: close };
  }
  if (lead) {
    return { goal: followGoal(arena, lead.sim), act: false, slow: false };
  }
  return { goal: s, act: false, slow: false };
};

/** The swim input that steers toward the plan's goal. */
const swim = (arena: Arena, s: DiverSim, { goal, act, slow }: Plan) => {
  const speed = slow ? SWIM_SPEED * 0.3 : SWIM_SPEED;
  const v = steerVelocity(
    arena.level,
    s,
    goal,
    speed,
    DIVER_RADIUS,
    DIVER_HALF_HEIGHT
  );
  let x = v.x / SWIM_SPEED;
  let z = v.z / SWIM_SPEED;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  if (slow && len < 0.3 && len > 1e-3) {
    x = (x / len) * 0.3;
    z = (z / len) * 0.3;
  }
  const y = Math.max(-1, Math.min(1, v.y / VERTICAL_SPEED));
  return { x, y, z, act: act ? 1 : 0 };
};

/**
 * A computer buddy for the second seat. It follows the human diver, surfaces when its own air runs
 * low, buddy-breathes the human when they go down, harpoons a machine that comes near, helps pry
 * a fossil the human is prying, and swims to the station's line when the human climbs out. It
 * leaves calming to the human and keeps out of the creatures' territories.
 */
export const buddyInput = (arena: Arena, me: ArenaDiver, ctx: BuddyContext) =>
  swim(arena, me.sim, plan(arena, me, ctx));
