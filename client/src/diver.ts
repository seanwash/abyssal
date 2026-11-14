import * as THREE from 'three/webgpu';
import {
  abs, color, dot, float, normalView, oneMinus, positionViewDirection, pow, smoothstep, uniform, uv,
  mx_noise_float, positionLocal,
} from 'three/tsl';
import { SUITS } from '../../shared/constants';

const BUBBLES = 40;
const RING = 12;
const RING_RADIUS = 0.16;

function rimMaterial(base: THREE.ColorRepresentation, rim: THREE.ColorRepresentation, rough = 0.6, metal = 0) {
  const b = new THREE.Color(base), r = new THREE.Color(rim);
  const m = new THREE.MeshStandardNodeMaterial({ roughness: rough, metalness: metal });
  m.colorNode = color(b);
  const f = pow(oneMinus(abs(dot(normalView, positionViewDirection))), 3.0);
  m.emissiveNode = color(r).mul(f).mul(0.9);
  return m;
}

/** A procedural scuba diver, built prone along +z, with headlamp and exhaled bubbles. */
export class DiverView {
  readonly root = new THREE.Group();
  readonly lamp: THREE.SpotLight;
  private body = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private bubbles: THREE.InstancedMesh;
  private plumb: THREE.LineSegments;
  private plumbOpacity = uniform(0);
  private lampIntensity: number;
  private bubbleState: { p: THREE.Vector3; v: number; age: number; life: number; s: number }[] = [];
  private nextBreath = 0;
  private kick = 0;
  private bank = 0;
  private pitch = 0;
  private roll = 0;
  readonly lampStrength = uniform(1);

