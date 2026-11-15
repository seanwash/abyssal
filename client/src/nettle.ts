import * as THREE from 'three/webgpu';
import {
  abs, attribute, color, cos, dot, float, fract, mix, mx_noise_float, normalView, oneMinus, positionLocal,
  positionViewDirection, pow, sin, smoothstep, time, uniform, uv, vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Jelly } from '../../shared/level';
import { mulberry32 } from '../../shared/rng';

const LAPPETS = 16;
const RADIAL = 96;
const RINGS = 28;

const AMBER = new THREE.Color(0xe0_8a_3c);
const RIM = new THREE.Color(0xff_e4_b0);
const STRIPE = new THREE.Color(0xff_5a_2e);
const ARM = new THREE.Color(0xf6_dc_cb);
const TENTACLE = new THREE.Color(0xff_6b_45);

/** Bell profile: apex at v=0, scalloped margin at v=1. Radius 1, height about 0.8. */
const bellGeometry = () => {
  const pos: number[] = []; const uvs: number[] = []; const idx: number[] = [];
  for (let j = 0; j <= RINGS; j += 1) {
    const v = j / RINGS;
    const r = Math.sin(v * Math.PI * 0.5) ** 0.85;
    const y = Math.cos(v * Math.PI * 0.5) * 0.72 - 0.08 * v * v;
    for (let i = 0; i <= RADIAL; i += 1) {
      const u = i / RADIAL;
      const a = u * Math.PI * 2;
      const lobe = Math.abs(Math.cos(u * Math.PI * LAPPETS));
      const scallop = 1 - (1 - lobe ** 0.6) * 0.07 * v ** 6;
      const rr = r * scallop * (1 + 0.04 * v ** 8);
      const yy = y - (1 - lobe ** 0.5) * 0.05 * v ** 8;
      pos.push(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      uvs.push(u, v);
    }
  }
  const row = RADIAL + 1;
  for (let j = 0; j < RINGS; j += 1) {
    for (let i = 0; i < RADIAL; i += 1) {
      const a = j * row + i; const b = a + 1; const c = a + row; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

/** A frilled ribbon hanging from the mouth; aT runs 0 at the bell to 1 at the tip. */
const oralArmGeometry = (angle: number, length: number, rnd: () => number) => {
  const across = 6;
  const segs = 64;
  const pos: number[] = []; const t: number[] = []; const edge: number[] = []; const idx: number[] = [];
  const twist = 1.6 + rnd() * 1.2;
  for (let i = 0; i <= segs; i += 1) {
    const s = i / segs;
    const y = -0.05 - s * length;
    const spiral = angle + s * twist;
    const cx = Math.cos(spiral) * (0.12 + s * 0.2); const cz = Math.sin(spiral) * (0.12 + s * 0.2);
    const w = 0.2 * (1 - s * 0.55) * Math.min(1, s * 8 + 0.3);
    const tx = -Math.sin(spiral); const tz = Math.cos(spiral);
    for (let j = 0; j <= across; j += 1) {
      const k = j / across - 0.5;
      const frill = Math.sin(s * 70 + k * 9) * 0.05 * Math.abs(k) * 2;
      pos.push(cx + tx * k * w + Math.cos(spiral) * frill, y + frill * 0.6, cz + tz * k * w + Math.sin(spiral) * frill);
      t.push(s);
      edge.push(Math.abs(k) * 2);
    }
  }
  const row = across + 1;
  for (let i = 0; i < segs; i += 1) {
    for (let j = 0; j < across; j += 1) {
      const a = i * row + j; const b = a + 1; const c = a + row; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

/** Merges geometries that all share the same attributes, as every caller here builds them. */
const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts, false);
  if (!g) {throw new Error('nettle: geometries to merge have mismatched attributes');}
  return g;
};

const tentacleGeometry = (count: number, rnd: () => number) => {
  const parts: THREE.BufferGeometry[] = [];
  for (let n = 0; n < count; n += 1) {
    const u = (n + 0.5) / count;
    const a = u * Math.PI * 2;
    const len = 3.2 + rnd() * 2.6;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const s = i / 12;
      const r = 0.97 + s * 0.12;
      pts.push(new THREE.Vector3(Math.cos(a) * r, -0.1 - s * len, Math.sin(a) * r));
    }
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.012, 4, false);
    const p = g.attributes.position;
    const tArr = new Float32Array(p.count); const iArr = new Float32Array(p.count);
    for (let i = 0; i < p.count; i += 1) {
      tArr[i] = Math.min(1, Math.max(0, (-p.getY(i) - 0.1) / len));
      iArr[i] = n;
    }
    g.setAttribute('aT', new THREE.BufferAttribute(tArr, 1));
    g.setAttribute('aIdx', new THREE.BufferAttribute(iArr, 1));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  return merge(parts);
};

const shared = {
  bell: bellGeometry(),
  arms: (() => {
    const rnd = mulberry32(3);
    return merge([0, 1, 2, 3].map((k) => oralArmGeometry(k * Math.PI * 0.5 + 0.4, 2.4 + rnd() * 1.4, rnd)));
  })(),
  tentacles: tentacleGeometry(24, mulberry32(4)),
};

const fresnel = () => pow(oneMinus(abs(dot(normalView, positionViewDirection))), 2.2);

/**
 * Pacific sea nettle (Chrysaora fuscescens), rendered as glowing glass in the manner of the
 * Discomedusae plates of Haeckel's Kunstformen der Natur.
 */
export class SeaNettle {
  readonly group = new THREE.Group();
  readonly pulse = uniform(0);
  readonly glow = uniform(1);
  readonly light?: THREE.PointLight;
  private base: THREE.Vector3;
  private spec: Jelly;

  constructor(spec: Jelly) {
    this.spec = spec;
    this.base = new THREE.Vector3(spec.x, spec.y, spec.z);
    this.group.position.copy(this.base);
    this.group.scale.setScalar(0.55 * spec.scale);

    const bell = new THREE.Mesh(shared.bell, this.bellMaterial(false));
    const inner = new THREE.Mesh(shared.bell, this.bellMaterial(true));
    inner.scale.setScalar(0.62);
    inner.position.y = -0.06;
    const arms = new THREE.Mesh(shared.arms, this.armMaterial());
    const tentacles = new THREE.Mesh(shared.tentacles, this.tentacleMaterial());
    bell.renderOrder = 3; inner.renderOrder = 2; arms.renderOrder = 1; tentacles.renderOrder = 1;
    for (const m of [bell, inner, arms, tentacles]) {m.frustumCulled = false;}
    this.group.add(tentacles, arms, inner, bell);

    if (spec.hero) {
      this.light = new THREE.PointLight(0xff_a8_60, 6, 9, 1.6);
      this.light.position.set(0, -0.4, 0);
      this.group.add(this.light);
    }
  }

  /** Contraction squeezes the bell in, then a slow recovery lifts the medusa upward. */
  update(t: number) {
    const cycle = (t * 0.55 + this.spec.phase) % 1;
    const squeeze = cycle < 0.28 ? Math.sin((cycle / 0.28) * Math.PI * 0.5) : Math.exp(-(cycle - 0.28) * 5.5);
    this.pulse.value = squeeze;
    const rise = Math.sin(t * 0.18 + this.spec.phase * 6) * 0.35;
    const drift = Math.sin(t * 0.05 + this.spec.phase * 3) * 0.6;
    this.group.position.set(this.base.x + drift, this.base.y + rise - squeeze * 0.05, this.base.z + Math.cos(t * 0.04 + this.spec.phase) * 0.4);
    this.group.rotation.set(Math.sin(t * 0.3 + this.spec.phase) * 0.08, t * 0.05, Math.cos(t * 0.23 + this.spec.phase) * 0.08);
    if (this.light) {this.light.intensity = 4.5 + squeeze * 4;}
  }

  get worldPosition() {
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  private squeezeNode() {
    const v = uv().y;
    const p = this.pulse;
    const radial = oneMinus(p.mul(0.16).mul(pow(v, 1.5)));
    const lift = p.mul(0.08).mul(oneMinus(v));
    return vec3(positionLocal.x.mul(radial), positionLocal.y.add(lift).mul(float(1).add(p.mul(0.1))), positionLocal.z.mul(radial));
  }

  private bellMaterial(inner: boolean) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    m.positionNode = this.squeezeNode();
    const u = uv().x; const v = uv().y;
    const f = fresnel();
    const stripes = smoothstep(0.9, 0.998, abs(cos(u.mul(Math.PI * LAPPETS)))).mul(smoothstep(0.08, 0.3, v));
    const midStripes = smoothstep(0.93, 1, abs(cos(u.mul(Math.PI * LAPPETS).add(Math.PI / 2)))).mul(smoothstep(0.35, 0.7, v));
    const rings = smoothstep(0.96, 1, abs(sin(v.mul(Math.PI * 3).sub(time.mul(0.4))))).mul(0.18);
    const travel = smoothstep(0, 0.25, oneMinus(abs(fract(v.sub(time.mul(0.45))).sub(0.5)).mul(4)));
    const grain = mx_noise_float(vec3(u.mul(40), v.mul(12), 0)).mul(0.5).add(0.5);
    const margin = smoothstep(0.86, 1, v);
    if (inner) {
      const gonad = smoothstep(0.55, 0.9, abs(sin(u.mul(Math.PI * 4)))).mul(smoothstep(0.15, 0.5, v)).mul(oneMinus(smoothstep(0.65, 0.95, v)));
      m.colorNode = mix(color(AMBER), color(0xff_c2_7a), gonad).mul(gonad.mul(0.9).add(f.mul(0.35)).add(0.05)).mul(this.glow).mul(float(0.7).add(this.pulse.mul(0.6)));
      return m;
    }
    const body = color(AMBER).mul(float(0.1).add(grain.mul(0.06)).add(oneMinus(v).mul(0.08)));
    const lines = color(STRIPE).mul(stripes.mul(0.9).add(midStripes.mul(0.4)).mul(float(0.35).add(v.mul(0.8))));
    const rim = color(RIM).mul(f.mul(1.1).add(margin.mul(1.3)).add(rings));
    const wave = color(0xff_d0_8a).mul(travel.mul(0.35).mul(oneMinus(v.mul(0.5))));
    m.colorNode = body.add(lines).add(rim).add(wave).mul(this.glow).mul(float(0.85).add(this.pulse.mul(0.5)));
    return m;
  }

  private armMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const t = attribute('aT', 'float');
    const e = attribute('aEdge', 'float');
    const sway = sin(time.mul(0.7).add(t.mul(5))).mul(t).mul(0.35);
    const sway2 = cos(time.mul(0.5).add(t.mul(3.7))).mul(t).mul(0.3);
    m.positionNode = positionLocal.add(vec3(sway, this.pulse.mul(0.12).mul(oneMinus(t)), sway2));
    const edge = smoothstep(0.6, 1, e);
    const fade = oneMinus(smoothstep(0.7, 1, t));
    m.colorNode = color(ARM).mul(edge.mul(0.7).add(0.06).add(fresnel().mul(0.3))).mul(fade).mul(this.glow).mul(0.8);
    return m;
  }

  private tentacleMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const t = attribute('aT', 'float');
    const i = attribute('aIdx', 'float');
    const wave = sin(time.mul(0.9).add(i.mul(1.7)).add(t.mul(6))).mul(pow(t, 1.2)).mul(0.55);
    const wave2 = cos(time.mul(0.6).add(i.mul(2.3)).add(t.mul(4))).mul(pow(t, 1.2)).mul(0.45);
    const flare = this.pulse.mul(0.18).mul(oneMinus(t));
    m.positionNode = vec3(positionLocal.x.mul(float(1).sub(flare)).add(wave), positionLocal.y, positionLocal.z.mul(float(1).sub(flare)).add(wave2));
    const fade = oneMinus(smoothstep(0.25, 1, t));
    m.colorNode = color(TENTACLE).mul(fade.mul(0.9)).mul(this.glow);
    return m;
  }
}
