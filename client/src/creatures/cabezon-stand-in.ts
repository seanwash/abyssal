import { color, mix, mx_noise_float, positionLocal, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView } from ".";
import { CABEZON } from "../../../shared/creatures/cabezon";
import type { CreatureSpawn } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { ease, mesh, rim, sphere } from "../fight";
import type { CreatureSnapshot } from "../net";

/**
 * A plain stand-in for the cabezon until its plate-style view is drawn: enough to read its state
 * in play.
 */

/** A blunt mottled fish that fades into the rock while hidden and glows violet while sick and revealed. */
export class CabezonStandIn implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects: THREE.Object3D[];
  private sick = uniform(0);
  private relief = uniform(0);
  private lastMeter = 0;

  constructor(spawn: CreatureSpawn) {
    const skin = new THREE.MeshStandardNodeMaterial({ roughness: 0.85 });
    skin.colorNode = mix(
      color(0x5c_5a_48),
      color(0x8a_4a_3a),
      mx_noise_float(positionLocal.mul(9)).mul(0.5).add(0.5)
    );
    skin.emissiveNode = color(0x9b_5c_ff)
      .mul(this.sick.mul(rim(2).mul(2.2).add(0.35)))
      .add(color(0xe8_f4_ff).mul(this.relief.mul(rim(1.2).mul(1.6))));
    const body = new THREE.Group();
    body.add(
      mesh(sphere, skin, [0, 0, 0], [0.2, 0.14, 0.42]),
      mesh(sphere, skin, [0, 0.02, 0.26], [0.22, 0.15, 0.2]),
      mesh(sphere, skin, [0.2, -0.05, 0.12], [0.16, 0.02, 0.12]),
      mesh(sphere, skin, [-0.2, -0.05, 0.12], [0.16, 0.02, 0.12])
    );
    this.root.add(body);
    this.root.scale.setScalar(1.5);
    const eggs = new THREE.InstancedMesh(
      sphere,
      Object.assign(new THREE.MeshStandardNodeMaterial({ roughness: 0.5 }), {
        colorNode: color(0x6a_3a_5a),
      }),
      60
    );
    const rnd = mulberry32(23);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 60; i += 1) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 0.45;
      m.makeScale(0.05, 0.05, 0.05).setPosition(
        spawn.at.x + Math.cos(a) * r,
        spawn.at.y + 0.04 + rnd() * 0.1,
        spawn.at.z + Math.sin(a) * r
      );
      eggs.setMatrixAt(i, m);
    }
    this.objects = [this.root, eggs];
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(s.pitch, s.yaw, 0, "YXZ");
    const hiding = s.mode === CABEZON.hidden;
    const goal = hiding || s.mode === CABEZON.calm ? 0 : 1 - s.meter * 0.7;
    this.sick.value += (goal - this.sick.value) * ease(dt, hiding ? 8 : 2);
    const soothed = s.meter > this.lastMeter + 1e-4;
    this.lastMeter = s.meter;
    const breathe = soothed ? 0.35 + Math.sin(t * 6) * 0.15 : 0;
    this.relief.value += (breathe - this.relief.value) * ease(dt, 4);
    this.root.scale.z =
      1.5 * (s.mode === CABEZON.coil ? 1 - s.charge * 0.15 : 1);
  }

  react(f: { k: string }) {
    if (f.k === "calmed") {
      this.relief.value = 1.1;
    }
  }
}
