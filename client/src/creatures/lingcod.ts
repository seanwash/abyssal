import { color, mix, mx_noise_float, positionLocal, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView } from ".";
import type { Fx } from "../../../shared/arena";
import { LING } from "../../../shared/creatures/lingcod";
import type { CreatureSpawn, Point } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { ease, mesh, rim, sphere } from "../fight";
import type { CreatureSnapshot } from "../net";

/** The lingcod's egg mass: a mound of pale eggs on the floor of the Hollow. */
const buildNest = (nest: Point) => {
  const rnd = mulberry32(17);
  const n = 140;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  mat.colorNode = color(0xa8_9a_82);
  mat.emissiveNode = color(0x3a_32_28).mul(rim(2));
  const eggs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    mat,
    n
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < n; i += 1) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 0.75;
    const h = (1 - r / 0.75) * 0.35 * rnd();
    p.set(
      nest.x + Math.cos(a) * r,
      nest.y + 0.04 + h,
      nest.z + Math.sin(a) * r
    );
    s.setScalar(0.06 + rnd() * 0.03);
    m.compose(p, q, s);
    eggs.setMatrixAt(i, m);
  }
  return eggs;
};

/** How bright the flare burns: building with the coil, full during the lunge. */
const flareGoal = (coil: boolean, lunge: boolean, charge: number) => {
  if (coil) {
    return charge;
  }
  return lunge ? 1 : 0;
};

/** How wide the jaw opens: widest in the lunge, widening through the coil, nearly shut otherwise. */
const jawGoal = (coil: boolean, lunge: boolean, charge: number) => {
  if (lunge) {
    return 0.6;
  }
  return coil ? 0.15 + charge * 0.3 : 0.04;
};

/**
 * Lingcod (Ophiodon elongatus), built along +z: a long mottled body, a big head and an underslung
 * jaw that opens as it coils and lunges. A sick fish glows violet; calming drains the glow.
 */
export class LingcodView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects: THREE.Object3D[];
  private body = new THREE.Group();
  private tail = new THREE.Group();
  private jaw = new THREE.Group();
  private sick = uniform(1);
  private flare = uniform(0);
  /** A pale glow that washes over the fish as it is soothed, and flares when the sickness leaves it. */
  private relief = uniform(0);
  private shiver = 0;
  private lastMeter = 0;
  private swim = 0;
  private last = new THREE.Vector3();

  constructor(spawn: CreatureSpawn) {
    const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
    const mottle = mx_noise_float(positionLocal.mul(7)).mul(0.5).add(0.5);
    skin.colorNode = mix(color(0x5a_5a_36), color(0xc4_ad_72), mottle);
    skin.emissiveNode = color(0x9b_5c_ff)
      .mul(this.sick.mul(rim(2).mul(2.4).add(0.45)))
      .add(color(0x9f_b0_80).mul(rim(3).mul(0.5)))
      .add(color(0xff_b0_70).mul(this.flare.mul(rim(1.5)).mul(1.4)))
      .add(color(0xe8_f4_ff).mul(this.relief.mul(rim(1.2).mul(1.6).add(0.25))));
    const eye = new THREE.MeshBasicNodeMaterial();
    eye.colorNode = mix(color(0xe8_d0_70), color(0xd9_a8_ff), this.sick);

    this.body.add(
      mesh(sphere, skin, [0, 0, 0], [0.2, 0.19, 0.62]),
      mesh(sphere, skin, [0, 0.03, 0.42], [0.22, 0.19, 0.3]),
      mesh(new THREE.BoxGeometry(0.02, 0.12, 0.9), skin, [0, 0.19, -0.05]),
      mesh(sphere, skin, [0.2, -0.07, 0.25], [0.15, 0.02, 0.1]),
      mesh(sphere, skin, [-0.2, -0.07, 0.25], [0.15, 0.02, 0.1]),
      mesh(sphere, eye, [0.13, 0.09, 0.56], [0.035, 0.035, 0.035]),
      mesh(sphere, eye, [-0.13, 0.09, 0.56], [0.035, 0.035, 0.035])
    );
    this.jaw.position.set(0, -0.06, 0.3);
    this.jaw.add(mesh(sphere, skin, [0, -0.02, 0.2], [0.19, 0.07, 0.25]));
    const fin = new THREE.ConeGeometry(0.2, 0.32, 4);
    fin.rotateX(-Math.PI / 2);
    this.tail.position.z = -0.5;
    this.tail.add(
      mesh(sphere, skin, [0, 0, -0.12], [0.1, 0.12, 0.24]),
      mesh(fin, skin, [0, 0, -0.38], [0.15, 1, 1])
    );
    this.body.add(this.jaw, this.tail);
    this.root.add(this.body);
    this.root.scale.setScalar(1.5);
    this.objects = [this.root, buildNest(spawn.at)];
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    const speed = dt > 0 ? this.last.distanceTo(this.root.position) / dt : 0;
    this.last.copy(this.root.position);
    this.root.rotation.set(0, s.yaw, 0);
    this.body.rotation.x = s.pitch;

    // Calming shows as a slow breathing glow while the meter rises.
    const soothed = s.meter > this.lastMeter + 1e-4;
    this.lastMeter = s.meter;
    const breathe = soothed ? 0.35 + Math.sin(t * 6) * 0.15 : 0;
    this.relief.value +=
      (Math.max(breathe, 0) - this.relief.value) * ease(dt, soothed ? 6 : 1.5);
    this.shiver *= Math.exp(-3 * dt);

    const calm = s.mode === LING.calm;
    const sick = calm ? 0 : 1 - s.meter * 0.7;
    this.sick.value += (sick - this.sick.value) * ease(dt, calm ? 0.8 : 4);
    const coil = s.mode === LING.coil;
    const lunge = s.mode === LING.lunge;
    this.flare.value +=
      (flareGoal(coil, lunge, s.charge) - this.flare.value) * ease(dt, 10);
    const open = jawGoal(coil, lunge, s.charge);
    this.jaw.rotation.x += (open - this.jaw.rotation.x) * ease(dt, 14);
    this.body.scale.z = coil ? 1 - s.charge * 0.12 : 1;

    this.swim += dt * (3 + Math.min(speed, 6) * 2.5);
    this.tail.rotation.y =
      Math.sin(this.swim) * (0.25 + Math.min(0.35, speed * 0.08)) +
      (coil ? s.charge * 0.6 : 0);
    this.body.rotation.y =
      Math.sin(this.swim - 1) * 0.06 + Math.sin(t * 40) * this.shiver * 0.15;
  }

  react(f: Fx) {
    if (f.k === "calmed") {
      this.relief.value = 1.1;
      this.shiver = 1;
    }
    return "";
  }
}
