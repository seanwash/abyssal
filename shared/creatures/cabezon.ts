import type { ArenaDiver } from "../arena";
import { floorHeight } from "../level";
import type { Point } from "../level";
import { baseCreature, dist3, faceAlong, glide, moveToward } from "./common";
import type { Creature, Species, World } from "./common";

/**
 * Cabezon (Scorpaenichthys marmoratus): a sick male guarding his eggs on the granite. He lies
 * camouflaged beside the nest, where the action key and the HUD pass over him, until a diver is
 * almost on top of him; then he bursts up and bites. Once revealed he guards the nest, lunging at
 * divers who come close, and holding the action key between lunges calms him. Left alone for a
 * while, he settles back onto the rock and hides again.
 */

export const CABEZON = {
  hidden: 0,
  guard: 1,
  coil: 2,
  lunge: 3,
  recover: 4,
  calm: 5,
} as const;

const CALM_RATE = 0.2;
const CALM_DECAY = 0.04;
const BITE_AIR = 8;
/** A hidden cabezon bursts out at a diver this close. */
const AMBUSH = 2.2;
/** A hidden cabezon is lying in wait, and spooks fish, while a diver is this close. */
const WAITING = 5;
/** A revealed cabezon lunges at a diver this close. */
const STRIKE = 2.8;
/** How far from the nest it notices divers once revealed. */
const NOTICE = 5;
/** Seconds without a diver near before it hides again. */
const SETTLE = 8;
const COIL = 0.35;

interface Cabezon extends Creature {
  timer: number;
  cooldown: number;
  /** Seconds since a diver was near, while revealed. */
  alone: number;
  lock: Point;
  hit: boolean;
}

/** Whether a creature has a cabezon's state. */
export const isCabezon = (c: Creature): c is Cabezon =>
  "alone" in c && "lock" in c && "hit" in c;

/** A flat fish: its belly is about `h` below its centre. */
const size = { r: 0.4, h: 0.1 };

/** Where it lies beside the nest: on the rock, its belly on the floor. */
const lair = (c: Cabezon, world: World): Point => {
  const x = c.home.x + 0.7;
  const z = c.home.z + 0.4;
  return { x, y: floorHeight(world.level, x, z) + size.h, z };
};

type Step = (
  c: Cabezon,
  world: World,
  dt: number,
  prey: ArenaDiver | null
) => void;

const startCoil = (c: Cabezon, prey: ArenaDiver) => {
  c.mode = CABEZON.coil;
  c.timer = COIL;
  c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z };
};

const hidden: Step = (c, world, dt) => {
  const rest = lair(c, world);
  glide(world.level, c, size, rest, 0.4, 3, dt, 0);
  const near = world.nearest(c, AMBUSH);
  if (near) {
    startCoil(c, near);
  }
};

const guard: Step = (c, world, dt, prey) => {
  const rest = lair(c, world);
  const goal = { ...rest, y: rest.y + 0.2 };
  glide(world.level, c, size, goal, 0.8, 2.5, dt, 0.1);
  if (prey) {
    c.alone = 0;
    faceAlong(c, prey.sim.x - c.x, prey.sim.y - c.y, prey.sim.z - c.z, dt, 4);
    if (dist3(c, prey.sim) < STRIKE && c.cooldown <= 0) {
      startCoil(c, prey);
    }
    return;
  }
  c.alone += dt;
  if (c.alone > SETTLE) {
    c.mode = CABEZON.hidden;
    c.meter = 0;
  }
};

const coil: Step = (c, _world, dt, prey) => {
  c.timer -= dt;
  c.charge = 1 - c.timer / COIL;
  if (prey) {
    c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z };
  }
  const dx = c.lock.x - c.x;
  const dy = c.lock.y - c.y;
  const dz = c.lock.z - c.z;
  faceAlong(c, dx, dy, dz, dt, 12);
  moveToward(c, { x: 0, y: 0.3, z: 0 }, 6, dt);
  if (c.timer <= 0) {
    const l = Math.hypot(dx, dy, dz) || 1;
    c.mode = CABEZON.lunge;
    c.timer = 0.3;
    c.charge = 0;
    c.hit = false;
    c.vx = (dx / l) * 8;
    c.vy = (dy / l) * 8;
    c.vz = (dz / l) * 8;
  }
};

