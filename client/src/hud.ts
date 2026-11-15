import * as THREE from 'three/webgpu';
import { SUITS } from '../../shared/constants';
import { AIR_MAX, PHASE } from '../../shared/arena';
import type { Fx, Target } from '../../shared/arena';
import { SPECIES } from '../../shared/creatures';
import { BAG_SLOTS } from '../../shared/loot/haul';
import { ITEMS } from '../../shared/loot/items';
import { BOT_ID } from '../../shared/protocol';
import type { CreatureSnapshot, DiverSnapshot, LootSnapshot, Net, NetStatus } from './net';
import { PARTY } from './party';
import { isMuted } from './sound';

const NUMERALS = ['I', 'II', 'III', 'IV'];
const finds = (n = 0) => `${n} ${n === 1 ? 'find' : 'finds'}`;
/** Seconds of diving after which the key hints stop filling an empty caption, counted across visits. */
const KEY_HINT_SECONDS = 90;
const KEYS_SEEN = 'abyssal.keys-seen';
const DEV_NUMBERS = 'abyssal.dev-numbers';
const KEYS = [['WASD', 'swim'], ['Space', 'rise'], ['Shift', 'sink'], ['F', 'act'], ['Alt', 'labels'], ['B', 'bot buddy'], ['M', 'mute']]
  .map(([k, what]) => `<span><b>${k}</b> ${what}</span>`).join(' ');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent.append(e);
  return e;
};

/** The element in `root` matching `sel`, which the HUD's own markup always has. */
const part = (root: ParentNode, sel: string) => {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) {throw new Error(`HUD is missing ${sel}`);}
  return e;
};

const setHtml = (e: HTMLElement, html: string) => {
  if (e.innerHTML !== html) {e.innerHTML = html;}
};

const capital = (s: string) => s.replace(/^the /u, '').replace(/^./u, (c) => c.toUpperCase());

