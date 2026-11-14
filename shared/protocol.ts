/** A single fixed-step input. Direction is in world space with a length of at most 1. */
export interface DiverInput {
  seq: number;
  x: number;
  y: number;
  z: number;
}

export interface DiverSim {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
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
  return { seq: Math.floor(r.seq as number), x, y, z };
}
