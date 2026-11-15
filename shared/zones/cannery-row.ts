import type { MapPoint } from "../level";
import { mapPoint } from "./build";
import type { Placer, ZonePlan } from "./build";

/**
 * Zone 1, Cannery Row: an 18-minute shore dive from San Carlos Beach, north along the breakwater
 * and west under the kelp to the ruins of a cannery. Everything is in the map frame (u metres east,
 * v metres north, with the shore to the south), laid out after the brief's map of the zone.
 *
 * The route's beats, east to west: San Carlos Beach, the Breakwater, the Kelp Corridors, McAbee
 * Boulders (optional, south toward shore), the Anchovy Line (a clue trail north-east into the
 * bay), the Urchin Barren, the Surge Gate, and the Cannery Ruins with the exit beyond them.
 */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const p = (u: number, v: number): MapPoint => ({ u, v });

/** The main route, beach to exit, kept clear of kelp so the way west reads as a corridor. */
const MAIN = [
  p(112, -24),
  p(118, -10),
  p(122, 6),
  p(112, 10),
  p(98, 2),
  p(80, -2),
  p(60, 4),
  p(40, 6),
  p(20, 4),
  p(0, 8),
  p(-18, 12),
  p(-34, 15),
  p(-50, 16),
  p(-64, 16.5),
  p(-76, 12),
  p(-92, 0),
  p(-114, -12),
];
/** The optional way down to McAbee Boulders, kept clear of kelp. */
const TO_MCABEE = [p(32, 5), p(18, -6), p(4, -16)];

/** Crevices, each a slot whose far end hides something. */
const CREVICES = {
  breakwater: { at: p(121, 5), len: 4, half: 1.6, depth: 2.4 },
  east: { at: p(98, 10), len: 4, half: 1.6, depth: 2.4 },
  west: { at: p(20, 2), len: 4, half: 1.5, depth: 2.6 },
  barren: { at: p(-30, 19), len: 3.5, half: 1.5, depth: 2.2 },
};

/** The far end of a crevice, where its find lies. */
const deep = (c: (typeof CREVICES)[keyof typeof CREVICES]) =>
  p(c.at.u, c.at.v - 0.6);

/** The nests in the Kelp Corridors: the cabezon's in a granite nook off the route, the lingcod's on it. */
const CABEZON_NEST = p(88, 6.5);
const LINGCOD_NEST = p(46, 5);

/** Where the ammonite lies in McAbee's rubble. */
const AMMONITE = p(2, -20);

/** The Surge Gate: a granite wall across the zone with one gap, at this u. */
const GATE_U = -64;
const GATE = { v0: 13, v1: 20 };

const LANES = [
  { path: MAIN.slice(2, 12), half: 2.6 },
  {
    path: [p(104, -6), p(80, -10), p(56, -6), p(36, -6), p(14, -8), p(0, -2)],
    half: 2.2,
  },
  { path: TO_MCABEE, half: 1.8 },
  { path: MAIN.slice(13), half: 2.4 },
];

const rocks = (z: Placer) => {
  // The breakwater: riprap from the beach out past its tip, breaking the surface.
  z.wall(p(130, -40), p(133, 14), 2.6);
  z.field({ at: p(125, -8), ru: 4, rv: 18 }, 22, 0.7, 1.8, { sy: 0.7 });
  z.field({ at: p(118, 10), ru: 6, rv: 5 }, 6, 0.6, 1.4);

  // Granite reef in the Kelp Corridors.
  for (const r of [
    { at: p(98, 6), ru: 8, rv: 5, n: 12 },
    { at: p(74, -6), ru: 7, rv: 4, n: 8 },
    { at: p(44, 10), ru: 9, rv: 5, n: 12 },
    { at: p(18, -2), ru: 8, rv: 5, n: 10 },
    { at: p(-12, 4), ru: 6, rv: 4, n: 6 },
  ]) {
    z.field(r, r.n, 0.6, 2.2, { avoid: LANES });
  }
  // The lingcod's rocks, sheltering its nest from the north.
  // The cabezon's nook: granite behind the nest to the north, where he lies on the rock.
  z.rock(CABEZON_NEST.u - 0.5, CABEZON_NEST.v + 2.4, 1.5, 0.7);
  z.rock(CABEZON_NEST.u + 2.2, CABEZON_NEST.v + 1.2, 1, 0.75);
  const den = z.rock(47, 8.5, 2.2, 0.65);
  z.onTop(den, 1.2, 0.8, 0.3, -0.2);
  z.rock(44, 9.5, 1.6, 0.7);

  // McAbee Boulders: pale fill heaped on the granite, nothing like the rock around it.
  // A nook in the heap, open to the south so the camera sees into it, holds the ammonite.
  z.field({ at: p(2, -20), ru: 6, rv: 4 }, 26, 0.35, 1.3, {
    stone: "fill",
    sy: 0.6,
    avoid: [{ path: [AMMONITE, p(AMMONITE.u, AMMONITE.v - 6)], half: 1.5 }],
  });
  z.field({ at: p(-8, -16), ru: 4, rv: 4 }, 5, 1, 2);
  z.field({ at: p(12, -14), ru: 4, rv: 3 }, 4, 1, 1.8);

  // A few rocks standing out of the Urchin Barren.
  z.field({ at: p(-34, 15), ru: 12, rv: 7 }, 7, 0.7, 1.8, { avoid: LANES });

  // The Surge Gate's wall, with its one gap.
  z.wall(p(GATE_U, -36), p(GATE_U, GATE.v0), 2.4);
  z.wall(p(GATE_U, GATE.v1), p(GATE_U, 76), 2.4);

  // Slabs of the cannery's foundations, until its walls and pilings are built.
  z.field({ at: p(-98, -4), ru: 12, rv: 8 }, 10, 1, 2.4, {
    stone: "fill",
    sy: 0.35,
    avoid: LANES,
  });
};

