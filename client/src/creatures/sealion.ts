import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  attribute,
  color,
  length,
  mx_noise_float,
  positionLocal,
  smoothstep,
  uniform,
  uv,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView, Stage } from ".";
import type { Fx } from "../../../shared/arena";
import { SEALION } from "../../../shared/creatures/sealion";
import type { CreatureSpawn, Point } from "../../../shared/level";
import { ease, rim } from "../fight";
import type { CreatureSnapshot } from "../net";
import { hiss, tone } from "../sound";

const FUR = new THREE.Color(0x5a_3f_2b);
const BELLY = new THREE.Color(0xa6_80_58);
const MUZZLE = new THREE.Color(0x8e_6c_4c);
const LEATHER = new THREE.Color(0x22_1a_15);
const EYE = new THREE.Color(0x06_05_05);

/** Bones, in the order of the skeleton. */
const B = {
  spine: 0,
  chest: 1,
  neck: 2,
  head: 3,
  jaw: 4,
  hips: 5,
  hind: 6,
  foreL: 7,
  foreR: 8,
} as const;

/** Each bone's parent and its rest position relative to that parent; the spine sits at the origin. */
const BONES: [number, [number, number, number]][] = [
  [-1, [0, 0, 0]],
  [B.spine, [0, 0, 0.08]],
  [B.spine, [0, 0.03, 0.32]],
  [B.neck, [0, 0.03, 0.2]],
  [B.head, [0, -0.03, 0.08]],
  [B.spine, [0, 0, -0.18]],
  [B.hips, [0, 0, -0.27]],
  [B.spine, [0.13, -0.09, 0.2]],
  [B.spine, [-0.13, -0.09, 0.2]],
];

/** Side profile from tail to nose: position along the body, girth, and height of the centre line. */
const PROFILE = [
  [-0.5, 0, 0],
  [-0.49, 0.03, 0],
  [-0.44, 0.06, 0],
  [-0.32, 0.11, 0],
  [-0.16, 0.16, 0],
  [0.02, 0.19, 0],
  [0.16, 0.185, 0.01],
  [0.3, 0.13, 0.03],
  [0.4, 0.09, 0.05],
  [0.47, 0.084, 0.062],
  [0.53, 0.09, 0.072],
  [0.58, 0.083, 0.074],
  [0.625, 0.058, 0.058],
  [0.68, 0.042, 0.048],
  [0.716, 0.024, 0.045],
  [0.726, 0, 0.045],
];

/** Smoothly 0 at `a` to 1 at `b`, in either direction. */
const rise = (a: number, b: number, x: number) =>
  a < b
    ? THREE.MathUtils.smoothstep(x, a, b)
    : 1 - THREE.MathUtils.smoothstep(x, b, a);

/** How much each bone moves a point of the body at `z` along it: the spine bends smoothly at neck and hips. */
const bodyWeights = (z: number): [number, number][] => {
  const head = rise(0.46, 0.54, z);
  const neck = rise(0.24, 0.38, z) * (1 - head);
  const hind = rise(-0.38, -0.47, z);
  const hips = rise(-0.06, -0.24, z) * (1 - hind);
  const rest = 1 - head - neck - hind - hips;
  const chest = rest * 0.85 * Math.exp(-(((z - 0.08) / 0.17) ** 2));
  return [
    [B.head, head],
    [B.neck, neck],
    [B.hind, hind],
    [B.hips, hips],
    [B.chest, chest],
    [B.spine, rest - chest],
  ];
};

/** Fills a geometry's colour and skin attributes, one colour and set of bone weights per vertex. */
const paint = (
  g: THREE.BufferGeometry,
  each: (i: number) => [THREE.Color, [number, number][]]
) => {
  const n = g.attributes.position.count;
  const rgb = new Float32Array(n * 3);
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    const [c, ws] = each(i);
    c.toArray(rgb, i * 3);
    const top = ws
      .filter(([, w]) => w > 1e-3)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    for (const [k, [bone, w]] of top.entries()) {
      index[i * 4 + k] = bone;
      weight[i * 4 + k] = w / sum;
    }
  }
  g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(index, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(weight, 4));
  return g;
};

