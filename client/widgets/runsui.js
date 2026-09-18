// SPDX-License-Identifier: AGPL-3.0-only
// THE PIECES THE AUTOMATION SCREENS SHARE, one file because they are one
// screen's vocabulary drawn in three places: the line to hand your agent, with
// Copy; an editor that writes a moment after the last keystroke and says so in
// one word; and a file tree with a ＋ on the folders that take one. Layer 8,
// under the views that draw them, so `instructions.js`, `automation.js` and
// `runs.js` — siblings, with no sideways — can all reach the one drawing.
//
// NOTHING HERE TALKS TO A STORE. Each piece is handed the text it draws and a
// function to call when the person did something, and the view that owns the
// screen owns the write. That is what keeps three screens one vocabulary
// rather than three copies of it.

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** How long after the last keystroke an editor writes. Short enough that a
 *  save feels immediate, long enough that a sentence is one write. */
export const SAVE_AFTER = 700;

/** The words every screen says the same way. Spelled once. */
export const WORDS = Object.freeze({
  askTitle: "Ask your agent to make it",
  copy: "Copy",
  copied: "Copied",
  saving: "saving…",
  saved: "saved",
  failed: "could not save",
});

/**
 * THE LINE TO HAND YOUR AGENT. A lamp, a small label, the sentence with its
 * blank drawn as a lit underline, and Copy at the end — because asking an agent
 * is the path this workspace is built for and every form under it is the
 * by-hand path. `___` in the sentence becomes the blank; what is copied is the
 * sentence with the blank left as three underscores, which is what a person
 * pastes and fills.
 * @param {H} h
 * @param {string} sentence
 * @returns {HTMLElement}
 */
export function askLine(h, sentence) {
  const cut = sentence.indexOf("___");
  const parts = cut < 0
    ? [sentence]
    : [sentence.slice(0, cut), h("span.blank", { "aria-label": "blank" }), sentence.slice(cut + 3)];
  const copy = h("button.copy", { type: "button" }, WORDS.copy);
  let timer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  copy.addEventListener("click", () => {
    const write = typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard.writeText(sentence) : Promise.reject(new Error("no clipboard"));
    write.then(() => {
      copy.textContent = WORDS.copied;
      copy.setAttribute("data-done", "");
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { copy.textContent = WORDS.copy; copy.removeAttribute("data-done"); }, 1600);
    }, () => {
      // No clipboard in this document — a browser that refused, or a test —
      // and the sentence is still on the screen to select by hand.
    });
  });
  return h("div.ask",
    h("span.lamp", { "aria-hidden": "true" }),
    h("span.k", WORDS.askTitle),
    h("p.p", ...parts),
    copy);
}

/**
 * @typedef {object} EditorSpec
 * @property {string} name what the file is called, in the head
 * @property {string} where where it sits, in the head, dimmer
 * @property {string} text what it holds now
 * @property {(text: string) => Promise<void>} save called a moment after the
 *   last keystroke with the whole text; a rejection is said in the head
 * @property {string} [foot] one dim line under the text
 * @property {string} [placeholder]
 */

/**
 * ONE FILE, ONE EDITOR, AND NOTHING TO PRESS. The file is written a moment
 * after the last keystroke, the way a slot on a page is written when the caret
 * leaves it; the word at the end of the head says `saving…` and then `saved`,
 * and is the only sign. A save that fails says so in the same place and keeps
 * the text, so nothing typed is lost to a refusal.
 * @param {H} h
 * @param {EditorSpec} spec
 * @returns {{ el: HTMLElement, textarea: HTMLTextAreaElement, flush: () => Promise<void> }}
 */
