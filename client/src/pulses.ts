import * as THREE from 'three/webgpu';
import { color, uniform } from 'three/tsl';
import { rim, sphere } from './fight-kit';

export const fadeUniform = () => uniform(0);
export interface Flash { mesh: THREE.Mesh; fade: ReturnType<typeof fadeUniform>; age: number }

/** The flash that has been running longest, so it is the one to reuse. */
export const oldest = (pool: Flash[]) => {
  let [best] = pool;
  for (const c of pool) {
    if (c.age > best.age) {best = c;}
  }
  return best;
};

/** A pool of glowing shells that grow from a point and fade, such as the drone's shock or a soothing ripple. */
export class Pulses {
  private pool: Flash[] = [];
  private radius: number;
  private life: number;

  constructor(objects: THREE.Object3D[], tint: number, count: number, radius: number, life: number, strength = 1.5) {
    this.radius = radius;
    this.life = life;
    for (let i = 0; i < count; i += 1) {
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
    const s = oldest(this.pool);
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
