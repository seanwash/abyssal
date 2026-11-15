import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { SHOCK_RADIUS } from '../../shared/creatures/drone';
import { fadeUniform, oldest, Pulses } from './pulses';
import type { Flash } from './pulses';
import { Sparks } from './sparks';

export { ease, mesh, rim, sphere } from './fight-kit';

/** Short-lived fight effects, pooled so nothing is created mid-fight. */
export class Effects {
  readonly objects: THREE.Object3D[] = [];
  private bolts: Flash[] = [];
  private shocks = new Pulses(this.objects, 0x8f_e8_ff, 2, SHOCK_RADIUS, 0.4);
  private soothes = new Pulses(this.objects, 0xb9_d8_ff, 4, 1.4, 0.9, 0.35);
  private reliefs = new Pulses(this.objects, 0xb8_94_ff, 1, 2.4, 0.9, 0.45);
  private finds = new Pulses(this.objects, 0xff_f2_c8, 2, 0.7, 0.5, 0.3);
  private sparks = new Sparks();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const bolt = new THREE.CylinderGeometry(0.025, 0.025, 1, 5);
    bolt.translate(0, 0.5, 0);
    for (let i = 0; i < 4; i += 1) {
      const fade = fadeUniform();
      const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      mat.colorNode = color(0xff_f0_c8).mul(fade);
      const m = new THREE.Mesh(bolt, mat);
      m.visible = false;
      this.bolts.push({ mesh: m, fade, age: 9 });
      this.objects.push(m);
    }
    this.objects.push(this.sparks.mesh);
  }

  /** The harpoon line from diver to machine, and sparks where it strikes. */
  harpoon(p: [number, number, number], q: [number, number, number]) {
    const b = oldest(this.bolts);
    const from = new THREE.Vector3(...p); const dir = new THREE.Vector3(...q).sub(from);
    b.mesh.position.copy(from);
    b.mesh.scale.set(1, dir.length(), 1);
    b.mesh.quaternion.setFromUnitVectors(this.up, dir.normalize());
    b.age = 0;
    this.sparks.burst(q, 14, 0xff_c0_70, 3.5, -0.3, 0.45);
  }

  shock(p: [number, number, number]) {
    this.shocks.fire(p);
    this.sparks.burst(p, 18, 0x9f_ea_ff, 4.5, 0, 0.35, 0.025);
  }

  /** A diver took a bite or a shock. */
  hurt(p: [number, number, number]) {
    this.sparks.burst(p, 14, 0xff_a0_80, 2.2, 0.3, 0.55, 0.04);
  }

  /** A ripple off a sick animal while a diver calms it. */
  soothe(p: ArrayLike<number>) {
    this.soothes.fire(p);
    this.sparks.burst(p, 3, 0xb4_8c_ff, 0.5, 0.5, 1.6, 0.04);
  }

  /** The sickness leaves a calmed animal: a wide soft ring and violet motes drifting up and away. */
  calmed(p: ArrayLike<number>) {
    this.reliefs.fire(p);
    this.sparks.burst(p, 48, 0xa0_70_ff, 1.6, 0.7, 2.8, 0.06);
  }

  /** A find leaves the floor: a small ring and motes in its category's colour; `big` for a fossil pried free. */
  collect(p: ArrayLike<number>, tint: number, big = false) {
    this.finds.fire(p);
    this.sparks.burst(p, big ? 44 : 16, tint, big ? 2.2 : 1.1, 0.6, big ? 1.8 : 1, big ? 0.05 : 0.035);
  }

  /** Grit off a fossil while divers pry it. */
  grit(p: ArrayLike<number>) {
    this.sparks.burst(p, 4, 0xd8_c8_a0, 1.2, -0.4, 0.6, 0.025);
  }

  wrecked(p: ArrayLike<number>) {
    this.shocks.fire(p);
    this.sparks.burst(p, 36, 0xff_a0_40, 5, -0.4, 0.8, 0.04);
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
