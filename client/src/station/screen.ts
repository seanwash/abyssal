import { ITEMS, type Category } from '../../../shared/loot/items';
import { shelf, type StationLog, type StationMessage } from '../../../shared/station';
import type { DiverSnapshot } from '../net';
import { sound } from '../sound';

const CATEGORIES: [Category, string][] = [['specimen', 'Specimens'], ['sample', 'Samples'], ['fossil', 'Fossils'], ['evidence', 'Evidence']];

const when = (at: number) => new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const names = (by: Iterable<string>) => [...by].map(escape).join(' &amp; ');

/**
 * The field station's screen, shown while your diver is out of the water: the finds just logged,
 * the save's stamp, and the shelf of everything the party has logged, with an empty frame for each
 * find still out there. F, Enter or the button dives again.
 */
export class StationScreen {
  private root = document.createElement('div');
  private tally: HTMLElement;
  private fresh: HTMLElement;
  private shelf: HTMLElement;
  private stamp: HTMLElement;
  private partner: HTMLElement;
  private log: StationLog | null = null;

  constructor(onDive: () => void) {
    this.root.className = 'station';
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
          <button type="button">Dive <b>F</b></button>
        </div>
      </div>`;
    this.tally = this.root.querySelector('.station-tally')!;
    this.fresh = this.root.querySelector('.station-fresh')!;
    this.shelf = this.root.querySelector('.station-shelf')!;
    this.stamp = this.root.querySelector('.station-stamp')!;
    this.partner = this.root.querySelector('.station-partner')!;
    const button = this.root.querySelector('button')!;
    // Space and Enter swim and act, so keep them from pressing the button again.
    button.addEventListener('click', () => { button.blur(); onDive(); });
    document.body.appendChild(this.root);
  }

  /** The server sent the log: on joining, or after a diver climbed out with its bag. */
  news(m: StationMessage, divers: DiverSnapshot[]) {
    this.log = m.log;
    this.renderShelf(m.log);
    const counts = new Map<Category, number>();
    for (const f of m.log.finds) {
      const c = ITEMS[f.item]?.category;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    this.tally.innerHTML = CATEGORIES.map(([c, label]) => `<span class="cat-${c}"><b>${counts.get(c) ?? 0}</b> ${label}</span>`).join('')
      + `<span class="trips">${m.log.trips} ${m.log.trips === 1 ? 'trip' : 'trips'}</span>`;

    if (!m.fresh) {
      const last = m.log.finds.length ? `Last logged ${when(m.log.updated)}. Everything on the shelf is saved.` : 'A new field log. Dive, bag what you find, and climb out at the line to log it.';
      this.fresh.innerHTML = `<div class="fresh-head">${m.log.finds.length ? 'Welcome back' : 'Field log'}</div><div class="fresh-empty">${last}</div>`;
      this.stamp.className = 'station-stamp';
      this.stamp.textContent = '';
      return;
    }
    const by = divers.find((d) => d.id === m.by);
    // Another diver climbing out empty-handed doesn't replace the finds on show.
    if (!m.fresh.length && !by?.local) return;
    const who = !by ? 'Your buddy' : by.local ? 'You' : escape(by.name);
    const rows = m.fresh.map((f, i) => {
      const it = ITEMS[f.item];
      return `<li class="cat-${it?.category ?? 'specimen'}" style="animation-delay:${0.25 + i * 0.35}s"><i>${escape(it?.latin ?? f.item)}</i><span>${escape(it?.common ?? '')}</span><span class="by">${names(f.by)}</span></li>`;
    }).join('');
    this.fresh.innerHTML = `<div class="fresh-head">${who} logged this trip</div>`
      + (rows ? `<ol>${rows}</ol>` : '<div class="fresh-empty">Nothing in the bag this trip.</div>');
    if (by?.local) m.fresh.forEach((f, i) => setTimeout(() => sound.logged(ITEMS[f.item]?.category !== 'specimen'), 250 + i * 350));
    if (!m.fresh.length) { this.stamp.className = 'station-stamp'; this.stamp.textContent = ''; return; }
    const delay = 250 + m.fresh.length * 350;
    this.stamp.className = `station-stamp ${m.error ? 'error' : 'saved'}`;
    this.stamp.textContent = m.error ?? `Logged and saved · ${when(m.savedAt ?? Date.now())}`;
    this.stamp.style.animationDelay = `${delay / 1000}s`;
  }

  private renderShelf(log: StationLog) {
    const got = new Map(shelf(log).map((e) => [e.item, e] as const));
    this.shelf.innerHTML = Object.entries(ITEMS).map(([key, it]) => {
      const e = got.get(key);
      if (!e) return `<div class="frame empty cat-${it.category}"><span class="q">Not yet recorded</span><span class="c">${it.category}${it.pry ? ' · both divers' : ''}</span></div>`;
      return `<div class="frame cat-${it.category}" title="${escape(it.note)}"><i>${escape(it.latin)}</i><span class="c">${escape(it.common)}</span>`
        + `<span class="n">${e.count > 1 ? `&times;${e.count}` : ''}</span><span class="d">${when(e.first)} &middot; ${names(e.by)}</span></div>`;
    }).join('');
  }

  update(divers: DiverSnapshot[], online: boolean) {
    const me = divers.find((d) => d.local)!;
    const show = me.aboard && !!this.log;
    this.root.classList.toggle('show', show);
    if (!show) return;
    const other = divers.find((d) => !d.local);
    const line = !other ? (online ? 'Diving alone. <b>B</b> brings a bot buddy.' : '') : other.aboard ? `${escape(other.name)} is at the station too.` : `${escape(other.name)} is still in the water.`;
    if (this.partner.innerHTML !== line) this.partner.innerHTML = line;
  }
}
