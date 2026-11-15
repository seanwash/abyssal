/**
 * The loading plate drawn by index.html, shown from the first paint until the first frame of the
 * dive. Each step of the load fills its share of the gold rule; the shares are roughly what each step
 * takes on a first visit in Chrome on an Apple GPU, so the rule moves at an even pace.
 */
const root = document.querySelector<HTMLElement>('#loader');
const caption = root?.querySelector('.loader-step');
let before = 0.04;
let share = 0;

const show = (p: number) => {
  root?.style.setProperty('--p', p.toFixed(3));
  root?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
};

export const loader = {
  /** Starts a step that fills `of` of the rule, under `text`. */
  step(text: string, of: number) {
    performance.mark(text);
    before += share;
    share = of;
    if (caption) {caption.textContent = text;}
    show(before);
  },
  /** How far the current step is, 0 to 1. */
  progress(done: number) {
    show(before + share * Math.min(1, done));
  },
  /** Fades the plate out over the running dive, then removes it. */
  finish() {
    performance.mark('Into the water');
    show(1);
    root?.classList.add('done');
    setTimeout(() => root?.remove(), 800);
  },
  /** Takes the plate down so the error underneath is readable. */
  fail() {
    root?.remove();
  },
};
