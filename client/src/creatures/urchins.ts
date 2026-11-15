import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  color,
  length,
  mix,
  positionGeometry,
  positionLocal,
  smoothstep,
  uniform,
} from "three/tsl";
import * as THREE from "three/webgpu";

import type { CreatureView, Stage } from ".";
import type { Fx } from "../../../shared/arena";
import { PATCH } from "../../../shared/creatures/urchins";
import type { CreatureSpawn } from "../../../shared/level";
import { groundHeight } from "../../../shared/level";
import { mulberry32 } from "../../../shared/rng";
import { buildLevel } from "../../../shared/zones";
import { ease, rim } from "../fight";
import type { CreatureSnapshot } from "../net";
import { hiss, tone } from "../sound";

const COUNT = 40;
/** A purple urchin's test is about 6 cm across and its spines reach as far again; each is drawn at `DRAWN` times that so a patch reads at the isometric camera's distance. */
const BODY = 0.06;
const SPINE = 0.11;
const DRAWN = 2.4;
/** The golden angle, which spreads spines evenly around the test. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** One urchin: a squat test bristling with spines, each a thin cone pointing out from the centre. */
const urchinGeometry = () => {
  const parts: THREE.BufferGeometry[] = [
    new THREE.SphereGeometry(BODY, 10, 7).scale(1, 0.7, 1),
  ];
  const up = new THREE.Vector3(0, 1, 0);
  const n = 34;
  for (let i = 0; i < n; i += 1) {
    // Spines spread evenly over the upper part of the test, none pointing into the floor.
    const y = 1 - (i / (n - 1)) * 1.15;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLDEN;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const cone = new THREE.ConeGeometry(0.006, SPINE, 4, 1, true);
    cone.translate(0, BODY * 0.6 + SPINE / 2, 0);
    cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    parts.push(cone);
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
};

/** A diver touched down among the urchins: broken spine tips and a sharp crackle. */
const spined = (f: Fx, { effects, me, loud }: Stage) => {
  if (f.k !== "spined" || !f.p) {
    return "";
  }
  // Broken spine tips, purple, kicked up around the diver.
  effects.burst(f.p, 20, 0xb0_60_e0, 1.8, -0.2, 0.6, 0.025);
  const v = f.by === me.id ? 1 : loud(f.p) * 0.6;
  for (let i = 0; i < 3; i += 1) {
    hiss("highpass", 3200 + i * 600, 0.05, 0.14 * v, i * 0.04);
  }
  tone("triangle", 980, 620, 0.12, 0.06 * v);
  return f.by === me.id ? "Urchin spines! Keep off the barren floor." : "";
};

/**
 * A patch of purple urchins grazing the barren: a few dozen spiny tests on the bare rock. They
 * never move. As a diver comes low and close (`charge`), their spine tips glow violet in warning;
 * a diver who touches down among them is spined.
 */
export class UrchinsView implements CreatureView {
  readonly root = new THREE.Group();
  readonly objects = [this.root];
  private warn = uniform(0);
  private sway = uniform(0);

  constructor(spawn: CreatureSpawn) {
    const level = buildLevel();
    const tip = smoothstep(BODY, BODY + SPINE, length(positionGeometry));
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    mat.colorNode = mix(color(0x4a_1f_52), color(0x9a_5c_b0), tip);
    // A dim violet rim keeps a patch visible past the lamp; the tips flare with the warning.
    mat.emissiveNode = color(0x6a_30_80)
      .mul(rim(2).mul(1.1))
      .add(color(0xc0_80_ff).mul(this.warn.mul(tip).mul(2.4)));
    mat.positionNode = positionLocal.add(
      positionGeometry.mul(this.sway.mul(tip).mul(0.12))
    );

    const mesh = new THREE.InstancedMesh(urchinGeometry(), mat, COUNT);
    const rnd = mulberry32(spawn.id.length * 97 + Math.round(spawn.at.x));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < COUNT; i += 1) {
      const a = rnd() * Math.PI * 2;
      const r = PATCH * Math.sqrt(rnd()) * 0.95;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // On whatever is under it, sand or the top of a rock in the patch.
      const y =
        groundHeight(level, spawn.at.x + x, spawn.at.z + z, spawn.at.y + 4) -
        spawn.at.y +
        0.05;
      const s = DRAWN * (0.75 + rnd() * 0.6);
      q.setFromEuler(e.set((rnd() - 0.5) * 0.4, rnd() * 6.3, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    }
    mesh.computeBoundingSphere();
    this.root.add(mesh);
    this.root.position.set(spawn.at.x, spawn.at.y, spawn.at.z);
  }

  update(dt: number, t: number, s: CreatureSnapshot) {
    this.root.position.set(s.x, s.y, s.z);
    this.warn.value += (s.charge - this.warn.value) * ease(dt, 8);
    this.sway.value = Math.sin(t * 1.3) * 0.3 + this.warn.value * 0.5;
  }

  readonly react = spined;
}
