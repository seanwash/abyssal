import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import { areaAt } from "../../shared/level";
import type { Level, WaterLight } from "../../shared/level";

/** The water before a zone tunes it: the near-black of the test reef. */
const OPEN: WaterLight = { water: 0x02_0b_10, dark: 0.94, reach: 1, sun: 0.4 };

/**
 * The water's light where the camera is, which the dark, the lamps, the caustics and the god rays
 * read. Each area of a zone sets its own, and `tuneWater` eases between them as a diver swims.
 */
export const water = {
  /** The colour the water fades to away from the lamps. */
  color: uniform(new THREE.Color(OPEN.water)),
  /** How much of a far scene the water hides, 0 to 1. */
  dark: uniform(OPEN.dark),
  /** Lamp reach, as a multiple of the default. */
  reach: uniform(OPEN.reach),
  /** Daylight through the surface, 0 to 1. */
  sun: uniform(OPEN.sun),
};

const goal = new THREE.Color();

/** Eases the water toward the light of the area at x, z, over about two seconds, and returns that area. */
export const tuneWater = (level: Level, x: number, z: number, dt: number) => {
  const area = areaAt(level, x, z);
  const l = area?.light ?? OPEN;
  const k = 1 - Math.exp(-1.5 * dt);
  water.color.value.lerp(goal.set(l.water), k);
  water.dark.value += (l.dark - water.dark.value) * k;
  water.reach.value += (l.reach - water.reach.value) * k;
  water.sun.value += (l.sun - water.sun.value) * k;
  return area;
};

/** Jumps straight to the light at x, z, for the first frame. */
export const settleWater = (level: Level, x: number, z: number) =>
  tuneWater(level, x, z, 1e3);
