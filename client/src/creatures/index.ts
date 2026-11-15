import type * as THREE from "three/webgpu";

import type { Fx } from "../../../shared/arena";
import type { CreatureSpawn } from "../../../shared/level";
import type { Effects } from "../fight";
import type { CreatureSnapshot, DiverSnapshot } from "../net";
import type { Loudness } from "../sound";
import { CabezonView } from "./cabezon";
import { DroneView } from "./drone";
import { LingcodView } from "./lingcod";
import { RockfishView } from "./rockfish";
import { SeaLionView } from "./sealion";

/** What a view plays an event with: the shared sparks, where the creature is, your diver, and how loud a sound is for you. */
export interface Stage {
  effects: Effects;
  at: [number, number, number];
  me: DiverSnapshot;
  loud: Loudness;
}

/** How one creature is drawn. It reads only the snapshot the server sends, so its look can change without touching the rules. */
export interface CreatureView {
  /** The object that follows the creature; hidden while the server has no such creature. */
  root: THREE.Object3D;
  /** Everything to add to the scene, including fixed scenery such as the lingcod's eggs. */
  objects: THREE.Object3D[];
  update: (dt: number, t: number, s: CreatureSnapshot) => void;
  /**
   * Something just happened to this creature, such as a harpoon hit, being calmed, or one of its
   * species' own events, whose effect and sound the view plays itself. Returns the line the top
   * rule announces for one of its species' own events, or "" for none.
   */
  react: (f: Fx, stage: Stage) => string;
}

/** A view for each `kind` in `shared/creatures`. */
export const VIEWS: Record<string, (spawn: CreatureSpawn) => CreatureView> = {
  lingcod: (s) => new LingcodView(s),
  drone: () => new DroneView(),
  cabezon: (s) => new CabezonView(s),
  rockfish: (s) => new RockfishView(s),
  sealion: (s) => new SeaLionView(s),
};