const lunge: Step = (c, world, dt) => {
  c.timer -= dt;
  const head = {
    x: c.x + Math.sin(c.yaw) * 0.55,
    y: c.y,
    z: c.z + Math.cos(c.yaw) * 0.55,
  };
  for (const d of c.hit ? [] : world.alive()) {
    if (dist3(head, d.sim) > 0.9) {
      continue;
    }
    c.hit = true;
    const l = Math.hypot(c.vx, c.vy, c.vz) || 1;
    d.sim.vx += (c.vx / l) * 3.5;
    d.sim.vy += (c.vy / l) * 3.5;
    d.sim.vz += (c.vz / l) * 3.5;
    world.hurt(d, BITE_AIR);
    world.emit({ k: "bite", id: d.id, p: [head.x, head.y, head.z] });
    break;
  }
  if (c.timer <= 0) {
    c.mode = CABEZON.recover;
    c.timer = 0.9;
  }
};

const recover: Step = (c, world, dt) => {
  c.timer -= dt;
  glide(world.level, c, size, lair(c, world), 1.2, 2.5, dt, 0.1);
  faceAlong(c, c.vx, c.vy, c.vz, dt, 4);
  if (c.timer <= 0) {
    c.mode = CABEZON.guard;
    c.alone = 0;
    c.cooldown = Math.max(c.cooldown, 1.8 + c.meter * 1.5);
  }
};

const rest: Step = (c, world, dt) => {
  glide(world.level, c, size, lair(c, world), 0.4, 2, dt, 0);
};

const STEPS: Partial<Record<number, Step>> = {
  [CABEZON.hidden]: hidden,
  [CABEZON.guard]: guard,
  [CABEZON.coil]: coil,
  [CABEZON.lunge]: lunge,
  [CABEZON.recover]: recover,
  [CABEZON.calm]: rest,
};

export const cabezon: Species<Cabezon> = {
  name: "the cabezon",
  latin: "Scorpaenichthys marmoratus",
  size,
  action: "calm",
  range: 3,
  reachAround: 2,
  needsSight: false,
  territory: 4.5,
  drops: "cabezon-swab",

  spawn(s) {
    return {
      ...baseCreature(s),
      x: s.at.x + 0.7,
      y: s.at.y + size.h,
      z: s.at.z + 0.4,
      yaw: 2.4,
      mode: CABEZON.hidden,
      timer: 0,
      cooldown: 0,
      alone: 0,
      lock: { ...s.at },
      hit: false,
    };
  },

  done: (c) => c.mode === CABEZON.calm,
  hidden: (c) => c.mode === CABEZON.hidden,
  busy: (c) => c.mode === CABEZON.coil || c.mode === CABEZON.lunge,
  // Lying in wait counts: fish over the nest give a hidden cabezon away before it strikes.
  threat: (c, world) =>
    c.mode === CABEZON.hidden
      ? world.nearest(c, WAITING) !== null
      : c.mode !== CABEZON.calm && c.mode !== CABEZON.recover,

  acted(c, world, by, dt) {
    c.meter = Math.min(1, c.meter + CALM_RATE * dt);
    if (c.meter >= 1) {
      c.mode = CABEZON.calm;
      c.charge = 0;
      world.emit({ k: "calmed", id: c.id, by: by.id });
    }
  },

  backOff(c, seconds) {
    c.cooldown = Math.max(c.cooldown, seconds);
    if (c.mode === CABEZON.coil || c.mode === CABEZON.lunge) {
      c.mode = CABEZON.recover;
      c.timer = 0.9;
      c.charge = 0;
    }
  },

  think(c, world, dt) {
    if (c.mode !== CABEZON.calm && !c.tended) {
      c.meter = Math.max(0, c.meter - CALM_DECAY * dt);
    }
    c.cooldown = Math.max(0, c.cooldown - dt);
    const prey =
      c.mode === CABEZON.calm ? null : world.nearest(c, NOTICE, c.home);
    STEPS[c.mode]?.(c, world, dt, prey);
  },
};
