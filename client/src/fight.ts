import * as THREE from 'three/webgpu';
import { abs, color, dot, normalView, oneMinus, positionViewDirection, pow, uniform } from 'three/tsl';
import { SHOCK_RADIUS } from '../../shared/creatures/drone';

/** Fresnel rim: bright where a surface turns away from the camera. */
export const rim = (p: number) => pow(oneMinus(abs(dot(normalView, positionViewDirection))), p);
/** Frame-rate independent blend factor for easing toward a target at `rate` per second. */
export const ease = (dt: number, rate: number) => 1 - Math.exp(-rate * dt);
export const sphere = new THREE.SphereGeometry(1, 18, 12);

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  return m;
}

const fadeUniform = () => uniform(0);
interface Flash { mesh: THREE.Mesh; fade: ReturnType<typeof fadeUniform>; age: number }

/** A pool of glowing shells that grow from a point and fade, such as the drone's shock or a soothing ripple. */
class Pulses {
  private pool: Flash[] = [];

  constructor(objects: THREE.Object3D[], tint: number, count: number, private radius: number, private life: number, strength = 1.5) {
    for (let i = 0; i < count; i++) {
      const fade = fadeUniform();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
      mat.colorNode = color(tint).mul(rim(1.2).mul(fade).mul(strength));
      const m = new THREE.Mesh(sphere, mat);
      m.visible = false;
      this.pool.push({ mesh: m, fade, age: 9 });
      objects.push(m);
    }
  }

  fire(p: ArrayLike<number>) {
    const s = this.pool.reduce((a, c) => (c.age > a.age ? c : a));
    s.mesh.position.set(p[0], p[1], p[2]);
    s.age = 0;
  }

  update(dt: number) {
    for (const s of this.pool) {
      s.age += dt;
      const k = s.age / this.life;
      s.mesh.visible = k < 1;
      s.mesh.scale.setScalar(0.3 + Math.sqrt(Math.min(1, k)) * this.radius);
      s.fade.value = Math.max(0, 1 - k);
    }
  }
}

const SPARKS = 128;

/**
 * Glowing flecks thrown from a point: sparks off a harpooned drone, and the violet sickness that
 * rises out of a calmed animal. One instanced mesh, so a burst never adds a draw call or a material.
 */
class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private p = new Float32Array(SPARKS * 3);
  private v = new Float32Array(SPARKS * 3);
  private age = new Float32Array(SPARKS).fill(9);
  private life = new Float32Array(SPARKS).fill(1);
  private size = new Float32Array(SPARKS);
  private rise = new Float32Array(SPARKS);
  private next = 0;
  private m = new THREE.Matrix4();
  private tint = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), mat, SPARKS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < SPARKS; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.tint.set(0xffffff));
    }
  }

  /** `speed` is how fast flecks fly outward, `rise` how fast they drift up, `life` how long they last in seconds. */
  burst(p: ArrayLike<number>, count: number, tint: number, speed: number, rise: number, life: number, size = 0.035) {
    this.tint.set(tint);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % SPARKS;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.p.set([p[0], p[1], p[2]], i * 3);
      this.v.set([Math.cos(a) * r * s, u * s, Math.sin(a) * r * s], i * 3);
      this.age[i] = 0;
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.rise[i] = rise;
      this.mesh.setColorAt(i, this.tint);
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    const drag = Math.exp(-3 * dt);
    for (let i = 0; i < SPARKS; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      const j = i * 3;
      this.v[j] *= drag; this.v[j + 2] *= drag;
      this.v[j + 1] = this.v[j + 1] * drag + this.rise[i] * dt * 3;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const sc = this.size[i] * (1 - k * k);
      this.m.makeScale(sc, sc, sc).setPosition(this.p[j], this.p[j + 1], this.p[j + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Short-lived fight effects, pooled so nothing is created mid-fight. */
export class Effects {
  readonly objects: THREE.Object3D[] = [];
  private bolts: Flash[] = [];
  private shocks = new Pulses(this.objects, 0x8fe8ff, 2, SHOCK_RADIUS, 0.4);
  private soothes = new Pulses(this.objects, 0xb9d8ff, 4, 1.4, 0.9, 0.35);
  private reliefs = new Pulses(this.objects, 0xb894ff, 1, 2.4, 0.9, 0.45);
  private finds = new Pulses(this.objects, 0xfff2c8, 2, 0.7, 0.5, 0.3);
  private sparks = new Sparks();
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
    this.objects.push(this.sparks.mesh);
  }

  /** The harpoon line from diver to machine, and sparks where it strikes. */
  harpoon(p: [number, number, number], q: [number, number, number]) {
    const b = this.bolts.reduce((a, c) => (c.age > a.age ? c : a));
    const from = new THREE.Vector3(...p), dir = new THREE.Vector3(...q).sub(from);
    b.mesh.position.copy(from);
    b.mesh.scale.set(1, dir.length(), 1);
    b.mesh.quaternion.setFromUnitVectors(this.up, dir.normalize());
    b.age = 0;
    this.sparks.burst(q, 14, 0xffc070, 3.5, -0.3, 0.45);
  }

  shock(p: [number, number, number]) {
    this.shocks.fire(p);
    this.sparks.burst(p, 18, 0x9feaff, 4.5, 0, 0.35, 0.025);
  }

  /** A diver took a bite or a shock. */
  hurt(p: [number, number, number]) {
    this.sparks.burst(p, 14, 0xffa080, 2.2, 0.3, 0.55, 0.04);
  }

  /** A ripple off a sick animal while a diver calms it. */
  soothe(p: ArrayLike<number>) {
    this.soothes.fire(p);
    this.sparks.burst(p, 3, 0xb48cff, 0.5, 0.5, 1.6, 0.04);
  }

  /** The sickness leaves a calmed animal: a wide soft ring and violet motes drifting up and away. */
  calmed(p: ArrayLike<number>) {
    this.reliefs.fire(p);
    this.sparks.burst(p, 48, 0xa070ff, 1.6, 0.7, 2.8, 0.06);
  }

  /** A find leaves the floor: a small ring and motes in its category's colour; `big` for a fossil pried free. */
  collect(p: ArrayLike<number>, tint: number, big = false) {
    this.finds.fire(p);
    this.sparks.burst(p, big ? 44 : 16, tint, big ? 2.2 : 1.1, 0.6, big ? 1.8 : 1.0, big ? 0.05 : 0.035);
  }

  /** Grit off a fossil while divers pry it. */
  grit(p: ArrayLike<number>) {
    this.sparks.burst(p, 4, 0xd8c8a0, 1.2, -0.4, 0.6, 0.025);
  }

  wrecked(p: ArrayLike<number>) {
    this.shocks.fire(p);
    this.sparks.burst(p, 36, 0xffa040, 5, -0.4, 0.8, 0.04);
  }

  update(dt: number) {
    for (const b of this.bolts) {
      b.age += dt;
      b.mesh.visible = b.age < 0.25;
      b.fade.value = Math.max(0, 1 - b.age / 0.25);
    }
    this.shocks.update(dt);
    this.soothes.update(dt);
    this.reliefs.update(dt);
    this.finds.update(dt);
    this.sparks.update(dt);
  }
}
