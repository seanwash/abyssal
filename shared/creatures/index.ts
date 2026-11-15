import { anchovies, isDrift } from "./anchovies";
import type { AnchovyEvent } from "./anchovies";
import { cabezon, isCabezon } from "./cabezon";
import { anySpecies } from "./common";
import type { Species } from "./common";
import { drone, isDrone } from "./drone";
import { isLingcod, lingcod } from "./lingcod";
import { isSchool, rockfish } from "./rockfish";
import type { SchoolEvent } from "./rockfish";
import { isSeaLion, sealion } from "./sealion";
import type { SeaLionEvent } from "./sealion";
import { isPatch, urchins } from "./urchins";
import type { UrchinEvent } from "./urchins";

/** The events species name for themselves, each declared beside its species' rules. */
export type CreatureEvent =
  | SeaLionEvent
  | SchoolEvent
  | AnchovyEvent
  | UrchinEvent;

const species = {
  lingcod: anySpecies(lingcod, isLingcod),
  drone: anySpecies(drone, isDrone),
  cabezon: anySpecies(cabezon, isCabezon),
  rockfish: anySpecies(rockfish, isSchool),
  sealion: anySpecies(sealion, isSeaLion),
  anchovies: anySpecies(anchovies, isDrift),
  urchins: anySpecies(urchins, isPatch),
};

/** A kind of creature: a key of the registry below, which the level's spawns and the client's views are checked against. */
export type Kind = keyof typeof species;

/**
 * Every kind of creature, by the `kind` the level and the network use. A new creature is one file
 * plus a line here. Lookups take any string, since snapshots carry the kind as text.
 */
export const SPECIES: Record<string, Species> = species;
