/** A single fixed-step input. Direction is in world space with a length of at most 1; `act` is 1 while the action key is held. */
export interface DiverInput {
  seq: number;
  x: number;
  y: number;
  z: number;
  act: number;
}

export interface DiverSim {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
}

/** A diver out of air cannot swim and sinks slowly; server and client prediction both move it this way. */
export function swimInput(input: DiverInput, down: boolean): DiverInput {
  return down ? { seq: input.seq, x: 0, y: -0.12, z: 0, act: 0 } : input;
}

export function sanitizeInput(raw: unknown): DiverInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.seq, r.x, r.y, r.z];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  let x = r.x as number, y = r.y as number, z = r.z as number;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  y = Math.max(-1, Math.min(1, y));
  return { seq: Math.floor(r.seq as number), x, y, z, act: r.act ? 1 : 0 };
}

/** The diver id of the bot buddy, which gives its seat to a person who joins. */
export const BOT_ID = 'buddy-bot';

/** Options a browser sends when it joins a dive. `party` picks the room; `diver` identifies the tab across reloads and drops. */
export interface JoinOptions {
  name?: string;
  party?: string;
  diver?: string;
}

/** Close code for a connection whose diver has rejoined from a newer connection, such as the same tab after a network change. */
export const CLOSE_REPLACED = 4100;
/** Join error code when the party already has two divers connected. */
export const ERROR_DIVE_FULL = 4409;
