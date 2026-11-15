import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  abs,
  color,
  float,
  fract,
  mix,
  mx_noise_float,
  oneMinus,
  positionLocal,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView } from ".";
import type { Fx } from "../../../shared/arena";
import { CABEZON } from "../../../shared/creatures/cabezon";
import type { CreatureSpawn, Point } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { ease, mesh, rim, sphere } from "../fight";
import type { CreatureSnapshot } from "../net";

/** The model is built about 1.25 long; this brings it to a 0.7 m fish before the root's ×1.5. */
const SIZE = 0.58;

/** Body half-width and half-height along its length, tail to snout: a broad flat head on a tapering body. */
const PROFILE = [
  [-0.5, 0.025, 0.05],
  [-0.42, 0.045, 0.085],
  [-0.25, 0.085, 0.14],
  [-0.05, 0.14, 0.175],
  [0.12, 0.22, 0.18],
  [0.25, 0.27, 0.165],
  [0.36, 0.26, 0.14],
  [0.45, 0.21, 0.1],
  [0.51, 0.1, 0.05],
] as const;
/** A coarse sphere for the eyes, mouth and chin, which cover a few pixels at the camera. */
const bead = new THREE.SphereGeometry(1, 12, 8);
const RINGS = 22;
const SEGS = 14;
/** The belly is flatter than the back, so the fish sits on the rock. */
const BELLY = 0.72;

const curve = new THREE.CatmullRomCurve3(
  PROFILE.map(([z, w, h]) => new THREE.Vector3(w, h, z))
);
const rings = curve.getSpacedPoints(RINGS - 1);

/** Half-width and half-height of the body at `z`. */
const girth = (z: number) => {
  const i = rings.findIndex((p) => p.z >= z);
  if (i <= 0) {
    return rings[Math.max(i, 0)];
  }
  const a = rings[i - 1];
  const b = rings[i];
  return a.clone().lerp(b, (z - a.z) / (b.z - a.z));
};

