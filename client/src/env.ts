import * as THREE from 'three/webgpu';
import {
  Fn, attribute, color, cos, float, instancedBufferAttribute, length, mix, mod, mx_fractal_noise_float,
  mx_noise_float, mx_worley_noise_vec2, normalWorld, oneMinus, positionLocal, positionWorld, pow, screenCoordinate,
  sin, smoothstep, step, floor, positionView, time, uniform, uv, vec2, vec3, max, bumpMap,
} from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { floorHeight, type Level } from '../../shared/level';
import { mulberry32, valueNoise2 } from '../../shared/rng';
import { SURFACE_Y } from '../../shared/constants';

export const PALETTE = {
  deep: new THREE.Color(0x0e2a30),
  sandLight: new THREE.Color(0xc9b994),
  sandDark: new THREE.Color(0x7c7558),
  granite: new THREE.Color(0x7b766c),
  graniteLight: new THREE.Color(0xa59d8f),
  coralline: new THREE.Color(0x9e6a86),
  algae: new THREE.Color(0x5d6a34),
  kelpDark: new THREE.Color(0x4f4a1c),
  kelpGold: new THREE.Color(0xc0973f),
  sun: new THREE.Color(0xfff0d2),
};

/** The local diver in world and view space, for the light radius and the kelp cut-away. */
export const cutaway = {
  diver: uniform(new THREE.Vector3(0, -6, 0)),
  diverView: uniform(new THREE.Vector3(0, 0, -40)),
};

const caustics = Fn(() => {
  const warp = vec2(mx_noise_float(positionWorld.xz.mul(0.35).add(time.mul(0.05))), mx_noise_float(positionWorld.xz.mul(0.35).sub(7.3)));
  const q = positionWorld.xz.mul(0.95).add(warp.mul(0.9));
  const t = time.mul(0.35);
  const a = mx_worley_noise_vec2(vec3(q.x, q.y, t));
  const b = mx_worley_noise_vec2(vec3(q.x.mul(1.7).add(4.1), q.y.mul(1.7).sub(2.3), t.mul(1.3)));
  const la = oneMinus(smoothstep(0.0, 0.07, a.y.sub(a.x)));
  const lb = oneMinus(smoothstep(0.0, 0.05, b.y.sub(b.x)));
  const patches = smoothstep(-0.1, 0.55, mx_noise_float(positionWorld.xz.mul(0.07).add(time.mul(0.02))));
  const depthFade = smoothstep(-16.0, -3.0, positionWorld.y);
  const up = smoothstep(0.25, 0.85, normalWorld.y);
  return la.mul(lb.mul(0.6).add(0.4)).add(la.mul(lb).mul(0.8)).mul(patches).mul(depthFade).mul(up);
});

/**
 * Kelp cut-away: kelp nearer the camera than the diver is removed close to the diver on screen
 * and drawn as a 50% checkerboard just outside that, like see-through walls.
 */
const screenDoor = Fn(() => {
  const r = length(positionView.xy.sub(cutaway.diverView.xy));
  const inFront = step(cutaway.diverView.z.add(0.4), positionView.z);
  const checker = mod(floor(screenCoordinate.x).add(floor(screenCoordinate.y)), 2.0);
  const hidden = max(step(r, 1.3), step(r, 2.5).mul(checker));
  return oneMinus(inFront.mul(hidden));
});

