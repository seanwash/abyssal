export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const hash2 = (ix: number, iz: number, seed: number) => {
  let h = Math.imul(ix, 374_761_393) ^ Math.imul(iz, 668_265_263) ^ Math.imul(seed, 2_147_483_647);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
};

export const valueNoise2 = (x: number, z: number, seed = 1) => {
  const ix = Math.floor(x); const iz = Math.floor(z);
  const fx = x - ix; const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx); const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed); const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed); const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
};

export const fbm2 = (x: number, z: number, octaves = 4, seed = 1) => {
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  let sum = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * valueNoise2(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
};
