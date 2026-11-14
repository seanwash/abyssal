import * as THREE from 'three/webgpu';
import { SUITS } from '../../shared/constants';
import { AIR_MAX, PHASE, type Fx, type Target } from '../../shared/arena';
import { SPECIES } from '../../shared/creatures';
import type { CreatureSnapshot, DiverSnapshot, Net, NetStatus } from './net';

const NUMERALS = ['I', 'II', 'III', 'IV'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/** Plate-style overlay: the specimen card, specimen label, diver names and connection state. */
export class Hud {
  private root = el('div', 'hud', document.body);
  private depth: HTMLElement;
  private roster: HTMLElement;
  private status: HTMLElement;
  private label: HTMLElement;
  private leader: SVGLineElement;
  private names = new Map<string, HTMLElement>();
  private air: HTMLElement;
  private airFill: HTMLElement;
  private prompt: HTMLElement;
  private meter: HTMLElement;
  private meterFill: HTMLElement;
  private banner: HTMLElement;
  private bannerUntil = 0;
  private hint: HTMLElement;
  private hurtFlash: HTMLElement;
  private v = new THREE.Vector3();

  constructor() {
    const card = el('div', 'plate', this.root);
    el('div', 'plate-kicker', card, 'Plate I');
    el('div', 'plate-title', card, 'Test Reef');
    el('div', 'plate-sub', card, 'Monterey Bay &middot; kelp forest');
    const rule = el('div', 'plate-rule', card);
    rule.setAttribute('aria-hidden', 'true');
    const d = el('div', 'plate-depth', card, '<span class="k">Depth</span><span class="v">0.0 m</span>');
    this.depth = d.querySelector('.v')!;
    const a = el('div', 'plate-air', card, '<span class="k">Air</span><span class="bar"><span class="fill"></span></span>');
    this.air = a;
    this.airFill = a.querySelector('.fill')!;
    this.roster = el('div', 'plate-roster', card);
    this.status = el('div', 'net-status', this.root);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'leader');
    this.leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(this.leader);
    this.root.appendChild(svg);
    this.label = el('div', 'specimen', this.root,
      '<div class="specimen-no">No. 1</div><div class="specimen-latin">Chrysaora fuscescens</div><div class="specimen-common">Pacific sea nettle</div>');

    this.prompt = el('div', 'act-prompt', this.root);
    this.meter = el('div', 'act-meter', this.root, '<span class="fill"></span>');
    this.meterFill = this.meter.querySelector('.fill')!;
    this.banner = el('div', 'banner', this.root);
    this.hint = el('div', 'hint', this.root);
    this.hurtFlash = el('div', 'hurt-flash', this.root);
    el('div', 'controls', this.root, '<b>WASD</b> or <b>arrows</b> swim &nbsp; <b>Space</b> / <b>E</b> rise &nbsp; <b>Shift</b> / <b>Q</b> sink &nbsp; <b>F</b> / <b>Enter</b> act &nbsp; <b>B</b> bot buddy &nbsp; <b>M</b> mute');
  }

  update(divers: DiverSnapshot[], status: NetStatus, camera: THREE.Camera, specimen: THREE.Vector3 | null, w: number, h: number) {
    const me = divers.find((d) => d.local)!;
    this.depth.textContent = `${Math.max(0, -me.y * 1).toFixed(1)} m`;
    this.status.textContent = status === 'online' ? '' : status === 'connecting' ? 'Joining the dive…' : 'Diving solo: no server found';
    this.status.classList.toggle('show', status !== 'online');

    const rows = divers.map((d) => {
      const c = '#' + SUITS[d.suit]?.color.toString(16).padStart(6, '0');
      return `<div class="diver-row"><span class="swatch" style="background:${c}"></span><span class="n">${NUMERALS[d.suit] ?? ''}</span><span class="nm">${escape(d.name)}</span>${d.local ? '<span class="you">you</span>' : ''}</div>`;
    }).join('');
    if (this.roster.innerHTML !== rows) this.roster.innerHTML = rows;

    const live = new Set<string>();
    for (const d of divers) {
      live.add(d.id);
      let tag = this.names.get(d.id);
      if (!tag) { tag = el('div', 'name-tag', this.root); this.names.set(d.id, tag); }
      tag.textContent = d.name;
      this.v.set(d.x, d.y + 0.75, d.z).project(camera);
      tag.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      tag.style.opacity = d.local ? '0.55' : '0.95';
    }
    for (const [id, tag] of this.names) if (!live.has(id)) { tag.remove(); this.names.delete(id); }

    const near = specimen && divers.some((d) => Math.hypot(d.x - specimen.x, d.y - specimen.y, d.z - specimen.z) < 8);
    this.label.classList.toggle('show', !!near);
    this.leader.parentElement!.classList.toggle('show', !!near);
    if (specimen) {
      this.v.copy(specimen).project(camera);
      const sx = (this.v.x * 0.5 + 0.5) * w, sy = (-this.v.y * 0.5 + 0.5) * h;
      const right = sx + 120 + 250 < w;
      const lx = right ? sx + 120 : Math.max(290, sx - 120 - 240), ly = Math.min(h - 120, Math.max(70, sy - 40));
      this.label.style.transform = `translate(${lx}px, ${ly}px)`;
      this.leader.setAttribute('x1', String(sx + (right ? 30 : -30))); this.leader.setAttribute('y1', String(sy));
      this.leader.setAttribute('x2', String(right ? lx : lx + 240)); this.leader.setAttribute('y2', String(ly + 30));
    }
  }

  /** Reddens the edges of the screen for a moment when your own diver is bitten or shocked. */
  hurt() {
    this.hurtFlash.classList.remove('show');
    void this.hurtFlash.offsetWidth;
    this.hurtFlash.classList.add('show');
  }

  /** Shows a short line across the top for something that just happened in the fight. */
  event(f: Fx, divers: DiverSnapshot[], creatures: CreatureSnapshot[]) {
    const who = nameOf(f.id, divers, creatures), by = nameOf(f.by, divers, creatures);
    const line = {
      calmed: `${by} calmed ${who}. Its violet glow drains away.`,
      wrecked: `${by} wrecked ${who}.`,
      down: `${who} ${who === 'You' ? 'are' : 'is'} out of air!`,
      revived: `${by} buddy-breathed ${who === 'You' ? 'you' : who} back up.`,
      clear: `Reef clear in ${Math.round(f.t ?? 0)} s. It resets shortly.`,
      wiped: 'Both divers are down. The dive starts over.',
      reset: 'The reef resets: the sick animals and the machines are back.',
    }[f.k as string];
    if (!line) return;
    this.banner.innerHTML = line;
    this.banner.classList.add('show');
    this.bannerUntil = performance.now() + (f.k === 'clear' ? 6000 : 3200);
  }

  fight(divers: DiverSnapshot[], creatures: CreatureSnapshot[], target: Target | null, acting: boolean, net: Net, camera: THREE.Camera, w: number, h: number) {
    const me = divers.find((d) => d.local)!;
    const air = Math.max(0, me.air) / AIR_MAX;
    this.airFill.style.width = `${(air * 100).toFixed(1)}%`;
    this.air.classList.toggle('low', air < 0.25);
    if (this.bannerUntil && performance.now() > this.bannerUntil) { this.banner.classList.remove('show'); this.bannerUntil = 0; }

    const at = (p: { x: number; y: number; z: number }, lift: number) => {
      this.v.set(p.x, p.y + lift, p.z).project(camera);
      return `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    };

    // The meter follows the downed diver being revived, else the targeted machine's hull, else a sick animal's calm.
    const downed = divers.find((d) => d.down);
    const dist = (c: CreatureSnapshot) => Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z);
    const sick = creatures
      .filter((c) => SPECIES[c.kind]?.action === 'calm' && !SPECIES[c.kind].done(c))
      .sort((a, b) => dist(a) - dist(b))[0];
    const tc = target && target.kind !== 'buddy' ? creatures.find((x) => x.id === target.id) : undefined;
    let label = '', anchor: { x: number; y: number; z: number } | null = null, fill = 0, kind = '';
    if (target) {
      const d = divers.find((x) => x.id === target.id);
      label = target.kind === 'buddy' ? 'Hold <b>F</b> to buddy-breathe'
        : target.kind === 'calm' ? (tc && SPECIES[tc.kind].busy(tc) ? 'Too agitated: wait for it to settle' : 'Hold <b>F</b> to calm')
        : 'Press <b>F</b> to harpoon';
      anchor = d ?? tc ?? null;
    } else if (sick && !me.down) {
      const range = SPECIES[sick.kind].range, d = dist(sick);
      if (d < range * 2.5) {
        label = d > range ? `Swim closer to calm <span class="dist">${(d - range).toFixed(1)} m</span>` : 'Turn toward it to calm';
        anchor = sick;
      }
    }
    const calming = target?.kind === 'calm' ? tc : sick;
    let meterAnchor: { x: number; y: number; z: number } | undefined;
    if (downed) { anchor = downed; meterAnchor = downed; fill = downed.revive; kind = 'revive'; }
    else if (target?.kind === 'harpoon' && tc) { meterAnchor = tc; fill = tc.meter; kind = 'hull'; }
    else if (calming && (calming.meter > 0 || target?.kind === 'calm')) { anchor = anchor ?? calming; meterAnchor = calming; fill = calming.meter; kind = 'calm'; }
    this.prompt.innerHTML = label;
    this.prompt.classList.toggle('show', !!label && !!anchor);
    this.prompt.classList.toggle('acting', acting);
    if (anchor) this.prompt.style.transform = at(anchor, 1.2);
    this.meter.classList.toggle('show', !!kind && !!meterAnchor);
    this.meter.dataset.kind = kind;
    this.meterFill.style.width = `${(fill * 100).toFixed(1)}%`;
    if (meterAnchor) this.meter.style.transform = at(meterAnchor, 0.75);

    const partner = divers.find((d) => !d.local);
    let hint = '';
    if (me.down) hint = partner ? `Out of air. ${escape(partner.name)} can hold <b>F</b> beside you to buddy-breathe.` : 'Out of air. Press <b>B</b> for a bot buddy, or wait for the reset.';
    else if (net.phase === PHASE.clear) hint = `Reef clear. Resets in ${Math.ceil(net.phaseTime)} s.`;
    else if (air < 0.25) hint = 'Air is low: rise to the surface to refill.';
    else if (!partner && net.status === 'online') hint = 'Diving alone: press <b>B</b> for a bot buddy, or open this link in a second window.';
    if (this.hint.innerHTML !== hint) this.hint.innerHTML = hint;
    this.hint.classList.toggle('show', !!hint);
  }
}

function nameOf(id: string | undefined, divers: DiverSnapshot[], creatures: CreatureSnapshot[]) {
  if (!id) return '';
  const c = creatures.find((x) => x.id === id);
  if (c) return SPECIES[c.kind]?.name ?? c.kind;
  const d = divers.find((x) => x.id === id);
  return d ? (d.local ? 'You' : escape(d.name)) : 'Your buddy';
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