/** The body, neck and head as one smooth tube along +z, darker on the back, with a paler muzzle and dark nose. */
const buildBody = () => {
  const curve = new THREE.CatmullRomCurve3(
    PROFILE.map(([z, r, y]) => new THREE.Vector3(z, r, y))
  );
  const rings = curve.getPoints(40);
  const seg = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of rings) {
    for (let j = 0; j <= seg; j += 1) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * p.y * 0.94, p.z + Math.sin(a) * p.y, p.x);
    }
  }
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < seg; j += 1) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2)
  );
  const c = new THREE.Color();
  return paint(g, (i) => {
    const ring = rings[Math.floor(i / (seg + 1))];
    const up = Math.sin(((i % (seg + 1)) / seg) * Math.PI * 2);
    c.lerpColors(BELLY, FUR, THREE.MathUtils.smoothstep(up, -0.6, 0.5));
    c.lerp(MUZZLE, rise(0.6, 0.66, ring.x) * 0.8);
    c.lerp(LEATHER, rise(0.7, 0.716, ring.x));
    return [c, bodyWeights(ring.x)];
  });
};

/** An ellipsoid on one bone, in rest-pose body space, with optional yaw. */
const lobe = (
  bone: number,
  at: [number, number, number],
  r: [number, number, number],
  tint: THREE.Color,
  yaw = 0,
  detail = 10
) => {
  const g = new THREE.SphereGeometry(1, detail, Math.ceil(detail * 0.7));
  g.scale(...r)
    .rotateY(yaw)
    .translate(...at);
  return paint(g, () => [tint, [[bone, 1]]]);
};

/** Geometry every sea lion shares, built on first use. */
const buildGeometry = () => {
  const parts = [
    buildBody(),
    lobe(B.jaw, [0, 0.014, 0.655], [0.034, 0.017, 0.06], MUZZLE),
    lobe(B.head, [0.056, 0.1, 0.6], [0.017, 0.017, 0.013], EYE, 0, 6),
    lobe(B.head, [-0.056, 0.1, 0.6], [0.017, 0.017, 0.013], EYE, 0, 6),
    lobe(B.head, [0.07, 0.128, 0.545], [0.01, 0.024, 0.014], LEATHER, 0, 6),
    lobe(B.head, [-0.07, 0.128, 0.545], [0.01, 0.024, 0.014], LEATHER, 0, 6),
  ];
  for (const side of [1, -1]) {
    const bone = side > 0 ? B.foreL : B.foreR;
    parts.push(
      lobe(
        bone,
        [side * 0.28, -0.1, 0.12],
        [0.19, 0.018, 0.07],
        LEATHER,
        side * 0.45,
        12
      ),
      lobe(
        B.hind,
        [side * 0.05, -0.005, -0.56],
        [0.05, 0.012, 0.125],
        LEATHER,
        side * 0.22
      )
    );
  }
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  g.boundingSphere?.set(new THREE.Vector3(0, 0, 0), 0.9);
  return g;
};

let built: THREE.BufferGeometry | undefined;
const geometry = () => {
  built ??= buildGeometry();
  return built;
};

/** Square-edged twitch, -1 to 1: the jerks of a seizing animal rather than a smooth wave. */
const jerk = (t: number, hz: number, phase: number) =>
  Math.tanh(Math.sin(t * hz + phase) * 4);

/** How far off, in metres, a seizure is heard and announced: far enough to carry from the beach. */
const SEIZURE_HEARD = 40;
/** Milliseconds after one seizure is announced before the top rule announces another. */
const SEIZURE_NEWS_GAP = 30_000;

/** A sick sea lion's seizure: ragged, strangled barks. */
const seizingSound = (v: number) => {
  for (let i = 0; i < 4; i += 1) {
    tone("sawtooth", 420 - i * 30, 210, 0.16, 0.12 * v, i * 0.22);
    hiss("bandpass", 900, 0.12, 0.1 * v, i * 0.22);
  }
};

