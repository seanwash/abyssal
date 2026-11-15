import { color, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView } from ".";
import { mulberry32 } from "../../../shared/rng";
import { ease, rim, sphere } from "../fight";
import type { CreatureSnapshot } from "../net";

/**
 * A plain stand-in for the blue rockfish school until its plate-style view is drawn: enough to
 * read the school and its scatter in play.
 */

const FISH = 24;

/** A school drawn as small slate-blue fish milling around its centre, flung outward by the alarm. */
export class RockfishStandIn implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects: THREE.Object3D[];
  private fish: THREE.InstancedMesh;
  private offsets: THREE.Vector3[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(0.06, 0.08, 0.2);
  private flash = uniform(0);

  constructor() {
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5 });
    mat.colorNode = color(0x50_60_78);
    mat.emissiveNode = color(0xa8_c0_d8).mul(
      rim(2).mul(this.flash.mul(2.5).add(0.5))
    );
    this.fish = new THREE.InstancedMesh(sphere, mat, FISH);
    this.fish.frustumCulled = false;
    const rnd = mulberry32(41);
    for (let i = 0; i < FISH; i += 1) {
      this.offsets.push(
        new THREE.Vector3(
          rnd() - 0.5,
          (rnd() - 0.5) * 0.5,
          rnd() - 0.5
        ).multiplyScalar(2.4)
      );
    }
    this.root.add(this.fish);
    this.objects = [this.root];
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.flash.value -= this.flash.value * ease(dt, 2.5);
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(0, s.yaw, 0);
    const spread = 1 + s.charge * 1.4;
    for (const [i, o] of this.offsets.entries()) {
      this.p.copy(o).multiplyScalar(spread);
      this.p.x += Math.sin(t * 1.3 + i) * 0.15;
      this.p.z += s.charge * 1.5 * (0.5 + (i % 5) / 5);
      this.fish.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.fish.instanceMatrix.needsUpdate = true;
  }

  /** A scatter flashes the school's flanks silver. */
  react(f: { k: string }) {
    if (f.k === "scattered") {
      this.flash.value = 1;
    }
  }
}
