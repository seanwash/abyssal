import { bloom } from "three/addons/tsl/display/BloomNode.js";
import {
  color,
  float,
  fog,
  length,
  max,
  min,
  mix,
  oneMinus,
  positionWorld,
  screenUV,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { cutaway } from "./env";

/**
 * Diablo II-style look: a fixed 2:1 isometric orthographic camera, a low internal resolution
 * upscaled with hard pixels, and a light radius around each diver. Outside the radius the
 * water falls to near black, so the self-lit nettles, plankton and headlamp carry the glow.
 */
export const ISO = {
  yaw: THREE.MathUtils.degToRad(45),
  pitch: THREE.MathUtils.degToRad(30),
  distance: 40,
  viewHeight: 11,
  lines: 450,
  radius: 5.5,
  /** Vertical distance counts this many times horizontal distance, so a diver sees the floor only when near it. */
  vertical: 1.7,
  dark: 0x02_0b_10,
};

export const fitIso = (camera: THREE.OrthographicCamera) => {
  const h = ISO.viewHeight / 2;
  const w = h * (innerWidth / innerHeight);
  camera.left = -w;
  camera.right = w;
  camera.top = h;
  camera.bottom = -h;
  camera.updateProjectionMatrix();
};

export const isoCamera = () => {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 120);
  fitIso(camera);
  return camera;
};

/**
 * Pixel ratio that renders about `lines` rows and upscales each by a whole number of device
 * pixels, so every scaled-up pixel is the same size.
 */
export const isoPixelRatio = (lines = ISO.lines) => {
  const factor = Math.max(
    1,
    Math.round((innerHeight * devicePixelRatio) / lines)
  );
  return devicePixelRatio / factor;
};

type Vec3Node = typeof cutaway.diver;

const lampDistance = (lamp: Vec3Node) => {
  const d = positionWorld.sub(lamp);
  return length(vec3(d.x, d.y.mul(ISO.vertical), d.z));
};

/** A soft dark spot straight below a diver that widens and fades as the diver rises. */
const dropShadow = (diver: Vec3Node) => {
  const h = diver.y.sub(positionWorld.y);
  const r = h.mul(0.05).add(0.3);
  const flat = length(positionWorld.xz.sub(diver.xz));
  return oneMinus(smoothstep(r.mul(0.4), r, flat))
    .mul(smoothstep(0.3, 0.6, h))
    .mul(mix(float(0.65), float(0.3), smoothstep(0, 10, h)));
};

/**
 * Near-black water that closes in with 3D distance from the nearest diver, so each diver's lamp
 * opens its own pocket of the dark, plus each diver's drop shadow on whatever lies below it.
 */
export const applyIsoScene = (scene: THREE.Scene) => {
  scene.backgroundNode = color(ISO.dark);
  const d = min(lampDistance(cutaway.diver), lampDistance(cutaway.partner));
  const dark = smoothstep(ISO.radius * 0.45, ISO.radius * 2.1, d).mul(0.94);
  const shadow = max(dropShadow(cutaway.diver), dropShadow(cutaway.partner));
  scene.fogNode = fog(color(ISO.dark), max(dark, shadow));
};

/** A diver's own light: the circle of visibility around them. */
export const isoDiverLight = () =>
  new THREE.PointLight(0xb8_ef_e2, 18, ISO.radius * 2.2, 1.1);

export const isoOutput = (sceneColor: THREE.TextureNode) => {
  const glow = bloom(sceneColor, 1.15, 0.5, 0.42);
  const d = length(screenUV.sub(vec2(0.5)).mul(vec2(1.4, 1)));
  const vignette = mix(float(1), float(0.2), smoothstep(0.25, 0.75, d));
  return sceneColor.add(glow).mul(vignette);
};
