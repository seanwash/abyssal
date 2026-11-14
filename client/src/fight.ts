import * as THREE from 'three/webgpu';
import { abs, color, dot, float, mix, mx_noise_float, normalView, oneMinus, positionLocal, positionViewDirection, pow, uniform } from 'three/tsl';
import { DRONE, LING, SHOCK_RADIUS } from '../../shared/arena';
import type { Point } from '../../shared/level';
import { mulberry32 } from '../../shared/rng';
import type { CreatureSnapshot } from './net';

const rim = (p: number) => pow(oneMinus(abs(dot(normalView, positionViewDirection))), p);
const ease = (dt: number, rate: number) => 1 - Math.exp(-rate * dt);
const sphere = new THREE.SphereGeometry(1, 18, 12);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  return m;
}

/**
 * Lingcod (Ophiodon elongatus), built along +z: a long mottled body, a big head and an underslung
 * jaw that opens as it coils and lunges. A sick fish glows violet; calming drains the glow.
 */
export class LingcodView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private tail = new THREE.Group();
  private jaw = new THREE.Group();
  private sick = uniform(1);
  private flare = uniform(0);
  private swim = 0;
  private last = new THREE.Vector3();

  constructor() {
    const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
    const mottle = mx_noise_float(positionLocal.mul(7.0)).mul(0.5).add(0.5);
    skin.colorNode = mix(color(0x5a5a36), color(0xc4ad72), mottle);
    skin.emissiveNode = color(0x9b5cff).mul(this.sick.mul(rim(2).mul(2.4).add(0.45)))
      .add(color(0x9fb080).mul(rim(3).mul(0.5)))
      .add(color(0xffb070).mul(this.flare.mul(rim(1.5)).mul(1.4)));
    const eye = new THREE.MeshBasicNodeMaterial();
    eye.colorNode = mix(color(0xe8d070), color(0xd9a8ff), this.sick);

    this.body.add(
      mesh(sphere, skin, [0, 0, 0], [0.2, 0.19, 0.62]),
      mesh(sphere, skin, [0, 0.03, 0.42], [0.22, 0.19, 0.3]),
      mesh(new THREE.BoxGeometry(0.02, 0.12, 0.9), skin, [0, 0.19, -0.05]),
      mesh(sphere, skin, [0.2, -0.07, 0.25], [0.15, 0.02, 0.1]),
      mesh(sphere, skin, [-0.2, -0.07, 0.25], [0.15, 0.02, 0.1]),
      mesh(sphere, eye, [0.13, 0.09, 0.56], [0.035, 0.035, 0.035]),
      mesh(sphere, eye, [-0.13, 0.09, 0.56], [0.035, 0.035, 0.035]),
    );
    this.jaw.position.set(0, -0.06, 0.3);
    this.jaw.add(mesh(sphere, skin, [0, -0.02, 0.2], [0.19, 0.07, 0.25]));
    const fin = new THREE.ConeGeometry(0.2, 0.32, 4);
    fin.rotateX(-Math.PI / 2);
    this.tail.position.z = -0.5;
    this.tail.add(mesh(sphere, skin, [0, 0, -0.12], [0.1, 0.12, 0.24]), mesh(fin, skin, [0, 0, -0.38], [0.15, 1, 1]));
    this.body.add(this.jaw, this.tail);
    this.root.add(this.body);
    this.root.scale.setScalar(1.5);
  }

  update(dt: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    const speed = dt > 0 ? this.last.distanceTo(this.root.position) / dt : 0;
    this.last.copy(this.root.position);
    this.root.rotation.set(0, s.yaw, 0);
    this.body.rotation.x = s.pitch;

    const calm = s.mode === LING.calm;
    const sick = calm ? 0 : 1 - s.meter * 0.7;
    this.sick.value += (sick - this.sick.value) * ease(dt, calm ? 0.8 : 4);
    const coil = s.mode === LING.coil, lunge = s.mode === LING.lunge;
    this.flare.value += ((coil ? s.charge : lunge ? 1 : 0) - this.flare.value) * ease(dt, 10);
    const open = lunge ? 0.6 : coil ? 0.15 + s.charge * 0.3 : 0.04;
    this.jaw.rotation.x += (open - this.jaw.rotation.x) * ease(dt, 14);
    this.body.scale.z = coil ? 1 - s.charge * 0.12 : 1;

    this.swim += dt * (3 + Math.min(speed, 6) * 2.5);
    this.tail.rotation.y = Math.sin(this.swim) * (0.25 + Math.min(0.35, speed * 0.08)) + (coil ? s.charge * 0.6 : 0);
    this.body.rotation.y = Math.sin(this.swim - 1) * 0.06;
  }
}

/**
 * The operator's survey drone, drawn as a brass-and-iron engineering plate: a riveted hull, two
 * ducted rotors and a red lens. The lens shows in the dark; the hull glows blue as a shock charges.
 */