/** The body as one closed loft along +z, with a point at each end. */
const buildBody = () => {
  const pos: number[] = [0, 0, rings[0].z - 0.02];
  for (const r of rings) {
    for (let j = 0; j < SEGS; j += 1) {
      const a = (j / SEGS) * Math.PI * 2;
      const s = Math.sin(a);
      pos.push(Math.cos(a) * r.x, s * r.y * (s < 0 ? BELLY : 1), r.z);
    }
  }
  const tip = 1 + RINGS * SEGS;
  pos.push(0, -0.01, rings[RINGS - 1].z + 0.02);
  const idx: number[] = [];
  const at = (i: number, j: number) => 1 + i * SEGS + (j % SEGS);
  for (let j = 0; j < SEGS; j += 1) {
    idx.push(
      0,
      at(0, j + 1),
      at(0, j),
      tip,
      at(RINGS - 1, j),
      at(RINGS - 1, j + 1)
    );
    for (let i = 0; i < RINGS - 1; i += 1) {
      idx.push(
        at(i, j),
        at(i, j + 1),
        at(i + 1, j),
        at(i, j + 1),
        at(i + 1, j + 1),
        at(i + 1, j)
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

type V3 = [number, number, number];

/**
 * A fin of `bases.length` rays from each base point to its tip, with the membrane between two rays
 * cut back by `dip` so spines stand proud. `uv.x` counts rays, so `fract(uv.x)` finds them.
 */
const fan = (bases: V3[], tips: V3[], dip: number) => {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (const [i, b] of bases.entries()) {
    pos.push(...b, ...tips[i]);
    uvs.push(i, 0, i, 1);
  }
  const n = bases.length;
  for (let i = 0; i < n - 1; i += 1) {
    const m = new THREE.Vector3(...tips[i])
      .add(new THREE.Vector3(...tips[i + 1]))
      .multiplyScalar(0.5)
      .lerp(
        new THREE.Vector3(...bases[i])
          .add(new THREE.Vector3(...bases[i + 1]))
          .multiplyScalar(0.5),
        dip
      );
    const k = pos.length / 3;
    pos.push(m.x, m.y, m.z);
    uvs.push(i + 0.5, 1 - dip);
    const [b0, t0, b1, t1] = [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3];
    idx.push(b0, b1, k, b0, k, t0, b1, t1, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

/** `n` evenly spaced values from `a` to `b`. */
const steps = (n: number, a: number, b: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/** A fin standing on the back (or hanging from the belly when `down`) from z `a` back to `b`, rays `tall(k)` long. */
const ridge = (
  n: number,
  a: number,
  b: number,
  tall: (k: number) => number,
  dip: number,
  down = false
) => {
  const zs = steps(n, a, b);
  const side = down ? -BELLY : 1;
  const bases = zs.map((z): V3 => [0, girth(z).y * side * 0.9, z]);
  const tips = zs.map((z, i): V3 => {
    const k = i / (n - 1);
    const l = tall(k);
    return [0, girth(z).y * side + (down ? -l : l), z - l * 0.45];
  });
  return fan(bases, tips, dip);
};

/** The fleshy fringed flap over each eye and on the snout. */
const cirrus = (x: number, z: number, tall: number) => {
  const y = girth(z).y * 0.92;
  const bases = steps(4, -0.02, 0.02).map((d): V3 => [x, y, z + d]);
  const tips = steps(4, -0.6, 0.6).map((a): V3 => [
    x + Math.sign(x) * tall * 0.3,
    y + tall * Math.cos(a),
    z + tall * Math.sin(a) * 0.6,
  ]);
  return fan(bases, tips, 0.55);
};

/** Fins that flex with the body: soft dorsal, anal fin, the rounded tail and the cirri. */
const buildFins = () => {
  const caudalBases = steps(9, -0.04, 0.04).map((y): V3 => [0, y, -0.48]);
  const caudalTips = steps(9, -0.9, 0.9).map((a): V3 => {
    const r = 0.24 * (0.85 + 0.15 * Math.cos(a));
    return [0, Math.sin(a) * r, -0.48 - Math.cos(a) * r];
  });
  return mergeGeometries([
    ridge(12, -0.04, -0.4, (k) => 0.13 - k * 0.05, 0.12),
    ridge(10, -0.08, -0.4, (k) => 0.09 - k * 0.03, 0.12, true),
    fan(caudalBases, caudalTips, 0.1),
    cirrus(0.1, 0.27, 0.08),
    cirrus(-0.1, 0.27, 0.08),
    cirrus(0, 0.45, 0.045),
  ]);
};

/** The big rounded pectoral fan, pointing out along +x from its root. */
const buildPectoral = () => {
  const n = 13;
  const bases = steps(n, 0.05, -0.07).map((z): V3 => [0, 0, z]);
  const tips = steps(n, 0.45, -1.6).map((a, i): V3 => {
    const r = 0.4 * (0.7 + 0.3 * Math.sin((Math.PI * i) / (n - 1)));
    return [Math.cos(a) * r, -0.03, Math.sin(a) * r];
  });
  return fan(bases, tips, 0.1);
};

/** The cabezon's egg mass: lumpy clutches of small eggs stuck to the rock, maroon to purple-green. */
const buildNest = (nest: Point) => {
  const rnd = mulberry32(31);
  const n = 150;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.3 });
  mat.emissiveNode = color(0x3a_20_38).mul(rim(1.5).add(0.15));
  const tints = [0x7a_1f_3a, 0x6e_2c_7c, 0x5a_6a_2c].map(
    (c) => new THREE.Color(c)
  );
  const tint = new THREE.Color();
  const eggs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 5),
    mat,
    n
  );
  const lobes = [0, 1, 2].map((i) => ({
    x: (rnd() - 0.5) * 0.36,
    z: (rnd() - 0.5) * 0.36,
    from: tints[i],
    to: tints[(i + 1) % tints.length],
  }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i += 1) {
    const lobe = lobes[i % lobes.length];
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.2;
    const h = (1 - r / 0.2) * 0.09 * rnd();
    p.set(
      nest.x + lobe.x + Math.cos(a) * r,
      nest.y + 0.02 + h,
      nest.z + lobe.z + Math.sin(a) * r
    );
    s.setScalar(0.022 + rnd() * 0.01);
    m.compose(p, q, s);
    eggs.setMatrixAt(i, m);
    eggs.setColorAt(i, tint.lerpColors(lobe.from, lobe.to, rnd() * 0.5));
  }
  return eggs;
};

/** One pose: what each part eases toward in a mode. */
interface Pose {
  /** Pectoral sweep back toward the body, and lift (negative presses the fin down). */
  sweep: number;
  lift: number;
  /** How far the spiny dorsal stands, 0 folded to 1 raised. */
  dorsal: number;
  /** How far the gill covers flare the cheeks out. */
  gill: number;
  jaw: number;
  /** Tail held to one side, as a fish curls on the rock or cocks for a lunge. */
  cock: number;
  /** The warm glow that telegraphs a lunge: building with the coil, full during it. */
  flare: number;
}

const pose = (mode: number, charge: number): Pose => {
  switch (mode) {
    case CABEZON.hidden: {
      return {
        sweep: 0.75,
        lift: -0.3,
        dorsal: 0.2,
        gill: 0,
        jaw: 0,
        cock: 0.1,
        flare: 0,
      };
    }
    case CABEZON.coil: {
      return {
        sweep: 0.05,
        lift: -0.2 - charge * 0.1,
        dorsal: 1,
        gill: 0.6 + charge * 0.4,
        jaw: 0.18 + charge * 0.35,
        cock: charge * 0.22,
        flare: charge,
      };
    }
    case CABEZON.lunge: {
      return {
        sweep: 0.9,
        lift: 0.05,
        dorsal: 0.5,
        gill: 1,
        jaw: 0.7,
        cock: 0,
        flare: 1,
      };
    }
    case CABEZON.calm: {
      return {
        sweep: 0.3,
        lift: -0.15,
        dorsal: 0.45,
        gill: 0,
        jaw: 0,
        cock: 0.06,
        flare: 0,
      };
    }
    default: {
      return {
        sweep: -0.05,
        lift: 0.15,
        dorsal: 1,
        gill: 0.55,
        jaw: 0.16,
        cock: 0,
        flare: 0,
      };
    }
  }
};

/**
 * Cabezon (Scorpaenichthys marmoratus), built along +z: a heavy sculpin with a broad flat head, a
 * wide mouth, fleshy flaps over its eyes, fan-like pectorals and a notched spiny dorsal fin. Hidden,
 * it lies flat with its fins folded in granite-grey, pink and olive blotches; roused, it flushes to
 * its own marbled red-brown, flares its cheeks and fans its fins. A sick fish glows violet once it
 * stops hiding; calming drains the glow.
 */
export class CabezonView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects: THREE.Object3D[];
  private body = new THREE.Group();
  private jaw = new THREE.Group();
  private dorsal: THREE.Mesh;
  private pectorals: THREE.Group[] = [];
  private puff: THREE.Mesh;
  private puffAge = 9;
  private sick = uniform(1);
  private hide = uniform(1);
  private flare = uniform(0);
  /** A pale glow that washes over the fish as it is soothed, and flares when the sickness leaves it. */
  private relief = uniform(0);
  private swim = uniform(0);
  private wag = uniform(0.02);
  private gill = uniform(0);
  private cock = uniform(0.1);
  private puffFade = uniform(0);
  private shiver = 0;
  private startle = 0;
  private lastMeter = 0;
  /** The mode last drawn; -1 before the first update, so a fish that spawns roused throws up no silt. */
  private lastMode = -1;
  private last = new THREE.Vector3();

  constructor(spawn: CreatureSpawn) {
    const p = positionLocal;
    const broad = mx_noise_float(p.mul(3.2)).mul(0.5).add(0.5);
    const blotch = mx_noise_float(p.mul(9).add(4.2));
    const spot = mx_noise_float(p.mul(21).sub(1.7));
    const dark = oneMinus(smoothstep(-0.32, -0.05, blotch));
    const pale = smoothstep(0.28, 0.45, spot);
    const belly = oneMinus(smoothstep(-0.13, -0.04, p.y));
    const own = mix(
      mix(
        mix(color(0x8a_3f_26), color(0x6b_60_2e), broad),
        color(0x2a_17_10),
        dark
      ),
      color(0xd6_b4_86),
      pale.mul(0.8)
    );
    const camo = mix(
      mix(
        mix(color(0x8a_85_7a), color(0x5d_6a_34), broad.mul(0.7)),
        color(0x4a_47_40),
        dark.mul(0.8)
      ),
      color(0xa8_70_8c),
      pale
    );
    const skinColor = mix(
      mix(own, color(0xc9_b0_8a), belly.mul(0.75)),
      camo,
      this.hide
    );
    const awake = oneMinus(this.hide);
    // Hidden, nothing glows: a violet edge would give the fish away.
    const glow = (edge: number) =>
      color(0x9b_5c_ff)
        .mul(this.sick.mul(awake).mul(rim(2).mul(edge).add(0.2)))
        .add(color(0xb0_90_70).mul(rim(3).mul(0.5).mul(awake)))
        .add(color(0xff_b0_70).mul(this.flare.mul(rim(1.5)).mul(1.4)))
        .add(
          color(0xe8_f4_ff).mul(this.relief.mul(rim(1.2).mul(1.6).add(0.25)))
        );

    // The tail half sways with `swim` and curls aside with `cock`; the cheeks puff out with `gill`.
    const tail = oneMinus(smoothstep(-0.6, 0.12, p.z));
    const tail2 = tail.mul(tail);
    const cheeks = smoothstep(0.05, 0.2, p.z).mul(
      oneMinus(smoothstep(0.3, 0.46, p.z))
    );
    const bentX = p.x.mul(cheeks.mul(this.gill).mul(0.2).add(1)).add(
      sin(this.swim.sub(p.z.mul(5)))
        .mul(this.wag)
        .add(this.cock)
        .mul(tail2)
    );
    const bent = vec3(bentX, p.y, p.z);
    // Hidden, the fins behind the head fold down against the body.
    const folded = vec3(
      bentX,
      p.y.mul(
        oneMinus(this.hide.mul(0.5).mul(oneMinus(smoothstep(0, 0.15, p.z))))
      ),
      p.z
    );

    // The chin shares the body's bend: its own coordinates sit at the head, where only the cheeks move.
    const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
    skin.colorNode = skinColor;
    skin.emissiveNode = glow(2.4);
    skin.positionNode = bent;

    const ray = oneMinus(
      smoothstep(0.04, 0.16, abs(fract(uv().x.add(0.5)).sub(0.5)))
    );
    const finColor = skinColor
      .mul(mix(float(1.05), float(0.5), ray))
      .mul(mix(float(0.9), float(1.25), uv().y));
    const fin = new THREE.MeshStandardNodeMaterial({
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    // Fins are thin enough that light comes through them, so they keep some colour facing away from it.
    const finGlow = glow(0.8).add(finColor.mul(0.22));
    fin.colorNode = finColor;
    fin.emissiveNode = finGlow;
    const bodyFin = fin.clone();
    bodyFin.colorNode = finColor;
    bodyFin.emissiveNode = finGlow;
    bodyFin.positionNode = folded;

    // A bronze iris round a dark pupil that looks up and out; hidden, the eye dims to a faint violet.
    const eyeX = 0.1;
    const eyeY = girth(0.31).y * 0.92;
    const gaze = vec3(p.x.sign().mul(0.55), 0.8, 0.25).normalize();
    const look = p
      .sub(vec3(p.x.sign().mul(eyeX), eyeY, 0.31))
      .normalize()
      .dot(gaze);
    const iris = mix(
      mix(color(0xd8_a0_40), color(0xd9_a8_ff), this.sick),
      color(0x6a_52_80),
      this.hide
    );
    const eye = new THREE.MeshBasicNodeMaterial();
    eye.colorNode = mix(iris, color(0x0a_06_08), smoothstep(0.84, 0.9, look));
    const mouth = new THREE.MeshBasicNodeMaterial();
    mouth.colorNode = color(0x1c_0a_0a);

    const eyes = mergeGeometries(
      [eyeX, -eyeX].map((x) =>
        bead.clone().scale(0.046, 0.046, 0.046).translate(x, eyeY, 0.31)
      )
    );

    this.dorsal = new THREE.Mesh(
      ridge(10, 0.24, 0, (k) => 0.15 - k * 0.07, 0.42),
      bodyFin
    );
    this.body.add(
      new THREE.Mesh(buildBody(), skin),
      new THREE.Mesh(buildFins(), bodyFin),
      this.dorsal,
      new THREE.Mesh(eyes, eye),
      mesh(bead, mouth, [0, -0.045, 0.37], [0.17, 0.055, 0.12])
    );
    this.jaw.position.set(0, -0.05, 0.24);
    // Built at its size rather than scaled, so the mottling matches the head's.
    const chin = bead.clone().scale(0.2, 0.035, 0.15).translate(0, 0.005, 0.12);
    this.jaw.add(new THREE.Mesh(chin, skin));
    this.body.add(this.jaw);

    const pect = buildPectoral();
    for (const side of [1, -1]) {
      const mount = new THREE.Group();
      mount.position.set(side * 0.17, -0.08, 0.08);
      mount.scale.x = side;
      const flap = new THREE.Group();
      flap.add(new THREE.Mesh(pect, fin));
      mount.add(flap);
      this.body.add(mount);
      this.pectorals.push(flap);
    }
    this.body.scale.setScalar(SIZE);
    this.root.add(this.body);
    this.root.scale.setScalar(1.5);

    // The silt the fish throws up when it bursts off the rock.
    const silt = new THREE.MeshStandardNodeMaterial({
      transparent: true,
      depthWrite: false,
      roughness: 1,
    });
    silt.colorNode = color(0xb7_a8_88);
    silt.opacityNode = oneMinus(rim(1)).mul(this.puffFade).mul(0.45);
    this.puff = new THREE.Mesh(sphere, silt);
    this.puff.visible = false;

    this.objects = [this.root, buildNest(spawn.at), this.puff];
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    const speed = dt > 0 ? this.last.distanceTo(this.root.position) / dt : 0;
    this.last.copy(this.root.position);
    this.root.rotation.set(0, s.yaw, 0);
    const hidden = s.mode === CABEZON.hidden;
    this.body.rotation.x = hidden ? 0 : s.pitch;

    if (this.lastMode === CABEZON.hidden && !hidden) {
      this.startle = 1;
      this.puffAge = 0;
      this.puff.position.set(s.x, s.y - 0.1, s.z);
    }
    this.lastMode = s.mode;

    // Calming shows as a slow breathing glow while the meter rises.
    const soothed = s.meter > this.lastMeter + 1e-4;
    this.lastMeter = s.meter;
    const breathe = soothed ? 0.35 + Math.sin(t * 6) * 0.15 : 0;
    this.relief.value +=
      (breathe - this.relief.value) * ease(dt, soothed ? 6 : 1.5);
    this.shiver *= Math.exp(-3 * dt);
    this.startle *= Math.exp(-4 * dt);

    const calm = s.mode === CABEZON.calm;
    const sick = calm ? 0 : 1 - s.meter * 0.7;
    this.sick.value += (sick - this.sick.value) * ease(dt, calm ? 0.8 : 4);
    this.hide.value +=
      ((hidden ? 1 : 0) - this.hide.value) * ease(dt, hidden ? 0.5 : 7);
    const coil = s.mode === CABEZON.coil;
    const goal = pose(s.mode, s.charge);
    this.flare.value += (goal.flare - this.flare.value) * ease(dt, 10);
    const k = ease(dt, 8);
    this.jaw.rotation.x += (goal.jaw - this.jaw.rotation.x) * ease(dt, 14);
    this.dorsal.scale.y += (goal.dorsal - this.dorsal.scale.y) * k;
    this.gill.value +=
      (goal.gill + Math.sin(t * 1.7) * 0.06 - this.gill.value) * k;
    this.cock.value += (goal.cock - this.cock.value) * ease(dt, 5);
    this.body.scale.z = SIZE * (coil ? 1 - s.charge * 0.1 : 1);
    this.body.position.y +=
      ((hidden ? -0.02 : 0.01) - this.body.position.y) * ease(dt, 4);

    this.swim.value += dt * (2 + Math.min(speed, 6) * 2.5);
    this.wag.value +=
      ((hidden ? 0.006 : 0.03 + Math.min(0.1, speed * 0.04)) - this.wag.value) *
      ease(dt, 4);
    // Pectorals scull gently while it holds station, and beat hard as it bursts off the rock.
    const scull = hidden ? 0 : Math.sin(t * (calm ? 1.6 : 3.2)) * 0.12;
    for (const [i, f] of this.pectorals.entries()) {
      f.rotation.y += (goal.sweep - f.rotation.y) * k;
      f.rotation.z +=
        (goal.lift +
          scull * (i ? 0.8 : 1) +
          Math.sin(t * 30) * this.startle * 0.5 -
          f.rotation.z) *
        ease(dt, 10);
    }
    this.body.rotation.y =
      Math.sin(t * 40) * (this.shiver * 0.12 + this.startle * 0.05);

    this.drift(dt);
  }

  /** The silt cloud spreads, rises and thins. */
  private drift(dt: number) {
    this.puffAge += dt;
    const a = this.puffAge / 1.6;
    this.puff.visible = a < 1;
    if (this.puff.visible) {
      const r = 0.25 + Math.sqrt(a) * 0.7;
      this.puff.scale.set(r, r * 0.25, r);
      this.puff.position.y += dt * 0.12;
      this.puffFade.value = 1 - a;
    }
  }

  react(f: Fx) {
    if (f.k === "calmed") {
      this.relief.value = 1.1;
      this.shiver = 1;
    }
    return "";
  }
}
