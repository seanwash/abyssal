import type { Point } from "../level";
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

const CALM_RATE = 0.16;
const CALM_DECAY = 0.03;
/** Seconds between seizures, and how long one lasts. */
const BOUT_GAP = [5, 9] as const;
const BOUT = 3.2;
/** A healthy sea lion notices a diver this far away and swoops past them. */
const NOTICE = 9;
const SWIM = 3.2;
const BUZZ = 6;

interface SeaLion extends Creature {
  timer: number;
  /** Healthy: the loop it swims, the waypoint it heads for, the pass it is making, and seconds before the next. */
  route: Point[];
  waypoint: number;
  pass: Point | null;
  passFor: number;
  /** Whether this pass has buzzed its diver yet. */
  buzzed: boolean;
}

export const isSeaLion = (c: Creature): c is SeaLion =>
  "pass" in c && "passFor" in c;

const size = { r: 0.5, h: 0.35 };

const healthy = (c: SeaLion) => c.mode === SEALION.swim;

/** The healthy sea lion's step: a loop around its patch, broken by passes at divers that come near. */
const swim = (c: SeaLion, world: World, dt: number) => {
  c.passFor = Math.max(0, c.passFor - dt);
  if (!c.pass && c.passFor <= 0) {
    const d = world.nearest(c, NOTICE);
    if (d) {
      // Aim to pass a metre to the side of the diver and carry on beyond.
      const dx = d.sim.x - c.x;
      const dz = d.sim.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      c.pass = {
        x: d.sim.x + (dx / l) * 4 - (dz / l) * 1.1,
        y: d.sim.y + 0.3,
        z: d.sim.z + (dz / l) * 4 + (dx / l) * 1.1,
      };
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
    if (dist3(c, c.pass) < 1.5) {
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
