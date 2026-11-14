import * as THREE from 'three/webgpu';
import { color, float, fog, length, mix, positionWorld, screenUV, smoothstep, vec2 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { cutaway } from './env';

/**
 * Diablo II-style look: a fixed 2:1 isometric orthographic camera, a low internal resolution
 * upscaled with hard pixels, and a light radius around the local diver. Outside the radius the
 * water falls to near black, so the self-lit nettles, plankton and headlamp carry the glow.
 */
export const ISO = {
  yaw: THREE.MathUtils.degToRad(45),
  pitch: THREE.MathUtils.degToRad(30),
  distance: 40,
  viewHeight: 11,
  lines: 450,
  radius: 5.5,
  dark: 0x020b10,
};

export function isoCamera() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 120);
  fitIso(camera);
  return camera;
}

export function fitIso(camera: THREE.OrthographicCamera) {
  const h = ISO.viewHeight / 2, w = h * (innerWidth / innerHeight);
  camera.left = -w; camera.right = w; camera.top = h; camera.bottom = -h;
  camera.updateProjectionMatrix();
}

/**
 * Pixel ratio that renders about `lines` rows and upscales each by a whole number of device
 * pixels, so every scaled-up pixel is the same size.
 */
export function isoPixelRatio(lines = ISO.lines) {
  const factor = Math.max(1, Math.round((innerHeight * devicePixelRatio) / lines));
  return devicePixelRatio / factor;
}

/** Near-black water that closes in with distance from the diver, leaving a circle of visibility. */
export function applyIsoScene(scene: THREE.Scene) {
  scene.backgroundNode = color(ISO.dark);
  const d = length(positionWorld.xz.sub(cutaway.diver.xz));
  scene.fogNode = fog(color(ISO.dark), smoothstep(ISO.radius * 0.45, ISO.radius * 2.1, d).mul(0.94));
}

/** The diver's own light: the circle of visibility that follows the player. */
export function isoDiverLight() {
  return new THREE.PointLight(0xb8efe2, 18, ISO.radius * 2.2, 1.1);
}

export function isoOutput(sceneColor: THREE.TextureNode) {
  const glow = bloom(sceneColor, 1.15, 0.5, 0.42);
  const d = length(screenUV.sub(vec2(0.5)).mul(vec2(1.4, 1.0)));
  const vignette = mix(float(1.0), float(0.2), smoothstep(0.25, 0.75, d));
  return sceneColor.add(glow).mul(vignette);
}
