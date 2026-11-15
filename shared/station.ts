import { SURFACE_Y } from './constants';
import type { Reachable } from './arena';
import type { Level } from './level';
import type { DiverSim } from './protocol';
import { ITEMS } from './loot/items';
import { unique } from './loot/haul';

/**
 * The field station, the dive's town. Divers start there, climb out at its line on the surface
 * to log what they bagged, and dive again from it. Its log is the party's save: every find
 * logged, by whom and when. The server keeps one per party on disk; clients only show it.
 */

/** How close to the line, across the water, a diver can climb out. */
const LINE_REACH = 2.6;
/** How near the surface a diver has to be to climb out. */
const CLIMB_DEPTH = 1.6;

export function canClimb(level: Level, s: DiverSim) {
  return Math.hypot(s.x - level.station.x, s.z - level.station.z) < LINE_REACH && s.y > SURFACE_Y - CLIMB_DEPTH;
}

/** The line as something the action key aims at. Climbing out itself goes through `canClimb`. */
export function stationReach(level: Level): Reachable {
  return { kind: 'climb', id: 'station', x: level.station.x, y: SURFACE_Y - 1, z: level.station.z, range: LINE_REACH, reachAround: LINE_REACH };
}

export interface Find {
  item: string;
  /** The loot spot it came from, so a fossil or evidence stays found. */
  spot: string;
  /** Who bagged it: one name, or both for a fossil pried free together. */
  by: string[];
  /** When it was logged, in milliseconds since 1970. */
  at: number;
  /** Which trip to the station logged it, counting from 1. */
  trip: number;
}

export interface StationLog {
  version: 1;
  party: string;
  created: number;
  updated: number;
  /** Times a diver has climbed out at the station. */
  trips: number;
  finds: Find[];
}

/** What the station's screen shows: the party's log, and after a climb-out the finds it just logged and whether they were saved. */
export interface StationMessage {
  log: StationLog;
  fresh?: Find[];
  /** The diver who just climbed out. */
  by?: string;
  savedAt?: number;
  error?: string;
}

export function newLog(party: string, now = Date.now()): StationLog {
  return { version: 1, party, created: now, updated: now, trips: 0, finds: [] };
}

/** Records one climb-out with what the diver's bag held, and returns the new finds. */
export function logTrip(log: StationLog, bag: { item: string; spot: string; by: string[] }[], now = Date.now()) {
  log.trips += 1;
  log.updated = now;
  const finds = bag.map((b) => ({ ...b, at: now, trip: log.trips }));
  log.finds.push(...finds);
  return finds;
}

/** The spots whose finds are logged for good: fossils and evidence. */
export function foundSpots(log: StationLog) {
  return new Set(log.finds.filter((f) => unique(f.item)).map((f) => f.spot));
}

/** A log read from disk or the network, or null when it is not one. Finds of items this build does not know are kept. */
export function parseLog(raw: unknown): StationLog | null {
  const r = raw as StationLog;
  if (!r || typeof r !== 'object' || r.version !== 1 || typeof r.party !== 'string' || !Array.isArray(r.finds)) return null;
  const finds = r.finds.filter((f) => f && typeof f.item === 'string' && typeof f.spot === 'string' && Array.isArray(f.by) && Number.isFinite(f.at));
  return { version: 1, party: r.party, created: Number(r.created) || Date.now(), updated: Number(r.updated) || Date.now(), trips: Number(r.trips) || 0, finds };
}

/** One entry per kind of find on the station's shelf, in catalogue order. */
export function shelf(log: StationLog) {
  const out = new Map<string, { item: string; count: number; first: number; by: Set<string> }>();
  for (const f of log.finds) {
    if (!ITEMS[f.item]) continue;
    let e = out.get(f.item);
    if (!e) { e = { item: f.item, count: 0, first: f.at, by: new Set() }; out.set(f.item, e); }
    e.count++;
    e.first = Math.min(e.first, f.at);
    for (const b of f.by) e.by.add(b);
  }
  const order = Object.keys(ITEMS);
  return [...out.values()].toSorted((a, b) => order.indexOf(a.item) - order.indexOf(b.item));
}
