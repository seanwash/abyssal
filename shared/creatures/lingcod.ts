import type { ArenaDiver } from "../arena";
import { floorHeight } from "../level";
import type { Point } from "../level";
import { baseCreature, dist3, faceAlong, glide, moveToward } from "./common";
import type { Creature, Species, World } from "./common";

/**
 * Lingcod (Ophiodon elongatus): a sick male guarding its egg mass. It stalks divers who come near
 * the nest, coils, then lunges and bites. Holding the action key between lunges calms it.
 */

export const LING = {
  guard: 0,
  stalk: 1,
  coil: 2,
  lunge: 3,
  recover: 4,
  calm: 5,
} as const;

const CALM_RATE = 0.17;
const CALM_DECAY = 0.04;
const BITE_AIR = 12;
const NOTICE = 6.5;

interface Lingcod extends Creature {
  timer: number;
  cooldown: number;
  /** Where the coil aims the lunge. */
  lock: Point;
  /** Whether this lunge has already bitten. */
  hit: boolean;
}

/** Whether a creature has a lingcod's state. */
export const isLingcod = (c: Creature): c is Lingcod =>
  "lock" in c && "hit" in c;

const size = { r: 0.5, h: 0.3 };

/** One fixed step of a mode's behaviour, given the diver it noticed and the spot by the nest it rests at. */
type Step = (
  c: Lingcod,
  world: World,
  dt: number,
  prey: ArenaDiver | null,
  rest: Point
) => void;

/** A point `gap` short of `p` on the level line from the lingcod to it. */
const toward = (c: Lingcod, p: Point, gap: number) => {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: p.x - (dx / l) * gap, y: p.y, z: p.z - (dz / l) * gap };
};

/** Calm or guarding: circles slowly by the nest, and a guarding one starts stalking a diver it noticed. */
const hover: Step = (c, world, dt, prey, rest) => {
  const t = world.clock * 0.35;
  const goal = {
    x: rest.x + Math.cos(t) * 0.6,
    y: rest.y,
    z: rest.z + Math.sin(t) * 0.6,
  };
  glide(world.level, c, size, goal, 0.6, 2, dt, 0.15);
  faceAlong(c, c.vx, c.vy, c.vz, dt, 3);
  if (prey && c.mode === LING.guard && c.cooldown <= 0) {
    c.mode = LING.stalk;
  }
};

const stalk: Step = (c, world, dt, prey) => {
  if (!prey) {
    c.mode = LING.guard;
    return;
  }
  const goal = toward(c, prey.sim, 2.2);
  goal.y = Math.min(prey.sim.y, floorHeight(world.level, goal.x, goal.z) + 3);
  glide(world.level, c, size, goal, 2.4, 3, dt, 0.15);
  faceAlong(c, prey.sim.x - c.x, prey.sim.y - c.y, prey.sim.z - c.z, dt);
  if (dist3(c, prey.sim) < 3.2 && c.cooldown <= 0) {
    c.mode = LING.coil;
    c.timer = 0.55;
    c.lock = { ...prey.sim };
  }
};

const coil: Step = (c, world, dt, prey) => {
  c.timer -= dt;
  c.charge = 1 - c.timer / 0.55;
  if (prey) {
    c.lock = { x: prey.sim.x, y: prey.sim.y, z: prey.sim.z };
  }
  const dx = c.lock.x - c.x;
  const dy = c.lock.y - c.y;
  const dz = c.lock.z - c.z;
  faceAlong(c, dx, dy, dz, dt, 10);
  const l = Math.hypot(dx, dy, dz) || 1;
  moveToward(
    c,
    { x: (-dx / l) * 0.5, y: (-dy / l) * 0.5, z: (-dz / l) * 0.5 },
    6,
    dt
  );
  if (c.timer <= 0) {
    c.mode = LING.lunge;
    c.timer = 0.32;
    c.charge = 0;
    c.hit = false;
    c.vx = (dx / l) * 9;
    c.vy = (dy / l) * 9;
    c.vz = (dz / l) * 9;
  }
};

