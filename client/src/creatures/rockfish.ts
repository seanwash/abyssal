import {
  abs,
  attribute,
  color,
  dot,
  float,
  instancedDynamicBufferAttribute,
  length,
  mix,
  mx_noise_float,
  normalView,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView } from ".";
import { ROCKFISH } from "../../../shared/creatures/rockfish";
import type { CreatureSpawn } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { ease, rim } from "../fight";
import type { CreatureSnapshot } from "../net";

/** The school's modes, as the rules send them. */

const COUNT = 24;
/** Each fish is built at a real blue rockfish's 30 cm and drawn at the lingcod's 1.5 times. */
const SCALE = 1.5;
/** The calm school is about 2.5 m across; full alarm spreads it to about 5.5 m. */
const RADIUS = 1.25;
const SPREAD = 1.3;

/** Half the body's depth at each point along it, nose (+z) to the base of the tail. */
const PROFILE: [number, number][] = [
  [0.135, 0],
  [0.126, 0.018],
  [0.11, 0.032],
  [0.08, 0.046],
  [0.04, 0.054],
  [0, 0.055],
  [-0.04, 0.047],
  [-0.07, 0.032],
  [-0.095, 0.017],
  [-0.112, 0.012],
];
/** The body is narrow from side to side, as a rockfish is. */
const WIDTH = 0.42;

const depthAt = (z: number) => {
  for (let i = 1; i < PROFILE.length; i += 1) {
    const [z1, r1] = PROFILE[i];
    if (z >= z1) {
      const [z0, r0] = PROFILE[i - 1];
      return r1 + ((z - z1) / (z0 - z1)) * (r0 - r1);
    }
  }
  return PROFILE.at(-1)?.[1] ?? 0;
};

const PALE = new THREE.Color(0x9a_a8_b2);
const DUSK = new THREE.Color(0x24_30_3e);
const ROOT = new THREE.Color(0x3a_4a_5c);

/** Triangles for one fish, with each vertex's colour and whether it is fin (1) or body (0). */
const plate = () => {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const fins: number[] = [];

  const vertex = (
    p: THREE.Vector3,
    n: THREE.Vector3,
    c: THREE.Color,
    fin: number
  ) => {
    pos.push(p.x, p.y, p.z);
    nrm.push(n.x, n.y, n.z);
    col.push(c.r, c.g, c.b);
    fins.push(fin);
  };

  /** A flat fin triangle, lit from either side. */
  const tri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    ca: THREE.Color,
    cb: THREE.Color,
    cc: THREE.Color
  ) => {
    const n = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize();
    vertex(a, n, ca, 1);
    vertex(b, n, cb, 1);
    vertex(c, n, cc, 1);
  };

  /**
   * A fin drawn like an engraved fan: rays run from `hub` points out to `tips`, each a pale line
   * through dusky membrane, the way a plate engraver hatches a rockfish's fins.
   */
  const fan = (hub: THREE.Vector3[], tips: THREE.Vector3[]) => {
    for (let i = 0; i + 1 < tips.length; i += 1) {
      const h0 = hub[Math.min(i, hub.length - 1)];
      const h1 = hub[Math.min(i + 1, hub.length - 1)];
      const mid = tips[i]
        .clone()
        .lerp(tips[i + 1], 0.5)
        .lerp(h0.clone().lerp(h1, 0.5), 0.3);
      tri(h0, tips[i], mid, ROOT, PALE, DUSK);
      tri(h0, mid, h1, ROOT, DUSK, ROOT);
      tri(h1, mid, tips[i + 1], ROOT, DUSK, PALE);
    }
  };

  const geometry = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("fin", new THREE.Float32BufferAttribute(fins, 1));
    return g;
  };

  return { vertex, tri, fan, geometry };
};
type Plate = ReturnType<typeof plate>;

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A deep, narrow body turned on a lathe along +z, with the back arched higher than the belly. */
const addBody = (out: Plate) => {
  const lathe = new THREE.LatheGeometry(
    PROFILE.map(([z, r]) => new THREE.Vector2(r, z)),
    9
  );
  lathe.rotateX(Math.PI / 2);
  lathe.scale(WIDTH, 1, 1);
  const p = lathe.getAttribute("position");
  for (let i = 0; i < p.count; i += 1) {
    const y = p.getY(i);
    p.setY(i, y * (y > 0 ? 1.08 : 0.88));
  }
  lathe.computeVertexNormals();
  const flat = lathe.index ? lathe.toNonIndexed() : lathe;
  const fp = flat.getAttribute("position");
  const fn = flat.getAttribute("normal");
  const a = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < fp.count; i += 1) {
    a.fromBufferAttribute(fp, i);
    n.fromBufferAttribute(fn, i);
    out.vertex(a, n, DUSK, 0);
  }
};

