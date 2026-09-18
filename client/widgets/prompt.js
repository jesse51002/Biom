// SPDX-License-Identifier: AGPL-3.0-only
// A button that copies a piece of text. Layer 8.
//
// It is the shape of every action in the product the app itself cannot
// perform: what the terminal's help hands out is a command to copy rather than
// a button that lies about having run it. It lives in `widgets/` so that any
// layer above may draw one and none has a private copy that drifts.
//
// A prompt card used to sit beside it — a sentence to hand an agent, and a note
// under it — for the History panel. That panel is gone (2026-09-17), and the
// card with it; the button is what the dock still needs.

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** What the button says when it is not saying anything else. */
const IDLE = "Copy";

/**
 * Worth more than a bare `navigator.clipboard.writeText`. The clipboard can
 * refuse — an insecure origin, a permission policy, a gesture the browser no
 * longer considers fresh — and a button that silently does nothing is worse
 * than no button. When it refuses, the prompt is selected instead, so the next
 * keystroke is the one the user was about to press anyway.
 *
 * @param {H} h
 * @param {string} text
 * @param {HTMLElement} body the element to select if the clipboard refuses
 * @param {string} [idle] what the button says at rest
 * @returns {HTMLElement}
 */
export function copyButton(h, text, body, idle = IDLE) {
  const btn = h("button.full", { type: "button" }, idle);

  /** @param {string} said @param {number} ms */
  const say = (said, ms) => {
    btn.textContent = said;
    setTimeout(() => { btn.textContent = idle; }, ms);
  };

  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      say("Copied", 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(body);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      body.scrollIntoView({ block: "nearest" });
      say("Selected — press ⌘C", 2800);
    }
  });

  return btn;
}
