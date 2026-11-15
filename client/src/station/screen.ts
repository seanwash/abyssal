import { ITEMS } from "../../../shared/loot/items";
import type { Category } from "../../../shared/loot/items";
import { shelf } from "../../../shared/station";
import type { Find, StationLog, StationMessage } from "../../../shared/station";
import { bold, KEYS } from "../keys";
import type { DiverSnapshot } from "../net";
import { sound } from "../sound";

const CATEGORIES: [Category, string][] = [
  ["specimen", "Specimens"],
  ["sample", "Samples"],
  ["fossil", "Fossils"],
  ["evidence", "Evidence"],
];

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const escape = (s: string) =>
  s.replaceAll(/[&<>"']/gu, (c) => `&#${c.codePointAt(0)};`);

const names = (by: Iterable<string>) => [...by].map(escape).join(" &amp; ");

/** The element in `root` matching `sel`, which the screen's own markup always has. */
const part = (root: ParentNode, sel: string) => {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) {
    throw new Error(`Station screen is missing ${sel}`);
  }
  return e;
};

/** Who climbed out, as the fresh finds' heading names them. */
const climber = (by: DiverSnapshot | undefined) => {
  if (!by) {
    return "Your buddy";
  }
  return by.local ? "You" : escape(by.name);
};

/** The footer line about the other diver, or about diving alone. */
const partnerLine = (other: DiverSnapshot | undefined, online: boolean) => {
  if (other) {
    return other.aboard
      ? `${escape(other.name)} is at the station too.`
      : `${escape(other.name)} is still in the water.`;
  }
  return online
    ? `Diving alone. ${bold(KEYS.buddy.name)} brings a bot buddy.`
    : "";
};

/**
 * The field station's screen, shown while your diver is out of the water: the finds just logged,
 * the save's stamp, and the shelf of everything the party has logged, with an empty frame for each
 * find still out there. Space or the button dives again.
 */
export class StationScreen {
  private root = document.createElement("div");
  private tally: HTMLElement;
  private fresh: HTMLElement;
  private shelf: HTMLElement;
  private stamp: HTMLElement;
  private partner: HTMLElement;
  private log: StationLog | null = null;

  constructor(onDive: () => void) {
    this.root.className = "station";
    this.root.innerHTML = `
      <div class="station-plate">
        <div class="plate-kicker">Plate II</div>
        <div class="station-title">Field Station</div>
        <div class="plate-sub">Cannery Row &middot; the wet lab on the wharf</div>
        <div class="plate-rule" aria-hidden="true"></div>
        <div class="station-tally"></div>
        <div class="station-fresh"></div>
        <div class="station-shelf"></div>
        <div class="station-foot">
          <span class="station-partner"></span>
          <span class="station-stamp"></span>
          <button type="button">Dive ${bold(KEYS.act.name)}</button>
        </div>
      </div>`;
    this.tally = part(this.root, ".station-tally");
    this.fresh = part(this.root, ".station-fresh");
    this.shelf = part(this.root, ".station-shelf");
    this.stamp = part(this.root, ".station-stamp");
    this.partner = part(this.root, ".station-partner");
    const button = part(this.root, "button");
    // Space acts, so keep it from pressing the button again.
    button.addEventListener("click", () => {
      button.blur();
      onDive();
    });
    document.body.append(this.root);
  }

  /** The server sent the log: on joining, or after a diver climbed out with its bag. */
  news(m: StationMessage, divers: DiverSnapshot[]) {
    this.log = m.log;
    this.renderShelf(m.log);
    this.renderTally(m.log);
    if (m.fresh) {
      this.renderFresh(m, m.fresh, divers);
    } else {
      this.renderWelcome(m.log);
    }
  }

  private renderTally(log: StationLog) {
    const counts = new Map<Category, number>();
    for (const f of log.finds) {
      const c = ITEMS[f.item]?.category;
      if (c) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    this.tally.innerHTML = `${CATEGORIES.map(
      ([c, label]) =>
        `<span class="cat-${c}"><b>${counts.get(c) ?? 0}</b> ${label}</span>`
    ).join(
      ""
    )}<span class="trips">${log.trips} ${log.trips === 1 ? "trip" : "trips"}</span>`;
  }

  /** No trip just ended: greets the party with when the log was last saved, or how to start one. */
  private renderWelcome(log: StationLog) {
    const last = log.finds.length
      ? `Last logged ${when(log.updated)}. Everything on the shelf is saved.`
      : "A new field log. Dive, bag what you find, and climb out at the line to log it.";
    this.fresh.innerHTML = `<div class="fresh-head">${log.finds.length ? "Welcome back" : "Field log"}</div><div class="fresh-empty">${last}</div>`;
    this.clearStamp();
  }

  /** A diver climbed out with `fresh`: lists the finds, chimes them in for your own, and stamps the save. */
  private renderFresh(
    m: StationMessage,
    fresh: Find[],
    divers: DiverSnapshot[]
  ) {
    const by = divers.find((d) => d.id === m.by);
    // Another diver climbing out empty-handed doesn't replace the finds on show.
    if (!fresh.length && !by?.local) {
      return;
    }
    const rows = fresh
      .map((f, i) => {
        const it = ITEMS[f.item];
        return `<li class="cat-${it?.category ?? "specimen"}" style="animation-delay:${0.25 + i * 0.35}s"><i>${escape(it?.latin ?? f.item)}</i><span>${escape(it?.common ?? "")}</span><span class="by">${names(f.by)}</span></li>`;
      })
      .join("");
    this.fresh.innerHTML = `<div class="fresh-head">${climber(by)} logged this trip</div>${
      rows
        ? `<ol>${rows}</ol>`
        : '<div class="fresh-empty">Nothing in the bag this trip.</div>'
    }`;
    if (by?.local) {
      for (const [i, f] of fresh.entries()) {
        setTimeout(
          () => sound.logged(ITEMS[f.item]?.category !== "specimen"),
          250 + i * 350
        );
      }
    }
    if (!fresh.length) {
      this.clearStamp();
      return;
    }
    const delay = 250 + fresh.length * 350;
    this.stamp.className = `station-stamp ${m.error ? "error" : "saved"}`;
    this.stamp.textContent =
      m.error ?? `Logged and saved · ${when(m.savedAt ?? Date.now())}`;
    this.stamp.style.animationDelay = `${delay / 1000}s`;
  }

  private clearStamp() {
    this.stamp.className = "station-stamp";
    this.stamp.textContent = "";
  }

  private renderShelf(log: StationLog) {
    const got = new Map(shelf(log).map((e) => [e.item, e] as const));
    this.shelf.innerHTML = Object.entries(ITEMS)
      .map(([key, it]) => {
        const e = got.get(key);
        if (!e) {
          return `<div class="frame empty cat-${it.category}"><span class="q">Not yet recorded</span><span class="c">${it.category}${it.pry ? " · both divers" : ""}</span></div>`;
        }
        return (
          `<div class="frame cat-${it.category}" title="${escape(it.note)}"><i>${escape(it.latin)}</i><span class="c">${escape(it.common)}</span>` +
          `<span class="n">${e.count > 1 ? `&times;${e.count}` : ""}</span><span class="d">${when(e.first)} &middot; ${names(e.by)}</span></div>`
        );
      })
      .join("");
  }

  update(divers: DiverSnapshot[], online: boolean) {
    const me = divers.find((d) => d.local);
    if (!me) {
      throw new Error("No local diver in the snapshot");
    }
    const show = me.aboard && !!this.log;
    this.root.classList.toggle("show", show);
    if (!show) {
      return;
    }
    const other = divers.find((d) => !d.local);
    const line = partnerLine(other, online);
    if (this.partner.innerHTML !== line) {
      this.partner.innerHTML = line;
    }
  }
}