const escape = (s: string) => s.replaceAll(/[&<>"']/gu, (c) => `&#${c.codePointAt(0)};`);

const localDiver = (divers: DiverSnapshot[]) => {
  const me = divers.find((d) => d.local);
  if (!me) {throw new Error('No local diver in the snapshot');}
  return me;
};

const nameOf = (id: string | undefined, divers: DiverSnapshot[], creatures: CreatureSnapshot[]) => {
  if (!id) {return '';}
  const c = creatures.find((x) => x.id === id);
  if (c) {return SPECIES[c.kind]?.name ?? c.kind;}
  const d = divers.find((x) => x.id === id);
  if (!d) {return 'Your buddy';}
  return d.local ? 'You' : escape(d.name);
};

const STATUS_TEXT: Record<NetStatus, string> = { online: '', connecting: 'Joining the dive…', offline: 'Diving solo: no server found' };

interface Point { x: number; y: number; z: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The nearest animal or machine that still needs calming, if any. */
const nearestSick = (creatures: CreatureSnapshot[], me: DiverSnapshot) => {
  const [sick] = creatures
    .filter((c) => SPECIES[c.kind]?.action === 'calm' && !SPECIES[c.kind].done(c))
    .toSorted((a, b) => distance(a, me) - distance(b, me));
  return sick;
};

/** What the action key does to `target`: `tc` is the targeted creature, `tl` the targeted loot. */
const targetAct = (target: Target, me: DiverSnapshot, tc: CreatureSnapshot | undefined, tl: LootSnapshot | undefined) => {
  const n = me.bag.length;
  if (target.kind === 'buddy') {return 'Hold <b>F</b> to buddy-breathe';}
  if (target.kind === 'calm') {return tc && SPECIES[tc.kind].busy(tc) ? 'Too agitated: wait for it to settle' : 'Hold <b>F</b> to calm';}
  if (target.kind === 'harpoon') {return 'Press <b>F</b> to harpoon';}
  if (target.kind === 'climb') {return `Press <b>F</b> to climb out${n ? ` and log ${n} ${n === 1 ? 'find' : 'finds'}` : ''}`;}
  if (n >= BAG_SLOTS) {return 'Bag full: climb out at the station to log it';}
  if (target.kind === 'pry') {return `Both divers hold <b>F</b> to pry it free <span class="dist">${tl?.hands ?? 0} of 2</span>`;}
  return 'Hold <b>F</b> to bag';
};

/** The caption's action line when nothing is targeted: the most pressing hint, whether it is an alarm, and the creature it names. */
interface Hint { act: string; alarm: boolean; named?: CreatureSnapshot }

const hint = (me: DiverSnapshot, downed: DiverSnapshot | undefined, partner: DiverSnapshot | undefined, sick: CreatureSnapshot | undefined, net: Net, air: number): Hint => {
  if (me.down) {
    return { act: partner ? `Out of air. ${escape(partner.name)} can hold <b>F</b> beside you to buddy-breathe.` : 'Out of air. Press <b>B</b> for a bot buddy, or wait for the reset.', alarm: true };
  }
  if (downed) {return { act: `Swim to ${escape(downed.name)} and hold <b>F</b> to buddy-breathe`, alarm: true };}
  if (sick && distance(sick, me) < SPECIES[sick.kind].range * 2.5) {
    const {range} = SPECIES[sick.kind];
    const d = distance(sick, me);
    return { act: d > range ? `Swim closer to calm <span class="dist">${(d - range).toFixed(1)} m</span>` : 'Turn toward it to calm', alarm: false, named: sick };
  }
  if (net.phase === PHASE.clear) {return { act: `Reef clear. Resets in ${Math.ceil(net.phaseTime)} s.`, alarm: false };}
  if (air < 0.25) {return { act: 'Air is low: rise to the surface to refill.', alarm: true };}
  if (me.bag.length >= BAG_SLOTS) {return { act: 'Bag full: climb out at the station&rsquo;s line to log it.', alarm: true };}
  if (me.bag.length) {return { act: 'Finds count once you climb out at the station&rsquo;s line to log them.', alarm: false };}
  return { act: '', alarm: false };
};

/** What the bottom caption names: a kicker, a title (italic Latin unless `roman`), and a common name. */
interface Caption { kick: string; title: string; sub: string; roman?: boolean }

/** The caption's name: the diver to revive, the find, the animal or machine, the station, or the nettle. */
const captionFor = (downed: DiverSnapshot | undefined, tc: CreatureSnapshot | undefined, tl: LootSnapshot | undefined, named: CreatureSnapshot | undefined, climbing: boolean, nettle: boolean): Caption | null => {
  const it = tl ? ITEMS[tl.item] : undefined;
  if (downed && !downed.local && !tc && !it) {return { kick: `${NUMERALS[downed.suit] ?? ''} &middot; out of air`, title: escape(downed.name), sub: '', roman: true };}
  if (it) {return { kick: `<span class="cat-${it.category}">${it.category}</span>`, title: escape(it.latin), sub: escape(it.common) + (it.pry ? ' &middot; needs both divers' : '') };}
  if (named) {
    const sp = SPECIES[named.kind];
    return sp.latin ? { kick: 'Sick animal', title: sp.latin, sub: capital(sp.name) } : { kick: 'Machine', title: capital(sp.name), sub: '', roman: true };
  }
  if (climbing) {return { kick: 'Field station', title: 'Station line', sub: 'Cannery Row', roman: true };}
  if (nettle) {return { kick: 'No. 1', title: 'Chrysaora fuscescens', sub: 'Pacific sea nettle' };}
  return null;
};

/**
 * The HUD as a specimen plate: a thin double rule around the screen, the plate and place top left,
 * depth and the party's invite top right, both divers' air bottom left, the bag bottom right, and a
 * caption at the bottom centre naming what you are near and what the action key does to it.
 */
export class Hud {
  private root = el('div', 'hud', document.body);
  private depth: HTMLElement;
  private status: HTMLElement;
  private mute: HTMLElement;
  private invite: HTMLElement;
  private inviteBot: HTMLElement;
  private ledger: HTMLElement;
  private rows: HTMLElement;
  private rowsKey = '';
  private airs: { row: Element; fill: HTMLElement; n: HTMLElement }[] = [];
  private names = new Map<string, HTMLElement>();
  private bag: HTMLElement;
  private bagSlots: HTMLElement;
  private bagCount: HTMLElement;
  private caption: HTMLElement;
  private capKick: HTMLElement;
  private capTitle: HTMLElement;
  private capSub: HTMLElement;
  private capAct: HTMLElement;
  private meter: HTMLElement;
  private meterFill: HTMLElement;
  private banner: HTMLElement;
  private bannerUntil = 0;
  private hurtFlash: HTMLElement;
  private mark: HTMLElement;
  private dev: HTMLElement;
  private nearNettle = false;
  /** Why this tab is not in the party, from the connection, shown under depth. */
  private notice = '';
  private keysLeft = localStorage.getItem(KEYS_SEEN) ? 0 : KEY_HINT_SECONDS;
  private lastFrame = performance.now();
  private frames = 0;
  private since = performance.now();
  private v = new THREE.Vector3();

  constructor() {
    el('div', 'hud-mat', this.root);
    el('div', 'hud-frame', this.root, '<i></i><i></i><i></i><i></i>');
    el('div', 'hud-place', this.root, '<div class="kick">Plate I</div><div class="title">Test Reef</div><div class="sub">Monterey Bay &middot; kelp forest</div>');

    const right = el('div', 'hud-depth', this.root, '<div class="kick">Depth</div><div class="v"></div>');
    this.depth = part(right, '.v');
    this.mute = el('div', 'hud-mute', right, 'Sound off &middot; <b>M</b>');
    this.status = el('div', 'hud-status', right);
    this.invite = el('div', 'hud-invite', right, '<div class="kick">Party</div><div class="code"></div><button type="button">Copy invite link</button>');
    part(this.invite, '.code').textContent = PARTY;
    this.inviteBot = el('div', 'bot', this.invite, 'or <b>B</b> for a bot buddy');
    const button = part(this.invite, 'button');
    button.addEventListener('click', async () => {
      // The invite never carries this tab's name, so the friend picks their own.
      const link = new URL(location.href);
      link.search = '';
      link.searchParams.set('party', PARTY);
      let copied = true;
      try { await navigator.clipboard.writeText(link.href); } catch { copied = false; }
      if (copied) {
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy invite link'; }, 1500);
      } else {
        // Plain-http LAN addresses have no clipboard, so show the link selected for copying by hand.
        button.textContent = link.href;
        getSelection()?.selectAllChildren(button);
        setTimeout(() => { button.textContent = 'Copy invite link'; }, 6000);
      }
      // Space and Enter swim, so keep them from pressing the button again.
      button.blur();
    });

    this.ledger = el('div', 'hud-ledger', this.root);
    this.rows = el('div', 'rows', this.ledger);
    el('div', 'party', this.ledger, `Party <b>${PARTY}</b>`);

    this.bag = el('div', 'hud-bag', this.root, `<div class="kick">Bag <span class="n"></span></div><div class="slots">${'<span></span>'.repeat(BAG_SLOTS)}</div>`);
    this.bagSlots = part(this.bag, '.slots');
    this.bagCount = part(this.bag, '.n');

    this.caption = el('div', 'hud-caption', this.root, '<div class="kick"></div><div class="title"></div><div class="sub"></div><div class="act"></div>');
    [this.capKick, this.capTitle, this.capSub, this.capAct] = [...this.caption.children] as HTMLElement[];

    this.meter = el('div', 'act-meter', this.root, '<span class="fill"></span>');
    this.meterFill = part(this.meter, '.fill');
    this.banner = el('div', 'hud-banner', this.root);
    this.hurtFlash = el('div', 'hurt-flash', this.root);
    this.mark = el('div', 'station-mark', this.root, '<span class="arrow">&#x2191;</span><span class="t">Station line</span>');

    this.dev = el('div', 'hud-dev', this.root);
    this.dev.classList.toggle('show', localStorage.getItem(DEV_NUMBERS) === '1');
    addEventListener('keydown', (e) => {
      if (e.code !== 'Backquote' || e.repeat) {return;}
      const on = this.dev.classList.toggle('show');
      localStorage.setItem(DEV_NUMBERS, on ? '1' : '0');
    });
  }

  update(divers: DiverSnapshot[], status: NetStatus, camera: THREE.Camera, specimen: THREE.Vector3 | null, w: number, h: number) {
    const me = localDiver(divers);
    this.depth.innerHTML = me.aboard ? 'Station' : `${Math.max(0, -me.y).toFixed(1)}<small>m</small>`;
    setHtml(this.status, this.notice || STATUS_TEXT[status]);
    this.mute.classList.toggle('show', isMuted());
    const human = divers.some((d) => !d.local && d.id !== BOT_ID);
    this.invite.classList.toggle('show', status === 'online' && !human);
    this.inviteBot.classList.toggle('show', divers.length === 1);

    const live = new Set<string>();
    for (const d of divers) {
      live.add(d.id);
      let tag = this.names.get(d.id);
      if (!tag) { tag = el('div', 'name-tag', this.root); this.names.set(d.id, tag); }
      tag.textContent = d.name;
      tag.style.display = d.aboard ? 'none' : '';
      this.v.set(d.x, d.y + 0.75, d.z).project(camera);
      tag.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      tag.style.opacity = d.local ? '0.55' : '0.95';
    }
    for (const [id, tag] of this.names) {if (!live.has(id)) { tag.remove(); this.names.delete(id); }}

    this.nearNettle = !!specimen && divers.some((d) => Math.hypot(d.x - specimen.x, d.y - specimen.y, d.z - specimen.z) < 8);
  }

  /** Frame time, frame rate and ping, on the bottom rule; the backtick key shows or hides them. */
  stats(net: Net, frameMs: number) {
    this.frames += 1;
    const now = performance.now();
    if (now - this.since < 500) {return;}
    const fps = Math.round(this.frames * 1000 / (now - this.since));
    this.frames = 0;
    this.since = now;
    const ping = net.status === 'online' ? ` · ${Math.round(net.rtt)} ms ping` : '';
    this.dev.textContent = `${frameMs.toFixed(1)} ms frame · ${fps} fps${ping}`;
    this.notice = escape(net.notice);
  }

  /** Reddens the edges of the screen for a moment when your own diver is bitten or shocked. */
  hurt() {
    this.hurtFlash.classList.remove('show');
    void this.hurtFlash.offsetWidth;
    this.hurtFlash.classList.add('show');
  }

  /** Shows a short line in the top rule for something that just happened in the dive. */
  event(f: Fx, divers: DiverSnapshot[], creatures: CreatureSnapshot[]) {
    const who = nameOf(f.id, divers, creatures); const by = nameOf(f.by, divers, creatures);
    const item = f.item ? ITEMS[f.item] : undefined;
    const latin = item ? `<i class="cat-${item.category}">${escape(item.latin)}</i>` : '';
    const line = {
      bagged: `${by} bagged ${latin}`,
      pried: `Pried free together: ${latin}`,
      dropped: `Something fell from the wreck: ${latin}`,
      returned: `${who} lost ${who === 'You' ? 'your' : 'their'} bag's ${finds(f.n)}. They drift back where they were found.`,
      // Your own climb-out shows on the station's screen, and an empty-handed one needs no news.
      aboard: f.n && who !== 'You' ? `${who} climbed out at the station with ${finds(f.n)}.` : '',
      calmed: `${by} calmed ${who}. Its violet glow drains away.`,
      wrecked: `${by} wrecked ${who}.`,
      down: `${who} ${who === 'You' ? 'are' : 'is'} out of air!`,
      revived: `${by} buddy-breathed ${who === 'You' ? 'you' : who} back up.`,
      clear: `Reef clear in ${Math.round(f.t ?? 0)} s. It resets shortly.`,
      wiped: 'Both divers are down. The dive starts over.',
      reset: 'The reef resets: the sick animals and the machines are back.',
    }[f.k as string];
    if (!line) {return;}
    this.banner.innerHTML = line;
    this.banner.classList.add('show');
    this.bannerUntil = performance.now() + (f.k === 'clear' || f.k === 'pried' ? 6000 : 3200);
  }

  fight(divers: DiverSnapshot[], creatures: CreatureSnapshot[], loot: LootSnapshot[], station: { x: number; z: number }, target: Target | null, acting: boolean, net: Net, camera: THREE.Camera, w: number, h: number) {
    const me = localDiver(divers);
    const now = performance.now();
    this.root.classList.toggle('aboard', me.aboard);
    if (this.bannerUntil && now > this.bannerUntil) { this.banner.classList.remove('show'); this.bannerUntil = 0; }

    this.renderBag(me);
    this.stationMark(me, station, target?.kind === 'climb', camera, w, h);
    this.renderLedger(divers);
    const air = Math.max(0, me.air) / AIR_MAX;

    const downed = divers.find((d) => d.down);
    const partner = divers.find((d) => !d.local);
    const sick = nearestSick(creatures, me);
    const tc = target && (target.kind === 'calm' || target.kind === 'harpoon') ? creatures.find((x) => x.id === target.id) : undefined;
    const tl = target && (target.kind === 'bag' || target.kind === 'pry') ? loot.find((x) => x.id === target.id) : undefined;

    // The action line: what the action key does now, else the most pressing hint.
    const line = target ? { act: targetAct(target, me, tc, tl), alarm: false, named: tc } : hint(me, downed, partner, sick, net, air);
    const cap = captionFor(downed, tc, tl, line.named, target?.kind === 'climb', this.nearNettle && !line.act);

    this.countKeyHints(me, now);
    const act = !cap && !line.act && this.keysLeft > 0 ? KEYS : line.act;
    this.renderCaption(cap, act, line.alarm, acting && !!target);
    this.renderMeter(downed, target, tc, sick, camera, w, h);
  }

  private renderBag(me: DiverSnapshot) {
    for (let i = 0; i < BAG_SLOTS; i += 1) {
      const slot = this.bagSlots.children[i] as HTMLElement; const item = me.bag[i];
      const cls = item ? `cat-${ITEMS[item]?.category ?? 'specimen'}` : '';
      if (slot.className !== cls) {slot.className = cls;}
    }
    this.bagCount.textContent = `${me.bag.length} / ${BAG_SLOTS}`;
    this.bag.classList.toggle('full', me.bag.length >= BAG_SLOTS);
  }

  /** One ledger row per diver, rebuilt only when who is in the dive or who is down changes, with each diver's air. */
  private renderLedger(divers: DiverSnapshot[]) {
    const key = divers.map((d) => `${d.id}:${d.name}:${d.down}`).join('|');
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows.innerHTML = divers.map((d) => {
        const c = `#${  SUITS[d.suit]?.color.toString(16).padStart(6, '0')}`;
        return `<div class="row${d.local ? ' you' : ''}"><span class="n">${NUMERALS[d.suit] ?? ''}</span><span class="nm"><span class="swatch" style="background:${c}"></span>${escape(d.name)}</span>${
           d.down ? '<span class="out">out of air</span>' : '<span class="bar"><span class="fill"></span></span><span class="pct"></span>'  }</div>`;
      }).join('');
      this.airs = [...this.rows.children].map((r) => ({ row: r, fill: r.querySelector('.fill') as HTMLElement, n: r.querySelector('.pct') as HTMLElement }));
    }
    for (const [i, d] of divers.entries()) {
      const a = this.airs[i];
      if (!a?.fill) {continue;}
      const air = Math.max(0, d.air) / AIR_MAX;
      a.fill.style.width = `${(air * 100).toFixed(1)}%`;
      a.n.textContent = String(Math.round(air * 100));
      a.row.classList.toggle('low', air < 0.25);
    }
  }

  /** Counts down the seconds of diving left before the key hints stop filling an empty caption. */
  private countKeyHints(me: DiverSnapshot, now: number) {
    if (!me.aboard && !me.down && this.keysLeft > 0) {
      this.keysLeft -= Math.min(0.1, (now - this.lastFrame) / 1000);
      if (this.keysLeft <= 0) {localStorage.setItem(KEYS_SEEN, '1');}
    }
    this.lastFrame = now;
  }

  private renderCaption(cap: Caption | null, act: string, alarm: boolean, acting: boolean) {
    setHtml(this.capKick, cap?.kick ?? '');
    setHtml(this.capTitle, cap?.title ?? '');
    setHtml(this.capSub, cap?.sub ?? '');
    setHtml(this.capAct, act);
    this.capTitle.classList.toggle('roman', !!cap?.roman);
    this.capAct.classList.toggle('alarm', alarm);
    this.capAct.classList.toggle('acting', acting);
    this.capAct.classList.toggle('keys', act === KEYS);
    this.caption.classList.toggle('show', !!cap || !!act);
    this.caption.classList.toggle('named', !!cap);
  }

  /** The meter rides on what it measures: the downed diver being revived, the targeted machine's hull, or a sick animal's calm. */
  private renderMeter(downed: DiverSnapshot | undefined, target: Target | null, tc: CreatureSnapshot | undefined, sick: CreatureSnapshot | undefined, camera: THREE.Camera, w: number, h: number) {
    const calming = target?.kind === 'calm' ? tc : sick;
    let fill = 0;
    let kind = '';
    let meterAnchor: Point | undefined;
    if (downed) { meterAnchor = downed; fill = downed.revive; kind = 'revive'; }
    else if (target?.kind === 'harpoon' && tc) { meterAnchor = tc; fill = tc.meter; kind = 'hull'; }
    else if (calming && (calming.meter > 0 || target?.kind === 'calm')) { meterAnchor = calming; fill = calming.meter; kind = 'calm'; }
    this.meter.classList.toggle('show', !!kind && !!meterAnchor);
    this.meter.dataset.kind = kind;
    this.meterFill.style.width = `${(fill * 100).toFixed(1)}%`;
    if (meterAnchor) {
      this.v.set(meterAnchor.x, meterAnchor.y + 0.75, meterAnchor.z).project(camera);
      this.meter.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
  }

  /** Points at the station's line while your bag has finds or you are near the surface: at the float when it is on screen, else from the screen's edge. */
  private stationMark(me: DiverSnapshot, station: { x: number; z: number }, climbing: boolean, camera: THREE.Camera, w: number, h: number) {
    const show = !me.aboard && !me.down && !climbing && (me.bag.length > 0 || me.y > -3);
    this.mark.classList.toggle('show', show);
    if (!show) {return;}
    this.v.set(station.x, 0.9, station.z).project(camera);
    let x = (this.v.x * 0.5 + 0.5) * w; let y = (-this.v.y * 0.5 + 0.5) * h;
    // Keeps clear of the corners of the plate, where the place, depth, air and bag sit.
    const pad = 120; const side = 340; const cx = w / 2; const cy = h / 2;
    const inside = x > pad && x < w - pad && y > pad && y < h - pad;
    let angle = 0;
    if (inside) {
      angle = Math.PI;
    } else {
      const dx = x - cx;
      const dy = y - cy;
      const k = Math.min((cx - side) / Math.abs(dx || 1e-6), (cy - pad) / Math.abs(dy || 1e-6));
      x = cx + dx * k; y = cy + dy * k;
      angle = Math.atan2(dx, -dy);
    }
    const dist = Math.hypot(me.x - station.x, me.z - station.z);
    const t = part(this.mark, '.t');
    const text = inside ? 'Station line' : `Station line ${dist.toFixed(0)} m`;
    if (t.textContent !== text) {t.textContent = text;}
    (this.mark.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${angle}rad)`;
    this.mark.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${inside ? '-100%' : '-50%'})`;
  }
}