  constructor(readonly suit: number) {
    const suitColor = new THREE.Color(SUITS[suit]?.color ?? SUITS[0].color);
    const neoprene = rimMaterial(0x1a1f22, suitColor.clone().multiplyScalar(1.4), 0.75);
    const panel = rimMaterial(suitColor, suitColor, 0.55);
    const steel = rimMaterial(0xc9c3b0, 0x9fd8d0, 0.35, 0.7);
    const rubber = rimMaterial(0x111416, 0x6a8a88, 0.8);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.62, 6, 16), neoprene);
    torso.rotation.x = Math.PI / 2;
    torso.scale.set(1.1, 1, 0.85);
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.215, 0.36, 4, 16), panel);
    stripe.rotation.x = Math.PI / 2;
    stripe.scale.set(1.12, 1, 0.87);
    stripe.position.z = 0.1;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), neoprene);
    head.position.set(0, 0.04, 0.58);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), this.glassMaterial());
    mask.rotation.x = Math.PI / 2 + 0.45;
    mask.position.set(0, 0.0, 0.66);
    mask.scale.set(1.25, 1, 0.8);

    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.5, 4, 14), steel);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 0.24, 0.0);
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), steel);
    valve.position.set(0, 0.26, 0.36);
    valve.rotation.x = Math.PI / 2;

    this.body.add(torso, stripe, head, mask, tank, valve);

    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.1, 0, -0.38);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), neoprene);
      thigh.rotation.x = Math.PI / 2;
      thigh.position.z = -0.26;
      const fin = new THREE.Mesh(this.finGeometry(), rimMaterial(suitColor.clone().multiplyScalar(0.55), suitColor, 0.5));
      fin.position.z = -0.52;
      leg.add(thigh, fin);
      this.legs.push(leg);
      this.body.add(leg);

      const arm = new THREE.Group();
      arm.position.set(side * 0.24, 0.02, 0.3);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.38, 4, 10), neoprene);
      upper.rotation.x = Math.PI / 2;
      upper.position.z = -0.18;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), rubber);
      glove.position.z = -0.4;
      arm.add(upper, glove);
      arm.rotation.set(0, side * 0.18, 0);
      this.arms.push(arm);
      this.body.add(arm);
    }

    this.root.add(this.body);

    this.lamp = new THREE.SpotLight(0xfff1d6, 60, 16, 0.42, 0.55, 1.4);
    this.lamp.position.set(0, 0.12, 0.72);
    this.lamp.target.position.set(0, -1.6, 4.5);
    this.body.add(this.lamp, this.lamp.target);
    this.lampIntensity = this.lamp.intensity;
    this.body.add(this.beamCone());
    this.plumb = this.plumbLine();

    this.bubbles = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      this.bubbleMaterial(),
      BUBBLES,
    );
    this.bubbles.frustumCulled = false;
    for (let i = 0; i < BUBBLES; i++) this.bubbleState.push({ p: new THREE.Vector3(0, -999, 0), v: 0, age: 9, life: 1, s: 0 });
  }

  /** Bubbles and the plumb line live in world space, so they stay vertical while the diver moves on. */
  get worldObjects() {
    return [this.bubbles, this.plumb];
  }

  /**
   * Shows or hides this diver. A hidden diver keeps its headlamp in the scene at zero intensity,
   * because adding or removing a light recompiles every lit material and stalls a frame.
   */
  setPresent(present: boolean) {
    for (const c of this.body.children) if (c !== this.lamp && c !== this.lamp.target) c.visible = present;
    this.lamp.intensity = present ? this.lampIntensity : 0;
    this.bubbles.visible = present;
    this.plumb.visible = present;
  }

  /** `ground` is the height of the first surface straight below the diver. */
  /** A diver out of air (`down`) rolls onto its side, stops kicking and its lamp dims. */
  update(dt: number, t: number, pos: THREE.Vector3, yaw: number, vel: THREE.Vector3, ground: number, down = false) {
    this.root.position.copy(pos);
    this.updatePlumb(pos, ground);
    const speed = Math.hypot(vel.x, vel.z);
    const targetPitch = Math.atan2(-vel.y, Math.max(0.6, speed)) * 0.9;
    this.pitch += (targetPitch - this.pitch) * (1 - Math.exp(-4 * dt));
    let dyaw = yaw - this.root.rotation.y;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.bank += (-dyaw * 2.5 - this.bank) * (1 - Math.exp(-5 * dt));
    this.root.rotation.set(0, yaw, 0);
    this.roll += ((down ? 1.9 : 0) - this.roll) * (1 - Math.exp(-3 * dt));
    this.body.rotation.set(this.pitch, 0, THREE.MathUtils.clamp(this.bank, -0.5, 0.5) + this.roll);
    this.lamp.intensity = this.lampIntensity * (down ? 0.2 : 1);
    this.lampStrength.value = down ? 0.2 : 1;
    this.body.position.y = Math.sin(t * 1.1) * 0.04;

    const effort = down ? 0 : Math.min(1, speed / 3 + Math.abs(vel.y) / 3);
    this.kick += dt * (2.2 + effort * 5.5);
    const amp = 0.12 + effort * 0.32;
    this.legs[0].rotation.x = Math.sin(this.kick) * amp;
    this.legs[1].rotation.x = Math.sin(this.kick + Math.PI) * amp;
    for (const [i, arm] of this.arms.entries()) arm.rotation.x = Math.sin(t * 0.8 + i) * 0.05;

    this.updateBubbles(dt, t);
  }

  private updateBubbles(dt: number, t: number) {
    if (t > this.nextBreath) {
      this.nextBreath = t + 3.2 + Math.random() * 1.2;
      const mouth = new THREE.Vector3(0, 0.05, 0.66).applyMatrix4(this.body.matrixWorld);
      let spawned = 0;
      for (const b of this.bubbleState) {
        if (b.age < b.life) continue;
        b.p.copy(mouth).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, Math.random() * 0.1, (Math.random() - 0.5) * 0.15));
        b.v = 0.9 + Math.random() * 0.8;
        b.age = -spawned * 0.035;
        b.life = 3 + Math.random() * 2;
        b.s = 0.018 + Math.random() * Math.random() * 0.06;
        if (++spawned > 14) break;
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.bubbleState.forEach((b, i) => {
      b.age += dt;
      if (b.age < 0 || b.age > b.life || b.p.y > -0.3) {
        m.makeScale(0, 0, 0);
      } else {
        b.p.y += b.v * dt;
        b.p.x += Math.sin(t * 5 + i) * 0.12 * dt;
        b.p.z += Math.cos(t * 4 + i * 1.3) * 0.12 * dt;
        const grow = b.s * (1 + b.age * 0.25);
        s.set(grow, grow * (0.8 + Math.sin(t * 12 + i) * 0.08), grow);
        m.compose(b.p, q, s);
      }
      this.bubbles.setMatrixAt(i, m);
    });
    this.bubbles.instanceMatrix.needsUpdate = true;
  }

  /** A faint vertical line from the diver to the ground with a small ring where it lands, so height reads in the isometric view. */
  private plumbLine() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((2 + RING * 2) * 3), 3));
    const mat = new THREE.LineBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    mat.colorNode = color(0xd8efe6);
    mat.opacityNode = this.plumbOpacity;
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  private updatePlumb(pos: THREE.Vector3, ground: number) {
    const h = pos.y - ground;
    this.plumbOpacity.value = THREE.MathUtils.smoothstep(h, 0.7, 1.6) * 0.32;
    const a = this.plumb.geometry.attributes.position as THREE.BufferAttribute;
    const y = ground + 0.04;
    a.setXYZ(0, pos.x, pos.y - 0.2, pos.z);
    a.setXYZ(1, pos.x, y, pos.z);
    for (let i = 0; i < RING; i++) {
      const a0 = (i / RING) * Math.PI * 2, a1 = ((i + 1) / RING) * Math.PI * 2;
      a.setXYZ(2 + i * 2, pos.x + Math.cos(a0) * RING_RADIUS, y, pos.z + Math.sin(a0) * RING_RADIUS);
      a.setXYZ(3 + i * 2, pos.x + Math.cos(a1) * RING_RADIUS, y, pos.z + Math.sin(a1) * RING_RADIUS);
    }
    a.needsUpdate = true;
  }

  private finGeometry() {
    const shape = new THREE.Shape();
    shape.moveTo(-0.07, 0);
    shape.lineTo(0.07, 0);
    shape.quadraticCurveTo(0.17, -0.25, 0.14, -0.46);
    shape.quadraticCurveTo(0.05, -0.4, 0, -0.44);
    shape.quadraticCurveTo(-0.05, -0.4, -0.14, -0.46);
    shape.quadraticCurveTo(-0.17, -0.25, -0.07, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.015, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 0.1);
    return g;
  }

  private glassMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0.2 });
    const f = pow(oneMinus(abs(dot(normalView, positionViewDirection))), 2.0);
    m.colorNode = color(0x0b1f22);
    m.emissiveNode = color(0x9ff3e6).mul(f.mul(1.4).add(0.08));
    return m;
  }

  private beamCone() {
    const len = 7;
    const g = new THREE.ConeGeometry(Math.tan(0.42) * len, len, 32, 1, true);
    g.translate(0, -len / 2, 0);
    g.rotateX(-Math.PI / 2 + 0.33);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    const along = uv().y;
    const edge = pow(oneMinus(abs(dot(normalView, positionViewDirection))), 1.2);
    const motes = mx_noise_float(positionLocal.mul(2.4)).mul(0.25).add(0.85);
    const fall = pow(along, 2.2).mul(oneMinus(smoothstep(0.92, 1.0, along)));
    m.colorNode = color(0xfff0cc);
    m.opacityNode = fall.mul(oneMinus(edge)).mul(motes).mul(0.12).mul(this.lampStrength);
    const cone = new THREE.Mesh(g, m);
    cone.position.set(0, 0.12, 0.72);
    cone.renderOrder = 5;
    return cone;
  }

  private bubbleMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const f = pow(oneMinus(abs(dot(normalView, positionViewDirection))), 2.5);
    m.colorNode = color(0xdff7f2).mul(f.mul(1.2).add(float(0.05)));
    return m;
  }

}
