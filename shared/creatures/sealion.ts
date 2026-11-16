import type { ArenaDiver } from "../arena";
import { SURFACE_Y } from "../constants";
import type { Level, Point } from "../level";
import { clearLine, floorLimit } from "../physics";
import { baseCreature, dist3, faceAlong, glide } from "./common";
import type { Creature, Species, World } from "./common";

/**
 * California sea lion (Zalophus californianus). One kind, two lives, chosen by the spawn's variant:
 *
 * - A sick one lies hauled out on a ledge of the breakwater at the waterline, out of the water,
 *   and seizes in bouts: the case's first sign. A diver at the surface beside it calms it by
 *   holding the action key between seizures, and it lets a swab be taken.
 * - A healthy one ("healthy") swims a loop around the breakwater and buzzes past divers in fast
 *   playful passes. It never hurts anyone and is never in the fight.
 */

export const SEALION = { swim: 0, haul: 1, seize: 2, calm: 3 } as const;

/** A sick sea lion starts a seizure; a healthy one streaks past the diver `by`. */
export type SeaLionEvent = "seizing" | "buzzed";

const CALM_RATE = 0.16;
const CALM_DECAY = 0.03;
/** Seconds between seizures, and how long one lasts. */
const BOUT_GAP = [5, 9] as const;
const BOUT = 3.2;
/** A healthy sea lion notices a diver this far away and swoops past them. */
const NOTICE = 9;
const SWIM = 3.2;
const BUZZ = 6;
/** A pass that has not reached its point by then, such as one blocked by rock, gives up. */
const PASS_TIME = 4;

interface SeaLion extends Creature {
  timer: number;
  /**
   * Healthy: the loop it swims, the waypoint it heads for, the pass it is making, and seconds
   * before the next pass, or, during a pass, before it gives up.
   */
  route: Point[];
  waypoint: number;
  pass: Point | null;
  passFor: number;
  /** Whether this pass has buzzed its diver yet. */
  buzzed: boolean;
}

export const isSeaLion = (c: Creature): c is SeaLion => c.kind === "sealion";

const size = { r: 0.5, h: 0.35 };

const healthy = (c: SeaLion) => c.mode === SEALION.swim;

/**
 * Where a pass may aim, tried in order: metres `along` the sea lion's line to the diver, past them,
 * and `side` across it. Far past the diver first; then shorter, and finally out to either side,
 * for a diver with rock behind them.
 */
const PASS_AIMS = [
  [4, 1.1],
  [2.5, 1.1],
  [1, 1.1],
  [1, 1.6],
  [1, -1.6],
] as const;

/**
 * The first of `PASS_AIMS` around diver `d` with open water there and a little beyond, so the
 * pass never ends in rock. Its height keeps between the seafloor and the surface, so a diver at
 * the surface is buzzed from just below. Null when there is no room around them.
 */
const passPoint = (level: Level, c: SeaLion, d: ArenaDiver) => {
  const dx = d.sim.x - c.x;
  const dz = d.sim.z - c.z;
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l;
  const uz = dz / l;
  for (const [along, side] of PASS_AIMS) {
    const x = d.sim.x + ux * along - uz * side;
    const z = d.sim.z + uz * along + ux * side;
    const floor = floorLimit(level, x, z, size.r, size.h) + 0.5;
    const ceiling = SURFACE_Y - 1.2;
    if (floor > ceiling) {
      continue;
    }
    const p = { x, y: Math.min(ceiling, Math.max(floor, d.sim.y + 0.3)), z };
    const ox = x - d.sim.x;
    const oz = z - d.sim.z;
    const ol = Math.hypot(ox, oz);
    const beyond = {
      x: x + (ox / ol) * 1.5,
      y: p.y,
      z: z + (oz / ol) * 1.5,
    };
    if (clearLine(level, d.sim, beyond)) {
      return p;
    }
  }
  return null;
};

/** The healthy sea lion's step: a loop around its patch, broken by passes at divers that come near. */
const swim = (c: SeaLion, world: World, dt: number) => {
  c.passFor = Math.max(0, c.passFor - dt);
  if (!c.pass && c.passFor <= 0) {
    const d = world.nearest(c, NOTICE);
    if (d) {
      c.pass = passPoint(world.level, c, d);
      c.passFor = c.pass ? PASS_TIME : 1;
      c.buzzed = false;
    }
  }
  if (c.pass) {
    glide(world.level, c, size, c.pass, BUZZ, 3, dt, 0.8);
    const close = world.nearest(c, 2);
    if (close && !c.buzzed) {
      c.buzzed = true;
      world.emit({ k: "buzzed", id: c.id, by: close.id, p: [c.x, c.y, c.z] });
    }
    if (dist3(c, c.pass) < 1.5 || c.passFor <= 0) {
      c.pass = null;
      c.passFor = 7 + (world.clock % 4);
    }
  } else {
    const wp = c.route[c.waypoint % c.route.length];
    if (dist3(c, wp) < 2) {
      c.waypoint = (c.waypoint + 1) % c.route.length;
    }
    glide(world.level, c, size, wp, SWIM, 1.5, dt, 0.8);
  }
  faceAlong(c, c.vx, c.vy, c.vz, dt, 5);
};

/** The sick sea lion's step: limp between seizures, then a bout whose strength rises and falls. */
const ashore = (c: SeaLion, world: World, dt: number) => {
  c.timer -= dt;
  if (c.mode === SEALION.haul) {
    c.charge = 0;
    if (c.timer <= 0) {
      c.mode = SEALION.seize;
      c.timer = BOUT;
      world.emit({ k: "seizing", id: c.id, p: [c.x, c.y, c.z] });
    }
    return;
  }
  const t = 1 - c.timer / BOUT;
  c.charge = Math.sin(Math.min(1, t) * Math.PI);
  if (c.timer <= 0) {
    c.mode = SEALION.haul;
    c.charge = 0;
    // A calmer animal seizes less often.
    c.timer =
      BOUT_GAP[0] +
      ((world.clock * 7.3) % (BOUT_GAP[1] - BOUT_GAP[0])) +
      c.meter * 4;
  }
};

export const sealion: Species<SeaLion> = {
  name: "the sea lion",
  latin: "Zalophus californianus",
  size,
  action: "calm",
  range: 3,
  reachAround: 2.4,
  needsSight: false,
  drops: "sealion-swab",

  spawn(s) {
    const isHealthy = s.variant === "healthy";
    return {
      ...baseCreature(s),
      yaw: isHealthy ? 0 : -2.4,
      mode: isHealthy ? SEALION.swim : SEALION.haul,
      timer: 2.5,
      route: s.route ?? [s.at],
      waypoint: 0,
      pass: null,
      passFor: 2,
      buzzed: false,
    };
  },

  done: (c) => c.mode === SEALION.calm || c.mode === SEALION.swim,
  busy: (c) => c.mode === SEALION.seize,
  ashore: (c) => c.mode !== SEALION.swim,

  acted(c, world, by, dt) {
    c.meter = Math.min(1, c.meter + CALM_RATE * dt);
    if (c.meter >= 1) {
      c.mode = SEALION.calm;
      c.charge = 0;
      world.emit({ k: "calmed", id: c.id, by: by.id });
    }
  },

  backOff: () => null,

  think(c, world, dt) {
    if (healthy(c)) {
      swim(c, world, dt);
      return;
    }
    if (c.mode === SEALION.calm) {
      return;
    }
    if (!c.tended) {
      c.meter = Math.max(0, c.meter - CALM_DECAY * dt);
    }
    ashore(c, world, dt);
  },
};
