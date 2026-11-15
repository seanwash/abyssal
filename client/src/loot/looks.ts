import {
  color,
  mix,
  mx_noise_float,
  normalView,
  positionLocal,
  uniform,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { mesh, rim, sphere } from "../fight";

/**
 * How each find looks on the floor: a few primitives each, drawn about twice life size so they
 * read at the isometric camera's scale, the way Diablo II draws items on the ground. `glow`
 * brightens a find while the action key aims at it or works it free.
 */

/** A 0-to-1 brightness uniform; `glowUniform` makes one. */
export const glowUniform = () => uniform(0);
type Glow = ReturnType<typeof glowUniform>;

const material = (base: number, glow: Glow, tint: number, roughness = 0.7) => {
  const m = new THREE.MeshStandardNodeMaterial({ roughness });
  m.colorNode = color(base);
  m.emissiveNode = color(tint).mul(rim(2).mul(glow.mul(1.6).add(0.35)));
  return m;
};

const LOOKS: Record<string, (glow: Glow) => THREE.Object3D> = {
  "urchin-test": (glow) => {
    const m = material(0x7a_4f_80, glow, 0xd8_a8_ff);
    m.colorNode = mix(
      color(0x5a_35_60),
      color(0xb0_8a_b8),
      mx_noise_float(positionLocal.mul(22)).mul(0.5).add(0.5)
    );
    const g = new THREE.Group();
    g.add(mesh(sphere, m, [0, 0.07, 0], [0.2, 0.12, 0.2]));
    return g;
  },
  "turban-snail": (glow) => {
    const m = material(0x3d_30_29, glow, 0xe0_c9_a0);
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.15, 0.28, 10);
    g.add(
      mesh(cone, m, [0, 0.12, 0]),
      mesh(
        sphere,
        material(0xc8_b4_8a, glow, 0xff_ff_ff),
        [0.07, 0.04, 0.05],
        [0.07, 0.05, 0.07]
      )
    );
    g.rotation.z = 0.9;
    return g;
  },
  "abalone-shell": (glow) => {
    const outer = material(0x8a_3a_2a, glow, 0xff_a0_80, 0.85);
    const nacre = new THREE.MeshStandardNodeMaterial({
      roughness: 0.25,
      metalness: 0.3,
    });
    nacre.colorNode = mix(
      color(0x6f_d0_c8),
      color(0xe6_a0_d8),
      normalView.x.mul(0.5).add(0.5)
    );
    nacre.emissiveNode = mix(
      color(0x2a_80_78),
      color(0x8a_40_80),
      normalView.y.mul(0.5).add(0.5)
    ).mul(glow.mul(1.2).add(0.4));
    const g = new THREE.Group();
    g.add(
      mesh(sphere, outer, [0, 0.05, 0], [0.3, 0.09, 0.22]),
      mesh(sphere, nacre, [0, 0.07, 0], [0.26, 0.05, 0.18])
    );
    return g;
  },
  "sunflower-star": (glow) => {
    const m = material(0xd0_60_3a, glow, 0xff_b0_70);
    m.colorNode = mix(
      color(0xc0_4a_3a),
      color(0x9a_5a_c0),
      mx_noise_float(positionLocal.mul(6)).mul(0.5).add(0.5)
    );
    const g = new THREE.Group();
    g.add(mesh(sphere, m, [0, 0.03, 0], [0.13, 0.04, 0.13]));
    const arm = new THREE.CapsuleGeometry(0.03, 0.26, 3, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(0.16, 0, 0);
    for (let i = 0; i < 16; i += 1) {
      // The wasting disease has taken some of its arms.
      if (i % 5 === 3) {
        continue;
      }
      const a = mesh(arm, m, [0, 0.02, 0], [i % 3 === 0 ? 0.6 : 1, 0.7, 1]);
      a.rotation.y = (i / 16) * Math.PI * 2;
      g.add(a);
    }
    return g;
  },
  "bloom-sample": (glow) => {
    const glass = new THREE.MeshStandardNodeMaterial({
      roughness: 0.15,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    glass.colorNode = color(0xdf_ee_e8);
    glass.emissiveNode = color(0xbf_e8_ff).mul(rim(1.5).mul(glow.add(0.5)));
    const water = new THREE.MeshBasicNodeMaterial();
    water.colorNode = color(0xb8_62_2a).mul(glow.mul(0.8).add(0.7));
    const cap = material(0xb3_8a_3c, glow, 0xff_e0_a0, 0.4);
    const g = new THREE.Group();
    const tube = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 12);
    g.add(
      mesh(tube, water, [0, 0.13, 0], [0.8, 0.7, 0.8]),
      mesh(tube, glass, [0, 0.17, 0]),
      mesh(tube, cap, [0, 0.36, 0], [1.1, 0.15, 1.1])
    );
    g.rotation.z = 1.2;
    return g;
  },
  "capitola-shells": (glow) => {
    const stone = material(0xd2_c2_9a, glow, 0x9e_f0_9e, 0.95);
    stone.colorNode = mix(
      color(0xb8_a7_7e),
      color(0xe4_d8_b4),
      mx_noise_float(positionLocal.mul(9)).mul(0.5).add(0.5)
    );
    const shell = material(0xf0_e6_d0, glow, 0x9e_f0_9e, 0.5);
    const g = new THREE.Group();
    g.add(
      mesh(
        new THREE.DodecahedronGeometry(1, 0),
        stone,
        [0, 0.14, 0],
        [0.34, 0.2, 0.28]
      )
    );
    const clam = [
      [0.12, 0.3, 0.05, 0.4],
      [-0.1, 0.27, 0.12, -0.3],
      [0.02, 0.28, -0.15, 0.8],
      [-0.2, 0.2, -0.05, 1.4],
    ];
    for (const [x, y, z, r] of clam) {
      g.add(
        mesh(sphere, shell, [x, y, z], [0.09, 0.03, 0.07])
          .rotateY(r)
          .rotateX(0.4)
      );
    }
    g.add(
      mesh(
        new THREE.ConeGeometry(0.05, 0.14, 8),
        shell,
        [0.18, 0.24, -0.12]
      ).rotateZ(1.1)
    );
    return g;
  },
  "megalodon-tooth": (glow) => {
    const enamel = material(0x50_60_6c, glow, 0x9e_f0_9e, 0.35);
    enamel.colorNode = mix(
      color(0x3a_46_50),
      color(0x8a_9a_a4),
      positionLocal.y.mul(2).clamp(0, 1)
    );
    const root = material(0x6a_5a_48, glow, 0x9e_f0_9e, 0.9);
    const g = new THREE.Group();
    const blade = new THREE.ConeGeometry(0.2, 0.42, 3);
    g.add(
      mesh(blade, enamel, [0, 0.21, 0], [1, 1, 0.3]),
      mesh(new THREE.BoxGeometry(0.36, 0.1, 0.1), root, [0, 0.02, 0])
    );
    g.rotation.set(-1.25, 0.6, 0);
    g.position.y = 0.05;
    return g;
  },
  "drone-housing": (glow) => {
    const brass = material(0x8a_6a_30, glow, 0xff_d0_70, 0.45);
    brass.metalness = 0.8;
    const iron = material(0x2e_2f_30, glow, 0xff_d0_70, 0.6);
    const lens = new THREE.MeshBasicNodeMaterial();
    lens.colorNode = color(0x60_18_10).mul(glow.add(0.4));
    const g = new THREE.Group();
    const hull = new THREE.CylinderGeometry(0.16, 0.16, 0.4, 14);
    g.add(
      mesh(hull, brass, [0, 0, 0]),
      mesh(
        new THREE.TorusGeometry(0.165, 0.02, 6, 16),
        iron,
        [0, 0.1, 0]
      ).rotateX(Math.PI / 2),
      mesh(sphere, lens, [0, 0.21, 0], [0.06, 0.02, 0.06])
    );
    g.rotation.z = Math.PI / 2;
    g.position.y = 0.08;
    return g;
  },
};

/** The find's model, with its centre at the origin's floor point. Unknown items get a plain pebble. */
export const buildLook = (item: string, glow: Glow) => {
  const look = LOOKS[item];
  if (look) {
    return look(glow);
  }
  const g = new THREE.Group();
  g.add(
    mesh(
      sphere,
      material(0x88_80_70, glow, 0xff_ff_ff),
      [0, 0.06, 0],
      [0.15, 0.08, 0.12]
    )
  );
  return g;
};
