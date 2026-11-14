import { DIVER_HALF_HEIGHT, DIVER_RADIUS, SURFACE_Y, SWIM_SPEED, VERTICAL_SPEED } from '../shared/constants';
import type { Arena, ArenaDiver } from '../shared/arena';
import { SPECIES } from '../shared/creatures';
import { steerVelocity } from '../shared/creatures/common';
import type { Point } from '../shared/level';

/**
 * A computer buddy for the second seat. It follows the human diver, surfaces when its own air runs
 * low, buddy-breathes the human when they go down, and harpoons a machine that comes near. It
 * leaves calming to the human and keeps out of the creatures' territories.
 */
export function buddyInput(arena: Arena, me: ArenaDiver) {
  const s = me.sim;
  const lead = [...arena.divers.values()].find((d) => d !== me);
  let goal: Point = s, act = false, speed = SWIM_SPEED, slow = false;
  const drone = arena.creatures.find((c) => SPECIES[c.kind].action === 'harpoon' && !SPECIES[c.kind].done(c));
  const dist = (p: Point) => Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
  if (lead?.down) {
    goal = lead.sim;
    act = dist(lead.sim) < 2.2;
  } else if (me.air < 22) {
    goal = { x: s.x, y: SURFACE_Y - 0.9, z: s.z };
  } else if (drone && (dist(drone) < 8 || (lead && Math.hypot(drone.x - lead.sim.x, drone.y - lead.sim.y, drone.z - lead.sim.z) < 8))) {
    goal = drone;
    // Inside harpoon range it only edges forward, so it keeps facing the machine while it fires.
    if (dist(drone) < 5) { act = true; slow = true; }
  } else if (lead) {
    const l = lead.sim;
    goal = { x: l.x - Math.sin(l.yaw) * 2, y: l.y + 0.3, z: l.z - Math.cos(l.yaw) * 2 };
    // It waits at the edge of a creature's territory, such as the lingcod's nest, rather than following into it.
    for (const c of arena.creatures) {
      const keep = SPECIES[c.kind].territory;
      if (!keep) continue;
      const n = c.home, dx = goal.x - n.x, dz = goal.z - n.z, r = Math.hypot(dx, dz);
      if (r < keep) goal = { x: n.x + dx / (r || 1) * keep, y: goal.y + 1.5, z: n.z + dz / (r || 1) * keep };
    }
  }
  if (slow) speed = SWIM_SPEED * 0.3;
  const v = steerVelocity(arena.level, s, goal, speed, DIVER_RADIUS, DIVER_HALF_HEIGHT);
  let x = v.x / SWIM_SPEED, z = v.z / SWIM_SPEED;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  if (slow && len < 0.3 && len > 1e-3) { x = x / len * 0.3; z = z / len * 0.3; }
  const y = Math.max(-1, Math.min(1, v.y / VERTICAL_SPEED));
  return { x, y, z, act: act ? 1 : 0 };
}
