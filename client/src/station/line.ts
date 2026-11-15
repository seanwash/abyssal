import { color, float, uniform } from "three/tsl";
import * as THREE from "three/webgpu";

import { floorHeight } from "../../../shared/level";
import type { Level } from "../../../shared/level";
import { mesh, rim, sphere } from "../fight";

/**
 * Each field station's descent line: a red-and-cream float on the surface with a lantern that
 * shows through the dark as a beacon, a line down to a shot weight on the floor, and a ladder
 * float where divers climb out.
 */
export class StationLine {
  readonly objects: THREE.Object3D[] = [];
  private lantern = uniform(1);

  constructor(level: Level) {
    const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    paint.colorNode = color(0xb8_45_2a);
    paint.emissiveNode = color(0x5a_20_10).mul(rim(2).mul(0.6));
    const cream = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
    cream.colorNode = color(0xe8_dc_c0);
    const rope = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
    rope.colorNode = color(0xd8_c8_90);
    rope.emissiveNode = color(0x6a_5a_30).mul(0.5);
    const iron = new THREE.MeshStandardNodeMaterial({
      roughness: 0.7,
      metalness: 0.6,
    });
    iron.colorNode = color(0x3a_3a_38);
    // The lantern ignores the dark, so divers can find the line from across the reef.
    const glow = new THREE.MeshBasicNodeMaterial({ fog: false });
    glow.colorNode = color(0xff_d8_90).mul(this.lantern).add(float(0.05));
    const halo = new THREE.MeshBasicNodeMaterial({
      fog: false,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    halo.colorNode = color(0xff_c0_70).mul(rim(1.2).mul(this.lantern).mul(0.5));

    for (const { x, z } of level.stations) {
      const floor = floorHeight(level, x, z);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      g.add(
        mesh(sphere, paint, [0, -0.1, 0], [0.42, 0.26, 0.42]),
        mesh(
          new THREE.CylinderGeometry(0.43, 0.43, 0.1, 18),
          cream,
          [0, -0.05, 0]
        ),
        mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), iron, [0, 0.3, 0]),
        mesh(sphere, glow, [0, 0.7, 0], [0.09, 0.12, 0.09]),
        mesh(sphere, halo, [0, 0.7, 0], [0.5, 0.5, 0.5])
      );
      const length = -0.3 - floor;
      g.add(
        mesh(new THREE.CylinderGeometry(0.022, 0.022, length, 5), rope, [
          0,
          -0.3 - length / 2,
          0,
        ]),
        mesh(sphere, iron, [0, floor + 0.15, 0], [0.22, 0.15, 0.22])
      );
      // Tags on the line every two metres, so its depth reads in the isometric view.
      for (let y = -2; y > floor + 0.5; y -= 2) {
        g.add(mesh(new THREE.BoxGeometry(0.12, 0.05, 0.02), cream, [0, y, 0]));
      }
      this.objects.push(g);
    }
  }

  update(t: number) {
    this.lantern.value = 1.3 + Math.sin(t * 2.2) * 0.35;
  }
}