export function buildFloor(level: Level) {
  const geo = new THREE.PlaneGeometry(level.floorExtentX, level.floorExtentZ, level.floorRes, level.floorRes);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, floorHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const p = positionWorld;
  const broad = mx_fractal_noise_float(p.xz.mul(0.09), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const fine = mx_noise_float(p.xz.mul(5.0)).mul(0.5).add(0.5);
  const warp = mx_noise_float(p.xz.mul(0.25)).mul(4.0);
  const ripple = sin(p.x.mul(1.7).add(p.z.mul(0.6)).add(warp)).mul(0.5).add(0.5);
  const sand = mix(color(PALETTE.sandDark), color(PALETTE.sandLight), broad.mul(0.65).add(fine.mul(0.15)).add(ripple.mul(0.2)));
  const detritus = smoothstep(0.58, 0.78, mx_noise_float(p.xz.mul(0.6).add(9.0)).mul(0.5).add(0.5));
  const shellHash = step(0.82, mx_noise_float(p.xz.mul(14.0)).mul(0.5).add(0.5)).mul(smoothstep(0.3, 0.7, broad));
  const base = mix(sand, color(0x5d5638), detritus.mul(0.4));
  mat.colorNode = mix(base, color(0xe8dcc0), shellHash.mul(0.6));
  mat.normalNode = bumpMap(ripple.mul(0.6).add(fine.mul(0.25)).add(detritus.mul(0.3)), float(0.6));
  mat.emissiveNode = caustics().mul(color(0xcff2d2)).mul(0.32);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

function rockGeometry(seed: number) {
  const ico = new THREE.IcosahedronGeometry(1, 6);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n1 = valueNoise2(v.x * 1.3 + v.y * 0.7 + seed, v.z * 1.3 - v.y * 0.5, seed) - 0.5;
    const n2 = valueNoise2(v.x * 3.7 + seed * 0.3, v.z * 3.7 + v.y * 2.1, seed + 3) - 0.5;
    const n3 = valueNoise2(v.x * 8.1 - v.z * 2.0, v.y * 8.1 + v.x, seed + 9) - 0.5;
    v.multiplyScalar(1 + n1 * 0.5 + n2 * 0.14 + n3 * 0.04);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildBoulders(level: Level) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  const p = positionWorld;
  const tone = mx_fractal_noise_float(p.mul(0.6), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const speck = step(0.55, mx_noise_float(p.mul(11.0)));
  const granite = mix(color(PALETTE.granite), color(PALETTE.graniteLight), tone).mul(oneMinus(speck.mul(0.35)));
  const encrustMask = smoothstep(0.2, 0.75, normalWorld.y.add(mx_noise_float(p.mul(1.4)).mul(0.35)));
  const encrust = mix(color(PALETTE.coralline), color(PALETTE.algae), smoothstep(-0.3, 0.5, mx_noise_float(p.mul(1.6).add(5.0))));
  const crust = mx_noise_float(p.mul(6.0)).mul(0.5).add(0.5);
  mat.colorNode = mix(granite, encrust.mul(crust.mul(0.5).add(0.6)), encrustMask.mul(0.7));
  mat.emissiveNode = caustics().mul(color(0xcff2d2)).mul(0.1);
  mat.normalNode = bumpMap(mx_fractal_noise_float(p.mul(2.2), 3, 2.0, 0.5).add(speck.mul(0.2)), float(0.25));
  const geos = [0, 1, 2, 3].map((s) => rockGeometry(s * 13 + 5));
  for (const b of level.boulders) {
    const m = new THREE.Mesh(geos[b.seed % geos.length], mat);
    m.position.set(b.x, b.y, b.z);
    m.scale.set(b.r, b.r * b.sy, b.r * (0.85 + (b.seed % 7) / 20));
    m.rotation.y = b.rot;
    group.add(m);
  }
  group.add(buildAnemones(level));
  return group;
}

/** Strawberry anemone clusters (Corynactis californica) on boulder flanks: small saturated dots of colour. */
function buildAnemones(level: Level) {
  const rnd = mulberry32(99);
  const geo = new THREE.SphereGeometry(1, 7, 5);
  const count = level.boulders.length * 26;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  mat.colorNode = color(0xd8557a);
  mat.emissiveNode = color(0x6a1834).mul(0.6);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
  const tint = new THREE.Color();
  let i = 0;
  for (const b of level.boulders) {
    const cx = rnd() * Math.PI * 2;
    for (let k = 0; k < 26; k++) {
      const a = cx + (rnd() - 0.5) * 1.6;
      const el = 0.05 + rnd() * 0.75;
      pos.set(Math.cos(a) * Math.cos(el) * b.r * 0.98, Math.sin(el) * b.r * b.sy * 0.98, Math.sin(a) * Math.cos(el) * b.r * 0.92);
      pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), b.rot).add(new THREE.Vector3(b.x, b.y, b.z));
      const r = 0.035 + rnd() * 0.04;
      s.set(r, r * 0.7, r);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tint.setHSL(0.94 + rnd() * 0.06, 0.6, 0.55 + rnd() * 0.15));
      i++;
    }
  }
  mesh.count = i;
  return mesh;
}