export function editor(h, spec) {
  const state = h("span.saved", WORDS.saved);
  const mark = h("span.mark");
  const area = /** @type {HTMLTextAreaElement} */ (h("textarea", {
    "aria-label": spec.name,
    spellcheck: "false",
    placeholder: spec.placeholder ?? null,
  }));
  area.value = spec.text;
  let pending = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  let writing = /** @type {Promise<void> | null} */ (null);
  const write = async () => {
    pending = null;
    const text = area.value;
    state.textContent = WORDS.saving;
    state.setAttribute("data-pending", "");
    try {
      writing = spec.save(text);
      await writing;
      // Only the latest text counts as saved: a keystroke that landed while the
      // write was in flight has its own timer and its own word.
      if (area.value === text) {
        mark.removeAttribute("data-dirty");
        state.textContent = WORDS.saved;
        state.removeAttribute("data-pending");
      }
    } catch (e) {
      state.textContent = WORDS.failed + (e instanceof Error && e.message ? ": " + e.message : "");
      state.setAttribute("data-failed", "");
    } finally {
      writing = null;
    }
  };
  area.addEventListener("input", () => {
    mark.setAttribute("data-dirty", "");
    state.textContent = WORDS.saving;
    state.setAttribute("data-pending", "");
    state.removeAttribute("data-failed");
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => void write(), SAVE_AFTER);
  });
  const el = h("div.editor",
    h("div.ed-head", mark, h("span.name", spec.name), h("span.where", spec.where), state),
    area,
    spec.foot ? h("div.ed-foot", spec.foot) : null);
  return {
    el,
    textarea: area,
    /** Write now, whatever the timer says — for a screen that is about to go. */
    async flush() {
      if (pending !== null) {
        clearTimeout(pending);
        await write();
      } else if (writing !== null) {
        await writing;
      }
    },
  };
}

/**
 * @typedef {object} TreeSpec
 * @property {string} root the label on the root row
 * @property {string[]} files paths under the root, `/`-separated
 * @property {string | null} open which file is open, drawn as current
 * @property {(path: string) => void} pick
 * @property {string[]} [adds] folders that take a ＋ at the end of their row —
 *   e.g. `skills` and `code` — which asks `add` for a new file under them
 * @property {(folder: string) => void} [add]
 * @property {boolean} [dim] the whole tree in the second ink, for a root
 *   that is somebody else's until a file in it is opened
 */

/**
 * A FILE TREE DRAWN THE WAY A FILE BROWSER DRAWS ONE: folders open, files
 * under them, the open file marked current, and a ＋ at the end of the rows
 * that take a new file. Built from a flat list of paths, so what it draws is
 * exactly what the server listed and nothing here decides what a folder holds.
 * @param {H} h
 * @param {TreeSpec} spec
 * @returns {HTMLElement}
 */
export function fileTree(h, spec) {
  /** @typedef {{ name: string, path: string, dirs: Map<string, Node>, files: string[] }} Node */
  /** @type {Node} */
  const top = { name: spec.root, path: "", dirs: new Map(), files: [] };
  for (const path of spec.files) {
    const parts = path.split("/");
    let at = top;
    for (const part of parts.slice(0, -1)) {
      let next = at.dirs.get(part);
      if (next === undefined) {
        next = { name: part, path: at.path === "" ? part : at.path + "/" + part, dirs: new Map(), files: [] };
        at.dirs.set(part, next);
      }
      at = next;
    }
    at.files.push(path);
  }
  const adds = new Set(spec.adds ?? []);
  /** @param {Node} node @param {number} depth @returns {HTMLElement[]} */
  const rows = (node, depth) => {
    /** @type {HTMLElement[]} */
    const out = [];
    for (const dir of [...node.dirs.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const plus = adds.has(dir.path) && spec.add
        ? h("button.plus", { type: "button", title: "New file in " + dir.name + "/", "aria-label": "New file in " + dir.name, onclick: () => spec.add && spec.add(dir.path) }, "＋")
        : null;
      out.push(h("div.node.dir", { style: { "--depth": String(depth) } }, h("span.twist", "▾"), h("span.nm", dir.name + "/"), plus));
      out.push(...rows(dir, depth + 1));
    }
    for (const file of node.files.sort()) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      out.push(h("button.node.file", {
        type: "button",
        "aria-current": spec.open === file ? "true" : null,
        onclick: () => spec.pick(file),
        style: { "--depth": String(depth) },
      }, h("span.dot", "·"), h("span.nm", name)));
    }
    return out;
  };
  const rootRow = h("div.node.root", h("span.twist", "▾"), h("span.nm", spec.root),
    adds.has("") && spec.add ? h("button.plus", { type: "button", "aria-label": "New file", onclick: () => spec.add && spec.add("") }, "＋") : null);
  const el = h("div.tree" + (spec.dim ? ".dim" : ""), rootRow, ...rows(top, 1));
  return el;
}