/** A healthy sea lion streaks past: a whoosh of bubbles and one bright bark. */
const buzzedSound = (v: number) => {
  hiss("bandpass", 600, 0.45, 0.3 * v);
  tone("square", 520, 640, 0.12, 0.06 * v, 0.15);
};

/** How far the animal lies over onto its side in each mode. */
const SIDE = [0, 0.9, 0.45, 0.2];

/**
 * California sea lion (Zalophus californianus), built along +z: a sleek brown body tapering to a
 * long neck and dog-like muzzle, small ears, long leathery fore-flippers it flies with, and hind
 * flippers trailing together. A healthy one swims in fast rolling loops. The sick one sprawls on the
 * rocks with a violet tint, and in a seizure throws its head back to the sky, arches and jerks its
 * flippers while a violet glow builds with the bout; calming drains the violet.
 */
export class SeaLionView implements CreatureView {
  /** When the top rule last announced a seizure, so repeated bouts do not crowd it. */
  private static seizureNews = -Infinity;
  readonly root = new THREE.Group();
  readonly objects = [this.root];
  private pose = new THREE.Group();
  private body = new THREE.Group();
  private bones: THREE.Bone[];
  private halo: THREE.Sprite;
  private sick = uniform(0);
  private flare = uniform(0);
  /** A pale glow that washes over the animal as it is soothed, and flares when the sickness leaves it. */
  private relief = uniform(0);
  private shiver = 0;
  private lastMeter = 0;
  private stroke = 0;
  private side = 0;
  private bank = 0;
  /** Seconds left in a playful barrel roll, and which way it turns. */
  private roll = 0;
  private rollDir = 1;
  private nextRoll: number;
  private lastYaw = 0;
  private last = new THREE.Vector3();
  private fresh = true;
  private phase: number;

