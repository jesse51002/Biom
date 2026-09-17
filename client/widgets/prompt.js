// SPDX-License-Identifier: AGPL-3.0-only
// A prompt you copy and hand to the agent. Layer 8.
//
// This is the shape of every action in the product the app itself cannot
// perform. The change loop is asking Claude Code, so anything that would
// otherwise need a terminal — reverting a page, adapting an installed listing,
// building something that does not exist yet — arrives here as a sentence to
// copy rather than a command to run or a button that lies.
//
// It lives in `widgets/` because two layers above need it and neither may
// import the other: the marketplace's listing screen (views) and the History
// panel (shell). A private copy in each is how the two would drift into
// describing the same gesture differently.

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** What the button says when it is not saying anything else. */
const IDLE = "Copy the prompt";

/**
 * A prompt card: the sentence, and a button that puts it on the clipboard.
 *
 * @param {H} h
 * @param {string} text the prompt itself, which is also what is copied
 * @param {{ lead?: string, note?: string }} [opts]
 *   `lead` is the small label above it; `note` sits under the button.
 * @returns {HTMLElement}
 */
export function promptCard(h, text, opts = {}) {
  const body = h("p.promptbody", text);
  const card = h("div.promptcard",
    opts.lead ? h("h5", opts.lead) : null,
    body,
    copyButton(h, text, body),
    opts.note ? h("p.notyet", opts.note) : null);
  return card;
}

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
 * @param {string} [idle] what the button says at rest, for a thing that is not a prompt
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
