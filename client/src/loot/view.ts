import * as THREE from "three/webgpu";

import type { Target } from "../../../shared/arena";
import { SPECIES } from "../../../shared/creatures";
import type { Level } from "../../../shared/level";
import { LOOT } from "../../../shared/loot/haul";
import { ITEMS } from "../../../shared/loot/items";
import type { Category } from "../../../shared/loot/items";
import { ISO } from "../iso";
import type { DiverSnapshot, LootSnapshot } from "../net";
import { buildLook, glowUniform } from "./looks";

/**
 * Finds on the reef: each one's model, its glint, and its ground label. Labels read like Diablo
 * II's: the Latin name in the category's colour over a dark plate, shown once a lamp reaches the
 * find, and for every find in the light while Alt is held. Every model is built up front, so a
 * drop or a reef reset never compiles a material mid-dive.
 */

/** Each category's colour, as on the ground labels: plain, blue, set green, unique gold. */
export const TINT: Record<Category, number> = {
  specimen: 0xec_e4_ce,
  sample: 0x8a_a8_ff,
  fossil: 0x74_e0_74,
  evidence: 0xd9_b4_5a,
};

interface One {
  root: THREE.Group;
  look: THREE.Object3D;
  glow: ReturnType<typeof glowUniform>;
  label: HTMLElement;
  meter: HTMLElement;
  fill: HTMLElement;
  spin: number;
}

/** How far a lamp reaches a find for its label to show, in the lamp's own 3D distance. */
const LABEL_REACH = ISO.radius * 0.95;

let altHeld = false;
addEventListener("keydown", (e) => {
  if (e.key === "Alt") {
    altHeld = true;
    e.preventDefault();
  }
});
addEventListener("keyup", (e) => {
  if (e.key === "Alt") {
    altHeld = false;
  }
});
addEventListener("blur", () => {
  altHeld = false;
});

export class LootView {
  readonly objects: THREE.Object3D[] = [];
  private all = new Map<string, One>();
  private layer = document.createElement("div");
  private v = new THREE.Vector3();

  constructor(level: Level) {
    this.layer.className = "loot-labels";
    document.body.append(this.layer);
    const items = new Map(level.loot.map((s) => [s.id, s.item] as const));
    for (const s of level.creatures) {
      const drops = SPECIES[s.kind]?.drops;
      if (drops) {
        items.set(`drop-${drops}`, drops);
      }
    }
    for (const [id, item] of items) {
      this.add(id, item);
    }
  }

  private add(id: string, item: string) {
    const glow = glowUniform();
    const look = buildLook(item, glow);
    const root = new THREE.Group();
    root.add(look);
    root.visible = false;
    this.objects.push(root);
    const it = ITEMS[item];
    const label = document.createElement("div");
    label.className = `loot-label cat-${it?.category ?? "specimen"}${it?.rare ? " rare" : ""}`;
    const latin = document.createElement("span");
    latin.className = "latin";
    latin.textContent = it?.latin ?? item;
    const common = document.createElement("span");
    common.className = "common";
    common.textContent = it
      ? `${it.common}${it.pry ? " · needs both divers" : ""}`
      : "";
    label.append(latin, common);
    const meter = document.createElement("div");
    meter.className = "loot-meter";
    const fill = document.createElement("span");
    fill.className = "fill";
    meter.append(fill);
    label.append(meter);
    this.layer.append(label);
    this.all.set(id, {
      root,
      look,
      glow,
      label,
      meter,
      fill,
      spin: Math.random() * 6,
    });
  }

  update(
    dt: number,
    t: number,
    loot: LootSnapshot[],
    divers: DiverSnapshot[],
    target: Target | null,
    camera: THREE.Camera,
    w: number,
    h: number
  ) {
    const lamps = divers.filter((d) => !d.aboard);
    const seen = new Set<string>();
    const reach = LABEL_REACH * (altHeld ? 1.5 : 1);
    for (const l of loot) {
      const one = this.all.get(l.id);
      if (!one) {
        continue;
      }
      seen.add(l.id);
      const lying = l.state === LOOT.lying;
      one.root.visible = lying;
      if (!lying) {
        one.label.classList.remove("show");
        continue;
      }
      one.root.position.set(l.x, l.y - 0.08, l.z);
      // A find being worked loose rocks in place.
      one.look.rotation.y = l.work > 0 ? Math.sin(t * 30) * 0.08 * l.work : 0;
      const aimed =
        target &&
        (target.kind === "bag" || target.kind === "pry") &&
        target.id === l.id;
      // A slow glint every few seconds, so a find shows as a spark at the edge of the light before its label does.
      one.spin += dt;
      const glint = Math.max(0, Math.sin(one.spin * 1.3) ** 24);
      const goal = aimed ? 0.9 + Math.sin(t * 6) * 0.15 + l.work : glint * 0.9;
      one.glow.value += (goal - one.glow.value) * (1 - Math.exp(-10 * dt));

      const lit = lamps.some(
        (d) =>
          Math.hypot(d.x - l.x, (d.y - l.y) * ISO.vertical, d.z - l.z) < reach
      );
      one.label.classList.toggle("show", lit || !!aimed);
      one.label.classList.toggle("aimed", !!aimed);
      one.meter.classList.toggle("show", l.work > 0.02);
      one.fill.style.width = `${(Math.min(1, l.work) * 100).toFixed(1)}%`;
      if (lit || aimed) {
        this.v.set(l.x, l.y + 0.35, l.z).project(camera);
        one.label.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      }
    }
    for (const [id, one] of this.all) {
      if (!seen.has(id)) {
        one.root.visible = false;
        one.label.classList.remove("show");
      }
    }
  }

  /** Hides every label, for the station screen. */
  hideLabels(hidden: boolean) {
    this.layer.classList.toggle("hidden", hidden);
  }
}
