import type { ArenaDiver, Fx, Reachable } from "../arena";
import { groundHeight } from "../level";
import type { Level, Point } from "../level";
import { ITEMS } from "./items";

/**
 * Loot on the reef and in the divers' bags. Holding the action key on a find bags it; a fossil
 * needs both divers holding it at once to pry it free. A bag's finds count only once a diver
 * climbs out at the field station and logs them; until then they are lost to a wipe or a closed
 * dive, and go back where they were found. The server runs these rules; the client draws the
 * results and predicts the action key's target with `reachable()`.
 */

export const LOOT = { lying: 0, carried: 1, logged: 2 } as const;
export const BAG_SLOTS = 6;

const BAG_TIME = 0.35;
const PRY_TIME = 2.4;
const REACH = 1.9;
const REACH_AROUND = 1.2;
/** Height of a resting find's centre above the ground under it. */
const REST = 0.08;

/** Fossils and evidence are found once per save; specimens and samples come back when the reef resets. */
export const unique = (item: string) =>
  ITEMS[item]?.category === "fossil" || ITEMS[item]?.category === "evidence";

/** The finds lying on the reef, as things the action key can aim at. Server and client both use it. */
export const lootReach = (
  loot: {
    id: string;
    item: string;
    x: number;
    y: number;
    z: number;
    state: number;
  }[]
): Reachable[] =>
  loot
    .filter((l) => l.state === LOOT.lying && ITEMS[l.item])
    .map((l) => ({
      kind: ITEMS[l.item].pry ? "pry" : "bag",
      id: l.id,
      x: l.x,
      y: l.y,
      z: l.z,
      range: REACH,
      reachAround: REACH_AROUND,
    }));

export interface Loot {
  id: string;
  item: string;
  /** Where it goes back to when a bag is lost. */
  home: Point;
  x: number;
  y: number;
  z: number;
  vy: number;
  state: number;
  /** Bagging or prying progress, 0 to 1. */
  work: number;
  /** How many divers are holding the action key on it. */
  hands: number;
  /** The diver who started working it loose, who gets it when two divers pry it together. */
  starter?: ArenaDiver;
}

export interface Carried {
  loot: Loot;
  by: string[];
}

interface Bag {
  name: string;
  items: Carried[];
}

/** Keeps who started working a find loose while they or the work last, and otherwise hands it to the first diver on it. */
const keepStarter = (l: Loot, on: ArenaDiver[]) => {
  if (!on.length && l.work <= 0) {
    l.starter = undefined;
  } else if (!l.starter || !on.includes(l.starter)) {
    l.starter = l.starter && l.work > 0 ? l.starter : on[0];
  }
};

export class Haul {
  readonly loot: Loot[] = [];
  private bags = new Map<ArenaDiver, Bag>();
  fx: Fx[] = [];
  readonly level: Level;

  /** `found` lists the spots whose finds are already logged for good, from the save. */
  constructor(level: Level, found: Set<string>) {
    this.level = level;
    for (const s of level.loot) {
      this.loot.push({
        id: s.id,
        item: s.item,
        home: { ...s.at },
        ...s.at,
        vy: 0,
        state: found.has(s.id) ? LOOT.logged : LOOT.lying,
        work: 0,
        hands: 0,
      });
    }
  }

  /** Gives a diver a bag. A diver coming back keeps the bag it had. */
  join(d: ArenaDiver, name: string) {
    const bag = this.bags.get(d);
    if (bag) {
      bag.name = name;
    } else {
      this.bags.set(d, { name, items: [] });
    }
  }

  /** The diver is gone for good: its unlogged finds go back where they were found. */
  leave(d: ArenaDiver) {
    this.giveBack(d);
    this.bags.delete(d);
  }

  /** The item keys in a diver's bag, in the order they were bagged. */
  bag(d: ArenaDiver) {
    return this.bags.get(d)?.items.map((c) => c.loot.item) ?? [];
  }

  reachable(): Reachable[] {
    return lootReach(this.loot);
  }

  /** One fixed step, after the arena has worked out what each diver's action key aims at. */
  tick(divers: Iterable<ArenaDiver>, dt: number) {
    const hands = this.handsOn(divers);
    for (const l of this.loot) {
      if (l.state !== LOOT.lying) {
        continue;
      }
      this.settle(l, dt);
      this.work(l, hands.get(l.id) ?? [], dt);
    }
  }

