/**
 * Every key the game binds, by action: the keys that press it, and the name that prompts, zone
 * guides, the HUD and the menu's Controls page show for it. A key change is one edit here.
 */
export interface Binding {
  /** How prompts name the key. */
  name: string;
  /** The `KeyboardEvent.code`s that press it. */
  codes: string[];
  /** A `KeyboardEvent.key` that also presses it, for a modifier such as Alt on either side of the keyboard. */
  key?: string;
}

export const KEYS = {
  forward: { name: "W", codes: ["KeyW", "ArrowUp"] },
  left: { name: "A", codes: ["KeyA", "ArrowLeft"] },
  back: { name: "S", codes: ["KeyS", "ArrowDown"] },
  right: { name: "D", codes: ["KeyD", "ArrowRight"] },
  sink: { name: "J", codes: ["KeyJ"] },
  rise: { name: "K", codes: ["KeyK"] },
  act: { name: "Space", codes: ["Space"] },
  labels: { name: "Alt", codes: [], key: "Alt" },
  chart: { name: "Tab", codes: ["Tab"] },
  buddy: { name: "B", codes: ["KeyB"] },
  mute: { name: "M", codes: ["KeyM"] },
  numbers: { name: "`", codes: ["Backquote"] },
  menu: { name: "Esc", codes: ["Escape"] },
} satisfies Record<string, Binding>;

/** The four swim keys, in the order they are read out: W A S D. */
export const SWIM: Binding[] = [KEYS.forward, KEYS.left, KEYS.back, KEYS.right];

/** Each action's key name, plus `swim` for all four swim keys at once, as zone guides' `{action}` placeholders name them. */
export const KEY_NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(KEYS).map(([a, b]) => [a, b.name])),
  swim: SWIM.map((b) => b.name).join(""),
};

/** Whether the key event `e` is for `b`'s key. */
export const presses = (e: KeyboardEvent, b: Binding) =>
  b.codes.includes(e.code) || e.key === b.key;

/** Each key name in `names` in bold, the way prompts show keys. */
export const bold = (names: string) => names.replaceAll(/\S+/gu, "<b>$&</b>");
