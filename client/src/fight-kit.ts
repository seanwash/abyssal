import * as THREE from 'three/webgpu';
import { abs, dot, normalView, oneMinus, positionViewDirection, pow } from 'three/tsl';

/** Fresnel rim: bright where a surface turns away from the camera. */
export const rim = (p: number) => pow(oneMinus(abs(dot(normalView, positionViewDirection))), p);
/** Frame-rate independent blend factor for easing toward a target at `rate` per second. */
export const ease = (dt: number, rate: number) => 1 - Math.exp(-rate * dt);
export const sphere = new THREE.SphereGeometry(1, 18, 12);

export const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1]) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  return m;
};