const backAt = (z: number) => depthAt(z) * 1.08 - 0.003;
const bellyAt = (z: number) => -depthAt(z) * 0.88 + 0.003;

/** The spiny dorsal: thirteen spines standing past a notched membrane, tallest near the front. */
const addSpinyDorsal = (out: Plate) => {
  const spines = 13;
  for (let i = 0; i < spines; i += 1) {
    const z0 = 0.075 - (i / spines) * 0.11;
    const z1 = 0.075 - ((i + 1) / spines) * 0.11;
    const h0 =
      0.036 *
      Math.sin(Math.min(1, (i + 1.5) / 4) * Math.PI * 0.5) *
      (1 - i * 0.03);
    const b0 = v3(0, backAt(z0), z0);
    const b1 = v3(0, backAt(z1), z1);
    const tip = v3(0, b0.y + h0, z0 - 0.006);
    const notch = v3(0, (b0.y + b1.y) / 2 + h0 * 0.5, (z0 + z1) / 2 - 0.004);
    out.tri(b0, b1, notch, ROOT, ROOT, DUSK);
    out.tri(b0, notch, tip, ROOT, DUSK, PALE);
  }
};

/** A soft-rayed fin along the back or belly, from `z0` to `z1`, rounded to `height`. */
const addSoftFin = (
  out: Plate,
  z0: number,
  z1: number,
  height: number,
  edge: (z: number) => number,
  dir: number
) => {
  const rays = 7;
  const hub: THREE.Vector3[] = [];
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i <= rays; i += 1) {
    const u = i / rays;
    const z = z0 + (z1 - z0) * u;
    const y = edge(z);
    hub.push(v3(0, y, z));
    const h = height * Math.sin((0.25 + u * 0.75) * Math.PI) ** 0.6;
    tips.push(v3(0, y + dir * Math.max(h, 0.004), z - height * 0.5));
  }
  out.fan(hub, tips);
};

/** The tail: a broad, squared fan with a shallow notch. */
const addTail = (out: Plate) => {
  const hub = [v3(0, 0.009, -0.104), v3(0, 0, -0.106), v3(0, -0.009, -0.104)];
  const tips: THREE.Vector3[] = [];
  const rays = 8;
  for (let i = 0; i <= rays; i += 1) {
    const u = i / rays;
    const y = 0.046 - u * 0.092;
    const notch = 0.012 * (1 - Math.abs(u - 0.5) * 2);
    tips.push(v3(0, y, -0.168 + notch));
  }
  const hubs = tips.map((_, i) => hub[Math.round((i / rays) * 2)]);
  out.fan(hubs, tips);
};

/** A pectoral fan on each flank, swept back and held a little off the body. */
const addPectorals = (out: Plate) => {
  for (const side of [-1, 1]) {
    const base = [
      v3(side * 0.02, 0.004, 0.05),
      v3(side * 0.021, -0.018, 0.046),
    ];
    const tips: THREE.Vector3[] = [];
    const rays = 6;
    for (let i = 0; i <= rays; i += 1) {
      const a = 0.35 - (i / rays) * 0.9;
      tips.push(
        v3(
          side * 0.034,
          -0.007 + Math.sin(a) * 0.04,
          0.046 - Math.cos(a) * 0.052
        )
      );
    }
    const hubs = tips.map((_, i) => base[i < rays / 2 ? 0 : 1]);
    out.fan(hubs, tips);
  }
};

const buildFish = () => {
  const fish = plate();
  addBody(fish);
  addSpinyDorsal(fish);
  addSoftFin(fish, -0.038, -0.092, 0.032, backAt, 1);
  addSoftFin(fish, -0.042, -0.09, 0.03, bellyAt, -1);
  addSoftFin(fish, 0.035, 0.012, 0.022, (z) => bellyAt(z) + 0.004, -1);
  addTail(fish);
  addPectorals(fish);
  return fish.geometry();
};

