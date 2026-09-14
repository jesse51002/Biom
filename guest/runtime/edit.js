// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/edit.js — the edit wave. A classic script sharing globals; see
 * registry.js for why there are no imports in here.
 *
 * THE WORDS TAKE A CARET AND NOTHING ELSE DOES. Click a paragraph and type; the
 * page is editable the moment it is drawn and there is nothing to press first.
 * What used to sit beside that — a menu on every section's corner, a grip to
 * drag one, a `+` at every seam, a grip on every list item — is gone. Sections
 * are structure an agent writes, and rearranging them is a sentence you hand the
 * agent rather than a gesture you make over the page. So this file draws NOTHING
 * over the page: no overlay, no chrome, no hit-testing of where the pointer is.
 *
 * WHAT THIS FILE DOES NOT DO IS ADD OR REMOVE THE PARTS INSIDE A SECTION, and
 * that is a division of labour rather than a gap. Adding a column to a
 * comparison, or taking a row off a ledger, looks like something in that
 * section's own design — so the section draws it, out of its own markup, with
 * `ctx.read` and `ctx.write`. A generated page that offers no way to add or
 * remove its parts is an unfinished page, and the checker says so.
 *
 * LIVE PREVIEW, WHICH IS WHY THE STORED MARKDOWN SURVIVES.
 *
 * The SLOT under the caret shows its RAW markdown — the whole part, every block
 * and the blank lines between them — and every other slot stays rendered. So
 * the thing being edited is the source: `{{quarter}}` is four words of template
 * while you are in the slot and the value everywhere else, and any HTML the
 * author wrote is the HTML they wrote.
 *
 * The alternative was contenteditable over the RENDERED output, which reads
 * better in a screenshot and destroys data: saving means serialising HTML back
 * to markdown, and the first keystroke in a paragraph holding `{{rate}}` writes
 * `62` over the top of the variable with nothing on screen to say a variable was
 * ever there. markdown.js's own header names that failure; this file is the
 * design that avoids it rather than the one that manages it.
 *
 * EACH BLOCK IS DRAWN AT ITS OWN TYPE, LIVE. `def.blocks(source)` answers
 * character ranges and the TAG the renderer would draw each one as, and
 * markdown.js implements it off markdown-it's own token map, so a fenced code
 * block containing a blank line is one block and a list is one block. The open
 * slot is the slot's own element made editable, holding one child per block —
 * an `<h1>` holding `# Title`, a `<p>` holding the paragraph — and one per gap
 * between them. Nothing is mirrored and no size is named: the page's type scale
 * already styles `[data-g-md] h1`, the section's own CSS already says
 * `.head > h1`, and the segments are exactly where the rendered blocks were. So
 * a heading's source is heading-sized while it is open, and typing `# ` in front
 * of a paragraph makes it one as you type, with the caret where it was.
 *
 * THE STORED SOURCE IS THE EDITOR'S TEXT. Every segment holds an exact substring
 * of the source and nothing else, a block owns the newline that ends its last
 * line, and the gaps hold whatever whitespace sits between blocks — so reading
 * the children back in order IS the source, and somebody's spacing comes back
 * as they left it. The reader trims exactly one thing: the placeholder `<br>` a
 * contenteditable keeps after a trailing newline, which nobody typed.
 *
 * THE RESIDUAL: rebuilding the children when a block changes shape is a DOM
 * replacement, and the browser's native undo does not survive one. Undo works
 * within a run of ordinary typing and is lost across the keystroke that turned a
 * paragraph into a heading. That is accepted rather than fixed, because the
 * alternative is an undo stack of our own.
 *
 * NOTHING IN HERE IS A SECURITY BOUNDARY. It runs in the same realm as every
 * section on the page and holds `rt.page` in a closure, which section code
 * cannot name but shares globals with. The browser-enforced wall is between the
 * box and the app.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** How long after the last keystroke the text goes to disk. Long enough that a
   *  sentence is one write, short enough that closing the lid loses nothing.
   *
   *  ─────────────────────────────────────────────────────────────────────────
   *  DISK WINS, AND THIS TIMER IS THE ONE THING THAT COULD STOP IT
   *  ─────────────────────────────────────────────────────────────────────────
   *
   *  When a file changes outside the app the page redraws from disk, the slot
   *  under the caret included. A person typing at that moment loses their caret
   *  and whatever this timer had not yet written; they see the agent's text and
   *  type again. Nothing is held, merged or offered back.
   *
   *  THE ONE THING THAT REQUIRES: A SAVE BELONGING TO A REDRAWN EDITOR IS
   *  DROPPED, NEVER WRITTEN. Otherwise this fires 350 ms after the redraw and
   *  the person's stale text lands on top of the agent's, which is the exact
   *  opposite of the rule.
   *
   *  IT IS ALREADY TRUE, FOR FREE, ON ONE PATH AND ONLY THAT PATH. This is a
   *  `setTimeout` in the box's own realm, and an automatic redraw goes through
   *  `reloadPage` in `client/store/workspace.js`, which sets the page to null
   *  and emits before it reads — which tears the frame down (`client/frame/
   *  frame.js`: *only a changed html, `drop` and `reloadPage` tear one down*).
   *  The realm goes, and a timer in a realm that has gone does not fire.
   *
   *  SO THE RULE IS ABOUT THE OTHER SIDE, and it is written here because this is
   *  where the next person to change it will be reading: **an automatic redraw
   *  must go through `reloadPage`, never through a cheaper redraw.** A frame is
   *  REUSED while its html is unchanged, so a path written to stop the flicker
   *  would leave this box alive with this timer armed. That failure is invisible
   *  until it happens and it happens to somebody who was mid-sentence.
   *
   *  WHAT IS NOT FIXED, STATED: a `page.write` already on the port has been
   *  SENT. The frame going away means the answer arrives nowhere, not that the
   *  write is cancelled. Last write to disk wins and the redraw after it shows
   *  that. The wider problem is `Architecture/Surviving_Concurrent_Change`; this
   *  makes the loss small and visible instead of silent and stale. */
  const SAVE_AFTER = 350;

  /** Tags that stand for a line ending when text is read back out of a
   *  contenteditable. Chrome's `plaintext-only` mode has used both a `<div>` per
   *  line and bare newlines depending on version, so both are handled rather
   *  than one being assumed. */
  const LINEY = new Set(["DIV", "P", "BR"]);

  /** The tags a block segment may be drawn as. Anything else a block reports —
   *  `table`, `hr`, the empty tag of an html block — opens as a paragraph, which
   *  is the right size for source that has no size of its own. */
  const SEG_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "blockquote", "ul", "ol"]);

  /* ── chrome ────────────────────────────────────────────────────────────── */

  /** Every colour here is a token or a mix of one. The box is handed the palette
   *  by the shim, so `var(--ink)` resolves; the fallbacks exist for the bare
   *  frame the runtime is verified in, which has no shim and therefore no
   *  palette, and they are greys rather than an opinion.
   *
   *  `[data-g-src]` is the SLOT while it is open, so nothing here sets its
   *  display: a slot a section laid out as a grid keeps its grid. */
  const CSS = `
[data-g-src] {
  min-height: 1.4em;
  outline: 0;
  caret-color: var(--cyan, #1543D6);
  background: color-mix(in srgb, var(--cyan, #1543D6) 5%, transparent);
  box-shadow: -0.75rem 0 0 color-mix(in srgb, var(--cyan, #1543D6) 5%, transparent);
  border-radius: 1px;
}
[data-g-src] [data-g-seg] {
  white-space: pre-wrap;
  overflow-wrap: break-word;
  /* THE SOURCE'S OWN BLANK LINES ARE THE SPACING while it is open. A block keeps
     its size, its weight and its colour, and gives up its margin: the gap
     segments hold the newlines a person actually typed, and a rendered margin on
     top of them would space the source twice and read as nothing in the file. */
  margin: 0;
  /* An indent belongs to a marker the browser drew. A raw list item and a raw
     quote line carry their own, so the segment sits flush with everything else.
     (No backticks in here: this block is a template literal.) */
  padding-inline: 0;
  margin-inline: 0;
}
[data-g-blank] { min-height: 1.4em; cursor: text; }
[data-g-blank]::after {
  content: attr(data-g-blank);
  opacity: 0.38;
  font-style: italic;
  pointer-events: none;
}

`;

  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const el = document.createElement("style");
    el.setAttribute("data-g-edit-chrome", "");
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /** @param {string} message @param {unknown} [err] */
  function say(message, err) {
    if (typeof rt.report === "function") rt.report(message, err);
    else console.error("[biom] " + message, err || "");
  }

  /* ── segments: the open slot's children ────────────────────────────────── */

  /**
   * @typedef {object} Seg
   * @property {"blk" | "gap"} kind
   * @property {string} tag the element it is drawn as
   * @property {number} from
   * @property {number} to
   */

  /**
   * Cut the source into segments that COVER it: one per block, drawn as the
   * block's own tag, and one per gap between blocks. Joining the slices back in
   * order is the source again, and that identity is what the whole design
   * rests on.
   *
   * A BLOCK OWNS THE NEWLINE THAT ENDS ITS LAST LINE. A pre-wrap block draws no
   * extra line for a trailing newline, so a gap of k newlines after it reads as
   * exactly k blank lines on screen — which is what the same source looks like
   * in a file.
   *
   * @param {string} text @param {{start: number, end: number, tag?: string}[]} ranges
   * @returns {Seg[]}
   */
  function segments(text, ranges) {
    /** @type {Seg[]} */
    const out = [];
    let pos = 0;
    ranges.forEach((range, i) => {
      if (range.start > pos) out.push({ kind: "gap", tag: "div", from: pos, to: range.start });
      let to = text.indexOf("\n", range.end);
      to = to < 0 ? text.length : to + 1;
      const next = ranges[i + 1];
      if (next && to > next.start) to = next.start;
      const tag = range.tag && SEG_TAGS.has(range.tag) ? range.tag : "p";
      out.push({ kind: "blk", tag: tag, from: range.start, to: to });
      pos = to;
    });
    if (pos < text.length) out.push({ kind: "gap", tag: "div", from: pos, to: text.length });
    return out;
  }

  /**
   * One segment as an element holding exactly its slice.
   *
   * A list opens at list size — the scale and a section's `.cards li` both aim
   * at `li` — but WITHOUT its marker column: raw `- one` carries its own marker,
   * and the indent belongs to the one the browser would have drawn.
   *
   * @param {Seg} seg @param {string} text @returns {HTMLElement}
   */
  function build(seg, text) {
    const el = document.createElement(seg.tag);
    el.setAttribute("data-g-seg", seg.kind);
    const words = document.createTextNode(text.slice(seg.from, seg.to));
    if (seg.tag === "ul" || seg.tag === "ol") {
      // The marker is in the source — `- one` — so the drawn one would be a
      // second bullet beside it. The indent goes with it; the stylesheet flattens
      // the padding for every segment.
      el.style.setProperty("list-style", "none");
      const li = document.createElement("li");
      li.setAttribute("data-g-seg", "in");
      li.style.setProperty("list-style", "none");
      li.appendChild(words);
      el.appendChild(li);
    } else {
      el.appendChild(words);
    }
    return el;
  }

  /** The one text node a segment element holds, or null once the browser has
   *  put anything else inside it.
   *  @param {Element} el @returns {Text | null} */
  function textNodeOf(el) {
    /** @type {Node | null} */
    let node = el;
    while (node && node.nodeType === 1 && node.childNodes.length === 1) {
      /** @type {Node | null} */
      const kid = node.firstChild;
      if (!kid) return null;
      if (kid.nodeType === 3) return /** @type {Text} */ (kid);
      if (kid.nodeType === 1 && /** @type {Element} */ (kid).getAttribute("data-g-seg") === "in") {
        node = kid;
        continue;
      }
      return null;
    }
    return null;
  }

  /* ── reading a contenteditable back out as text ────────────────────────── */

  /**
   * The text a person typed, with line endings, WITHOUT asking for layout —
   * and where every node's text starts and ends, so the caret can be found.
   *
   * `innerText` is the obvious answer and it is measured to be the wrong one
   * here: it is defined in terms of rendered boxes, so in a browser that has
   * laid nothing out it returns the empty string — which would save an empty
   * slot over somebody's writing and look like the editor eating text.
   * `textContent` has the opposite fault and drops every line break. So the
   * nodes are walked and the line breaks put back from the markup.
   *
   * OUR OWN SEGMENTS ARE TRANSPARENT: they hold exact slices, newlines and all,
   * so an element boundary between two of them means nothing. What the browser
   * inserts on its own — a `<div>` or a `<br>` for Enter — still means a line.
   *
   * @param {Element} host
   * @returns {{ text: string, starts: Map<Node, number>, ends: Map<Node, number> }}
   */
  function read(host) {
    let out = "";
    /** @type {Map<Node, number>} */
    const starts = new Map();
    /** @type {Map<Node, number>} */
    const ends = new Map();
    /** @type {Element | null} */
    let lastBr = null;
    /** @param {Node} node @param {boolean} top @returns {void} */
    const walk = (node, top) => {
      for (const kid of Array.from(node.childNodes)) {
        // AT THE HOST'S OWN LEVEL, ONLY OUR SEGMENTS ARE WORDS. A section may put
        // furniture inside the region it owns — the shipped list section paints a
        // delete button into every item and puts it BACK whenever the item is
        // redrawn — and reading that would fold its glyph into somebody's
        // markdown and save it there. Text and a `<br>` still count, because
        // those are what a browser leaves behind when a person types.
        if (top && kid.nodeType === 1 && !(/** @type {Element} */ (kid)).hasAttribute("data-g-seg")
            && (/** @type {Element} */ (kid)).tagName !== "BR") continue;
        starts.set(kid, out.length);
        if (kid.nodeType === 3) {
          out += kid.nodeValue || "";
          ends.set(kid, out.length);
          lastBr = null;
          continue;
        }
        if (kid.nodeType !== 1) continue;
        const el = /** @type {Element} */ (kid);
        if (el.tagName === "BR") {
          out += "\n";
          lastBr = el;
          ends.set(kid, out.length);
          continue;
        }
        lastBr = null;
        if (el.hasAttribute("data-g-seg")) {
          walk(el, false);
          ends.set(kid, out.length);
          continue;
        }
        const breaks = LINEY.has(el.tagName);
        if (breaks && out !== "" && !out.endsWith("\n")) out += "\n";
        walk(el, false);
        if (breaks && !out.endsWith("\n")) out += "\n";
        ends.set(kid, out.length);
      }
    };
    walk(host, true);
    // A contenteditable keeps a placeholder <br> after a trailing newline so the
    // empty last line has height. Nobody typed it, and reading it as a newline
    // would grow the source by one line on every open.
    if (lastBr && out.endsWith("\n")) out = out.slice(0, -1);
    return { text: out, starts: starts, ends: ends };
  }

  /** @param {Element} el @returns {string} */
  function readText(el) {
    return read(el).text;
  }

  /**
   * WHERE THE CARET GOES WHEN A RENDERED BLOCK OPENS AS SOURCE.
   *
   * Clicking the word "time" in a rendered paragraph should put the caret on the
   * word "time" in the markdown, not at the top of it. The rendered text is very
   * nearly a subsequence of the source — rendering markdown REMOVES characters
   * (`#`, `*`, the brackets of a link) far more than it adds any — so walking the
   * two together and skipping what the source has and the text does not lands on
   * the right character for ordinary prose.
   *
   * It is an approximation and it is allowed to be: being a word out is a caret
   * the user moves, and the alternative is a full source map for a gain nobody
   * would notice. Where the walk runs out it answers the end of the block, which
   * is the safe direction to be wrong in.
   *
   * @param {string} src @param {string} text @param {number} upto
   * @returns {number}
   */
  function sourceOffset(src, text, upto) {
    let si = 0;
    let ti = 0;
    while (si < src.length && ti < upto && ti < text.length) {
      if (src[si] === text[ti]) ti++;
      si++;
    }
    return si;
  }

  /* ── the caret, as a character offset ──────────────────────────────────── */

  /**
   * Where the caret is, as an offset into the text `read` answered.
   * @param {Element} host @param {{ text: string, starts: Map<Node, number>, ends: Map<Node, number> }} r
   * @returns {number | null}
   */
  function caretOffset(host, r) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    const off = range.startOffset;
    if (node !== host && !host.contains(node)) return null;
    if (node.nodeType === 3) return (r.starts.get(node) ?? 0) + off;
    const kid = node.childNodes[off];
    if (kid) return r.starts.get(kid) ?? 0;
    return node === host ? r.text.length : (r.ends.get(node) ?? r.text.length);
  }

  /**
   * Put the caret at a character offset. An offset on the seam between two
   * segments lands at the START of the later one, so typing there goes into
   * the block that begins at the seam.
   * @param {Element} host @param {number} at
   */
  function place(host, at) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    const it = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let acc = 0;
    /** @type {Text | null} */
    let last = null;
    /** @type {Text | null} */
    let found = null;
    let node;
    while ((node = /** @type {Text | null} */ (it.nextNode()))) {
      const len = (node.nodeValue || "").length;
      if (at < acc + len) {
        found = node;
        range.setStart(node, at - acc);
        break;
      }
      acc += len;
      last = node;
    }
    if (!found) {
      if (last) range.setStart(last, (last.nodeValue || "").length);
      else range.setStart(host, 0);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ── one editable slot ─────────────────────────────────────────────────── */

  /**
   * @typedef {object} Slot
   * @property {HTMLElement} node the `data-g-part` element itself
   * @property {string} section
   * @property {string} part
   * @property {number} item the index in a list slot, or -1 for a plain one
   * @property {any} def the plugin drawing it
   * @property {any} ctx
   * @property {string} source the stored markdown, `{{}}` and all
   * @property {{start: number, end: number, tag?: string}[]} ranges
   * @property {{abort: AbortController, frame: any, composing: boolean} | null} open
   * @property {any} timer
   */

  /** @type {Slot[]} */
  let slots = [];

  /** The source as it stands right now, INCLUDING whatever is being typed. Used
   *  by the debounced save, so a save that fires mid-sentence writes the
   *  sentence rather than the version from before the slot was opened.
   *  @param {Slot} slot @returns {string} */
  function sourceNow(slot) {
    return slot.open ? read(slot.node).text : slot.source;
  }

  /** Every region drawn into one slot, in the order their items sit in.
   *  @param {Slot} slot */
  function siblings(slot) {
    return slots
      .filter((one) => one.section === slot.section && one.part === slot.part && one.item >= 0)
      .sort((a, b) => a.item - b.item);
  }

  /** @param {Slot} slot */
  function save(slot) {
    clearTimeout(slot.timer);
    slot.timer = setTimeout(() => {
      // A LIST IS WRITTEN WHOLE. One item's words changed, but what the document
      // holds is the array, so the array goes back — every item's current text,
      // in order, with this one's edit in it. Writing an item alone would need
      // the wire to carry an index, and an index is the thing that goes wrong
      // when two edits cross.
      const data = slot.item < 0
        ? sourceNow(slot)
        : siblings(slot).map((one) => (one === slot ? sourceNow(slot) : one.source));
      rt.page.write(slot.section, slot.part, data).catch((/** @type {any} */ e) => {
        say(
          'the text in "' + slot.part + '" could not be saved: ' +
            String((e && e.message) || e),
          e,
        );
      });
    }, SAVE_AFTER);
  }

  /** Draw every block of a slot as rendered markdown.
   *
   *  NO WRAPPER ELEMENT, and that is deliberate rather than fussy. A section's
   *  CSS is its own and routinely says `.head > h1`; a div slipped in between to
   *  hold a block would break every child selector on the page and the author
   *  would have no way of knowing why. So each block's own top-level nodes are
   *  tagged with `data-g-blk` instead — an attribute changes no selector that
   *  was already written.
   *  @param {Slot} slot */
  function render(slot) {
    // A redraw over an open slot must never leave the slot editable.
    release(slot);
    slot.node.textContent = "";
    const frag = document.createDocumentFragment();

    slot.ranges.forEach((range, i) => {
      const scratch = document.createElement("div");
      try {
        rt.sections.mountWith(
          slot.def,
          scratch,
          { kind: "markdown", md: slot.source.slice(range.start, range.end), vars: {} },
          slot.ctx,
        );
      } catch (e) {
        say('a block of "' + slot.part + '" could not be drawn', e);
      }
      /** @type {Element[]} */
      const made = [];
      for (const node of Array.from(scratch.childNodes)) {
        if (node.nodeType === 1) made.push(/** @type {Element} */ (node));
        frag.appendChild(node);
      }
      // An empty block renders to nothing, and nothing cannot be clicked. A
      // placeholder keeps the region reachable, which is the whole reason an
      // empty slot is still an editable slot.
      if (made.length === 0) {
        const holder = document.createElement("p");
        holder.setAttribute("data-g-blank", "Write something");
        made.push(holder);
        frag.appendChild(holder);
      }
      for (const el of made) el.setAttribute("data-g-blk", String(i));
    });

    if (slot.ranges.length === 0) {
      const holder = document.createElement("p");
      holder.setAttribute("data-g-blank", "Write something");
      holder.setAttribute("data-g-blk", "0");
      frag.appendChild(holder);
    }

    slot.node.appendChild(frag);
  }

  /** A BLOCK IS WHATEVER THE PLUGIN SAYS IT IS.
   *
   *  `def.blocks(source)` answers character ranges, each with the tag it is
   *  drawn as, and markdown.js implements it off markdown-it's own token map, so
   *  a fenced code block containing a blank line is one block and a list is one
   *  block. Splitting on blank lines here would be a second parser that agrees
   *  with the renderer until the first fence, and then tears a paragraph in
   *  half while somebody is typing in it.
   *
   *  A plugin that declares `edit` and no `blocks` is one block, which is right
   *  for content with no inner structure — and it is the fallback when a
   *  plugin's own splitting throws, because a page that cannot be edited is
   *  worse than one edited in bigger pieces than it meant.
   *  @param {Slot} slot @param {string} source
   *  @returns {{start: number, end: number, tag?: string}[]} */
  function rangesOf(slot, source) {
    const from = source.length - source.replace(/^\s+/, "").length;
    const to = source.replace(/\s+$/, "").length;
    const whole = to > from ? [{ start: from, end: to, tag: "" }] : [];
    const blocks = slot.def && typeof slot.def.blocks === "function" ? slot.def.blocks : null;
    if (!blocks) return whole;
    try {
      const ranges = blocks(source);
      return Array.isArray(ranges) ? ranges : whole;
    } catch (err) {
      say('"' + slot.part + '" could not be split into blocks; it is edited whole', err);
      return whole;
    }
  }

  /** @param {Slot} slot @param {number} index */
  function nodesOf(slot, index) {
    return Array.from(slot.node.querySelectorAll('[data-g-blk="' + index + '"]'));
  }

  /** Close whatever is open, anywhere. Called before another slot opens and
   *  before a redraw, so there is never a second editor on screen. */
  function closeOpen() {
    for (const slot of slots) if (slot.open) close(slot);
  }

  /** Take the slot back WITHOUT reading it. `close` reads first; a section's
   *  `write` and a redraw both discard what was typed on purpose.
   *  @param {Slot} slot */
  function release(slot) {
    if (!slot.open) return;
    slot.open.abort.abort();
    if (slot.open.frame) clearTimeout(slot.open.frame);
    slot.open = null;
    slot.node.removeAttribute("contenteditable");
    slot.node.removeAttribute("data-g-src");
    slot.node.removeAttribute("spellcheck");
  }

  /** @param {Slot} slot */
  function close(slot) {
    if (!slot.open) return;
    // THE STORED SOURCE IS EXACTLY THE EDITOR'S TEXT.
    const next = read(slot.node).text;
    release(slot);
    const changed = next !== slot.source;
    slot.source = next;
    slot.ranges = rangesOf(slot, slot.source);
    render(slot);
    if (changed) save(slot);
  }

  /** The segment elements of an open host, in order — its own children and not
   *  a section's furniture.
   *  @param {Element} host @returns {Element[]} */
  function ours(host) {
    return Array.from(host.children).filter((el) => el.hasAttribute("data-g-seg"));
  }

  /** Everything in the host that a SECTION put there — a delete button, a bar,
   *  anything it draws over its own item. It is not words, it is never read back,
   *  and it survives a rebuild in the order it was in. The RENDERED blocks are
   *  ours and are not furniture: they carry `data-g-blk` and the editor replaces
   *  them.
   *  @param {Element} host @returns {Element[]} */
  function keep(host) {
    return Array.from(host.children).filter(
      (el) => !el.hasAttribute("data-g-seg") && !el.hasAttribute("data-g-blk"),
    );
  }

  /**
   * Are the slot's children already exactly these segments? Ordinary typing
   * inside a paragraph changes a text node in place and nothing else, and that
   * case must cost no DOM work — it is every keystroke.
   * @param {Element} host @param {Seg[]} segs @param {string} text
   */
  function same(host, segs, text) {
    const kids = ours(host);
    if (kids.length !== segs.length) return false;
    for (let i = 0; i < segs.length; i++) {
      const el = kids[i];
      const seg = segs[i];
      if (!el || !seg) return false;
      if (el.tagName.toLowerCase() !== seg.tag || el.getAttribute("data-g-seg") !== seg.kind) return false;
      const words = textNodeOf(el);
      if (!words || words.nodeValue !== text.slice(seg.from, seg.to)) return false;
    }
    return true;
  }

  /**
   * Re-cut the open slot after a keystroke. The text is read back, split again,
   * and the children rebuilt ONLY when their shape changed — a new block, a
   * paragraph that became a heading, a browser-inserted `<div>` for Enter —
   * with the caret put back at the same character.
   * @param {Slot} slot
   */
  function rebuild(slot) {
    if (!slot.open) return;
    const host = slot.node;
    const r = read(host);
    const segs = segments(r.text, rangesOf(slot, r.text));
    if (same(host, segs, r.text)) return;
    const at = caretOffset(host, r);
    // A SECTION'S OWN FURNITURE STAYS. The shipped list section paints a delete
    // button into every item and puts it back whenever the item is redrawn;
    // sweeping it away here would make it flicker on every keystroke and would
    // fight that section's observer.
    host.replaceChildren(...keep(host), ...segs.map((seg) => build(seg, r.text)));
    if (at !== null) place(host, at);
  }

  /** One rebuild per burst of keystrokes, and none in the middle of an IME
   *  composition — replacing the node under a composition would drop the
   *  characters being composed.
   *
   *  A TIMER RATHER THAN `requestAnimationFrame`, which is the obvious choice and
   *  is measured to stall: a frame callback does not run while the box is not
   *  being painted, and a box that is not painting is exactly where a scheduled
   *  rebuild goes missing and never comes back. The delay is zero, so it is the
   *  same keystroke either way.
   *  @param {Slot} slot */
  function schedule(slot) {
    if (!slot.open || slot.open.composing || slot.open.frame) return;
    slot.open.frame = setTimeout(() => {
      if (slot.open) slot.open.frame = 0;
      rebuild(slot);
    }, 0);
  }

  /**
   * Open the whole slot as its own markdown, each block at its own type.
   *
   * THE SLOT'S OWN ELEMENT BECOMES THE EDITOR. It already carries `data-g-md`,
   * which is what the page's type scale attaches to, and it is the element the
   * section's CSS aims at — so an `<h1>` segment placed directly inside it is
   * styled exactly as the rendered `<h1>` was, with nothing copied across.
   *
   * @param {Slot} slot @param {number} [caret]
   */
  function open(slot, caret) {
    const host = slot.node;
    const text = slot.source;
    host.replaceChildren(...keep(host), ...segments(text, slot.ranges).map((seg) => build(seg, text)));
    host.setAttribute("data-g-src", "");
    // `plaintext-only` so a paste brings words rather than somebody else's
    // markup, and so the browser stops trying to be a rich text editor over the
    // top of a plain text format.
    host.setAttribute("contenteditable", "plaintext-only");
    host.setAttribute("spellcheck", "true");

    const ac = new AbortController();
    slot.open = { abort: ac, frame: 0, composing: false };
    const opt = { signal: ac.signal };

    host.addEventListener("input", () => { schedule(slot); save(slot); }, opt);
    host.addEventListener("compositionstart", () => { if (slot.open) slot.open.composing = true; }, opt);
    host.addEventListener("compositionend", () => {
      if (!slot.open) return;
      slot.open.composing = false;
      schedule(slot);
    }, opt);
    host.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        host.blur();
      }
    }, opt);
    host.addEventListener("blur", () => {
      // A blur that is only the window losing focus is not a close: the caret is
      // still in the slot when the user comes back to it.
      if (document.activeElement === host) return;
      close(slot);
    }, opt);

    host.focus({ preventScroll: true });
    place(host, Math.max(0, Math.min(caret === undefined ? text.length : caret, text.length)));
  }

  /* ── finding the caret in a rendered block ─────────────────────────────── */

  /**
   * How many characters of the block's rendered text sit before the click.
   * @param {Element[]} nodes @param {number} x @param {number} y
   * @returns {number | undefined}
   */
  function clickedAt(nodes, x, y) {
    const doc = /** @type {any} */ (document);
    /** @type {Range | null} */
    let hit = null;
    if (typeof doc.caretRangeFromPoint === "function") {
      hit = doc.caretRangeFromPoint(x, y);
    } else if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        hit = document.createRange();
        hit.setStart(pos.offsetNode, pos.offset);
      }
    }
    const first = nodes[0];
    if (!hit || !first) return undefined;
    try {
      const span = document.createRange();
      span.setStartBefore(first);
      span.setEnd(hit.startContainer, hit.startOffset);
      return span.toString().length;
    } catch {
      return undefined;
    }
  }

  /* ── the always-on wiring ──────────────────────────────────────────────── */

  /** Start a draw. The controllers belong to the elements of ONE draw, and a
   *  redraw replaces every one of them. */
  function reset() {
    slots = [];
  }

  /**
   * Take over one section's editable slots, called by the runtime the moment
   * that section's slots are filled and BEFORE its script runs.
   *
   * The order is the whole reason this is a hook rather than a pass over the
   * finished page. Re-drawing a slot as separately-tagged blocks replaces every
   * node the plugin made, so doing it after the scripts threw away whatever they
   * had decorated — a table whose cells a script had classed came back plain,
   * and the script looked like it had not run.
   *
   * @param {HTMLElement} section the section's own element
   * @param {any} drawn its `DrawnSection`
   * @param {Record<string, any>} vars the page's values with the section's over them
   */
  function dress(section, drawn, vars) {
    style();
    const name = String(drawn.name);

    for (const node of Array.from(section.querySelectorAll("[data-g-part]"))) {
      const part = node.getAttribute("data-g-part") || "";
      const content = (drawn.parts || {})[part];

      // A LIST IS MANY REGIONS IN ONE SLOT, one per item. Each is edited on its
      // own and written back by its index, so adding, removing and reordering
      // are operations on an array — nothing to agree about, nothing to parse.
      if (content && content.kind === "list") {
        node.setAttribute("data-g-md", "");
        (content.items || []).forEach((/** @type {any} */ item, /** @type {number} */ at) => {
          const def = rt.plugins.get(String(item.kind));
          if (!def || def.edit !== true) return;
          const holder = /** @type {HTMLElement | null} */ (
            node.querySelector('[data-g-item="' + at + '"]')
          );
          if (!holder) return;
          holder.setAttribute("data-g-md", "");
          take(holder, part, at, def, item, rt.sections.merge(vars, item.vars || {}), section, name);
        });
        continue;
      }

      // An unfilled slot is still a slot: it is where somebody types first.
      const kind = content ? String(content.kind) : "markdown";
      const def = rt.plugins.get(kind);
      if (!def || def.edit !== true) continue;
      node.removeAttribute("data-g-empty");
      // The page's type scale attaches to this attribute.
      node.setAttribute("data-g-md", "");
      take(
        /** @type {HTMLElement} */ (node), part, -1, def, content,
        rt.sections.merge(vars, (content && content.vars) || {}), section, name,
      );
    }
  }

  /**
   * Put one region under the editor's control.
   *
   * @param {HTMLElement} node the element the words are drawn into
   * @param {string} part @param {number} item the list index, or -1
   * @param {any} def @param {any} content @param {Record<string, any>} vars
   * @param {HTMLElement} section @param {string} name
   */
  function take(node, part, item, def, content, vars, section, name) {
    /** @type {Slot} */
    const slot = {
      node: node,
      section: name,
      part: part,
      item: item,
      def: def,
      ctx: rt.sections.makeCtx({
        page: rt.page.id,
        section: name,
        part: part,
        plugin: def.id,
        vars: vars,
        root: section,
        bucket: name,
        node: node,
        call: () => Promise.reject(new Error("the editor does not call the host")),
      }),
      source: content && typeof content.md === "string" ? content.md : "",
      ranges: [],
      open: null,
      timer: null,
    };
    slot.ranges = rangesOf(slot, slot.source);
    render(slot);
    slots.push(slot);
  }

  /** One delegated click for the whole page. A slot opens on a plain click and
   *  never on a drag, because selecting a sentence to copy it is at least as
   *  common as editing one and stealing that gesture would be maddening. */
  function onClick(/** @type {MouseEvent} */ ev) {
    const target = /** @type {Element | null} */ (ev.target);
    if (!target || typeof target.closest !== "function") return;
    if (target.closest("[data-g-src]")) return; // already editing this one
    // A link in prose is a link. Opening the paragraph instead would make every
    // reference on the page unfollowable.
    if (target.closest("a[href]")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).length > 0) return;

    // WHICH REGION WAS CLICKED. A list item is its own region and sits inside the
    // slot, so the nearest item wins over the slot around it — resolving to the
    // slot would hand back the container and the click would land on nothing.
    // Clicking the item's own box, rather than a word in it, counts too: the box
    // IS the region, and a card with a gap under its last line should still open
    // when you click the gap.
    const region = target.closest("[data-g-item]") || target.closest("[data-g-part]");
    const slot = slots.find((s) => s.node === region);
    if (!slot) return;

    // THE CARET LANDS ON THE WORD THAT WAS CLICKED, as an offset into the whole
    // source: the clicked block's own start plus where in it the click fell. A
    // click on the slot's padding, outside any block, opens at the end.
    /** @type {number | undefined} */
    let caret;
    const blk = target.closest("[data-g-blk]");
    if (blk) {
      const index = Number(blk.getAttribute("data-g-blk") || "0");
      const range = slot.ranges[index];
      const nodes = nodesOf(slot, index);
      const at = clickedAt(nodes, ev.clientX, ev.clientY);
      if (range && at !== undefined) {
        const text = nodes.map((n) => n.textContent || "").join("");
        caret = range.start + sourceOffset(slot.source.slice(range.start, range.end), text, at);
      } else if (range) {
        caret = range.end;
      }
    }

    closeOpen();
    open(slot, caret);
  }

  /* ── start ─────────────────────────────────────────────────────────────── */

  if (rt.page && typeof rt.page.onDraw === "function") {
    rt.page.onDraw(() => style());
    document.addEventListener("click", onClick, false);
  } else {
    say("the edit wave loaded before the runtime; the page cannot be edited");
  }

  rt.edit = {
    reset: reset,
    dress: dress,

    /** THE WORDS IN ONE OF A SECTION'S OWN SLOTS, and the way a section changes
     *  them.
     *
     *  A section draws its own editing — a `+` that adds another item, an `✕`
     *  that removes one, arrows that reorder — and every one of those is an edit
     *  to the markdown a slot already holds. Without this a section could only
     *  drive the editor by faking clicks at it, which is what the first attempt
     *  did and it did not work.
     *
     *  IT IS SCOPED TO THE SECTION'S OWN SLOTS, by name, and a section may not
     *  name another's. That is a closure and not a browser guarantee — the whole
     *  box is one realm and always was — but it is the difference between an API
     *  that says what it is for and one that invites reaching.
     *
     *  Nothing here is a new capability: the person editing the page can already
     *  type any of it. What it removes is the CEILING — a section no longer has
     *  to declare its slots ahead of time to have somewhere to put a new item,
     *  because an item is another block of markdown in a slot that already
     *  exists.
     *  @param {string} section @param {string} part
     *  @returns {string | string[]} */
    read(section, part) {
      // THE DOCUMENT SAYS WHAT THE SLOT IS, not the regions on screen. An EMPTY
      // list has no regions, and answering "" for one would tell a section it
      // held a string — so the `+` that adds the first item would write a string
      // over the list and there would be no way back. Read the drawn page.
      const drawn = rt.page.sections().find((/** @type {any} */ one) => String(one.name) === section);
      const content = drawn && drawn.parts ? drawn.parts[part] : null;
      const mine = slots
        .filter((one) => one.section === section && one.part === part)
        .sort((a, b) => a.item - b.item);

      if (content && content.kind === "list") {
        // What is on screen where there is anything, because that is where an
        // unsaved keystroke lives; what the document holds otherwise.
        return mine.length > 0
          ? mine.map((one) => one.source)
          : (content.items || []).map((/** @type {any} */ item) => String(item.md || ""));
      }
      if (mine.length > 0 && mine[0]) return mine[0].source;
      return content && typeof content.md === "string" ? content.md : "";
    },

    /** @param {string} section @param {string} part
     *  @param {string | string[]} markdown */
    write(section, part, markdown) {
      const mine = slots.filter((one) => one.section === section && one.part === part);

      // A LIST IS WRITTEN WHOLE AND REDRAWN WHOLE. Adding an item, removing one
      // or moving one changes how many regions the slot has, and a region is an
      // element — so the page is asked to draw itself again rather than patched
      // in place. `rt.page.write` sends the array; the redraw follows the answer
      // so the section sees exactly what was stored.
      if (Array.isArray(markdown)) {
        const list = markdown.map((one) => String(one));
        for (const one of mine) release(one);
        rt.page.write(section, part, list).then(
          () => rt.page.redraw(),
          (/** @type {any} */ e) => say('"' + part + '" could not be written: ' + String((e && e.message) || e), e),
        );
        return true;
      }

      const slot = mine[0];
      if (!slot) {
        say('a section asked to write "' + part + '", which is not one of its slots');
        return false;
      }
      // Whatever was open is abandoned: the section has just rewritten the very
      // text the caret was sitting in, and keeping the old edit over the new
      // source would put back a version of the words nobody asked for.
      release(slot);
      slot.source = String(markdown);
      slot.ranges = rangesOf(slot, slot.source);
      render(slot);
      save(slot);
      return true;
    },
    /** For verification: the slots currently under the editor's control. */
    slots() {
      return slots.map((s) => ({ section: s.section, part: s.part, blocks: s.ranges.length }));
    },
    openSlot: open,
    closeAll: closeOpen,
    segments: segments,
    sourceOffset: sourceOffset,
    readText: readText,
  };
})();