export const CANNERY_ROW: ZonePlan = {
  name: "Cannery Row",
  seed: 7,
  bounds: { u0: -122, u1: 134, v0: -40, v1: 72 },
  shore: (u) => -34 - 2 * smooth(40, 0, Math.abs(u)) + 8 * smooth(-50, -100, u),
  depth: (offshore) =>
    Math.max(-3, offshore < 15 ? offshore * 0.4 : 6 + (offshore - 15) * 0.17),
  mounds: [
    // The breakwater's toe and the reef around it.
    { at: p(124, -6), ru: 7, rv: 20, h: 1.4, ground: "reef" },
    // Granite reef under the kelp.
    { at: p(98, 6), ru: 9, rv: 6, h: 2, ground: "reef" },
    { at: CABEZON_NEST, ru: 4, rv: 3.5, h: 0.6, ground: "reef" },
    { at: p(74, -6), ru: 8, rv: 5, h: 1.5, ground: "reef" },
    { at: p(44, 10), ru: 10, rv: 6, h: 2.2, ground: "reef" },
    { at: p(18, -2), ru: 9, rv: 6, h: 1.8, ground: "reef" },
    { at: p(-12, 4), ru: 7, rv: 5, h: 1.2, ground: "reef" },
    // McAbee's heap of dumped fill.
    { at: p(2, -20), ru: 8, rv: 5.5, h: 1.8, ground: "fill" },
    // The barren is reef grazed bare.
    { at: p(-34, 15), ru: 15, rv: 8, h: 1, ground: "barren" },
    // The cannery's footing.
    { at: p(-98, -4), ru: 14, rv: 9, h: 1, ground: "fill" },
  ],
  ridges: [
    { from: p(131, -44), to: p(133, 16), half: 9, top: -1.5, ground: "reef" },
    {
      from: p(GATE_U, -44),
      to: p(GATE_U, GATE.v0 - 2),
      half: 6,
      top: -3,
      ground: "reef",
    },
    {
      from: p(GATE_U, GATE.v1 + 2),
      to: p(GATE_U, 90),
      half: 6,
      top: -3,
      ground: "reef",
    },
  ],
  crevices: Object.values(CREVICES),
  paint: [{ at: p(-34, 15), ru: 16, rv: 9, kind: "barren" }],
  groves: [
    { at: p(118, 12), ru: 8, rv: 7, n: 24 },
    { at: p(86, 0), ru: 26, rv: 14, n: 150 },
    { at: p(30, 5), ru: 28, rv: 15, n: 160 },
    { at: p(-2, -12), ru: 14, rv: 8, n: 40 },
    { at: p(-98, 12), ru: 10, rv: 7, n: 26 },
  ],
  lanes: LANES,
  clearings: [
    { ...p(112, -22), r: 5 },
    { ...LINGCOD_NEST, r: 3 },
    { ...CABEZON_NEST, r: 2.5 },
  ],
  stations: [
    { id: "beach", name: "San Carlos Beach", at: p(112, -23) },
    { id: "exit", name: "Cannery Row exit", at: p(-114, -12) },
  ],
  areas: [
    {
      id: "beach",
      beat: 1,
      name: "San Carlos Beach",
      sub: "Shore entry",
      minutes: 1,
      at: p(112, -22),
      r: 11,
      light: { water: 0x35_60_4f, dark: 0.7, reach: 1.7, sun: 1 },
    },
    {
      id: "breakwater",
      beat: 2,
      name: "The Breakwater",
      sub: "Sea lions hauled out above",
      minutes: 3,
      at: p(122, 0),
      r: 15,
      light: { water: 0x2f_5a_4c, dark: 0.78, reach: 1.45, sun: 0.9 },
    },
    {
      id: "kelp",
      beat: 3,
      name: "Kelp Corridors",
      sub: "Lingcod and cabezon nests",
      minutes: 3,
      at: p(58, 2),
      r: 46,
      light: { water: 0x34_48_26, dark: 0.85, reach: 1.2, sun: 0.75 },
    },
    {
      id: "mcabee",
      beat: 4,
      name: "McAbee Boulders",
      sub: "Optional · the ammonite",
      minutes: 3,
      optional: true,
      at: p(2, -19),
      r: 12,
      light: { water: 0x30_48_3c, dark: 0.82, reach: 1.3, sun: 0.8 },
    },
    {
      id: "anchovy",
      beat: 5,
      name: "The Anchovy Line",
      sub: "Clue trail toward Moss Landing",
      minutes: 2,
      at: p(90, 44),
      r: 30,
      light: { water: 0x10_28_3a, dark: 0.9, reach: 1.05, sun: 0.5 },
    },
    {
      id: "barren",
      beat: 6,
      name: "Urchin Barren",
      sub: "A red herring",
      minutes: 2,
      at: p(-34, 15),
      r: 17,
      light: { water: 0x2c_4a_48, dark: 0.8, reach: 1.3, sun: 0.9 },
    },
    {
      id: "surge",
      beat: 7,
      name: "Surge Gate",
      sub: "Co-op: anchor and swim",
      minutes: 1,
      at: p(GATE_U, 16.5),
      r: 10,
      light: { water: 0x18_32_38, dark: 0.9, reach: 1.05, sun: 0.5 },
    },
    {
      id: "ruins",
      beat: 8,
      name: "Cannery Ruins",
      sub: "Boss · giant Pacific octopus",
      minutes: 3,
      at: p(-98, -2),
      r: 26,
      light: { water: 0x05_0b_10, dark: 0.95, reach: 0.95, sun: 0.2 },
    },
  ],
  rocks,
  populate: (z) => {
    const drone = [
      mapPoint(-20, 16, -4.5),
      mapPoint(-40, 22, -5),
      mapPoint(-46, 10, -4),
      mapPoint(-28, 6, -4.5),
    ];
    const lie = (id: string, item: string, at: MapPoint) => ({
      id,
      item,
      at: z.onFloor(at.u, at.v, 0.08),
    });
    return {
      spawns: [mapPoint(110, -21, -2), mapPoint(114, -21, -2)],
      creatures: [
        {
          id: "lingcod",
          kind: "lingcod",
          at: z.onFloor(LINGCOD_NEST.u, LINGCOD_NEST.v),
        },
        {
          id: "cabezon",
          kind: "cabezon",
          at: z.onFloor(CABEZON_NEST.u, CABEZON_NEST.v),
        },
        // Schools over each nest scatter when its guard starts hunting; a third mills in open kelp.
        { id: "rockfish-cabezon", kind: "rockfish", at: z.onFloor(89, 5, 3.5) },
        { id: "rockfish-lingcod", kind: "rockfish", at: z.onFloor(48, 3, 3.5) },
        { id: "rockfish-kelp", kind: "rockfish", at: z.onFloor(68, 0, 4) },
        { id: "drone", kind: "drone", at: drone[0], route: drone },
      ],
      loot: [
        // On open sand by the line, so the first find teaches bagging.
        lie("urchin-beach", "urchin-test", p(108, -18)),
        lie("abalone-breakwater", "abalone-shell", p(126, -10)),
        lie("abalone-den", "abalone-shell", deep(CREVICES.breakwater)),
        lie("snail-east", "turban-snail", p(92, -4)),
        lie("snail-west", "turban-snail", p(26, 11)),
        lie("star-crevice", "sunflower-star", deep(CREVICES.east)),
        lie("star-west", "sunflower-star", deep(CREVICES.west)),
        lie("ammonite", "ammonite", AMMONITE),
        lie("bloom-anchovy", "bloom-sample", p(99, 51)),
        lie("urchin-barren", "urchin-test", p(-36, 13)),
        lie("urchin-crevice", "urchin-test", deep(CREVICES.barren)),
      ],
      jellies: [
        { ...mapPoint(70, 22, -5), scale: 0.7, phase: 0, hero: false },
        { ...mapPoint(84, 34, -7), scale: 1.25, phase: 3.3, hero: true },
        { ...mapPoint(104, 50, -6), scale: 0.6, phase: 6.1, hero: false },
      ],
    };
  },
};