interface Fish {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** The fish's place in the calm school: its radius, angle around the centre, and height. */
  ring: number;
  angle: number;
  height: number;
  /** How far ahead along the heading it bolts at full alarm. */
  dash: number;
  size: number;
  phase: number;
  yaw: number;
  pitch: number;
  roll: number;
  swim: number;
}

const school = (): Fish[] => {
  const rnd = mulberry32(61);
  return Array.from({ length: COUNT }, () => ({
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    ring: RADIUS * Math.sqrt(0.08 + rnd() * 0.92),
    angle: rnd() * Math.PI * 2,
    height: (rnd() - 0.5) * 0.8,
    dash: 0.9 + rnd() * 1.6,
    size: 0.82 + rnd() * 0.36,
    phase: rnd() * Math.PI * 2,
    yaw: 0,
    pitch: 0,
    roll: 0,
    swim: rnd() * 10,
  }));
};

const ignore = (): void => undefined;

/** Wraps an angle difference into -π..π. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * A school of blue rockfish (Sebastes mystinus): slate blue-grey, darkly mottled, deep-bodied
 * fish with spiny dorsal fins drawn as engraved fans. The rules send one creature for the whole
 * school; the view keeps its own fish, milling loosely around the school's centre. When the
 * school's alarm (`charge`) jumps, every fish bolts outward and away along the heading, rolling
 * so its pale flank flashes in the dark, then drifts back as the alarm fades.
 *
 * All fish draw as one instanced mesh. Each fish's tail beat is bent in the vertex shader from a
 * per-fish side direction, swim phase and amplitude, so the CPU only places 24 matrices a frame.
 */
