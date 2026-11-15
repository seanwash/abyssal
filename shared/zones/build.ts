import { RockGrid, floorHeight, toWorld } from "../level";
import type {
  Area,
  Boulder,
  CreatureSpawn,
  Ground,
  Jelly,
  Kelp,
  Level,
  LootSpot,
  MapPoint,
  Point,
  Route,
} from "../level";
import { fbm2, mulberry32 } from "../rng";

/**
 * Turns a zone's authored plan into a `Level`. A plan is written in the map frame (u east, v
 * north) as layers: the ground's depth and features, the rocks on it, the kelp that grows where
 * nothing else is, and what lives and lies in each part of the route. Procedural noise only adds
 * texture on top: dunes and ripples in the sand, and where exactly each kelp plant stands.
 */

export type GroundKind = "reef" | "barren" | "fill";

/** An ellipse in the map frame, `ru` metres east-west and `rv` north-south. */
export interface Shape {
  at: MapPoint;
  ru: number;
  rv: number;
}
/** Raises the floor by `h` metres in a rounded hump, optionally made of something other than sand. */
export interface Mound extends Shape {
  h: number;
  ground?: GroundKind;
}
/** Raises the floor along a line toward height `top`, falling away over `half` metres either side. */
export interface Ridge {
  from: MapPoint;
  to: MapPoint;
  half: number;
  top: number;
  ground?: GroundKind;
}
/**
 * A narrow slot cut into the floor. It runs south from a closed far end at `at` for `len` metres
 * and then ramps up to the floor, so it lies along the camera's line of sight and its walls never
 * hide a diver inside it. A lamp lights by 3D distance, so what lies at the far end shows only to
 * a diver who swims down into the slot.
 */
export interface Crevice {
  at: MapPoint;
  len: number;
  half: number;
  depth: number;
}
/** A kelp grove: `n` plants scattered over the ellipse, except in lanes and clearings and on bare ground. */
export interface Grove extends Shape {
  n: number;
}
/** A lane kept clear of kelp along a path, `half` metres either side. */
export interface Lane {
  path: MapPoint[];
  half: number;
}

/** What a plan's `populate` returns: the zone's living and lying things, placed with the `Placer`. */
export interface Population {
  creatures: CreatureSpawn[];
  loot: LootSpot[];
  jellies: Jelly[];
  spawns: Point[];
}

export interface ZonePlan {
  name: string;
  seed: number;
  /** The swimmable area. */
  bounds: { u0: number; u1: number; v0: number; v1: number };
  /** The waterline's v at each u. */
  shore: (u: number) => number;
  /** Depth in metres this far offshore, before features. */
  depth: (offshore: number) => number;
  mounds: Mound[];
  ridges: Ridge[];
  crevices: Crevice[];
  /** Ground that is reef, barren or fill without changing its height. */
  paint: (Shape & { kind: GroundKind })[];
  groves: Grove[];
  lanes: Lane[];
  /** Round places no kelp grows, such as a nest or the station's line. */
  clearings: (MapPoint & { r: number })[];
  stations: { id: string; name: string; at: MapPoint }[];
  areas: Area[];
  route: Route;
  /** Places the boulders, in the order given, once the ground is built. */
  rocks: (p: Placer) => void;
  /** Places the creatures, finds, jellies and spawns, once the ground and rocks are built. */
  populate: (p: Placer) => Population;
}

/** Margin of ground built around the swimmable area, so the camera never sees past the floor's edge. */
const MARGIN = 28;
const STEP = 0.5;
const RAMP = 3.5;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Distance from p to the segment a-b. */
const segmentDistance = (p: MapPoint, a: MapPoint, b: MapPoint) => {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const len2 = du * du + dv * dv || 1;
  const t = Math.min(
    1,
    Math.max(0, ((p.u - a.u) * du + (p.v - a.v) * dv) / len2)
  );
  return Math.hypot(p.u - a.u - du * t, p.v - a.v - dv * t);
};