/**
 * Giant kelp (Macrocystis pyrifera): stipes with alternating ruffled blades and gas floats,
 * merged into one mesh that sways in a shared surge plus per-plant motion.
 */
export function buildKelp(level: Level) {
  const rnd = mulberry32(31);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const bladderGeo = new THREE.SphereGeometry(0.05, 6, 4);

  for (const k of level.kelp) {
    const lean = new THREE.Vector3(Math.cos(k.lean), 0, Math.sin(k.lean));
    const H = k.height;
    const pathPt = (t: number) => new THREE.Vector3(k.x, k.floorY + t * H, k.z)
      .addScaledVector(lean, Math.sin(t * Math.PI * 0.5) * 0.9 + Math.sin(t * 7 + k.phase) * 0.12);
    const pts = Array.from({ length: 16 }, (_, i) => pathPt(i / 15));
    const curve = new THREE.CatmullRomCurve3(pts);
    const stipe = new THREE.TubeGeometry(curve, 40, 0.035, 5, false);
    tagGeometry(stipe, k, PALETTE.kelpDark, PALETTE.kelpDark);
    parts.push(stipe);

    const hold = new THREE.SphereGeometry(0.28, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    hold.scale(1, 0.55, 1);
    hold.translate(k.x, k.floorY - 0.02, k.z);
    tagGeometry(hold, k, new THREE.Color(0x3b3317), new THREE.Color(0x3b3317));
    parts.push(hold);

    let angle = rnd() * Math.PI * 2;
    for (let t = 0.05; t < 1.0; t += 0.3 / H + rnd() * 0.015) {
      angle += 2.4 + rnd() * 0.4;
      const base = curve.getPoint(t);
      const canopy = smoothstepJs(0.82, 1.0, t);
      const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const dir = outward.clone().multiplyScalar(1 - canopy * 0.3).addScaledVector(up, 0.75 - canopy * 0.6).normalize();
      const len = (1.1 + rnd() * 0.8) * (1 + canopy * 0.6);
      const width = 0.15 + rnd() * 0.08;
      const blade = bladeGeometry(base.clone().addScaledVector(outward, 0.06), dir, outward, len, width, rnd);
      tagGeometry(blade, k, PALETTE.kelpDark, PALETTE.kelpGold, t);
      parts.push(blade);
      const bl = bladderGeo.toNonIndexed();
      bl.translate(base.x + outward.x * 0.06, base.y, base.z + outward.z * 0.06);
      tagGeometry(bl, k, new THREE.Color(0x8a7a2c), new THREE.Color(0x8a7a2c));
      parts.push(bl);
    }
  }

  const geo = mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g), false)!;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
  const sway = attribute('aSway', 'vec2');
  const ph = sway.x, h = sway.y;
  const bend = pow(h, 1.5);
  const y = positionLocal.y;
  const surge = sin(time.mul(0.42)).mul(0.75).add(sin(time.mul(0.17).add(1.3)).mul(0.35));
  const dx = surge.add(sin(time.mul(0.6).add(ph).add(y.mul(0.14))).mul(0.45))
    .add(sin(time.mul(1.7).add(ph.mul(2.3)).add(y.mul(0.55))).mul(0.1)).mul(bend);
  const dz = cos(time.mul(0.5).add(ph.mul(1.3)).add(y.mul(0.11))).mul(0.5)
    .add(sin(time.mul(1.3).add(ph.mul(0.7)).add(y.mul(0.6))).mul(0.08)).mul(bend);
  mat.positionNode = positionLocal.add(vec3(dx, 0, dz));
  const vcol = attribute('color', 'vec3');
  const lift = smoothstep(-12.0, -1.0, positionWorld.y);
  mat.colorNode = vcol;
  mat.emissiveNode = vcol.mul(color(0xffd27a)).mul(lift.mul(0.22).add(0.05));
  mat.opacityNode = screenDoor();
  mat.alphaTest = 0.5;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

