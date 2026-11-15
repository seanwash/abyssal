import { SUITS } from "../../../shared/constants";
import { areaAt, nearestStation, toMap } from "../../../shared/level";
import type { Level, MapPoint } from "../../../shared/level";
import { bold, KEYS, presses } from "../keys";
import type { DiverSnapshot } from "../net";

import css from "./chart.css?inline";

/** Pixels per metre of the baked ground layer, which CSS scales to the chart's size. */
const PX = 6;
/** Depth between contour lines, in metres. */
const CONTOUR = 3;
/** Spacing of the depth soundings, in metres. */
const SOUNDING = 16;
/** Distance between the direction chevrons on the route, in metres. */
const CHEVRON = 28;
/** Height difference, in metres, before the buddy's label says whether they are above or below you. */
const LEVEL_BAND = 2;

/** Seafloor height at a map point, blended between the ground grid's samples. */
const heightAt = (level: Level, u: number, v: number) => {
  const g = level.ground;
  const fu = Math.min(Math.max((u - g.u0) / g.step, 0), g.nu - 1.0001);
  const fv = Math.min(Math.max((v - g.v0) / g.step, 0), g.nv - 1.0001);
  const i = Math.floor(fu);
  const j = Math.floor(fv);
  const a = fu - i;
  const b = fv - j;
  const k = j * g.nu + i;
  const h = g.height;
  return (
    (h[k] * (1 - a) + h[k + 1] * a) * (1 - b) +
    (h[k + g.nu] * (1 - a) + h[k + g.nu + 1] * a) * b
  );
};

const STIPPLE = {
  reef: [150, 176, 160, 110],
  barren: [176, 128, 196, 150],
  fill: [226, 214, 182, 140],
} as const;
const SHORE = [222, 186, 102, 235];
const CONTOUR_LINE = [201, 162, 74, 105];
const LAND_HATCH = [236, 228, 206, 70];
const LAND = [236, 228, 206, 22];

/** The stipple of whatever the ground is made of at a map point, or nothing on sand. */
const stippleAt = (level: Level, u: number, v: number) => {
  const g = level.ground;
  const s =
    Math.round((v - g.v0) / g.step) * g.nu + Math.round((u - g.u0) / g.step);
  if (g.barren[s] > 110) {
    return STIPPLE.barren;
  }
  if (g.fill[s] > 110) {
    return STIPPLE.fill;
  }
  return g.reef[s] > 110 ? STIPPLE.reef : null;
};

/** Each pixel's contour band: which `CONTOUR`-metre slice of depth it is in, or -1 on land. */
const depthBands = (level: Level, w: number, h: number) => {
  const { u0, v1 } = level.bounds;
  const band = new Int16Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const v = v1 - (y + 0.5) / PX;
    for (let x = 0; x < w; x += 1) {
      const d = -heightAt(level, u0 + (x + 0.5) / PX, v);
      band[y * w + x] = d <= 0 ? -1 : Math.floor(d / CONTOUR);
    }
  }
  return band;
};

/** Whether a pixel is on the stipple's staggered 4-pixel grid. */
const onStipple = (x: number, y: number) =>
  (x % 4 === 0 && y % 4 === 0) || ((x + 2) % 4 === 0 && (y + 2) % 4 === 0);

/**
 * The ground as a chart engraves it: land shaded, the shoreline and depth contours ruled in gold,
 * and reef, barren and dumped fill stippled, on transparent water so the dive shows through.
 */
const bakeGround = (level: Level, canvas: HTMLCanvasElement) => {
  const { u0, u1, v0, v1 } = level.bounds;
  const w = Math.round((u1 - u0) * PX);
  const h = Math.round((v1 - v0) * PX);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const band = depthBands(level, w, h);
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const k = y * w + x;
      const b = band[k];
      const right = x + 1 < w ? band[k + 1] : b;
      const below = y + 1 < h ? band[k + w] : b;
      let c: readonly number[] | null = null;
      if (b !== right || b !== below) {
        c = Math.min(b, right, below) < 0 ? SHORE : CONTOUR_LINE;
      } else if (b < 0) {
        c = (x + y) % 3 === 0 ? LAND_HATCH : LAND;
      } else if (onStipple(x, y)) {
        c = stippleAt(level, u0 + (x + 0.5) / PX, v1 - (y + 0.5) / PX);
      }
      if (c) {
        px.set(c, k * 4);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
};

const f1 = (n: number) => n.toFixed(1);

/** Points along a polyline every `gap` metres, with the direction of travel there. */
const along = (path: MapPoint[], gap: number) => {
  const out: { u: number; v: number; a: number }[] = [];
  let next = gap / 2;
  let walked = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.u - a.u, b.v - a.v);
    while (next <= walked + len) {
      const t = (next - walked) / len;
      out.push({
        u: a.u + (b.u - a.u) * t,
        v: a.v + (b.v - a.v) * t,
        a: Math.atan2(b.u - a.u, b.v - a.v),
      });
      next += gap;
    }
    walked += len;
  }
  return out;
};

