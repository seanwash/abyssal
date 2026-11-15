import { cabezon, isCabezon } from "./cabezon";
import { anySpecies } from "./common";
import type { Species } from "./common";
import { drone, isDrone } from "./drone";
import { isLingcod, lingcod } from "./lingcod";
import { isSchool, rockfish } from "./rockfish";
import { isSeaLion, sealion } from "./sealion";

/** Every kind of creature, by the `kind` the level and the network use. A new creature is one file plus a line here. */
export const SPECIES: Record<string, Species> = {
  lingcod: anySpecies(lingcod, isLingcod),
  drone: anySpecies(drone, isDrone),
  cabezon: anySpecies(cabezon, isCabezon),
  rockfish: anySpecies(rockfish, isSchool),
  sealion: anySpecies(sealion, isSeaLion),
};