  private bagOf(d: ArenaDiver) {
    const bag = this.bags.get(d);
    if (!bag) {
      throw new Error(`Diver ${d.id} has no bag`);
    }
    return bag;
  }

  /** The divers with a bag holding the action key on each find, by the find's id. */
  private handsOn(divers: Iterable<ArenaDiver>) {
    const hands = new Map<string, ArenaDiver[]>();
    for (const d of divers) {
      const t = d.target;
      if (
        d.down ||
        !d.act ||
        !t ||
        (t.kind !== "bag" && t.kind !== "pry") ||
        !this.bags.has(d)
      ) {
        continue;
      }
      hands.set(t.id, [...(hands.get(t.id) ?? []), d]);
    }
    return hands;
  }

  /** Advances bagging or prying a lying find with the divers `on` it, and bags it once done. */
  private work(l: Loot, on: ArenaDiver[], dt: number) {
    const pry = !!ITEMS[l.item].pry;
    const room = on.filter((d) => this.bagOf(d).items.length < BAG_SLOTS);
    l.hands = on.length;
    keepStarter(l, on);
    if (room.length && (!pry || on.length >= 2)) {
      l.work += dt / (pry ? PRY_TIME : BAG_TIME);
    } else {
      l.work = Math.max(0, l.work - dt * (pry ? 0.25 : 2));
    }
    if (l.work < 1) {
      return;
    }
    const taker = l.starter && room.includes(l.starter) ? l.starter : room[0];
    l.state = LOOT.carried;
    l.work = 0;
    l.hands = 0;
    l.starter = undefined;
    this.bagOf(taker).items.push({
      loot: l,
      by: on.map((d) => this.bagOf(d).name),
    });
    this.fx.push({
      k: pry ? "pried" : "bagged",
      id: l.id,
      by: taker.id,
      item: l.item,
      p: [l.x, l.y, l.z],
    });
  }

  /** A find sinks until it rests on the floor or a boulder, which becomes its home. */
  private settle(l: Loot, dt: number) {
    const rest = groundHeight(this.level, l.x, l.z, l.y + 0.01) + REST;
    if (l.y <= rest + 1e-4 && l.vy === 0) {
      return;
    }
    l.vy = Math.max(-1.2, l.vy - 3 * dt);
    l.y += l.vy * dt;
    if (l.y <= rest) {
      l.y = rest;
      l.vy = 0;
      l.home = { x: l.x, y: l.y, z: l.z };
    }
  }

  /** A creature leaves `item` where it was calmed or wrecked, unless that find is already out or logged for good. */
  drop(item: string, at: Point) {
    const id = `drop-${item}`;
    let l = this.loot.find((x) => x.id === id);
    if (l && (l.state !== LOOT.logged || unique(item))) {
      return;
    }
    if (!l) {
      l = {
        id,
        item,
        home: { ...at },
        ...at,
        vy: 0,
        state: LOOT.lying,
        work: 0,
        hands: 0,
      };
      this.loot.push(l);
    }
    Object.assign(l, {
      x: at.x,
      y: at.y,
      z: at.z,
      home: { ...at },
      vy: -0.2,
      state: LOOT.lying,
      work: 0,
      hands: 0,
    });
    this.fx.push({ k: "dropped", id, item, p: [at.x, at.y, at.z] });
  }

  /** Sends a diver's unlogged finds back where they were found. */
  giveBack(d: ArenaDiver) {
    const bag = this.bags.get(d);
    if (!bag?.items.length) {
      return;
    }
    for (const { loot: l } of bag.items) {
      Object.assign(l, {
        ...l.home,
        vy: 0,
        state: LOOT.lying,
        work: 0,
        hands: 0,
      });
    }
    this.fx.push({ k: "returned", id: d.id, n: bag.items.length });
    bag.items = [];
  }

  /** Empties a diver's bag at the station and returns what it held, to be logged. */
  unload(d: ArenaDiver): Carried[] {
    const bag = this.bags.get(d);
    if (!bag) {
      return [];
    }
    const out = bag.items;
    bag.items = [];
    for (const c of out) {
      c.loot.state = LOOT.logged;
    }
    return out;
  }

  /** Specimens and samples that were logged grow back in their places. */
  restock() {
    for (const l of this.loot) {
      if (l.state === LOOT.logged && !unique(l.item)) {
        Object.assign(l, {
          ...l.home,
          vy: 0,
          state: LOOT.lying,
          work: 0,
          hands: 0,
        });
      }
    }
  }
}
