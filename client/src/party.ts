import type { Net } from './net';

const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';

function randomCode(length: number, alphabet: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * The party this tab dives with, from `?party=`. Without one the tab starts a new party and puts
 * its code in the address bar, so a reload stays in it and the address is the invite link.
 */
export const PARTY = (() => {
  const url = new URL(location.href);
  const given = (url.searchParams.get('party') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (given) return given;
  const code = randomCode(4, LETTERS);
  url.searchParams.set('party', code);
  history.replaceState(null, '', url);
  return code;
})();

/** Identifies this tab's diver across reloads and dropped connections; each tab or window is its own diver. */
export const DIVER_ID = (() => {
  const key = 'abyssal.diver';
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = randomCode(16, 'abcdefghijklmnopqrstuvwxyz0123456789');
    sessionStorage.setItem(key, id);
  }
  return id;
})();

/** Corner card with the party code, the invite link, and frame time, frame rate and ping. */
export class PartyPanel {
  private root = document.createElement('div');
  private stats: HTMLElement;
  private notice: HTMLElement;
  private frames = 0;
  private since = performance.now();

  constructor() {
    this.root.className = 'party';
    this.root.innerHTML = `
      <div class="party-row"><span class="k">Party</span><span class="code"></span><button type="button">Copy invite link</button></div>
      <div class="party-notice"></div>
      <div class="party-stats"></div>`;
    this.root.querySelector('.code')!.textContent = PARTY;
    this.stats = this.root.querySelector('.party-stats')!;
    this.notice = this.root.querySelector('.party-notice')!;
    const button = this.root.querySelector('button')!;
    button.addEventListener('click', async () => {
      // The invite never carries this tab's name, so the friend picks their own.
      const invite = new URL(location.href);
      invite.search = '';
      invite.searchParams.set('party', PARTY);
      await navigator.clipboard.writeText(invite.href).catch(() => prompt('Invite link', invite.href));
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy invite link'; }, 1500);
      // Space and Enter swim, so keep them from pressing the button again.
      button.blur();
    });
    document.body.appendChild(this.root);
  }

  update(net: Net, frameMs: number) {
    this.frames++;
    const now = performance.now();
    if (now - this.since < 500) return;
    const fps = Math.round(this.frames * 1000 / (now - this.since));
    this.frames = 0;
    this.since = now;
    const ping = net.status === 'online' ? ` · ${Math.round(net.rtt)} ms ping` : '';
    this.stats.textContent = `${frameMs.toFixed(1)} ms frame · ${fps} fps${ping}`;
    this.notice.textContent = net.notice;
  }
}
