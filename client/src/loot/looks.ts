import * as THREE from 'three/webgpu';
import { color, mix, mx_noise_float, normalView, positionLocal, uniform } from 'three/tsl';
import { mesh, rim, sphere } from '../fight';

/**
 * How each find looks on the floor: a few primitives each, drawn about twice life size so they
 * read at the isometric camera's scale, the way Diablo II draws items on the ground. `glow`
 * brightens a find while the action key aims at it or works it free.
 */

/** A 0-to-1 brightness uniform; `glowUniform` makes one. */
export const glowUniform = () => uniform(0);
type Glow = ReturnType<typeof glowUniform>;

function material(base: number, glow: Glow, tint: number, roughness = 0.7) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness });
  m.colorNode = color(base);
  m.emissiveNode = color(tint).mul(rim(2).mul(glow.mul(1.6).add(0.35)));
  return m;
}

const LOOKS: Record<string, (glow: Glow) => THREE.Object3D> = {
  'urchin-test': (glow) => {
    const m = material(0x7a4f80, glow, 0xd8a8ff);
    m.colorNode = mix(color(0x5a3560), color(0xb08ab8), mx_noise_float(positionLocal.mul(22)).mul(0.5).add(0.5));
    const g = new THREE.Group();
    g.add(mesh(sphere, m, [0, 0.07, 0], [0.2, 0.12, 0.2]));
    return g;
  },
  'turban-snail': (glow) => {
    const m = material(0x3d3029, glow, 0xe0c9a0);
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.15, 0.28, 10);
    g.add(mesh(cone, m, [0, 0.12, 0]), mesh(sphere, material(0xc8b48a, glow, 0xffffff), [0.07, 0.04, 0.05], [0.07, 0.05, 0.07]));
    g.rotation.z = 0.9;
    return g;
  },
  'abalone-shell': (glow) => {
    const outer = material(0x8a3a2a, glow, 0xffa080, 0.85);
    const nacre = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.3 });
    nacre.colorNode = mix(color(0x6fd0c8), color(0xe6a0d8), normalView.x.mul(0.5).add(0.5));
    nacre.emissiveNode = mix(color(0x2a8078), color(0x8a4080), normalView.y.mul(0.5).add(0.5)).mul(glow.mul(1.2).add(0.4));
    const g = new THREE.Group();
    g.add(mesh(sphere, outer, [0, 0.05, 0], [0.3, 0.09, 0.22]), mesh(sphere, nacre, [0, 0.07, 0], [0.26, 0.05, 0.18]));
    return g;
  },
  'sunflower-star': (glow) => {
    const m = material(0xd0603a, glow, 0xffb070);
    m.colorNode = mix(color(0xc04a3a), color(0x9a5ac0), mx_noise_float(positionLocal.mul(6)).mul(0.5).add(0.5));
    const g = new THREE.Group();
    g.add(mesh(sphere, m, [0, 0.03, 0], [0.13, 0.04, 0.13]));
    const arm = new THREE.CapsuleGeometry(0.03, 0.26, 3, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(0.16, 0, 0);
    for (let i = 0; i < 16; i++) {
      // The wasting disease has taken some of its arms.
      if (i % 5 === 3) continue;
      const a = mesh(arm, m, [0, 0.02, 0], [i % 3 === 0 ? 0.6 : 1, 0.7, 1]);
      a.rotation.y = (i / 16) * Math.PI * 2;
      g.add(a);
    }
    return g;
  },
  'bloom-sample': (glow) => {
    const glass = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false });
    glass.colorNode = color(0xdfeee8);
    glass.emissiveNode = color(0xbfe8ff).mul(rim(1.5).mul(glow.add(0.5)));
    const water = new THREE.MeshBasicNodeMaterial();
    water.colorNode = color(0xb8622a).mul(glow.mul(0.8).add(0.7));
    const cap = material(0xb38a3c, glow, 0xffe0a0, 0.4);
    const g = new THREE.Group();
    const tube = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 12);
    g.add(mesh(tube, water, [0, 0.13, 0], [0.8, 0.7, 0.8]), mesh(tube, glass, [0, 0.17, 0]), mesh(tube, cap, [0, 0.36, 0], [1.1, 0.15, 1.1]));
    g.rotation.z = 1.2;
    return g;
  },
  'capitola-shells': (glow) => {
    const stone = material(0xd2c29a, glow, 0x9ef09e, 0.95);
    stone.colorNode = mix(color(0xb8a77e), color(0xe4d8b4), mx_noise_float(positionLocal.mul(9)).mul(0.5).add(0.5));
    const shell = material(0xf0e6d0, glow, 0x9ef09e, 0.5);
    const g = new THREE.Group();
    g.add(mesh(new THREE.DodecahedronGeometry(1, 0), stone, [0, 0.14, 0], [0.34, 0.2, 0.28]));
    const clam = [[0.12, 0.3, 0.05, 0.4], [-0.1, 0.27, 0.12, -0.3], [0.02, 0.28, -0.15, 0.8], [-0.2, 0.2, -0.05, 1.4]];
    for (const [x, y, z, r] of clam) g.add(mesh(sphere, shell, [x, y, z], [0.09, 0.03, 0.07]).rotateY(r).rotateX(0.4));
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.14, 8), shell, [0.18, 0.24, -0.12]).rotateZ(1.1));
    return g;
  },
  'megalodon-tooth': (glow) => {
    const enamel = material(0x50606c, glow, 0x9ef09e, 0.35);
    enamel.colorNode = mix(color(0x3a4650), color(0x8a9aa4), positionLocal.y.mul(2).clamp(0, 1));
    const root = material(0x6a5a48, glow, 0x9ef09e, 0.9);
    const g = new THREE.Group();
    const blade = new THREE.ConeGeometry(0.2, 0.42, 3);
    g.add(mesh(blade, enamel, [0, 0.21, 0], [1, 1, 0.3]), mesh(new THREE.BoxGeometry(0.36, 0.1, 0.1), root, [0, 0.02, 0]));
    g.rotation.set(-1.25, 0.6, 0);
    g.position.y = 0.05;
    return g;
  },
  'drone-housing': (glow) => {
    const brass = material(0x8a6a30, glow, 0xffd070, 0.45);
    brass.metalness = 0.8;
    const iron = material(0x2e2f30, glow, 0xffd070, 0.6);
    const lens = new THREE.MeshBasicNodeMaterial();
    lens.colorNode = color(0x601810).mul(glow.add(0.4));
    const g = new THREE.Group();
    const hull = new THREE.CylinderGeometry(0.16, 0.16, 0.4, 14);
    g.add(mesh(hull, brass, [0, 0, 0]), mesh(new THREE.TorusGeometry(0.165, 0.02, 6, 16), iron, [0, 0.1, 0]).rotateX(Math.PI / 2), mesh(sphere, lens, [0, 0.21, 0], [0.06, 0.02, 0.06]));
    g.rotation.z = Math.PI / 2;
    g.position.y = 0.08;
    return g;
  },
};

/** The find's model, with its centre at the origin's floor point. Unknown items get a plain pebble. */
export function buildLook(item: string, glow: Glow) {
  const look = LOOKS[item];
  if (look) return look(glow);
  const g = new THREE.Group();
  g.add(mesh(sphere, material(0x888070, glow, 0xffffff), [0, 0.06, 0], [0.15, 0.08, 0.12]));
  return g;
}
