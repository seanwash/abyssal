const held = new Set<string>();

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  held.add(e.code);
  if (e.code === 'Space' || e.code === 'Enter') e.preventDefault();
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

/** Swim direction in world space, relative to a camera looking along yaw `camYaw`. */
export function readSwim(camYaw: number) {
  let f = 0, r = 0, u = 0;
  if (held.has('KeyW') || held.has('ArrowUp')) f += 1;
  if (held.has('KeyS') || held.has('ArrowDown')) f -= 1;
  if (held.has('KeyD') || held.has('ArrowRight')) r += 1;
  if (held.has('KeyA') || held.has('ArrowLeft')) r -= 1;
  if (held.has('Space') || held.has('KeyE')) u += 1;
  if (held.has('ShiftLeft') || held.has('ShiftRight') || held.has('KeyC') || held.has('KeyQ')) u -= 1;

  const pad = navigator.getGamepads?.().find((p) => p);
  if (pad) {
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    r += dz(pad.axes[0] ?? 0);
    f -= dz(pad.axes[1] ?? 0);
    if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) u += 1;
    if (pad.buttons[1]?.pressed || pad.buttons[4]?.pressed) u -= 1;
  }

  const sx = Math.sin(camYaw), cz = Math.cos(camYaw);
  let x = -sx * f + cz * r;
  let z = -cz * f - sx * r;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { x, y: Math.max(-1, Math.min(1, u)), z };
}

/** Whether the action key is held: F or Enter, or a gamepad's X or right trigger. */
export function readAct() {
  if (held.has('KeyF') || held.has('Enter') || held.has('NumpadEnter')) return true;
  const pad = navigator.getGamepads?.().find((p) => p);
  return !!(pad?.buttons[2]?.pressed || pad?.buttons[7]?.pressed);
}