const escape = (s: string) =>
  s.replaceAll(/[&<>"']/gu, (c) => `&#${c.codePointAt(0)};`);

/** Everything on the chart that never moves, as SVG in the map frame with y = -v, so north is up. */
const pts = (path: MapPoint[]) =>
  path.map((p) => `${f1(p.u)},${f1(-p.v)}`).join(" ");

const drawLines = (level: Level) => {
  const { route } = level;
  const out: string[] = [];

  for (
    let u = level.bounds.u0 + SOUNDING / 2;
    u < level.bounds.u1;
    u += SOUNDING
  ) {
    for (
      let v = level.bounds.v0 + SOUNDING / 2;
      v < level.bounds.v1;
      v += SOUNDING
    ) {
      const d = -heightAt(level, u, v);
      if (d > 1.5) {
        out.push(
          `<text class="sounding" x="${f1(u)}" y="${f1(-v)}">${Math.round(d)}</text>`
        );
      }
    }
  }
  out.push(
    `<g class="kelp">${level.kelp
      .map((k) => {
        const p = toMap(k.x, k.z);
        return `<circle cx="${f1(p.u)}" cy="${f1(-p.v)}" r="0.45"/>`;
      })
      .join("")}</g>`,
    `<g class="rock">${level.boulders
      .map((b) => {
        const p = toMap(b.x, b.z);
        return `<circle cx="${f1(p.u)}" cy="${f1(-p.v)}" r="${f1(Math.max(0.5, b.r * 0.7))}"/>`;
      })
      .join("")}</g>`,
    `<polyline class="route" points="${pts(route.main)}"/>`,
    ...route.branches.map(
      (b) => `<polyline class="route optional" points="${pts(b)}"/>`
    ),
    ...along(route.main, CHEVRON).map(
      (c) =>
        `<path class="chevron" d="M-1.3,0.9 L0,-0.6 L1.3,0.9" transform="translate(${f1(c.u)},${f1(-c.v)}) rotate(${f1((c.a * 180) / Math.PI)})"/>`
    ),
    ...route.clues.map(
      (c) => `<circle class="clue" cx="${f1(c.u)}" cy="${f1(-c.v)}" r="0.9"/>`
    )
  );
  for (const s of level.stations) {
    const p = toMap(s.x, s.z);
    out.push(
      `<g class="station" transform="translate(${f1(p.u)},${f1(-p.v)})"><line y1="-1.4" y2="2.6"/><circle r="1.4"/><text class="label" x="2.6" y="4.6">${escape(s.name)}</text></g>`
    );
  }
  for (const a of level.areas) {
    // Each label sits on the side of its beat away from the main route, judged by the nearest route
    // point more than 4 m out, so a route that starts or passes right at a beat does not decide it.
    let near = { u: a.at.u, v: a.at.v + 1e3 };
    for (const p of route.main) {
      const d = Math.hypot(p.u - a.at.u, p.v - a.at.v);
      if (d > 4 && d < Math.hypot(near.u - a.at.u, near.v - a.at.v)) {
        near = p;
      }
    }
    const north = near.v < a.at.v;
    out.push(
      `<g class="beat${a.optional ? " optional" : ""}" data-area="${escape(a.id)}" transform="translate(${f1(a.at.u)},${f1(-a.at.v)})"><circle r="2.5"/><text class="n" y="1">${a.beat}</text><text class="label" y="${north ? -7.8 : 6.6}">${escape(a.name)}</text><text class="sub" y="${north ? -4.4 : 10.4}">${escape(a.sub)}</text></g>`
    );
  }
  return out.join("");
};

/** The buddy's depth, and whether they are above or below you when it differs enough to look for them. */
const depthNote = (d: DiverSnapshot, me: DiverSnapshot) => {
  if (d.aboard) {
    return "· aboard";
  }
  const depth = `${Math.max(0, -d.y).toFixed(0)} m`;
  if (me.aboard || Math.abs(d.y - me.y) < LEVEL_BAND) {
    return `· ${depth}`;
  }
  return `· ${depth} ${d.y > me.y ? "↑ above" : "↓ below"}`;
};

/** A diver's place on the chart, as percentages of its width and height. */
interface Mark {
  el: HTMLElement;
  label: HTMLElement;
  x: number;
  y: number;
  text: string;
}

/**
 * The zone's chart, a see-through overlay toggled with Tab the way Diablo II toggles its automap,
 * so the dive keeps going under it. It shows the route and its beats, the station lines, depth as
 * contours and soundings, and both divers, with the buddy's depth against yours.
 */
export class Chart {
  private root = document.createElement("div");
  private level: Level;
  private open = false;
  private marks = new Map<string, Mark>();
  private here = "";

  constructor(level: Level) {
    this.level = level;
    document.head.append(
      Object.assign(document.createElement("style"), { textContent: css })
    );
    const { u0, u1, v0, v1 } = level.bounds;
    this.root.className = "chart";
    this.root.style.setProperty("--aspect", String((u1 - u0) / (v1 - v0)));
    this.root.innerHTML = `<div class="chart-frame"><i></i><i></i><i></i><i></i></div><div class="chart-map"><canvas></canvas><svg viewBox="${u0} ${-v1} ${u1 - u0} ${v1 - v0}" preserveAspectRatio="none"></svg><div class="chart-marks"></div></div><div class="chart-key"><span class="kick">Chart &middot; ${escape(level.name)}</span><span>Soundings and contours in metres, every ${CONTOUR} m</span><span>${bold(KEYS.chart.name)} close</span></div>`;
    document.body.append(this.root);
    // Drawn once while the loading plate is up, so the first Tab opens the chart without a hitch.
    bakeGround(level, this.root.querySelector("canvas") as HTMLCanvasElement);
    (this.root.querySelector("svg") as SVGElement).innerHTML = drawLines(level);

    addEventListener("keydown", (e) => {
      if (!presses(e, KEYS.chart) || e.target instanceof HTMLInputElement) {
        return;
      }
      // Tab would otherwise move focus to the invite button.
      e.preventDefault();
      if (!e.repeat) {
        this.open = !this.open;
        this.root.classList.toggle("show", this.open);
      }
    });
  }

  /** Moves the divers' marks and marks the beat you are in; does nothing while the chart is closed. */
  update(divers: DiverSnapshot[]) {
    if (!this.open) {
      return;
    }
    const me = divers.find((d) => d.local);
    if (!me) {
      return;
    }
    this.root.classList.toggle("aboard", me.aboard);
    const here = areaAt(this.level, me.x, me.z)?.id ?? "";
    if (here !== this.here) {
      this.here = here;
      for (const g of this.root.querySelectorAll<SVGElement>(".beat")) {
        g.classList.toggle("here", g.dataset.area === here);
      }
    }
    const live = new Set<string>();
    for (const d of divers) {
      live.add(d.id);
      this.place(d, me);
    }
    for (const [id, m] of this.marks) {
      if (!live.has(id)) {
        m.el.remove();
        this.marks.delete(id);
      }
    }
  }

  private place(d: DiverSnapshot, me: DiverSnapshot) {
    let m = this.marks.get(d.id);
    if (!m) {
      const el = document.createElement("div");
      el.className = d.local ? "chart-diver you" : "chart-diver";
      el.style.setProperty(
        "--suit",
        `#${(SUITS[d.suit]?.color ?? 0xec_e4_ce).toString(16).padStart(6, "0")}`
      );
      el.innerHTML =
        '<i class="dot"></i><i class="heading"></i><span class="label"></span>';
      (this.root.querySelector(".chart-marks") as HTMLElement).append(el);
      m = {
        el,
        label: el.querySelector(".label") as HTMLElement,
        x: -1,
        y: -1,
        text: "",
      };
      this.marks.set(d.id, m);
    }
    const { u0, u1, v0, v1 } = this.level.bounds;
    // A diver out of the water stands at the station they climbed out at.
    const at = d.aboard ? nearestStation(this.level, d.x, d.z) : d;
    const p = toMap(at.x, at.z);
    const x = ((p.u - u0) / (u1 - u0)) * 100;
    const y = ((v1 - p.v) / (v1 - v0)) * 100;
    if (Math.abs(x - m.x) > 0.02 || Math.abs(y - m.y) > 0.02) {
      m.x = x;
      m.y = y;
      m.el.style.left = `${x.toFixed(2)}%`;
      m.el.style.top = `${y.toFixed(2)}%`;
      m.el.classList.toggle("east", x > 80);
    }
    // Yaw turns from world +z toward +x; on the chart, u is east and v is north.
    const hx = Math.sin(d.yaw);
    const hz = Math.cos(d.yaw);
    m.el.style.setProperty(
      "--heading",
      `${Math.atan2(hx - hz, -(hx + hz)).toFixed(2)}rad`
    );
    m.el.classList.toggle("down", d.down);
    m.el.classList.toggle("aboard", d.aboard);
    const text = d.local ? "You" : `${d.name} ${depthNote(d, me)}`;
    if (text !== m.text) {
      m.text = text;
      m.label.textContent = text;
    }
  }
}
