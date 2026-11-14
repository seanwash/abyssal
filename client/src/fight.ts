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