export const pathDistance = (p: MapPoint, path: MapPoint[]) => {
  let d = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    d = Math.min(d, segmentDistance(p, path[i - 1], path[i]));
  }
  return d;
};

const creviceDepth = (u: number, v: number, c: Crevice) => {
  const along = c.at.v - v;
  const across = Math.abs(u - c.at.u);
  if (across >= c.half || along <= -c.half || along >= c.len + RAMP) {
    return 0;
  }
  const d = Math.hypot(across, Math.min(0, along)) / c.half;
  if (d >= 1) {
    return 0;
  }
  // A flat bottom with steep walls, rising to the floor along the ramp.
  const k = Math.max(0, (d - 0.5) / 0.5);
  const r = Math.max(0, Math.min(1, (along - c.len) / RAMP));
  return c.depth * (1 - k * k * (3 - 2 * k)) * (1 - r * r * (3 - 2 * r));
};

/** The ground's height and makeup at one point of the map. */
const sampleGround = (plan: ZonePlan, u: number, v: number) => {
  const offshore = v - plan.shore(u);
  let h = -plan.depth(offshore);
  h += (fbm2(u * 0.08, v * 0.08, 4, 11) - 0.5) * 1.6;
  h += Math.sin(u * 0.9 + Math.sin(v * 0.35) * 1.6) * 0.06;
  const kinds = { reef: 0, barren: 0, fill: 0 };
  // Patchy edges, so reef and barren end raggedly rather than in clean ellipses.
  const ragged = (fbm2(u * 0.3, v * 0.3, 2, 5) - 0.5) * 0.5;
  for (const m of plan.mounds) {
    const d = Math.hypot((u - m.at.u) / m.ru, (v - m.at.v) / m.rv);
    if (d >= 1.3) {
      continue;
    }
    const w = smooth(1, 0, d);
    // Reef mounds are lumpy; fill heaps are lumpier still.
    const lumps =
      m.ground === "fill"
        ? 0.75 + fbm2(u * 0.6, v * 0.6, 3, 23) * 0.5
        : 0.85 + fbm2(u * 0.35, v * 0.35, 3, 29) * 0.3;
    h += m.h * w * lumps;
    if (m.ground) {
      kinds[m.ground] = Math.max(
        kinds[m.ground],
        smooth(0.05, 0.4, 1 - d + ragged)
      );
    }
  }
  for (const r of plan.ridges) {
    const d = segmentDistance({ u, v }, r.from, r.to) / r.half;
    if (d >= 1) {
      continue;
    }
    const w = smooth(1, 0, d);
    if (r.top > h) {
      h += (r.top - h) * w;
    }
    if (r.ground) {
      kinds[r.ground] = Math.max(kinds[r.ground], smooth(0.1, 0.5, 1 - d));
    }
  }
  for (const c of plan.crevices) {
    const cut = creviceDepth(u, v, c);
    if (cut > 0) {
      h -= cut;
      kinds.reef = Math.max(kinds.reef, smooth(0, 0.6, cut));
    }
  }
  for (const p of plan.paint) {
    const d = Math.hypot((u - p.at.u) / p.ru, (v - p.at.v) / p.rv);
    if (d < 1.3) {
      kinds[p.kind] = Math.max(
        kinds[p.kind],
        smooth(0.05, 0.4, 1 - d + ragged)
      );
    }
  }
  return { h, ...kinds };
};

