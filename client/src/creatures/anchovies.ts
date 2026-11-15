import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { color, mix, positionGeometry, smoothstep, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView, Stage } from ".";
import type { Fx } from "../../../shared/arena";
import type { CreatureSpawn } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { ease, rim } from "../fight";
import type { CreatureSnapshot } from "../net";
import { tone } from "../sound";

const COUNT = 64;
/** A northern anchovy is about 15 cm, drawn twice that so a drift reads at the isometric camera's distance. */
const LENGTH = 0.15 * 2;

/** One anchovy: a slim, spindle-shaped body with a forked tail, nose toward +z. */
const fishGeometry = () => {
  const body = new THREE.SphereGeometry(1, 10, 6);
  body.scale(LENGTH * 0.09, LENGTH * 0.13, LENGTH * 0.5);
  const tail = new THREE.ConeGeometry(LENGTH * 0.12, LENGTH * 0.18, 3);
  tail.rotateX(Math.PI / 2);
  tail.scale(0.25, 1, 1);
  tail.translate(0, 0, -LENGTH * 0.55);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()]);
};

interface Fish {
  at: THREE.Vector3;
  yaw: number;
  roll: number;
  phase: number;
}

/**
 * A drift of dead northern anchovies hanging in the water: silver fish rolled belly-up at every
 * angle, turning slowly together on the current. Their flanks catch a lamp and keep a faint sheen
 * of their own, so a drift reads from a few metres off in the dark water of the Anchovy Line.
 */
export class AnchoviesView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects = [this.root];
  private mesh: THREE.InstancedMesh;
  private fish: Fish[];
  private glint = uniform(0);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private one = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();

  constructor(spawn: CreatureSpawn) {
    const mat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.3,
      metalness: 0.6,
    });
    // A blue-green back over a silver belly, washed out the way dead fish fade.
    mat.colorNode = mix(
      color(0xc8_d0_d4),
      color(0x4a_6a_70),
      smoothstep(-0.005, 0.02, positionGeometry.y)
    );
    // Dead flanks keep a faint pale sheen of their own, brighter at the rim and when a drift glints.
    mat.emissiveNode = color(0xa8_c4_cc)
      .mul(rim(1.5).mul(this.glint.mul(1.6).add(0.7)))
      .add(color(0x3a_4a_50).mul(this.glint.add(1)));
    this.mesh = new THREE.InstancedMesh(fishGeometry(), mat, COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const rnd = mulberry32(Math.round(spawn.at.x * 31 + spawn.at.z * 7));
    // A loose, flattened cloud, longer along the current than across it.
    this.fish = Array.from({ length: COUNT }, () => ({
      at: new THREE.Vector3(
        (rnd() - 0.5) * 2.2,
        (rnd() - 0.5) * 1.2,
        (rnd() - 0.5) * 4.5
      ),
      yaw: rnd() * Math.PI * 2,
      roll: Math.PI * (0.6 + rnd() * 0.8),
      phase: rnd() * Math.PI * 2,
    }));
    this.root.add(this.mesh);
    this.root.position.set(spawn.at.x, spawn.at.y, spawn.at.z);
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
    this.glint.value *= 1 - ease(dt, 0.8);
    for (const [i, f] of this.fish.entries()) {
      const bob = Math.sin(t * 0.4 + f.phase);
      this.p.set(f.at.x, f.at.y + bob * 0.08, f.at.z);
      this.e.set(bob * 0.15, f.yaw + bob * 0.1, f.roll);
      this.q.setFromEuler(this.e);
      this.m.compose(this.p, this.q, this.one);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  react(f: Fx, { effects, at, loud }: Stage) {
    if (f.k !== "sighted") {
      return "";
    }
    this.glint.value = 1;
    // A slow silver shimmer off the drift, and two low falling notes.
    effects.burst(at, 16, 0xc0_d8_e0, 0.6, 0.2, 2.2, 0.03);
    const v = loud(f.p);
    tone("sine", 330, 300, 1.2, 0.07 * v, 0, 0.3);
    tone("sine", 247, 220, 1.6, 0.06 * v, 0.5, 0.3);
    return "Dead anchovies, drifting in a line out toward Moss Landing.";
  }
}
