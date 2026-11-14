import * as THREE from 'three/webgpu';
import { color, float, mix, oneMinus, uniform } from 'three/tsl';
import type { Fx } from '../../../shared/arena';
import { DRONE } from '../../../shared/creatures/drone';
import { ease, mesh, rim, sphere } from '../fight';
import type { CreatureSnapshot } from '../net';
import type { CreatureView } from '.';

/**
 * The operator's survey drone, drawn as a brass-and-iron engineering plate: a riveted hull, two
 * ducted rotors and a red lens. The lens shows in the dark; the hull glows blue as a shock charges.
 */
export class DroneView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects = [this.root];
  private body = new THREE.Group();
  private rotors: THREE.Group[] = [];
  private charge = uniform(0);
  private wreck = uniform(0);
  private lens = uniform(1);
  private hit = uniform(0);
  private jolt = 0;
  private spin = 0;

  constructor() {
    this.root.rotation.order = 'YXZ';
    const brass = new THREE.MeshStandardNodeMaterial({ metalness: 0.85, roughness: 0.38 });
    brass.colorNode = mix(color(0xb38a3c), color(0x3a3024), this.wreck);
    brass.emissiveNode = color(0xfff2d8).mul(this.hit.mul(rim(0.8).add(0.6)))
      .add(color(0x7fe0ff).mul(this.charge.mul(rim(1.5)).mul(2.2)))
      .add(color(0x5a4420).mul(rim(3).mul(oneMinus(this.wreck)).mul(0.5)));
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
    this.hit.value *= Math.exp(-12 * dt);
    this.jolt *= Math.exp(-9 * dt);
    const j = (charging ? s.charge * 0.03 : 0) + this.jolt * 0.08;
    this.body.position.set((Math.random() - 0.5) * j, Math.sin(t * 2.3) * 0.05 + (Math.random() - 0.5) * j, -this.jolt * 0.15);
    this.body.rotation.z = (wrecked ? 0.7 : Math.sin(t * 1.7) * 0.06) + Math.sin(t * 50) * this.jolt * 0.25;
  }

  react(f: Fx) {
    if (f.k !== 'harpoon' && f.k !== 'wrecked') return;
    this.hit.value = f.k === 'wrecked' ? 2.5 : 1.4;
    this.jolt = 1;
  }
}
