import type { Level } from "../level";
import { buildZone } from "./build";
import { CANNERY_ROW } from "./cannery-row";

let built: Level | undefined;

/** Zone 1, Cannery Row, built once per process: the level never changes, so every dive shares it. */
export const buildLevel = () => {
  built ??= buildZone(CANNERY_ROW);
  return built;
};
