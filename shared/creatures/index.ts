import type { Species } from './common';
import { drone } from './drone';
import { lingcod } from './lingcod';

/** Every kind of creature, by the `kind` the level and the network use. A new creature is one file plus a line here. */
export const SPECIES: Record<string, Species> = { lingcod, drone };