function smoothstepJs(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function bladeGeometry(origin: THREE.Vector3, dir: THREE.Vector3, outward: THREE.Vector3, len: number, width: number, rnd: () => number) {
  const segs = 12;
  const side = new THREE.Vector3().crossVectors(dir, outward).normalize();
  if (side.lengthSq() < 0.01) side.set(1, 0, 0);
  const normal = new THREE.Vector3().crossVectors(side, dir).normalize();
  const droop = 0.15 + rnd() * 0.2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const center = origin.clone().addScaledVector(dir, u * len).addScaledVector(normal, -droop * u * u);
    const w = width * Math.pow(Math.sin(Math.min(1, u * 1.08 + 0.04) * Math.PI), 0.7);
    for (let j = -1; j <= 1; j++) {
      const ruffle = j === 0 ? 0 : Math.sin(u * 46 + j * 1.7 + rnd() * 0.3) * 0.035 * (w / width);
      const p = center.clone().addScaledVector(side, j * w).addScaledVector(normal, ruffle);
      positions.push(p.x, p.y, p.z);
      uvs.push((j + 1) / 2, u);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j, b = a + 1, c = a + 3, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function tagGeometry(g: THREE.BufferGeometry, k: Level['kelp'][number], c0: THREE.Color, c1: THREE.Color, along = -1) {
  const pos = g.attributes.position;
  const sway = new Float32Array(pos.count * 2);
  const cols = new Float32Array(pos.count * 3);
  const uvAttr = g.attributes.uv;
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.min(1, Math.max(0, (pos.getY(i) - k.floorY) / k.height));
    sway[i * 2] = k.phase;
    sway[i * 2 + 1] = h;
    const v = along >= 0 && uvAttr ? uvAttr.getY(i) : 0.5;
    const edge = along >= 0 && uvAttr ? Math.abs(uvAttr.getX(i) - 0.5) * 2 : 0;
    tmp.copy(c0).lerp(c1, along >= 0 ? Math.min(1, 0.35 + v * 0.55 + along * 0.25 - edge * 0.15) : 0);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 2));
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'aSway', 'color'].includes(name)) g.deleteAttribute(name);
  }
}

export function buildGodRays() {
  const group = new THREE.Group();
  const rnd = mulberry32(5);
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  geo.translate(0, -0.5, 0);
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const seed = rnd() * 10;
    const v = uv();
    const fall = pow(v.y, 1.6);
    const edge = pow(sin(v.x.mul(Math.PI)), 2.0);
    const flicker = sin(time.mul(0.35).add(seed)).mul(0.35).add(0.65);
    mat.colorNode = color(PALETTE.sun);
    mat.opacityNode = fall.mul(edge).mul(flicker).mul(0.06 + rnd() * 0.05);
    const m = new THREE.Mesh(geo, mat);
    const w = 1.5 + rnd() * 4;
    m.scale.set(w, 16, 1);
    m.position.set((rnd() * 2 - 1) * 30, SURFACE_Y, (rnd() * 2 - 1) * 22);
    m.rotation.set(0, rnd() * Math.PI, 0.32);
    group.add(m);
  }
  return group;
}