const buildGround = (plan: ZonePlan): Ground => {
  const { bounds } = plan;
  const u0 = bounds.u0 - MARGIN;
  const v0 = bounds.v0 - MARGIN;
  const nu = Math.ceil((bounds.u1 - bounds.u0 + MARGIN * 2) / STEP) + 1;
  const nv = Math.ceil((bounds.v1 - bounds.v0 + MARGIN * 2) / STEP) + 1;
  const n = nu * nv;
  const g: Ground = {
    u0,
    v0,
    step: STEP,
    nu,
    nv,
    height: new Float32Array(n),
    reef: new Uint8Array(n),
    barren: new Uint8Array(n),
    fill: new Uint8Array(n),
  };
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const s = sampleGround(plan, u0 + i * STEP, v0 + j * STEP);
      const k = j * nu + i;
      g.height[k] = s.h;
      g.reef[k] = Math.round(s.reef * 255);
      g.barren[k] = Math.round(s.barren * 255);
      g.fill[k] = Math.round(s.fill * 255);
    }
  }
  return g;
};

/** Reads a ground layer at the nearest sample. */
const groundAt = (g: Ground, layer: Uint8Array, p: MapPoint) => {
  const i = Math.round((p.u - g.u0) / g.step);
  const j = Math.round((p.v - g.v0) / g.step);
  if (i < 0 || j < 0 || i >= g.nu || j >= g.nv) {
    return 0;
  }
  return layer[j * g.nu + i] / 255;
};

/** A world point at a map point and height. */
export const mapPoint = (u: number, v: number, y: number): Point => ({
  ...toWorld(u, v),
  y,
});

/**
 * What a plan's `rocks` and `populate` place things with. Everything takes map coordinates and
 * returns or records world coordinates.
 */
export class Placer {
  readonly boulders: Boulder[] = [];
  readonly rnd: () => number;
  private level: Level;

  constructor(level: Level, seed: number) {
    this.level = level;
    this.rnd = mulberry32(seed);
  }

  /** The floor's height at a map point, ignoring rocks. */
  floor(u: number, v: number) {
    const { x, z } = toWorld(u, v);
    return floorHeight(this.level, x, z);
  }

  /** A world point `lift` metres above the floor. */
  onFloor(u: number, v: number, lift = 0): Point {
    return mapPoint(u, v, this.floor(u, v) + lift);
  }

  /** A boulder at a map point. By default a third of it is buried in the floor; `y` sets its centre instead. */
  rock(
    u: number,
    v: number,
    r: number,
    sy: number,
    opts: { y?: number; stone?: Boulder["stone"] } = {}
  ) {
    const { x, z } = toWorld(u, v);
    const b: Boulder = {
      x,
      z,
      y: opts.y ?? floorHeight(this.level, x, z) + r * sy * 0.35,
      r,
      sy,
      rot: this.rnd() * Math.PI * 2,
      seed: Math.floor(this.rnd() * 1e6),
      stone: opts.stone ?? "granite",
    };
    this.boulders.push(b);
    return b;
  }

  /** A boulder resting on top of another, offset by du, dv. */
  onTop(
    below: Boulder,
    r: number,
    sy: number,
    du = 0,
    dv = 0,
    stone = below.stone
  ) {
    const c = below.r * below.sy * 0.92;
    const p = toWorld(du, dv);
    const b: Boulder = {
      x: below.x + p.x,
      z: below.z + p.z,
      y: below.y + c * 0.8 + r * sy * 0.5,
      r,
      sy,
      rot: this.rnd() * Math.PI * 2,
      seed: Math.floor(this.rnd() * 1e6),
      stone,
    };
    this.boulders.push(b);
    return b;
  }

