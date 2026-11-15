import * as THREE from 'three/webgpu';

const SPARKS = 128;

/**
 * Glowing flecks thrown from a point: sparks off a harpooned drone, and the violet sickness that
 * rises out of a calmed animal. One instanced mesh, so a burst never adds a draw call or a material.
 */
export class Sparks {
  readonly mesh: THREE.InstancedMesh;
  private p = new Float32Array(SPARKS * 3);
  private v = new Float32Array(SPARKS * 3);
  private age = new Float32Array(SPARKS).fill(9);
  private life = new Float32Array(SPARKS).fill(1);
  private size = new Float32Array(SPARKS);
  private rise = new Float32Array(SPARKS);
  private next = 0;
  private m = new THREE.Matrix4();
  private tint = new THREE.Color();

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), mat, SPARKS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < SPARKS; i += 1) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.tint.set(0xff_ff_ff));
    }
  }

  /** `speed` is how fast flecks fly outward, `rise` how fast they drift up, `life` how long they last in seconds. */
  burst(p: ArrayLike<number>, count: number, tint: number, speed: number, rise: number, life: number, size = 0.035) {
    this.tint.set(tint);
    for (let n = 0; n < count; n += 1) {
      const i = this.next;
      this.next = (this.next + 1) % SPARKS;
      const u = Math.random() * 2 - 1; const a = Math.random() * Math.PI * 2; const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.p.set([p[0], p[1], p[2]], i * 3);
      this.v.set([Math.cos(a) * r * s, u * s, Math.sin(a) * r * s], i * 3);
      this.age[i] = 0;
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.rise[i] = rise;
      this.mesh.setColorAt(i, this.tint);
    }
    // setColorAt in the constructor created the colour buffer.
    if (this.mesh.instanceColor) {this.mesh.instanceColor.needsUpdate = true;}
  }

  update(dt: number) {
    const drag = Math.exp(-3 * dt);
    for (let i = 0; i < SPARKS; i += 1) {
      if (this.age[i] >= this.life[i]) {continue;}
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) { this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue; }
      const j = i * 3;
      this.v[j] *= drag; this.v[j + 2] *= drag;
      this.v[j + 1] = this.v[j + 1] * drag + this.rise[i] * dt * 3;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const sc = this.size[i] * (1 - k * k);
      this.m.makeScale(sc, sc, sc).setPosition(this.p[j], this.p[j + 1], this.p[j + 2]);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
