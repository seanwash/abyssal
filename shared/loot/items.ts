/**
 * Everything a diver can bag, by the `item` key the level, the network and the save use. Each
 * entry is data only: how its ground label reads, its category, and whether it takes both divers.
 * The rules live in `haul.ts`; each item's look lives in `client/src/loot/looks.ts`.
 */

/**
 * Ground labels take their colour from the category, the way Diablo II colours items by quality:
 * specimens are plain, samples blue, fossils green like set items (their families grant set boons
 * later), and evidence gold like uniques.
 */
export type Category = "specimen" | "sample" | "fossil" | "evidence";

export interface Item {
  /** The binomial or classification on the ground label, in italics. */
  latin: string;
  common: string;
  category: Category;
  /** A short field note for the station's shelf. */
  note: string;
  /** Prying it free takes both divers holding the action key at once. */
  pry?: boolean;
  rare?: boolean;
}

export const ITEMS: Record<string, Item> = {
  "urchin-test": {
    latin: "Strongylocentrotus purpuratus",
    common: "Purple urchin test",
    category: "specimen",
    note: "The bare shell of a purple urchin. Whole barrens of them can mow a kelp forest down to rock.",
  },
  "turban-snail": {
    latin: "Tegula pulligo",
    common: "Dusky turban snail",
    category: "specimen",
    note: "Grazes high on the kelp and drops to the floor when the canopy thins.",
  },
  "abalone-shell": {
    latin: "Haliotis rufescens",
    common: "Red abalone shell",
    category: "specimen",
    note: "Empty, the nacre still bright. Abalone keep under ledges where the surge cannot reach.",
  },
  "sunflower-star": {
    latin: "Pycnopodia helianthoides",
    common: "Sunflower star, wasting",
    category: "specimen",
    note: "Its arms are falling away from the wasting disease. With the stars gone, nothing eats the urchins.",
  },
  "bloom-sample": {
    latin: "Pseudo-nitzschia australis",
    common: "Water sample, bloom diatoms",
    category: "sample",
    note: "Rust-coloured water from the floor of the Hollow. These diatoms can make domoic acid.",
  },
  "capitola-shells": {
    latin: "Mollusca, Purisima Fm.",
    common: "Capitola shells, 3 to 7 million years",
    category: "fossil",
    note: "Clams and snails packed into pale sandstone, like the shell beds in the cliffs below Depot Hill.",
    pry: true,
  },
  "megalodon-tooth": {
    latin: "Otodus megalodon",
    common: "Megalodon tooth",
    category: "fossil",
    note: "The legendary find. Real ones turn up in the bay's rock now and then.",
    pry: true,
    rare: true,
  },
  ammonite: {
    latin: "Ammonoidea",
    common: "Ammonite, out of place",
    category: "evidence",
    note: "Ammonites died out with the dinosaurs, long before any of the bay's fossil beds formed. This one came in with rock dumped from somewhere else.",
    pry: true,
    rare: true,
  },
  "drone-housing": {
    latin: "Machina exploratrix",
    common: "Survey drone housing",
    category: "evidence",
    note: "A brass sampling housing off the wrecked drone, stamped with a maker's mark someone filed half away.",
  },
};
