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