export class RockfishView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects = [this.root];
  private fish = school();
  private mesh: THREE.InstancedMesh;
  /** Per fish: its flank direction scaled to its size (xyz) and its swim phase (w). */
  private side = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 4),
    4
  );
  /** Per fish: tail-beat amplitude and silver flash. */
  private look = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 2),
    2
  );
  private ready = false;
  /** The school's own clock, advanced by `dt`, so milling never outruns the fish after a stalled frame. */
  private clock = 0;
  private center = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private goal = new THREE.Vector3();

  constructor(spawn: CreatureSpawn) {
    this.side.setUsage(THREE.DynamicDrawUsage);
    this.look.setUsage(THREE.DynamicDrawUsage);
    const side = instancedDynamicBufferAttribute<"vec4">(this.side, "vec4");
    const look = instancedDynamicBufferAttribute<"vec2">(this.look, "vec2");

    // The tail beat is a wave running back along the body, growing toward the tail.
    const pg = positionGeometry;
    const bend = smoothstep(0.03, -0.17, pg.z);
    const lateral = sin(side.w.add(pg.z.mul(22)))
      .mul(look.x)
      .mul(bend.mul(bend));

    const mat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.42,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    mat.positionNode = positionLocal.add(side.xyz.mul(lateral));

    // Slate back, blue-grey flanks with dark blotches, a pale belly and a large dark eye.
    const flank = mix(
      color(0x8e_9a_a6),
      color(0x48_5b_72),
      smoothstep(-0.045, -0.008, pg.y)
    );
    const back = mix(flank, color(0x2c_3c_52), smoothstep(0.004, 0.045, pg.y));
    const blotch = mx_noise_float(pg.mul(vec3(22, 26, 22)))
      .mul(0.5)
      .add(0.5);
    const mottled = mix(
      back,
      color(0x12_1a_25),
      smoothstep(0.45, 0.6, blotch).mul(smoothstep(-0.04, 0, pg.y))
    );
    const eyeD = length(vec2(pg.y.sub(0.017), pg.z.sub(0.098)));
    const eyed = mix(
      mix(mottled, color(0x6e_74_70), smoothstep(0.013, 0.011, eyeD)),
      color(0x05_07_0a),
      smoothstep(0.0095, 0.0075, eyeD)
    );
    const fin = attribute("fin", "float");
    mat.colorNode = mix(eyed, attribute("color", "vec3"), fin);

    // A cool rim keeps the school's outline in the dark; a spooked fish's flank flashes silver,
    // brightest where it turns flat to the camera.
    const facing = abs(dot(normalView, positionViewDirection));
    mat.emissiveNode = color(0x6f_90_b0)
      .mul(rim(3).mul(0.7))
      .add(
        color(0xe6_f0_ff).mul(
          look.y
            .mul(facing.mul(facing).mul(3.2).add(0.6))
            .mul(float(1).sub(fin.mul(0.6)))
        )
      );

    this.mesh = new THREE.InstancedMesh(buildFish(), mat, COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The fish move freely around the centre, so a bounding sphere computed once would go stale.
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.position.set(spawn.at.x, spawn.at.y, spawn.at.z);
  }

  update(dt: number, _t: number, s: CreatureSnapshot) {
    this.clock += dt;
    const t = this.clock;
    const c = this.center.set(s.x, s.y, s.z);
    this.root.position.copy(c);
    const alarm = Math.max(0, Math.min(1, s.charge));
    const fleeing = s.mode === ROCKFISH.scatter;
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    const fwdX = sy * Math.cos(s.pitch);
    const fwdY = -Math.sin(s.pitch);
    const fwdZ = cy * Math.cos(s.pitch);
    // A school that appears or jumps (a reef reset) is placed at once instead of swimming over.
    const snap = !this.ready || this.fish[0].pos.distanceTo(c) > 9;
    this.ready = true;

    const spread = 1 + SPREAD * alarm;
    // Bolting is fast and decisive; regrouping is a slow drift back.
    const pull = fleeing ? 7 : 1.3;
    const top = fleeing ? 7 : 1.1;

    for (const [i, f] of this.fish.entries()) {
      // Milling: each fish circles the centre slowly at its own radius, with a little bob.
      const a = f.angle + t * 0.1 * (0.8 + f.size * 0.3);
      const r = f.ring * spread * (1 + Math.sin(t * 0.37 + f.phase) * 0.08);
      const lx = Math.cos(a) * r;
      const lz = Math.sin(a) * r;
      const ahead = alarm * f.dash;
      this.goal.set(
        c.x + lx * cy + lz * sy + fwdX * ahead,
        c.y +
          f.height * spread +
          Math.sin(t * 0.6 + f.phase) * 0.06 +
          fwdY * ahead,
        c.z - lx * sy + lz * cy + fwdZ * ahead
      );

      if (snap) {
        f.pos.copy(this.goal);
        f.vel.set(0, 0, 0);
      } else {
        const want = this.p.subVectors(this.goal, f.pos).multiplyScalar(pull);
        const len = want.length();
        if (len > top) {
          want.multiplyScalar(top / len);
        }
        f.vel.lerp(want, ease(dt, fleeing ? 9 : 2.5));
        f.pos.addScaledVector(f.vel, dt);
      }

      // Face along the swim, leaning on the school's heading when nearly still.
      const speed = f.vel.length();
      const dx = f.vel.x + fwdX * 0.12;
      const dy = f.vel.y + fwdY * 0.12;
      const dz = f.vel.z + fwdZ * 0.12;
      const yaw = Math.atan2(dx, dz);
      const turn = wrap(yaw - f.yaw);
      const k = ease(dt, fleeing ? 12 : 3);
      f.yaw += turn * k;
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
      f.pitch += (Math.max(-0.6, Math.min(0.6, pitch)) - f.pitch) * k;
      // Banks into turns; a spooked fish also rolls side to side, flashing its flank.
      const bank = Math.max(
        -0.9,
        Math.min(0.9, (-turn / Math.max(dt, 1e-3)) * 0.04)
      );
      const flick = alarm * 0.7 * Math.sin(t * 9 + f.phase * 3);
      f.roll += (bank + flick - f.roll) * ease(dt, 8);

      f.swim += dt * (7 + Math.min(speed, 6) * 6) * (0.9 + f.size * 0.15);
      this.e.set(f.pitch, f.yaw, f.roll);
      this.q.setFromEuler(this.e);
      this.s.setScalar(SCALE * f.size);
      this.m.compose(this.p.subVectors(f.pos, c), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      const el = this.m.elements;
      this.side.setXYZW(i, el[0], el[1], el[2], f.swim);
      this.look.setXY(
        i,
        0.01 + Math.min(speed, 5) * 0.006,
        alarm * alarm * (0.55 + 0.45 * Math.sin(t * 13 + f.phase * 5))
      );
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.side.needsUpdate = true;
    this.look.needsUpdate = true;
  }

  /** The rules drive the scatter through mode and charge, so a harpoon or bite elsewhere never spooks the school. */
  readonly react = ignore;
}