/**
 * @typedef {object} NameSpec
 * @property {string} label what is being named, as a small label
 * @property {string} [value] what the field starts holding
 * @property {string} [placeholder]
 * @property {string} ok the word on the button
 * @property {(name: string) => Promise<void>} take called with the trimmed
 *   name on Enter or the button; a rejection is said beside the field and the
 *   field stays
 * @property {() => void} [cancel] Escape, or the field losing its purpose
 */

/**
 * ONE NAME, ASKED IN PLACE. Not `window.prompt`: Electron's renderer does not
 * support it and throws, so a screen that asked with one worked in a browser
 * and did nothing in the built application. This is a field where the act
 * was — a label, the input focused, one button — that takes Enter, gives up
 * on Escape, and says a refusal beside itself rather than in a dialog.
 * @param {H} h
 * @param {NameSpec} spec
 * @returns {HTMLElement}
 */
export function nameField(h, spec) {
  const input = /** @type {HTMLInputElement} */ (h("input", { type: "text", value: spec.value ?? "", placeholder: spec.placeholder ?? null, "aria-label": spec.label, spellcheck: "false" }));
  const said = h("span.said");
  const go = h("button.ok", { type: "button" }, spec.ok);
  let busy = false;
  const take = async () => {
    if (busy) return;
    const name = input.value.trim();
    if (name === "") { input.focus(); return; }
    busy = true; go.setAttribute("disabled", ""); said.textContent = "";
    try {
      await spec.take(name);
    } catch (e) {
      said.textContent = e instanceof Error && e.message ? e.message : "that could not be made";
      busy = false; go.removeAttribute("disabled"); input.focus();
    }
  };
  go.addEventListener("click", () => void take());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void take(); }
    if (e.key === "Escape" && spec.cancel) { e.preventDefault(); spec.cancel(); }
  });
  const el = h("div.namefield", h("span.lbl", spec.label), h("div.row", input, go), said);
  // Focused once it is on screen; a field nobody has to click into is the
  // whole point of asking in place.
  setTimeout(() => { if (el.isConnected) input.focus(); }, 0);
  if (spec.value) setTimeout(() => { if (el.isConnected) input.select(); }, 0);
  return el;
}

/** How much of a log's tail a row keeps for its one raw line and the whole-log
 *  flap. Older bytes fall off the front; the last line is always the last. */
export const TAIL_KEEP = 64 * 1024;
/** How many reads one draw may make of one run, so a log that grows faster
 *  than it is read cannot hold a redraw hostage. */
const READS_PER_DRAW = 32;

/**
 * @typedef {{ text: string, next: number, ended: boolean }} Tail
 */

/**
 * FOLLOW ONE RUN'S LOG, from where the last read stopped to where the log is
 * NOW. One `run.read` answers at most a chunk, and a draw that read one chunk
 * per run showed the line at the chunk's end as the run's "last line" — wrong
 * for any finished log longer than a chunk, and stuck that way until another
 * run moved. So a draw reads until the answer says nothing more arrived, and
 * keeps only the tail. A run already read to its end is not asked again.
 * @param {(id: string, stream: "stdout" | "stderr", from?: number) => Promise<{ text: string, next: number, ended: boolean }>} readRun
 * @param {Map<string, Tail>} tails
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function followLog(readRun, tails, id) {
  const had = tails.get(id) ?? { text: "", next: 0, ended: false };
  if (had.ended) return;
  let text = had.text;
  let next = had.next;
  let ended = false;
  try {
    for (let i = 0; i < READS_PER_DRAW; i++) {
      const got = await readRun(id, "stdout", next);
      text = (text + got.text).slice(-TAIL_KEEP);
      next = got.next;
      // Nothing new and the run has ended: that is the whole of it. Nothing
      // new and still running: it will say more later.
      if (got.text === "") { ended = got.ended; break; }
    }
  } catch {
    /* a run whose directory has gone; the row still draws what it had */
  }
  tails.set(id, { text, next, ended });
}

/** A clock, `mm:ss` from milliseconds; hours when there are any.
 *  @param {number} ms @returns {string} */
export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh > 0 ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
}

/** The last non-empty line of a log tail, for the row's one raw line.
 *  @param {string} text @returns {string} */
export function lastLine(text) {
  const lines = text.split("\n").filter((/** @type {string} */ l) => l.trim() !== "");
  return lines.length === 0 ? "" : lines[lines.length - 1] ?? "";
}
