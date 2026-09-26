// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — **GO BACK TO**, top left: the person's work, named, while an
// agent has the screen.
//
// It shows when an agent has moved the screen and the screen is not the
// person's; it names the latest screen in the history that is theirs,
// skipping every one the switcher brought up; pressing it goes there, as an
// open by the person; it goes when pressed or when the screen becomes theirs,
// and with nothing of theirs to go back to it does not show
// (*History and View Switcher*, `popups`).
//
// ALL OF THAT IS THE SWITCHER'S TO KNOW, and this is only its drawing: the
// switcher's `back` is null exactly when it must not show, and names the
// place and what it is called when it must — the page's name out of the tree
// the workspace store holds, as it is called now. The shell mounts it at the
// top left of the canvas and gives the screen under it room while it shows, so
// it never sits over a page's heading. Its dress is `.goback` in `chrome.css`,
// after the mockup's, on the palette's tokens.

/** @import { Switcher } from "../store/switcher.js" */

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** WHAT IT SAYS, spelled once so an end-to-end run can find it by its words. */
export const GO_BACK_WORDS = "Go back to";

/**
 * @param {{ h: H, switcher: Pick<Switcher, "get" | "back"> }} deps
 * @returns {() => HTMLElement | null} The button as the switcher now has it,
 *   or null when there is nothing to go back to.
 */
export function makeGoBack(deps) {
  const { h, switcher } = deps;
  /** THE BUTTON IS KEPT, and rebuilt only when what it names changes. The
   *  shell repaints on every store emit — a keystroke, a stream event — and a
   *  button replaced between the press and the release is a click the browser
   *  never fires. @type {{ name: string, el: HTMLElement } | null} */
  let held = null;
  return () => {
    const back = switcher.get().back;
    if (back === null) return null;
    if (held === null || held.name !== back.name) {
      held = {
        name: back.name,
        el: h("button.goback", {
          type: "button",
          title: GO_BACK_WORDS + " " + back.name,
          // What it goes to is read when it is pressed, not when it was drawn.
          onclick: () => switcher.back(),
        },
        h("span.go", { "aria-hidden": "true" }, "←"),
        h("span.ft", GO_BACK_WORDS + " ", h("b", back.name))),
      };
    }
    return held.el;
  };
}
