import { releaseKeys } from "../input";
import { PARTY } from "../party";
import { isMuted, toggleMute } from "../sound";

import css from "./menu.css?inline";

const keys = (k: string) => k.replaceAll(/\S+/gu, "<b>$&</b>");

const CONTROLS = [
  ["W A S D", "swim, or the arrow keys"],
  ["J K", "sink, rise"],
  ["Space", "act on what the caption names"],
  ["Tab", "chart of the zone"],
  ["Alt", "hold to name every find in your light"],
  ["B", "bring or send home a bot buddy"],
  ["M", "sound on or off"],
  ["`", "developer numbers"],
  ["Esc", "this menu"],
]
  .map(([k, what]) => `<dt>${keys(k)}</dt><dd>${what}</dd>`)
  .join("");

const row = (id: string, label: string, key = "") =>
  `<button type="button" data-id="${id}"><span class="l">${label}</span><span class="v"></span>${key ? keys(key) : ""}</button>`;

/** What the HUD knows that the menu's rows show. */
export interface MenuState {
  online: boolean;
  bot: boolean;
  numbers: boolean;
}

/**
 * The menu, a paper plate in the middle of the screen that Esc opens and closes: back to the dive,
 * the party's invite, the bot buddy, sound, the developer numbers, and a page listing the controls.
 * Arrows, W and S, or Tab move between rows; Enter or Space picks one. The dive never pauses,
 * because the other diver is still in it: while the menu is open it takes every key press, so the
 * diver lets go of the swim keys and drifts, and the action key cannot fire, but air still runs.
 */
export class Menu {
  private root = document.createElement("div");
  private rows: HTMLButtonElement[];
  private value = new Map<string, HTMLElement>();
  private note: HTMLElement;
  private state: MenuState = { online: false, bot: false, numbers: false };
  private alone = false;

  constructor(actions: { buddy: () => void; numbers: () => void }) {
    document.head.append(
      Object.assign(document.createElement("style"), { textContent: css })
    );
    this.root.className = "menu";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Menu");
    this.root.innerHTML = `
      <div class="menu-plate">
        <div class="plate-kicker">Abyssal</div>
        <div class="menu-title">Menu</div>
        <div class="plate-sub">The dive goes on while this is open.</div>
        <div class="plate-rule" aria-hidden="true"></div>
        <div class="menu-list">
          ${row("back", "Back to the dive", "Esc")}
          ${row("invite", "Invite a buddy")}
          ${row("buddy", "Bot buddy", "B")}
          ${row("sound", "Sound", "M")}
          ${row("controls", "Controls")}
          ${row("numbers", "Developer numbers", "`")}
        </div>
        <div class="menu-controls">
          <dl>${CONTROLS}</dl>
          ${row("list", "Back to the menu", "Esc")}
        </div>
        <div class="menu-note"></div>
        <div class="menu-foot">${keys("↑ ↓")} choose &middot; ${keys("Enter")} pick</div>
      </div>`;
    this.rows = [...this.root.querySelectorAll("button")];
    for (const b of this.rows) {
      this.value.set(b.dataset.id ?? "", b.querySelector(".v") as HTMLElement);
      b.addEventListener("pointermove", () => {
        if (document.activeElement !== b) {
          b.focus({ preventScroll: true });
        }
      });
    }
    this.note = this.root.querySelector(".menu-note") as HTMLElement;
    this.text("invite", PARTY);
    this.text("controls", "&rsaquo;");

    const pick: Record<string, () => void> = {
      back: () => this.toggle(),
      invite: () => this.copyInvite(),
      buddy: actions.buddy,
      sound: () => {
        toggleMute();
        this.render();
      },
      numbers: actions.numbers,
      controls: () => this.page(true),
      list: () => this.page(false),
    };
    this.root.addEventListener("click", (e) => {
      const b = (e.target as Element).closest("button");
      if (b) {
        pick[b.dataset.id ?? ""]?.();
      } else if (e.target === this.root) {
        this.toggle();
      }
    });
    document.body.append(this.root);

    // Capturing on window runs before the game's own key listeners, so an open menu keeps keys from them.
    addEventListener(
      "keydown",
      (e) => {
        if (e.target instanceof HTMLInputElement) {
          return;
        }
        if (e.code === "Escape" && !e.repeat) {
          if (this.root.classList.contains("controls")) {
            this.page(false);
          } else {
            this.toggle();
          }
        } else if (!this.open) {
          return;
        } else if (e.code === "ArrowUp" || e.code === "KeyW") {
          this.move(-1, e);
        } else if (e.code === "ArrowDown" || e.code === "KeyS") {
          this.move(1, e);
        } else if (e.code === "Tab") {
          this.move(e.shiftKey ? -1 : 1, e);
        }
        e.stopPropagation();
      },
      { capture: true }
    );
  }

  get open() {
    return this.root.classList.contains("show");
  }

  /** Opens or closes the menu; it opens on the invite while you dive with no other person. */
  toggle() {
    const open = !this.open;
    this.root.classList.toggle("show", open);
    this.page(false);
    if (open) {
      releaseKeys();
      this.render();
      this.focus(this.alone ? "invite" : "back");
    } else if (this.root.contains(document.activeElement)) {
      // Space acts in the dive, so a button left focused would be pressed by it.
      (document.activeElement as HTMLElement).blur();
    }
  }

  /** Takes the party's state from the HUD each frame. */
  sync(state: MenuState, alone: boolean) {
    this.alone = alone;
    const s = this.state;
    if (
      s.online !== state.online ||
      s.bot !== state.bot ||
      s.numbers !== state.numbers
    ) {
      this.state = state;
      this.render();
    }
  }

  private render() {
    const { online, bot, numbers } = this.state;
    let buddy = bot ? "In the water" : "Off";
    if (!online) {
      buddy = "Needs the server";
    }
    this.text("buddy", buddy);
    (this.row("buddy") as HTMLButtonElement).disabled = !online;
    this.text("sound", isMuted() ? "Off" : "On");
    this.text("numbers", numbers ? "On" : "Off");
  }

  private row(id: string) {
    return this.rows.find((b) => b.dataset.id === id);
  }

  private text(id: string, html: string) {
    const v = this.value.get(id);
    if (v && v.innerHTML !== html) {
      v.innerHTML = html;
    }
  }

  private focus(id: string) {
    this.row(id)?.focus({ preventScroll: true });
  }

  /** Shows the controls page or the list of rows. */
  private page(controls: boolean) {
    this.root.classList.toggle("controls", controls);
    this.note.textContent = "";
    if (this.open) {
      this.focus(controls ? "list" : "controls");
    }
  }

  /** Moves the selection to the next or previous row on this page that can be picked, wrapping. */
  private move(by: number, e: KeyboardEvent) {
    e.preventDefault();
    const shown = this.rows.filter((b) => b.offsetParent && !b.disabled);
    const i = shown.indexOf(document.activeElement as HTMLButtonElement);
    shown.at((i + by) % shown.length)?.focus({ preventScroll: true });
  }

  private async copyInvite() {
    // The invite never carries this tab's name, so the friend picks their own.
    const link = new URL(location.href);
    link.search = "";
    link.searchParams.set("party", PARTY);
    try {
      await navigator.clipboard.writeText(link.href);
      this.text("invite", "Link copied");
      this.note.textContent = `Your buddy opens it to join party ${PARTY}.`;
    } catch {
      // Plain-http LAN addresses have no clipboard, so show the link selected for copying by hand.
      this.note.textContent = link.href;
      getSelection()?.selectAllChildren(this.note);
    }
    setTimeout(() => this.text("invite", PARTY), 2000);
  }
}