/** Bites the first diver its head reaches, once per lunge. */
const bite = (c: Lingcod, world: World, head: Point) => {
  for (const d of world.alive()) {
    if (dist3(head, d.sim) > 0.95) {
      continue;
    }
    c.hit = true;
    const l = Math.hypot(c.vx, c.vy, c.vz) || 1;
    d.sim.vx += (c.vx / l) * 4;
    d.sim.vy += (c.vy / l) * 4;
    d.sim.vz += (c.vz / l) * 4;
    world.hurt(d, BITE_AIR);
    world.emit({ k: "bite", id: d.id, p: [head.x, head.y, head.z] });
    break;
  }
};

const lunge: Step = (c, world, dt) => {
  c.timer -= dt;
  const fx = Math.sin(c.yaw);
  const fz = Math.cos(c.yaw);
  const head = { x: c.x + fx * 0.8, y: c.y, z: c.z + fz * 0.8 };
  if (!c.hit) {
    bite(c, world, head);
  }
  if (c.timer <= 0) {
    c.mode = LING.recover;
    c.timer = 0.9;
  }
};

const recover: Step = (c, world, dt, _prey, rest) => {
  c.timer -= dt;
  glide(world.level, c, size, rest, 1.2, 2.5, dt, 0.15);
  faceAlong(c, c.vx, c.vy, c.vz, dt, 4);
  if (c.timer <= 0) {
    c.mode = LING.guard;
    c.cooldown = Math.max(c.cooldown, 0.9 + c.meter * 1.6);
  }
};

/** What each mode does on a step; a mode not listed does nothing. */
const STEPS: Partial<Record<number, Step>> = {
  [LING.calm]: hover,
  [LING.guard]: hover,
  [LING.stalk]: stalk,
  [LING.coil]: coil,
  [LING.lunge]: lunge,
  [LING.recover]: recover,
};

export const lingcod: Species<Lingcod> = {
  name: "the lingcod",
  latin: "Ophiodon elongatus",
  size,
  action: "calm",
  range: 3.4,
  reachAround: 2.2,
  needsSight: false,
  territory: 7.5,

  spawn(s) {
    const n = s.at;
    return {
      ...baseCreature(s),
      x: n.x + 0.8,
      y: n.y + 0.5,
      z: n.z + 0.8,
      yaw: 0.8,
      mode: LING.guard,
      timer: 0,
      cooldown: 0,
      lock: { ...n },
      hit: false,
    };
  },

  done: (c) => c.mode === LING.calm,

  // A lingcod coiling or lunging is too worked up to calm, so calming happens between lunges.
  busy: (c) => c.mode === LING.coil || c.mode === LING.lunge,

  acted(c, world, by, dt) {
    c.meter = Math.min(1, c.meter + CALM_RATE * dt);
    if (c.meter >= 1) {
      c.mode = LING.calm;
      c.charge = 0;
      world.emit({ k: "calmed", id: c.id, by: by.id });
    }
  },

  backOff(c, seconds) {
    c.cooldown = Math.max(c.cooldown, seconds);
    if (c.mode !== LING.calm) {
      c.mode = LING.recover;
      c.timer = 0.9;
      c.charge = 0;
    }
  },

  think(c, world, dt) {
    const nest = c.home;
    const rest = { x: nest.x + 0.9, y: nest.y + 0.45, z: nest.z + 0.6 };
    if (c.mode !== LING.calm && !c.tended) {
      c.meter = Math.max(0, c.meter - CALM_DECAY * dt);
    }
    c.cooldown = Math.max(0, c.cooldown - dt);
    const prey = c.mode === LING.calm ? null : world.nearest(c, NOTICE, nest);
    STEPS[c.mode]?.(c, world, dt, prey, rest);
  },
};