  /**
   * A wall of rock along a line, built up in courses until its top breaks the surface, with
   * neighbours close enough that no diver fits between them.
   */
  wall(
    from: MapPoint,
    to: MapPoint,
    r: number,
    stone: Boulder["stone"] = "granite"
  ) {
    const len = Math.hypot(to.u - from.u, to.v - from.v);
    const n = Math.max(1, Math.ceil(len / (r * 1.25)));
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const u = from.u + (to.u - from.u) * t;
      const v = from.v + (to.v - from.v) * t;
      const size = r * (0.85 + this.rnd() * 0.3);
      let b = this.rock(u, v, size, 0.85, { stone });
      while (b.y + b.r * b.sy * 0.6 < 0.8) {
        b = this.onTop(
          b,
          size * (0.8 + this.rnd() * 0.25),
          0.85,
          (this.rnd() - 0.5) * 0.6,
          (this.rnd() - 0.5) * 0.6
        );
      }
    }
  }

  /** `n` boulders scattered over an ellipse, `r0` to `r1` wide, kept apart from each other. */
  field(
    shape: Shape,
    n: number,
    r0: number,
    r1: number,
    opts: { sy?: number; stone?: Boulder["stone"]; avoid?: Lane[] } = {}
  ) {
    let placed = 0;
    for (let guard = 0; placed < n && guard < n * 40; guard += 1) {
      const a = this.rnd() * Math.PI * 2;
      const d = Math.sqrt(this.rnd());
      const u = shape.at.u + Math.cos(a) * d * shape.ru;
      const v = shape.at.v + Math.sin(a) * d * shape.rv;
      const r = r0 + (r1 - r0) * this.rnd() ** 1.5;
      const { x, z } = toWorld(u, v);
      if (
        opts.avoid?.some((l) => pathDistance({ u, v }, l.path) < l.half + r) ||
        this.boulders.some(
          (b) => Math.hypot(b.x - x, b.z - z) < (b.r + r) * 0.8
        )
      ) {
        continue;
      }
      this.rock(u, v, r, opts.sy ?? 0.55 + this.rnd() * 0.3, {
        stone: opts.stone,
      });
      placed += 1;
    }
  }
}

/** Plants each grove, skipping lanes, clearings, bare or rubble ground and rocks, and keeping plants apart. */
const plantKelp = (plan: ZonePlan, level: Level, rnd: () => number) => {
  const kelp: Kelp[] = [];
  const g = level.ground;
  for (const grove of plan.groves) {
    let placed = 0;
    for (let guard = 0; placed < grove.n && guard < grove.n * 30; guard += 1) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd());
      const p = {
        u: grove.at.u + Math.cos(a) * d * grove.ru,
        v: grove.at.v + Math.sin(a) * d * grove.rv,
      };
      const { x, z } = toWorld(p.u, p.v);
      const floorY = floorHeight(level, x, z);
      if (
        floorY > -2.5 ||
        groundAt(g, g.barren, p) > 0.3 ||
        groundAt(g, g.fill, p) > 0.3 ||
        plan.lanes.some((l) => pathDistance(p, l.path) < l.half) ||
        plan.clearings.some((c) => Math.hypot(p.u - c.u, p.v - c.v) < c.r) ||
        level.rocks
          .near(x, z)
          .some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.95) ||
        kelp.some(
          (k) => Math.abs(k.x - x) < 1 && Math.hypot(k.x - x, k.z - z) < 1
        )
      ) {
        continue;
      }
      kelp.push({
        x,
        z,
        floorY,
        height: -floorY - 0.4 - rnd() * 1.5,
        phase: rnd() * Math.PI * 2,
        lean: rnd() * Math.PI * 2,
      });
      placed += 1;
    }
  }
  return kelp;
};

export const buildZone = (plan: ZonePlan): Level => {
  const ground = buildGround(plan);
  const level: Level = {
    seed: plan.seed,
    name: plan.name,
    ground,
    bounds: plan.bounds,
    boulders: [],
    rocks: new RockGrid([]),
    kelp: [],
    jellies: [],
    spawns: [],
    creatures: [],
    loot: [],
    stations: plan.stations.map((s) => ({
      id: s.id,
      name: s.name,
      ...toWorld(s.at.u, s.at.v),
    })),
    areas: plan.areas,
    route: plan.route,
  };
  const placer = new Placer(level, plan.seed);
  plan.rocks(placer);
  level.boulders = placer.boulders;
  level.rocks = new RockGrid(level.boulders);
  level.kelp = plantKelp(plan, level, mulberry32(plan.seed + 1));
  Object.assign(level, plan.populate(placer));
  return level;
};