  constructor(spawn: CreatureSpawn) {
    this.phase =
      [...spawn.id].reduce((a, ch) => a + (ch.codePointAt(0) ?? 0), 0) % 17;
    this.nextRoll = 2 + (this.phase % 5);
    const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.42 });
    const mottle = mx_noise_float(positionLocal.mul(9)).mul(0.14).add(0.93);
    skin.colorNode = attribute("color", "vec3").mul(mottle);
    skin.emissiveNode = color(0x9b_5c_ff)
      .mul(this.sick.mul(rim(2).mul(2.4).add(0.3)))
      .add(color(0x8f_b4_bc).mul(rim(3).mul(0.55)))
      .add(color(0xa8_6c_ff).mul(this.flare.mul(rim(1.5).mul(1.8).add(0.2))))
      .add(color(0xe8_f4_ff).mul(this.relief.mul(rim(1.2).mul(1.6).add(0.25))));

    this.bones = BONES.map(([, at]) => {
      const b = new THREE.Bone();
      b.position.set(...at);
      return b;
    });
    for (const [i, [parent]] of BONES.entries()) {
      if (parent >= 0) {
        this.bones[parent].add(this.bones[i]);
      }
    }
    const animal = new THREE.SkinnedMesh(geometry(), skin);
    animal.add(this.bones[B.spine]);
    animal.bind(new THREE.Skeleton(this.bones));

    // A violet bloom that shows through the dark, so a seizure reads from across the screen.
    const glow = new THREE.SpriteNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const fall = smoothstep(0.5, 0, length(uv().sub(0.5)));
    glow.colorNode = color(0xa8_6c_ff);
    glow.opacityNode = fall.mul(fall).mul(this.flare).mul(0.85);
    this.halo = new THREE.Sprite(glow);
    this.halo.scale.setScalar(2.2);
    this.halo.position.set(0, 0.2, 0.2);
    this.halo.visible = false;
    this.halo.renderOrder = 10;

    this.body.add(animal);
    this.pose.add(this.body);
    this.root.add(this.pose, this.halo);
    this.root.scale.setScalar(1.5);
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    const speed = dt > 0 ? this.last.distanceTo(this.root.position) / dt : 0;
    this.last.copy(this.root.position);
    let turn = s.yaw - this.lastYaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const yawRate = dt > 0 && !this.fresh ? turn / dt : 0;
    this.lastYaw = s.yaw;
    this.root.rotation.set(0, s.yaw, 0);

    // Calming shows as a slow breathing glow while the meter rises.
    const soothed = s.meter > this.lastMeter + 1e-4;
    this.lastMeter = s.meter;
    const breathe = soothed ? 0.35 + Math.sin(t * 6) * 0.15 : 0;
    this.relief.value +=
      (Math.max(breathe, 0) - this.relief.value) * ease(dt, soothed ? 6 : 1.5);
    this.shiver *= Math.exp(-3 * dt);

    const ill = s.mode === SEALION.haul || s.mode === SEALION.seize;
    const sick = ill ? 1 - s.meter * 0.7 : 0;
    const settle = this.fresh ? 1 : ease(dt, s.mode === SEALION.calm ? 0.8 : 4);
    this.sick.value += (sick - this.sick.value) * settle;
    const fit = s.mode === SEALION.seize ? s.charge : 0;
    this.flare.value += (fit - this.flare.value) * ease(dt, 12);
    this.halo.visible = this.flare.value > 0.02;
    this.side +=
      ((SIDE[s.mode] ?? 0) - this.side) * (this.fresh ? 1 : ease(dt, 2.5));
    this.fresh = false;

    if (s.mode === SEALION.swim) {
      this.swim(dt, s.pitch, speed, yawRate);
    } else {
      this.ashore(t, s.mode === SEALION.calm, this.flare.value);
    }
    this.body.rotation.y += Math.sin(t * 40) * this.shiver * 0.15;
  }

  /** Flies through the water on its fore-flippers, banking into turns and now and then rolling right over. */
  private swim(dt: number, pitch: number, speed: number, yawRate: number) {
    const b = this.bones;
    const fast = Math.min(speed, 6) / 6;
    this.bank +=
      (THREE.MathUtils.clamp(-yawRate * 0.3, -1, 1) - this.bank) * ease(dt, 5);
    this.nextRoll -= dt;
    if (this.nextRoll <= 0 && this.roll <= 0 && fast > 0.4) {
      this.roll = 0.9;
      this.rollDir = Math.sign(this.bank) || 1;
      this.nextRoll = 4 + ((this.phase * 7.3) % 5);
    }
    const spin =
      this.roll > 0
        ? (1 - this.roll / 0.9) ** 1.4 * Math.PI * 2 * this.rollDir
        : 0;
    this.roll = Math.max(0, this.roll - dt);
    this.pose.rotation.set(0, 0, 0);
    this.pose.position.y = 0;
    this.body.rotation.set(pitch, 0, this.bank + spin, "YXZ");

    this.stroke += dt * (2.2 + fast * 7);
    const flap = Math.sin(this.stroke);
    const reach = 0.25 + fast * 0.45;
    for (const [i, side] of [1, -1].entries()) {
      b[B.foreL + i].rotation.set(
        Math.cos(this.stroke) * 0.25 * fast,
        side * (0.1 - flap * 0.25 * fast),
        side * (0.12 + flap * reach)
      );
    }
    const lean = THREE.MathUtils.clamp(yawRate * 0.12, -0.5, 0.5);
    b[B.neck].rotation.set(-0.05 - Math.sin(this.stroke - 0.8) * 0.06, lean, 0);
    b[B.head].rotation.set(0.05, lean * 0.5, 0);
    b[B.jaw].rotation.x = 0;
    b[B.hips].rotation.set(
      Math.sin(this.stroke - 1.6) * 0.1 * fast,
      -lean * 0.6,
      0
    );
    b[B.hind].rotation.set(Math.sin(this.stroke - 2.2) * 0.2, -lean * 0.8, 0);
    b[B.chest].scale.set(1, 1, 1);
  }

  /**
   * Lies on the rocks. Sick and limp it sprawls on its side breathing hard; seizing it throws its head
   * back to the sky, arches and jerks with the bout's intensity `fit`; calmed it rests on its belly, chin down.
   */
  private ashore(t: number, calm: boolean, fit: number) {
    const b = this.bones;
    const ph = this.phase;
    const k = fit * fit;
    const jolt = k * jerk(t, 23, ph);
    this.pose.rotation.set(
      0,
      Math.sin(t * 31 + ph) * 0.04 * k,
      this.side + jolt * 0.1
    );
    this.pose.position.y = Math.abs(jerk(t, 17, ph * 2)) * 0.04 * k;
    this.body.rotation.set(0, 0, 0);

    const pant = calm
      ? Math.sin(t * 1.6 + ph) * 0.03
      : Math.sin(t * 4.2 + ph) * 0.07 * (1 - fit * 0.5);
    b[B.chest].scale.set(1 + pant, 1 + pant, 1);

    const rest = calm ? 0.38 : 0.3;
    b[B.neck].rotation.set(
      THREE.MathUtils.lerp(rest + pant, -1.25, fit) + jolt * 0.15,
      jerk(t, 13, ph + 1) * 0.12 * k,
      0
    );
    b[B.head].rotation.set(
      THREE.MathUtils.lerp(calm ? 0.12 : 0.05, -0.55, fit),
      0,
      0
    );
    const gape = calm ? 0 : 0.08 + Math.max(0, pant) * 1.5;
    b[B.jaw].rotation.x =
      THREE.MathUtils.lerp(gape, 0.45, fit) + jerk(t, 19, ph) * 0.12 * k;
    b[B.hips].rotation.set(
      THREE.MathUtils.lerp(calm ? 0.04 : 0.08, 0.5, fit) + jolt * 0.1,
      0,
      0
    );
    b[B.hind].rotation.set(0.15 + jerk(t, 21, ph + 2) * 0.4 * k, 0, 0);
    for (const [i, side] of [1, -1].entries()) {
      const flail = jerk(t, 25 + i * 3, ph + i * 1.7) * k;
      b[B.foreL + i].rotation.set(
        calm ? 0.3 : 0.1 + flail * 0.5,
        side * (calm ? 0.5 : 0.1 + flail * 0.3),
        side * (-0.15 + flail * 0.7)
      );
    }
  }

  react(f: Fx, { effects, at, me, loud }: Stage) {
    if (f.k === "calmed") {
      this.relief.value = 1.1;
      this.shiver = 1;
    } else if (f.k === "seizing") {
      // Violet motes thrown off the convulsing body.
      effects.burst(at, 18, 0xb4_70_ff, 1.6, 0.6, 0.9, 0.04);
      const d = Math.hypot(at[0] - me.x, at[1] - me.y, at[2] - me.z);
      seizingSound(Math.max(0, 1 - d / SEIZURE_HEARD));
      return SeaLionView.seizure(f, me);
    } else if (f.k === "buzzed" && f.p) {
      // A trail of bubbles where it streaked past.
      effects.burst(f.p, 22, 0xe0_f4_ff, 1.4, 0.9, 1.2, 0.03);
      buzzedSound(f.by === me.id ? 1 : loud(f.p) * 0.6);
      return f.by === me.id ? "A sea lion buzzes past you, playing." : "";
    }
    return "";
  }

  /** The line for a seizure, or none if it is far off or one was announced in the last half minute. */
  private static seizure(f: Fx, me: Point) {
    const now = performance.now();
    const far =
      !f.p ||
      Math.hypot(f.p[0] - me.x, f.p[1] - me.y, f.p[2] - me.z) > SEIZURE_HEARD;
    if (far || now - SeaLionView.seizureNews < SEIZURE_NEWS_GAP) {
      return "";
    }
    SeaLionView.seizureNews = now;
    return "A sea lion is seizing on the breakwater.";
  }
}