/** Marine snow lit as glowing plankton: drifting particles that wrap around the camera target. */
export function buildMarineSnow(count = 2600) {
  const rnd = mulberry32(17);
  const base = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    base[i * 3] = rnd() * 40; base[i * 3 + 1] = rnd() * 14; base[i * 3 + 2] = rnd() * 34;
    sizes[i] = 0.03 + rnd() * rnd() * 0.1;
  }
  const target = uniform(new THREE.Vector3());
  const box = vec3(40, 14, 34);
  const b = vec3(instancedBufferAttribute(new THREE.InstancedBufferAttribute(base, 3)) as never);
  const size = instancedBufferAttribute(new THREE.InstancedBufferAttribute(sizes, 1));
  const drift = vec3(time.mul(0.08), time.mul(-0.12), time.mul(0.05));
  const wrapped = vec3(mod(b.add(drift).sub(target).add(box.mul(0.5)), box)).sub(box.mul(0.5)).add(target);
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  mat.positionNode = wrapped;
  mat.scaleNode = size;
  const d = length(uv().sub(vec2(0.5)));
  mat.colorNode = color(0x7af2d8).mul(1.6);
  mat.opacityNode = smoothstep(0.5, 0.1, d).mul(0.55);
  const sprite = new THREE.Sprite(mat);
  sprite.count = count;
  sprite.frustumCulled = false;
  return { object: sprite, target };
}

export { max };

/** Seafloor scatter: cobbles, bat stars (Patiria miniata) and broken shell, so open sand reads at walking scale. */
export function buildScatter(level: Level) {
  const rnd = mulberry32(211);
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const tint = new THREE.Color();
  const free = (x: number, z: number) => !level.boulders.some((b) => Math.hypot(b.x - x, b.z - z) < b.r * 0.9);

  const cobbleGeo = rockGeometry(77);
  const cobbleMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  cobbleMat.colorNode = mix(color(PALETTE.granite), color(0x4c4a40), mx_noise_float(positionWorld.mul(3.0)).mul(0.5).add(0.5));
  const cobbles = new THREE.InstancedMesh(cobbleGeo, cobbleMat, 520);
  let n = 0;
  while (n < 520) {
    const cx = (rnd() * 2 - 1) * 40, cz = (rnd() * 2 - 1) * 30;
    const k = 2 + Math.floor(rnd() * 6);
    for (let i = 0; i < k && n < 520; i++) {
      const x = cx + (rnd() - 0.5) * 2.5, z = cz + (rnd() - 0.5) * 2.5;
      if (!free(x, z)) continue;
      const r = 0.05 + rnd() * rnd() * 0.28;
      p.set(x, floorHeight(x, z) + r * 0.2, z);
      q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4));
      s.set(r, r * (0.5 + rnd() * 0.3), r * (0.8 + rnd() * 0.4));
      cobbles.setMatrixAt(n++, m.compose(p, q, s));
    }
  }

  const starShape = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.62;
    if (i === 0) starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  starGeo.rotateX(-Math.PI / 2);
  const starMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  starMat.colorNode = mix(color(0xb83a22), color(0xe0742c), mx_noise_float(positionWorld.mul(9.0)).mul(0.5).add(0.5));
  const stars = new THREE.InstancedMesh(starGeo, starMat, 60);
  for (let i = 0; i < 60; i++) {
    let x = 0, z = 0;
    do { x = (rnd() * 2 - 1) * 34; z = (rnd() * 2 - 1) * 24; } while (!free(x, z));
    const r = 0.08 + rnd() * 0.06;
    p.set(x, floorHeight(x, z) + 0.02, z);
    q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI * 2, 0));
    s.setScalar(r);
    stars.setMatrixAt(i, m.compose(p, q, s));
    stars.setColorAt(i, tint.setHSL(0.02 + rnd() * 0.06, 0.7, 0.4 + rnd() * 0.15));
  }

  const shellGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.35);
  const shellMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, side: THREE.DoubleSide });
  shellMat.colorNode = color(0xe9dfc8);
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, 260);
  for (let i = 0; i < 260; i++) {
    const x = (rnd() * 2 - 1) * 40, z = (rnd() * 2 - 1) * 30;
    const r = 0.03 + rnd() * 0.05;
    p.set(x, floorHeight(x, z) + 0.005, z);
    q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.6));
    s.set(r, r * 0.6, r * 1.2);
    shells.setMatrixAt(i, m.compose(p, q, s));
  }
  group.add(cobbles, stars, shells);
  return group;
}
