import * as THREE from 'three/webgpu';
import { SUITS } from '../../shared/constants';
import type { DiverSnapshot, NetStatus } from './net';

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
  private v = new THREE.Vector3();

  constructor() {
    const card = el('div', 'plate', this.root);
    el('div', 'plate-kicker', card, 'Plate I');
    el('div', 'plate-title', card, 'Cannery Row');
    el('div', 'plate-sub', card, 'Monterey Bay &middot; kelp forest');
    const rule = el('div', 'plate-rule', card);
    rule.setAttribute('aria-hidden', 'true');
    const d = el('div', 'plate-depth', card, '<span class="k">Depth</span><span class="v">0.0 m</span>');
    this.depth = d.querySelector('.v')!;
    this.roster = el('div', 'plate-roster', card);
    this.status = el('div', 'net-status', this.root);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'leader');
    this.leader = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svg.appendChild(this.leader);
    this.root.appendChild(svg);
    this.label = el('div', 'specimen', this.root,
      '<div class="specimen-no">No. 1</div><div class="specimen-latin">Chrysaora fuscescens</div><div class="specimen-common">Pacific sea nettle</div>');

    el('div', 'controls', this.root, '<b>WASD</b> swim &nbsp; <b>Space</b> rise &nbsp; <b>Shift</b> sink');
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
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
