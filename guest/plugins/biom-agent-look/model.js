// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-agent-look/model.js — THE DEFAULT LOOK'S PURE HALF. A
 * classic script; see registry.js for why there are no imports in here.
 *
 * EVERYTHING THE LOOK DECIDES BEFORE IT TOUCHES A NODE: which words a turn's
 * end is said in, which group a chat sits under, what a tool line's verb is,
 * what a diff added and removed, how an agent's reply is read as markdown, and
 * how a chat's stream of updates becomes turns. None of it reads the document,
 * so `tests/agent-look.test.js` runs it as it is, and `look.js` beside it is
 * only the drawing. It is hung on a global, `__gAgentLook`, which `look.js`
 * reads when it mounts — never when it loads, so the order the two files load
 * in decides nothing.
 *
 * AN AGENT'S WORDS ARE UNTRUSTED, AND THIS IS WHERE THAT IS HELD. A reply is
 * read by the vendored markdown-it with raw HTML OFF, and what comes out is a
 * tree of a closed set of tags whose every leaf is a string — a string is only
 * ever drawn as a text node. A link is drawn as its words with the address in
 * a tooltip and never as an `href`, because a link followed inside the box
 * would navigate the Agent screen itself away. An image is its alt text. A
 * face's art is drawn only from the one folder the faces ship in. Nothing
 * here, and nothing in `look.js`, ever writes markup from a string. */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  /** A word the server sent, looked up in a table of ours by OWN key only —
   *  `constructor` is a word too, and the prototype is not a row.
   *  @template T @param {Record<string, T>} table @param {any} key @returns {T | undefined} */
  const own = (table, key) => (typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

  /* ── faces ─────────────────────────────────────────────────────────────── */

  /** WHERE A FACE'S ART MAY COME FROM: the vendored Noto folder, one file of
   *  hex codepoints. A face is chosen by the server off a fixed list, so this
   *  refuses nothing in practice — it is here so that no string in a chat can
   *  ever be put in an `src`. */
  const ART = /^\/vendor\/noto\/[0-9a-f]{2,6}(?:_[0-9a-f]{2,6}){0,6}\.webp$/;

  /** @param {any} face @returns {string | null} the art to draw, or null for text */
  function artOf(face) {
    return face && typeof face.art === "string" && ART.test(face.art) ? face.art : null;
  }

  /** A face is an emoji and never words: a pictograph or a flag, with the
   *  joiners and selectors that build one, and at most a handful of code
   *  points. Anything else is no face at all.
   *  @param {any} face @returns {string} */
  function emojiOf(face) {
    if (!face || typeof face.emoji !== "string") return "";
    const cps = Array.from(face.emoji);
    if (cps.length === 0 || cps.length > 10) return "";
    return cps.every((c) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200d|\ufe0f/u.test(c)) &&
      cps.some((c) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(c)) ? face.emoji : "";
  }

  /* ── lights and ends ───────────────────────────────────────────────────── */

  /** A chat's light as the LED draws it: amber and pulsing while it works,
   *  green after a finished turn, red until its next turn starts, and none.
   *  @param {any} light @returns {"lit pulse" | "green" | "red" | "none"} */
  function lampOf(light) {
    if (light === "working") return "lit pulse";
    if (light === "done") return "green";
    if (light === "error") return "red";
    return "none";
  }

  /** The light's tooltip, in words. @param {any} chat @param {number} now */
  function lampWords(chat, now) {
    const light = chat && chat.light;
    if (light === "working") return "Working";
    if (light === "error") return "Stopped on an error";
    if (light === "done") {
      const mins = Math.max(1, Math.round((now - Number(chat.updated || now)) / 60000));
      return "Finished " + mins + " min ago";
    }
    return "";
  }

  /** WHY A TURN ENDED RED, as a head and a sentence, or null for a turn that
   *  did not. `reason` is the server's own words where it gave any, and it
   *  follows the head rather than replacing it.
   *  @param {any} stop @param {any} reason @returns {{ head: string, rest: string } | null} */
  function stopWords(stop, reason) {
    /** @type {Record<string, [string, string]>} */
    const WORDS = {
      refusal: ["The agent refused.", "It would not carry this request out."],
      max_tokens: ["The reply ran out of room.", "It hit the agent's limit on how long one reply may be."],
      max_turn_requests: ["The turn ran out of steps.", "It hit the agent's limit on requests in one turn."],
      crashed: ["The agent stopped answering mid-turn.", "Nothing after the last line above was done. Send the message again to carry on."],
    };
    const w = own(WORDS, stop);
    if (!w) return null;
    const said = typeof reason === "string" && reason.trim() !== "" ? reason.trim() : w[1];
    return { head: w[0], rest: said };
  }

  /* ── when ──────────────────────────────────────────────────────────────── */

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  /** @param {number} n */
  const two = (n) => (n < 10 ? "0" : "") + n;

  /** Local midnight of the day `t` falls in. @param {number} t */
  function dayOf(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  /** WHICH GROUP A CHAT IS LISTED UNDER, by when it last moved, as the
   *  mockup's list groups them. @param {number} at @param {number} now */
  function groupOf(at, now) {
    const today = dayOf(now);
    if (at >= today) return "Today";
    if (at >= today - 864e5) return "Yesterday";
    if (at >= today - 6 * 864e5) return "This week";
    return "Earlier";
  }

  /** When, as the row says it: the time today, then the day, then the date.
   *  @param {number} at @param {number} now */
  function whenOf(at, now) {
    const d = new Date(at);
    const g = groupOf(at, now);
    if (g === "Today") return two(d.getHours()) + ":" + two(d.getMinutes());
    if (g === "Yesterday") return "Yesterday";
    if (g === "This week") return DAYS[d.getDay()] || "";
    return (MONTHS[d.getMonth()] || "") + " " + d.getDate();
  }

  /** THE LIST, GROUPED: newest first, each group once, in the order a reader
   *  meets them. @param {any[]} chats @param {number} now
   *  @returns {{ label: string, chats: any[] }[]} */
  function grouped(chats, now) {
    const sorted = (Array.isArray(chats) ? chats : []).filter((c) => c && typeof c.id === "string")
      .slice().sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
    /** @type {{ label: string, chats: any[] }[]} */
    const out = [];
    for (const c of sorted) {
      const label = groupOf(Number(c.updated || 0), now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.chats.push(c);
      else out.push({ label: label, chats: [c] });
    }
    return out;
  }

  /** The row's second line: what the chat is doing and with which harness.
   *  @param {any} chat @param {number} now */
  function subOf(chat, now) {
    const harness = typeof chat.harness === "string" && chat.harness !== "" ? chat.harness : "No agent yet";
    if (chat.light === "working") return { working: true, text: harness };
    if (chat.light === "error") return { working: false, text: "Stopped · " + harness };
    return { working: false, text: harness + " · " + whenOf(Number(chat.updated || now), now) };
  }

  /* ── tool lines ────────────────────────────────────────────────────────── */

  /** Each kind's verb, done and doing. `other` has none: its title says it. */
  /** @type {Record<string, [string, string]>} */
  const VERBS = {
    read: ["Read", "Reading"],
    edit: ["Edited", "Editing"],
    delete: ["Deleted", "Deleting"],
    move: ["Moved", "Moving"],
    search: ["Searched", "Searching"],
    execute: ["Ran", "Running"],
    think: ["Thought", "Thinking"],
    fetch: ["Fetched", "Fetching"],
    switch_mode: ["Switched mode", "Switching mode"],
  };
  /** Title words an agent leads with that ARE the verb, so it is not said
   *  twice — never on a command line, whose first word is the program. */
  const LEADS = /^(read|edit|write|delete|remove|move|rename|search|fetch|list)\s+/i;

  /** WHAT A TOOL LINE SAYS: the verb for its kind and state, and its object —
   *  the title, less a verb it leads with, or the first place it names where
   *  the title is bare. A failed line keeps its verb; its lamp says it failed.
   *  @param {any} tool @returns {{ verb: string, obj: string, live: boolean, failed: boolean }} */
  function toolWords(tool) {
    const t = tool || {};
    const live = t.status === "pending" || t.status === "in_progress";
    const failed = t.status === "failed";
    const pair = own(VERBS, t.kind);
    const title = typeof t.title === "string" ? t.title.replace(/\s+/g, " ").trim() : "";
    const loc = Array.isArray(t.locations) && t.locations[0] && typeof t.locations[0].path === "string"
      ? t.locations[0].path + (typeof t.locations[0].line === "number" ? ":" + t.locations[0].line : "")
      : "";
    if (!pair) return { verb: title || (live ? "Working" : "Done"), obj: title ? "" : loc, live: live, failed: failed };
    let obj = t.kind === "execute" ? title : title.replace(LEADS, "");
    if (/^`[^`]*`$/.test(obj)) obj = obj.slice(1, -1);
    if (obj === "") obj = loc;
    return { verb: live ? pair[1] : pair[0], obj: obj, live: live, failed: failed };
  }

  /** WHAT A RUN OF TOOL CALLS SAYS WHILE IT IS SHUT: *Used 3 tools*, or
   *  *Using 3 tools* while it is the turn's run in progress, with the call
   *  under way after it in its own words; and how many failed, which the shut
   *  line marks so a failure is never hidden. One call is *1 tool*.
   *  @param {any[]} tools the run's lines, in the order they came
   *  @param {boolean} live whether the run is still going
   *  @returns {{ label: string, current: string, failed: number, live: boolean }} */
  function runWords(tools, live) {
    const list = (Array.isArray(tools) ? tools : []).filter((x) => x && typeof x === "object");
    let failed = 0;
    for (const x of list) if (x.status === "failed") failed++;
    let current = "";
    if (live) {
      for (let i = list.length - 1; i >= 0; i--) {
        const w = toolWords(list[i]);
        if (w.live) { current = w.obj ? w.verb + " " + w.obj : w.verb; break; }
      }
    }
    const n = list.length;
    return { label: (live ? "Using " : "Used ") + n + (n === 1 ? " tool" : " tools"), current: current, failed: failed, live: live };
  }

  /** THE THREE VIEWS OF A CHAT, and the one this look draws for a word it
   *  does not know: Tool calls, the default. @param {any} v
   *  @returns {"plain" | "tools" | "thinking"} */
  function viewOf(v) {
    return v === "plain" || v === "thinking" ? v : "tools";
  }

  /* ── diffs ─────────────────────────────────────────────────────────────── */

  /** @param {any} s @returns {string[]} */
  function linesOf(s) {
    if (typeof s !== "string" || s === "") return [];
    const out = s.split("\n");
    if (out.length > 1 && out[out.length - 1] === "") out.pop();
    return out;
  }

  /** THE LINES A DIFF CHANGED, as rows to draw and two counts. Common lines at
   *  either end are trimmed first; what is left is laid out by a longest
   *  common subsequence where it is small enough to be cheap, and as the old
   *  lines removed then the new added where it is not — a correct diff, if not
   *  the tightest, and bounded. Unchanged runs longer than the context are one
   *  `gap` row saying how many. Only the first `cap` rows are drawn; `cut`
   *  says how many more there were.
   *  @param {any} before @param {any} after @param {number} [cap]
   *  @returns {{ rows: { k: "add" | "del" | "ctx" | "gap", s: string }[], added: number, removed: number, cut: number }} */
  function lineDiff(before, after, cap) {
    const a = linesOf(before), b = linesOf(after);
    const limit = typeof cap === "number" && cap > 0 ? cap : 400;
    const CONTEXT = 3;
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head++;
    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const am = a.slice(head, a.length - tail), bm = b.slice(head, b.length - tail);
    /** @type {{ k: "add" | "del" | "ctx", s: string }[]} */
    const mid = [];
    if (am.length * bm.length <= 250000 && am.length > 0 && bm.length > 0) {
      const n = am.length, m = bm.length;
      const w = m + 1;
      const L = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          L[i * w + j] = am[i] === bm[j] ? (L[(i + 1) * w + j + 1] || 0) + 1 : Math.max(L[(i + 1) * w + j] || 0, L[i * w + j + 1] || 0);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (am[i] === bm[j]) { mid.push({ k: "ctx", s: String(am[i]) }); i++; j++; }
        else if ((L[(i + 1) * w + j] || 0) >= (L[i * w + j + 1] || 0)) { mid.push({ k: "del", s: String(am[i]) }); i++; }
        else { mid.push({ k: "add", s: String(bm[j]) }); j++; }
      }
      while (i < n) { mid.push({ k: "del", s: String(am[i]) }); i++; }
      while (j < m) { mid.push({ k: "add", s: String(bm[j]) }); j++; }
    } else {
      for (const s of am) mid.push({ k: "del", s: s });
      for (const s of bm) mid.push({ k: "add", s: s });
    }
    let added = 0, removed = 0;
    for (const r of mid) { if (r.k === "add") added++; else if (r.k === "del") removed++; }
    /** @type {{ k: "add" | "del" | "ctx", s: string }[]} */
    const all = [];
    for (const s of a.slice(0, head)) all.push({ k: "ctx", s: s });
    for (const r of mid) all.push(r);
    for (const s of a.slice(a.length - tail)) all.push({ k: "ctx", s: s });
    /** @type {{ k: "add" | "del" | "ctx" | "gap", s: string }[]} */
    const rows = [];
    // A context line is kept when a change is within CONTEXT lines of it.
    const near = new Uint8Array(all.length);
    all.forEach((r, i) => {
      if (r.k === "ctx") return;
      for (let d = Math.max(0, i - CONTEXT); d <= Math.min(all.length - 1, i + CONTEXT); d++) near[d] = 1;
    });
    let skipped = 0;
    all.forEach((r, i) => {
      if (r.k !== "ctx" || near[i]) {
        if (skipped) { rows.push({ k: "gap", s: skipped + (skipped === 1 ? " unchanged line" : " unchanged lines") }); skipped = 0; }
        rows.push(r);
      } else skipped++;
    });
    if (skipped && rows.length) rows.push({ k: "gap", s: skipped + (skipped === 1 ? " unchanged line" : " unchanged lines") });
    const cut = Math.max(0, rows.length - limit);
    return { rows: cut ? rows.slice(0, limit) : rows, added: added, removed: removed, cut: cut };
  }

  /** A tool line's counts: every diff it carries, summed, or null for none.
   *  @param {any} tool @returns {{ added: number, removed: number } | null} */
  function countsOf(tool) {
    const diffs = tool && Array.isArray(tool.diffs) ? tool.diffs : [];
    if (!diffs.length) return null;
    let added = 0, removed = 0;
    for (const d of diffs) {
      const r = lineDiff(d && d.old, d && d.new, 1);
      added += r.added; removed += r.removed;
    }
    return { added: added, removed: removed };
  }

  /** "+18 −6", with a real minus sign, or "" for nothing.
   *  @param {any} added @param {any} removed */
  function countWords(added, removed) {
    const parts = [];
    if (typeof added === "number" && added > 0) parts.push("+" + added);
    if (typeof removed === "number" && removed > 0) parts.push("−" + removed);
    return parts.join(" ");
  }

  /* ── an agent's words, as markdown ─────────────────────────────────────── */

  /** THE TAGS A READ MAY PRODUCE, and no other. `span` carries a link's words
   *  and an image's alt text. */
  const TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "hr", "br", "table", "thead", "tbody", "tr", "th", "td", "span"]);
  /** The attributes a node may carry, each from a closed set of values but
   *  `title`, which is only ever set as an attribute and never parsed. */
  const ATTRS = new Set(["class", "title", "start"]);

  /**
   * @typedef {{ t: string, a?: Record<string, string>, c: (MdNode | string)[] }} MdNode
   */

  /** @type {any} */
  let parser = null;
  /** @type {any} */
  let parserOf = null;

  /** The vendored markdown-it, made once per library: raw HTML OFF, no
   *  linkify, no typographer — an agent's words, read as markdown and nothing
   *  more. Null where the box has no library. @param {any} lib */
  function mdParser(lib) {
    if (typeof lib !== "function") return null;
    if (parserOf === lib && parser) return parser;
    try { parser = lib({ html: false, linkify: false, typographer: false, breaks: false }); parserOf = lib; }
    catch { parser = null; parserOf = null; }
    return parser;
  }

  /** @param {MdNode} into @param {string} s */
  function text(into, s) {
    if (s === "") return;
    const last = into.c[into.c.length - 1];
    if (typeof last === "string") into.c[into.c.length - 1] = last + s;
    else into.c.push(s);
  }

  /** @param {any} tok */
  function alignOf(tok) {
    const style = tok && typeof tok.attrGet === "function" ? tok.attrGet("style") : null;
    if (style === "text-align:left") return "al-l";
    if (style === "text-align:center") return "al-c";
    if (style === "text-align:right") return "al-r";
    return "";
  }

  /** An inline token run into a node, with its own stack for emphasis and
   *  links. Anything it does not know is drawn as its words.
   *  @param {MdNode} parent @param {any[]} children */
  function inline(parent, children) {
    /** @type {MdNode[]} */
    const stack = [parent];
    for (const tok of children || []) {
      const top = /** @type {MdNode} */ (stack[stack.length - 1]);
      const type = String(tok && tok.type || "");
      if (type === "text" || type === "text_special") text(top, String(tok.content || ""));
      else if (type === "softbreak") text(top, "\n");
      else if (type === "hardbreak") top.c.push({ t: "br", c: [] });
      else if (type === "code_inline") top.c.push({ t: "code", c: [String(tok.content || "")] });
      else if (type === "strong_open" || type === "em_open" || type === "s_open") {
        const n = { t: type === "strong_open" ? "strong" : type === "em_open" ? "em" : "s", c: [] };
        top.c.push(n); stack.push(n);
      } else if (type === "link_open") {
        const href = typeof tok.attrGet === "function" ? tok.attrGet("href") : null;
        /** @type {MdNode} */
        const n = { t: "span", a: { class: "lk" }, c: [] };
        if (typeof href === "string" && href !== "" && n.a) n.a.title = href.slice(0, 2048);
        top.c.push(n); stack.push(n);
      } else if (/_close$/.test(type)) {
        if (stack.length > 1) stack.pop();
      } else if (type === "image") {
        const alt = Array.isArray(tok.children) ? tok.children.map((/** @type {any} */ c) => String(c.content || "")).join("") : String(tok.content || "");
        top.c.push({ t: "span", a: { class: "img" }, c: [alt || "image"] });
      } else if (tok && typeof tok.content === "string") text(top, tok.content);
    }
  }

  /** THE MARKDOWN OF AN AGENT'S REPLY, AS A TREE: a closed set of tags, every
   *  leaf a string. With no library it is the words in paragraphs, which is
   *  a poorer reading and a safe one.
   *  @param {any} md @param {any} [lib] @returns {(MdNode | string)[]} */
  function mdTree(md, lib) {
    const src = typeof md === "string" ? md : "";
    const p = mdParser(lib === undefined ? glob.markdownit : lib);
    if (!p) return plain(src);
    /** @type {any[]} */
    let tokens;
    try { tokens = p.parse(src, {}); } catch { return plain(src); }
    /** @type {MdNode} */
    const root = { t: "#", c: [] };
    /** @type {MdNode[]} */
    const stack = [root];
    for (const tok of tokens) {
      const top = /** @type {MdNode} */ (stack[stack.length - 1]);
      const type = String(tok.type || "");
      if (type === "inline") { inline(top, tok.children || []); continue; }
      // A tight list's paragraphs are hidden: their words sit in the item.
      if (tok.hidden && (type === "paragraph_open" || type === "paragraph_close")) continue;
      if (tok.nesting === 1) {
        let tag = String(tok.tag || "");
        if (!TAGS.has(tag) || tag === "span") tag = "p";
        /** @type {MdNode} */
        const n = { t: tag, c: [] };
        if (tag === "ol") {
          // markdown-it keeps the number a list starts at as a number.
          const start = typeof tok.attrGet === "function" ? String(tok.attrGet("start") ?? "") : "";
          if (/^\d{1,9}$/.test(start) && start !== "1") n.a = { start: start };
        }
        if (tag === "th" || tag === "td") { const al = alignOf(tok); if (al) n.a = { class: al }; }
        top.c.push(n); stack.push(n);
      } else if (tok.nesting === -1) {
        if (stack.length > 1) stack.pop();
      } else if (type === "hr") top.c.push({ t: "hr", c: [] });
      else if (type === "fence" || type === "code_block") top.c.push({ t: "pre", c: [{ t: "code", c: [String(tok.content || "").replace(/\n$/, "")] }] });
      else if (typeof tok.content === "string" && tok.content !== "") top.c.push({ t: "p", c: [tok.content] });
    }
    return root.c;
  }

  /** The words in paragraphs, for a box with no markdown library.
   *  @param {string} src @returns {MdNode[]} */
  function plain(src) {
    return src.split(/\n{2,}/).filter((s) => s.trim() !== "").map((s) => ({ t: "p", a: { class: "pre" }, c: [s] }));
  }

  /** WHERE A STREAMING REPLY CAN BE CUT: the end of the last blank line after
   *  `from` that is not inside a fence, so everything before it is whole blocks
   *  that will not change, and only what follows is read again as more words
   *  arrive. `from` is always such a place itself, so the fence state starts
   *  closed. Returns `from` where there is no such line yet.
   *  @param {string} textIn @param {number} from */
  function settledEnd(textIn, from) {
    let at = from;
    let fence = "";
    let cut = from;
    while (at < textIn.length) {
      const nl = textIn.indexOf("\n", at);
      if (nl < 0) break; // the last line is still arriving
      const line = textIn.slice(at, nl);
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f && f[1]) {
        if (fence === "") fence = f[1];
        else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = "";
      } else if (fence === "" && line.trim() === "") cut = nl + 1;
      at = nl + 1;
    }
    return cut;
  }

  /* ── a chat's stream, as turns ─────────────────────────────────────────── */

  /**
   * @typedef {{ kind: "think" | "prose" | "acts" | "hand", text: string, ids: string[], at: number, end: number | null, n: number, from?: string, byEnd?: boolean }} Block
   * @typedef {{ id: string, seq: number, tool: any, turn: number, block: Block }} ToolEntry
   * @typedef {{ n: number, prompt: string | null, blocks: Block[], face: any, phase: string | null, stop: string | null,
   *   reason: string | null, changed: any[] | null, errors: string[], agent: string | null, at: number, end: number | null }} Turn
   */

  /** A sink is told what moved; every method is optional. */
  /** @typedef {Record<string, ((...args: any[]) => void) | undefined>} Sink */

  /**
   * THE TRANSCRIPT: a chat's updates folded into turns, in the order they
   * arrived. A turn is its prompt and then BLOCKS — consecutive thinking is one
   * folded block, consecutive tool calls one list of lines, consecutive reply
   * one run of prose — so an agent that thinks, acts, says something and acts
   * again reads in that order. A tool line is replaced by its id and only by a
   * later `seq`, wherever it first stood. `sink` is told each change, so the
   * drawing can follow it one node at a time; with no sink this is a model and
   * nothing else, which is what a first draw builds before it draws.
   * @param {Sink} [sinkIn]
   */
  function makeTranscript(sinkIn) {
    /** @type {Sink} */
    let sink = sinkIn || {};
    /** @type {Map<number, Turn>} */
    const turns = new Map();
    /** @type {number[]} */
    const order = [];
    /** @type {Map<string, ToolEntry>} */
    const tools = new Map();
    const chat = { harness: /** @type {string | null} */ (null), agent: /** @type {string | null} */ (null), options: /** @type {any[]} */ ([]), name: /** @type {string | null} */ (null), seq: 0, count: 0 };

    /** @param {string} name @param {...any} args */
    const tell = (name, ...args) => { const fn = sink[name]; if (typeof fn === "function") fn(...args); };

    /** @param {number} n @param {number} at @returns {Turn} */
    function turnOf(n, at) {
      let t = turns.get(n);
      if (t) return t;
      t = { n: n, prompt: null, blocks: [], face: null, phase: null, stop: null, reason: null, changed: null, errors: [], agent: chat.harness, at: at, end: null };
      turns.set(n, t);
      // Turns arrive in order; one that does not is put where it belongs.
      let i = order.length;
      while (i > 0 && (order[i - 1] || 0) > n) i--;
      order.splice(i, 0, n);
      tell("turn", t);
      return t;
    }

    /** The block a turn is adding to is closed: another kind began, or the
     *  turn ended — and which, because a block closed only by the turn's end
     *  takes words of its own kind that arrive after it (see `blockOf`).
     *  @param {Turn} t @param {number} at @param {boolean} [byEnd] */
    function close(t, at, byEnd) {
      const last = t.blocks[t.blocks.length - 1];
      if (last && last.end === null) { last.end = at; if (byEnd) last.byEnd = true; tell("close", t, last); }
    }

    /** @param {Turn} t @param {"think" | "prose" | "acts" | "hand"} kind @param {number} at @returns {Block} */
    function blockOf(t, kind, at) {
      const last = t.blocks[t.blocks.length - 1];
      // WORDS AFTER THE TURN'S END JOIN THE WORDS BEFORE IT. The stream says a
      // turn's last chunk and its end in that order, but a patch may carry
      // them the other way about; a reply is one reply either way, so a block
      // closed only by the end is still the one its kind continues.
      if (kind !== "hand" && last && last.kind === kind && (last.end === null || last.byEnd)) return last;
      close(t, at);
      /** @type {Block} */
      const b = { kind: kind, text: "", ids: [], at: at, end: null, n: t.blocks.length };
      t.blocks.push(b);
      tell("block", t, b);
      return b;
    }

    /** ONE UPDATE, folded in. Anything malformed is skipped rather than
     *  thrown: a chat that drew yesterday must still draw after a bad line.
     *  @param {any} u */
    function add(u) {
      if (!u || typeof u !== "object" || typeof u.kind !== "string") return;
      const n = typeof u.turn === "number" && u.turn >= 0 ? Math.floor(u.turn) : 0;
      const at = typeof u.at === "number" ? u.at : 0;
      if (typeof u.seq === "number" && u.seq > chat.seq) chat.seq = u.seq;
      chat.count++;
      switch (u.kind) {
        case "prompt": {
          const t = turnOf(n, at);
          t.prompt = typeof u.text === "string" ? u.text : "";
          t.at = at;
          tell("prompt", t);
          return;
        }
        case "reply":
        case "thought": {
          if (typeof u.text !== "string" || u.text === "") return;
          const t = turnOf(n, at);
          const b = blockOf(t, u.kind === "reply" ? "prose" : "think", at);
          b.text += u.text;
          tell("text", t, b, u.text);
          return;
        }
        case "tool": {
          const line = u.tool;
          if (!line || typeof line.id !== "string") return;
          const seq = typeof u.seq === "number" ? u.seq : 0;
          const held = tools.get(line.id);
          if (held) {
            if (held.seq >= seq) return;
            held.seq = seq; held.tool = line;
            const t = turns.get(held.turn);
            if (t) tell("tool", t, held.block, held, false);
            return;
          }
          const t = turnOf(n, at);
          const b = blockOf(t, "acts", at);
          /** @type {ToolEntry} */
          const entry = { id: line.id, seq: seq, tool: line, turn: t.n, block: b };
          tools.set(line.id, entry);
          b.ids.push(line.id);
          tell("tool", t, b, entry, true);
          return;
        }
        case "turn": {
          const t = turnOf(n, at);
          t.phase = typeof u.phase === "string" ? u.phase : null;
          if (typeof u.stop === "string") {
            t.stop = u.stop;
            t.reason = typeof u.reason === "string" ? u.reason : null;
            t.end = at;
            close(t, at, true);
          }
          tell("phase", t);
          return;
        }
        case "face": {
          if (!u.face || typeof u.face !== "object") return;
          const t = turnOf(n, at);
          t.face = u.face;
          tell("face", t);
          return;
        }
        case "name":
          chat.name = typeof u.name === "string" ? u.name : chat.name;
          tell("name", chat);
          return;
        case "agent": {
          const was = chat.harness;
          chat.harness = typeof u.harness === "string" ? u.harness : chat.harness;
          chat.agent = typeof u.agent === "string" ? u.agent : chat.agent;
          const t = turns.get(n);
          // A turn that has not begun yet begins under the new agent. One
          // already under way keeps the name it was drawn with, and the
          // handover is said where it happened: a line in the turn, after
          // whatever came before it. The first agent of a chat is no news.
          if (t && t.prompt === null && t.blocks.length === 0) t.agent = chat.harness;
          if (was !== null && was !== chat.harness) {
            const at2 = turnOf(n, at);
            const b = blockOf(at2, "hand", at);
            b.text = String(chat.harness || "");
            b.from = was;
            b.end = at;
            tell("close", at2, b);
          }
          return;
        }
        case "changed": {
          if (!Array.isArray(u.edits)) return;
          const t = turnOf(n, at);
          t.changed = u.edits;
          tell("changed", t);
          return;
        }
        case "config":
          if (Array.isArray(u.options)) chat.options = u.options;
          tell("config", chat);
          return;
        case "error": {
          const t = turnOf(n, at);
          t.errors.push(typeof u.message === "string" ? u.message : "Something went wrong.");
          tell("error", t, t.errors[t.errors.length - 1]);
          return;
        }
        default:
          // commands, usage and plan are kept by the server and not drawn yet.
          return;
      }
    }

    return {
      add: add,
      turns: turns,
      order: order,
      tools: tools,
      chat: chat,
      /** @param {Sink} s */
      listen(s) { sink = s || {}; },
      /** @param {number} n */
      turn(n) { return turns.get(n) || null; },
    };
  }

  /** THE MODEL NAME the chat's config says, or null: the option in the
   *  `model` category, as its choice's name. @param {any[]} options */
  function modelOf(options) {
    const o = (Array.isArray(options) ? options : []).find((x) => x && x.category === "model");
    if (!o) return null;
    const c = Array.isArray(o.choices) ? o.choices.find((/** @type {any} */ x) => x && x.value === o.value) : null;
    return c && typeof c.name === "string" ? c.name : typeof o.value === "string" ? o.value : null;
  }

  /** How long a stretch took, in whole seconds, never less than one.
   *  @param {number} from @param {number | null} to */
  function seconds(from, to) {
    if (typeof to !== "number" || !from) return 1;
    return Math.max(1, Math.round((to - from) / 1000));
  }

  /* ── what the look may say ─────────────────────────────────────────────── */

  const CHAT_ID = /^[A-Za-z0-9_-]{8,64}$/;

  /** THE ONLY THINGS THE LOOK EVER ASKS THE HOST, rebuilt field by field so
   *  nothing rides along: the four `look.*` kinds and `open` for a page or a
   *  table. Each carries an id or a word from a closed list, never text — the
   *  input box is Biom's, and only the person's typing reaches an agent. Null
   *  for anything else, and the look sends nothing.
   *  @param {string} kind @param {any} [p] @returns {{ kind: string, params: Record<string, any> } | null} */
  function request(kind, p) {
    const q = p || {};
    if (kind === "look.open") return typeof q.chat === "string" && CHAT_ID.test(q.chat) ? { kind: kind, params: { chat: q.chat } } : null;
    if (kind === "look.new") return { kind: kind, params: {} };
    if (kind === "look.list") return typeof q.open === "boolean" ? { kind: kind, params: { open: q.open } } : null;
    if (kind === "look.panel") return q.to === "screen" || q.to === "beside" || q.to === "closed" ? { kind: kind, params: { to: q.to } } : null;
    if (kind === "open") {
      const t = q.target;
      if (!t || (t.kind !== "page" && t.kind !== "table") || typeof t.id !== "string" || t.id === "" || t.id.charAt(0) === "@") return null;
      return { kind: kind, params: { target: { kind: t.kind, id: t.id } } };
    }
    return null;
  }

  /** WHAT A CHANGED FILE OPENS, and what it is called: a page by its uid
   *  through `names`, a table by its id, or nothing — a file no screen shows,
   *  a page since removed, a deletion.
   *  @param {any} edit @param {Record<string, any>} names
   *  @returns {{ label: string, where: string, target: { kind: "page" | "table", id: string } | null, page: boolean }} */
  function changedTarget(edit, names) {
    const path = typeof edit.path === "string" ? edit.path : "";
    const place = edit.place;
    if (place && place.view === "page" && typeof place.uid === "string") {
      const named = names && Object.prototype.hasOwnProperty.call(names, place.uid) ? names[place.uid] : null;
      if (named && typeof named.id === "string" && named.id !== "") {
        const label = typeof named.name === "string" && named.name !== "" ? named.name : named.id;
        return { label: label, where: named.id, target: edit.op === "deleted" ? null : { kind: "page", id: named.id }, page: true };
      }
      return { label: path || "a page", where: path, target: null, page: true };
    }
    if (place && place.view === "table" && typeof place.id === "string" && place.id !== "") {
      return { label: place.id, where: place.id, target: edit.op === "deleted" ? null : { kind: "table", id: place.id }, page: false };
    }
    return { label: path || "a file", where: path, target: null, page: false };
  }

  /** THE PAGE FOLDER A PATH IS IN, read the way the server's address table
   *  reads it (`addressOfPath` in server/domain/history.ts, which the box
   *  cannot import): `pages/<seg>(/children/<seg>)*`, each segment a page
   *  segment's grammar, the walk ending where one is not — and what is left
   *  below is the page's own. `folder` is the folder's path, `id` the page's
   *  id as the path names it, `last` its last segment. Null for a path that
   *  is under no page folder, or that climbs out with `..`.
   *  @param {any} path @returns {{ folder: string, id: string, last: string } | null} */
  function pageFolderOf(path) {
    if (typeof path !== "string") return null;
    const parts = path.replace(/^\.\//, "").split("/").filter((p) => p !== "" && p !== ".");
    if (parts.indexOf("..") >= 0 || parts[0] !== "pages") return null;
    const SEG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
    const head = parts[1];
    if (head === undefined || !SEG.test(head)) return null;
    const ids = [head];
    let at = 2;
    for (;;) {
      const next = parts[at + 1];
      if (parts[at] !== "children" || next === undefined || !SEG.test(next)) break;
      ids.push(next);
      at += 2;
    }
    return { folder: parts.slice(0, at).join("/"), id: ids.join("/"), last: String(ids[ids.length - 1]) };
  }

  /** A page's own document is ITS `content.yaml` — the file whose creation is
   *  the page's, whose removal removes it, whose move moves it — and no
   *  `content.yaml` further down: a child page's is the child's, and one
   *  under a folder that is no page's is only a file of this page's.
   *  @param {any} path */
  const ownDocument = (path) => {
    const f = pageFolderOf(path);
    return f !== null && String(path).replace(/^\.\//, "") === f.folder + "/content.yaml";
  };

  /** THE PAGES THE TURN CHANGED, one row each. The chat says what happened to
   *  each FILE; this says what happened to each PAGE, which is what the block
   *  is: every file placed at one page is one row, its counts summed, and the
   *  page reads Created, Deleted or Moved only when its own document was — a
   *  new file inside a page that was already there makes the page Edited. A
   *  table's writes are one row per table; a file no screen shows is a row of
   *  its own, as the file it is. In the order each first appears.
   *
   *  A PAGE DELETED IN THE TURN COMES WITH NO PLACE: the server places a file
   *  by the page's uid when the turn ends, and a page whose document is gone
   *  has none by then. So a place-less file under `pages/` is grouped by the
   *  page folder its path names, labelled by that folder's last segment, and
   *  opens nothing — the page it names is not there to open, or is not known
   *  to be.
   *  @param {any} edits @param {Record<string, any>} names
   *  @returns {{ label: string, where: string, target: { kind: "page" | "table", id: string } | null, page: boolean, op: string, added?: number, removed?: number }[]} */
  function changedRows(edits, names) {
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const e of Array.isArray(edits) ? edits : []) {
      if (!e || typeof e !== "object") continue;
      const place = e.place;
      const folder = place ? null : pageFolderOf(e.path);
      const key = place && place.view === "page" && typeof place.uid === "string" ? "page:" + place.uid
        : place && place.view === "table" && typeof place.id === "string" && place.id !== "" ? "table:" + place.id
        : folder ? "folder:" + folder.id
        : "file:" + String(e.path || "");
      const had = groups.get(key);
      if (had) had.push(e); else groups.set(key, [e]);
    }
    /** @type {{ label: string, where: string, target: { kind: "page" | "table", id: string } | null, page: boolean, op: string, added?: number, removed?: number }[]} */
    const out = [];
    for (const [key, list] of groups) {
      const isPage = key.startsWith("page:") || key.startsWith("folder:");
      const doc = isPage ? list.find((e) => ownDocument(e.path)) : undefined;
      const ops = [...new Set(list.map((e) => e.op))];
      const op = isPage
        ? (doc && (doc.op === "created" || doc.op === "deleted" || doc.op === "moved") ? doc.op : "edited")
        : ops.length === 1 ? String(ops[0]) : "edited";
      const folder = key.startsWith("folder:") ? pageFolderOf(list[0].path) : null;
      const to = folder
        ? { label: folder.last, where: folder.id, target: null, page: true }
        : changedTarget({ path: (doc || list[0]).path, place: list[0].place, op: op }, names);
      /** @type {{ label: string, where: string, target: { kind: "page" | "table", id: string } | null, page: boolean, op: string, added?: number, removed?: number }} */
      const row = { label: to.label, where: to.where, target: to.target, page: to.page, op: op };
      const counted = list.filter((e) => typeof e.added === "number" || typeof e.removed === "number");
      if (counted.length) {
        row.added = counted.reduce((n, e) => n + (typeof e.added === "number" ? e.added : 0), 0);
        row.removed = counted.reduce((n, e) => n + (typeof e.removed === "number" ? e.removed : 0), 0);
      }
      out.push(row);
    }
    return out;
  }

  /** @param {any} op */
  function opWords(op) {
    return op === "created" ? "Created" : op === "deleted" ? "Deleted" : op === "moved" ? "Moved" : "Edited";
  }

  glob.__gAgentLook = {
    artOf: artOf,
    emojiOf: emojiOf,
    lampOf: lampOf,
    lampWords: lampWords,
    stopWords: stopWords,
    groupOf: groupOf,
    whenOf: whenOf,
    grouped: grouped,
    subOf: subOf,
    toolWords: toolWords,
    runWords: runWords,
    viewOf: viewOf,
    lineDiff: lineDiff,
    countsOf: countsOf,
    countWords: countWords,
    mdTree: mdTree,
    TAGS: TAGS,
    ATTRS: ATTRS,
    settledEnd: settledEnd,
    makeTranscript: makeTranscript,
    modelOf: modelOf,
    seconds: seconds,
    request: request,
    changedTarget: changedTarget,
    changedRows: changedRows,
    opWords: opWords,
  };
})();