export class DroneView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private rotors: THREE.Group[] = [];
  private charge = uniform(0);
  private wreck = uniform(0);
  private lens = uniform(1);
  private spin = 0;

  constructor() {
    this.root.rotation.order = 'YXZ';
    const brass = new THREE.MeshStandardNodeMaterial({ metalness: 0.85, roughness: 0.38 });
    brass.colorNode = mix(color(0xb38a3c), color(0x3a3024), this.wreck);
    brass.emissiveNode = color(0x7fe0ff).mul(this.charge.mul(rim(1.5)).mul(2.2)).add(color(0x5a4420).mul(rim(3).mul(oneMinus(this.wreck)).mul(0.5)));
    const iron = new THREE.MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.55 });
    iron.colorNode = color(0x2e2f30);
    const lens = new THREE.MeshBasicNodeMaterial({ fog: false });
    lens.colorNode = color(0xff3a20).mul(this.lens).add(float(0.02));

    const hull = new THREE.CylinderGeometry(0.26, 0.26, 0.7, 16);
    hull.rotateX(Math.PI / 2);
    const nose = new THREE.SphereGeometry(0.26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    nose.rotateX(Math.PI / 2);
    const tail = new THREE.ConeGeometry(0.26, 0.3, 16);
    tail.rotateX(-Math.PI / 2);
    const band = new THREE.TorusGeometry(0.27, 0.025, 6, 20);
    this.body.add(
      mesh(hull, brass, [0, 0, 0]),
      mesh(nose, brass, [0, 0, 0.35]),
      mesh(tail, iron, [0, 0, -0.5]),
      mesh(band, iron, [0, 0, 0.2]),
      mesh(band, iron, [0, 0, -0.2]),
      mesh(sphere, lens, [0, 0.02, 0.6], [0.08, 0.08, 0.04]),
    );
    const duct = new THREE.TorusGeometry(0.15, 0.025, 6, 18);
    const blade = new THREE.BoxGeometry(0.26, 0.03, 0.01);
    for (const side of [-1, 1]) {
      const r = new THREE.Group();
      r.position.set(side * 0.45, 0, -0.1);
      const blades = new THREE.Group();
      blades.add(mesh(blade, iron, [0, 0, 0]), mesh(blade, iron, [0, 0, 0], [1, 1, 1]).rotateZ(Math.PI / 2));
      r.add(mesh(duct, brass, [0, 0, 0]), blades);
      this.body.add(r, mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), iron, [side * 0.3, 0, -0.1]));
      this.rotors.push(blades);
    }
    this.root.add(this.body);
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(s.pitch, s.yaw, 0);
    const wrecked = s.mode === DRONE.wrecked;
    this.wreck.value += ((wrecked ? 1 : 0) - this.wreck.value) * ease(dt, 3);
    const charging = s.mode === DRONE.charge;
    this.charge.value = charging ? s.charge : this.charge.value * Math.exp(-6 * dt);
    const alert = s.mode === DRONE.hunt || charging;
    this.lens.value = wrecked ? 0 : alert ? 1.6 + Math.sin(t * 14) * 0.4 : 0.8;
    this.spin += dt * (wrecked ? 0 : 30);
    for (const r of this.rotors) r.rotation.z = this.spin;
    const j = charging ? s.charge * 0.03 : 0;
    this.body.position.set((Math.random() - 0.5) * j, Math.sin(t * 2.3) * 0.05 + (Math.random() - 0.5) * j, 0);
    this.body.rotation.z = wrecked ? 0.7 : Math.sin(t * 1.7) * 0.06;
  }
}

/** The lingcod's egg mass: a mound of pale eggs on the floor of the Hollow. */
export function buildNest(nest: Point) {
  const rnd = mulberry32(17);
  const n = 140;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  mat.colorNode = color(0xa89a82);
  mat.emissiveNode = color(0x3a3228).mul(rim(2));
  const eggs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.75;
    const h = (1 - r / 0.75) * 0.35 * rnd();
    p.set(nest.x + Math.cos(a) * r, nest.y + 0.04 + h, nest.z + Math.sin(a) * r);
    s.setScalar(0.06 + rnd() * 0.03);
    m.compose(p, q, s);
    eggs.setMatrixAt(i, m);
  }
  return eggs;
}

const fadeUniform = () => uniform(0);
interface Flash { mesh: THREE.Mesh; fade: ReturnType<typeof fadeUniform>; age: number }

/** Short-lived fight effects: harpoon lines and the drone's shock ring, pooled so nothing is created mid-fight. */
export class Effects {
  readonly objects: THREE.Object3D[] = [];
  private bolts: Flash[] = [];
  private shocks: Flash[] = [];
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const bolt = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
    bolt.translate(0, 0.5, 0);
    for (let i = 0; i < 4; i++) {
      const fade = fadeUniform();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      mat.colorNode = color(0xfff0c8).mul(fade);
      const m = new THREE.Mesh(bolt, mat);
      m.visible = false;
      this.bolts.push({ mesh: m, fade, age: 9 });
      this.objects.push(m);
    }
    for (let i = 0; i < 2; i++) {
      const fade = fadeUniform();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
      mat.colorNode = color(0x8fe8ff).mul(rim(1.2).mul(fade).mul(1.5));
      const m = new THREE.Mesh(sphere, mat);
      m.visible = false;
      this.shocks.push({ mesh: m, fade, age: 9 });
      this.objects.push(m);
    }
  }

  harpoon(p: [number, number, number], q: [number, number, number]) {
    const b = this.bolts.reduce((a, c) => (c.age > a.age ? c : a));
    const from = new THREE.Vector3(...p), dir = new THREE.Vector3(...q).sub(from);
    b.mesh.position.copy(from);
    b.mesh.scale.set(1, dir.length(), 1);
    b.mesh.quaternion.setFromUnitVectors(this.up, dir.normalize());
    b.age = 0;
  }

  shock(p: [number, number, number]) {
    const s = this.shocks.reduce((a, c) => (c.age > a.age ? c : a));
    s.mesh.position.set(...p);
    s.age = 0;
  }

  update(dt: number) {
    for (const b of this.bolts) {
      b.age += dt;
      b.mesh.visible = b.age < 0.25;
      b.fade.value = Math.max(0, 1 - b.age / 0.25);
    }
    for (const s of this.shocks) {
      s.age += dt;
      const k = s.age / 0.4;
      s.mesh.visible = k < 1;
      s.mesh.scale.setScalar(0.3 + Math.sqrt(Math.min(1, k)) * SHOCK_RADIUS);
      s.fade.value = Math.max(0, 1 - k);
    }
  }
}
