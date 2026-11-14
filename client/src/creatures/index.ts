import type * as THREE from 'three/webgpu';
import type { Fx } from '../../../shared/arena';
import type { CreatureSpawn } from '../../../shared/level';
import type { CreatureSnapshot } from '../net';
import { DroneView } from './drone';
import { LingcodView } from './lingcod';

/** How one creature is drawn. It reads only the snapshot the server sends, so its look can change without touching the rules. */
export interface CreatureView {
  /** The object that follows the creature; hidden while the server has no such creature. */
  root: THREE.Object3D;
  /** Everything to add to the scene, including fixed scenery such as the lingcod's eggs. */
  objects: THREE.Object3D[];
  update(dt: number, t: number, s: CreatureSnapshot): void;
  /** Something just happened to this creature, such as a harpoon hit or being calmed. */
  react(f: Fx): void;
}

/** A view for each `kind` in `shared/creatures`. */
export const VIEWS: Record<string, (spawn: CreatureSpawn) => CreatureView> = {
  lingcod: (s) => new LingcodView(s),
  drone: () => new DroneView(),
};
