import { KEYS, presses } from "./keys";
import type { Binding } from "./keys";

const held = new Set<string>();

addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) {
    return;
  }
  held.add(e.code);
  if (presses(e, KEYS.act)) {
    e.preventDefault();
  }
});
addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());

/** Whether one of `b`'s keys is held. */
const isHeld = (b: Binding) => b.codes.some((c) => held.has(c));

/** Lets go of every held key, as if each were released. */
export const releaseKeys = () => held.clear();

const deadzone = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);

/** Forward, right and up from the held keys, each -1, 0 or 1. */
const readKeys = () => {
  let f = 0;
  let r = 0;
  let u = 0;
  if (isHeld(KEYS.forward)) {
    f += 1;
  }
  if (isHeld(KEYS.back)) {
    f -= 1;
  }
  if (isHeld(KEYS.right)) {
    r += 1;
  }
  if (isHeld(KEYS.left)) {
    r -= 1;
  }
  if (isHeld(KEYS.rise)) {
    u += 1;
  }
  if (isHeld(KEYS.sink)) {
    u -= 1;
  }
  return { f, r, u };
};

/** Forward, right and up from the first connected gamepad's left stick and buttons, or zeros without one. */
const readPad = () => {
  let f = 0;
  let r = 0;
  let u = 0;
  const pad = navigator.getGamepads?.().find(Boolean);
  if (pad) {
    r += deadzone(pad.axes[0] ?? 0);
    f -= deadzone(pad.axes[1] ?? 0);
    if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed) {
      u += 1;
    }
    if (pad.buttons[1]?.pressed || pad.buttons[4]?.pressed) {
      u -= 1;
    }
  }
  return { f, r, u };
};

/** Swim direction in world space, relative to a camera looking along yaw `camYaw`. */
export const readSwim = (camYaw: number) => {
  const keys = readKeys();
  const pad = readPad();
  const f = keys.f + pad.f;
  const r = keys.r + pad.r;
  const u = keys.u + pad.u;

  const sx = Math.sin(camYaw);
  const cz = Math.cos(camYaw);
  let x = -sx * f + cz * r;
  let z = -cz * f - sx * r;
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  return { x, y: Math.max(-1, Math.min(1, u)), z };
};

/** Whether the action key is held, or a gamepad's X or right trigger. */
export const readAct = () => {
  if (isHeld(KEYS.act)) {
    return true;
  }
  const pad = navigator.getGamepads?.().find(Boolean);
  return !!(pad?.buttons[2]?.pressed || pad?.buttons[7]?.pressed);
};
