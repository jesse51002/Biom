// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-agent-look/look.js — THE AGENT SCREEN'S DEFAULT LOOK. A
 * classic script; see registry.js for why there are no imports in here.
 *
 * WHAT IT IS. The Agent screen is a box on `@agent`, and everything in it but
 * the input box is drawn by the plugin its `look` variable names — this one,
 * unless a workspace names another in `plugins/biom-agent/extensions.yaml`.
 * It draws the start screen, a chat, the list of chats, and the panel's head
 * when the chat sits beside a page. It is the owner's mockup
 * (Specs/2026-09-24-Chat/Mockup), ported: `sheet.js` is its look on the box's
 * tokens and `model.js` its every decision; this file is the nodes.
 *
 * WHAT IT HEARS AND WHAT IT SAYS. It hears the chats through `biom.onLook`,
 * which the shim feeds from the host's `look.state` and `look.patch` with the
 * patches already folded in. It says four things and one more — `look.open`,
 * `look.new`, `look.list`, `look.panel`, and `open` for a page a turn changed
 * — every one of them built by `request` in the model from an id or a word on
 * a closed list. IT NEVER SENDS TEXT: the input box is Biom's, in the host,
 * over this box, so only the person's typing ever reaches an agent, and the
 * guards refuse anything else from here anyway.
 *
 * AN AGENT'S WORDS ARE UNTRUSTED. A reply, a thought, a tool's title, a diff, a
 * path and a page's name are each only ever a text node or an attribute value
 * set through `setAttribute`; there is no `innerHTML` in this file or its two
 * siblings, and a test holds that. The reply's markdown is read into a tree of
 * a closed set of tags by `mdTree`, and drawn from that.
 *
 * IT DRAWS IN A SHADOW ROOT of its own node, so its class names and its sheet
 * touch nothing of the document's and nothing of the document's touches it —
 * the tokens, which are inherited, still reach it.
 *
 * IT DRAWS INCREMENTALLY. A patch arrives at most once a frame; the transcript
 * folds it in and tells this file what moved — a turn begun, words appended, a
 * tool line changed — and only that node is touched. A reply as it streams is
 * cut at its last settled blank line: what is above is drawn once, and only
 * the paragraph still arriving is read again. A long chat draws its latest
 * FORTY turns, with a button for forty more, and each turn is
 * `content-visibility: auto`, so a chat of hundreds of turns costs what is on
 * screen. A tool line's diff or output is built only when it is opened, and
 * bounded when it is.
 *
 * STILLNESS. Under reduced motion, or `--motion: 0`, the root is marked
 * `data-still`, which stops every animation in the sheet; the ribbon is drawn
 * once and left; the word stops turning; a face is its emoji as text, because
 * no still art is vendored.
 *
 * TEARDOWN takes down every timer, frame, observer and listener it started,
 * and the node it drew into. */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  const SVG = "http://www.w3.org/2000/svg";
  /** The mockup's icons, as path data on a 16-pixel grid. */
  /** @type {Record<string, string[]>} */
  const ICONS = {
    plus: ["M8 3.25v9.5M3.25 8h9.5"],
    chev: ["m4 6.25 4 4 4-4"],
    chevr: ["m6.25 4 4 4-4 4"],
    expand: ["M9.75 2.25h4v4M6.25 13.75h-4v-4M13.75 2.25 9.4 6.6M2.25 13.75 6.6 9.4"],
    shrink: ["M2.75 9.25h4v4M13.25 6.75h-4v-4M6.75 9.25 2.25 13.75M9.25 6.75l4.5-4.5"],
    close: ["m4 4 8 8M12 4l-8 8"],
    down: ["M8 3v9.5M4 8.5l4 4 4-4"],
    page: ["M4 1.75h5.2l2.8 2.8v9.7H4Z", "M9 1.9v2.85h2.85"],
    check: ["m3.25 8.5 3 3 6.5-7"],
  };
  /** The start screen's last word, in turn. */
  const WORDS = ["automate", "plan", "create", "visualize"];
  /** How many of a chat's latest turns are drawn, and how many more each press. */
  const DRAW_TURNS = 40;
  /** The most of one tool's output drawn, in characters, and of one diff line. */
  const OUTPUT_CAP = 20000;
  const LINE_CAP = 2000;
  /** The most of one block of thinking drawn, in characters — written out or
   *  opened, it is bounded as an output is. */
  const THINK_CAP = 20000;

  /**
   * @param {any} node the document's own node, which this fills
   * @param {any} _content null: a document's variable names this plugin
   * @param {any} ctx the runtime's context; `ctx.call` is the guest port
   */
  function mount(node, _content, ctx) {
    const M = glob.__gAgentLook;
    const SHEET = glob.__gAgentLookSheet;
    const biom = glob.biom;
    if (!M || typeof SHEET !== "string") throw new Error("the look's own files did not load — model.js and sheet.js sit beside look.js in biom-agent-look/");
    if (!biom || typeof biom.onLook !== "function") throw new Error("this box's shim has no biom.onLook, so the look cannot hear the chats");

    /** @type {any} */
    const doc = node.ownerDocument || glob.document;
    /** @type {any} */
    const win = doc.defaultView || glob;
    let gone = false;

    /* ── the lifetime of everything started here ────────────────────────── */

    /** @type {Set<any>} */
    const timers = new Set();
    /** @type {Set<any>} */
    const frames = new Set();
    /** @type {(() => void)[]} */
    const undo = [];
    /** @param {() => void} fn @param {number} ms */
    const later = (fn, ms) => {
      const t = win.setTimeout(() => { timers.delete(t); if (!gone) fn(); }, ms);
      timers.add(t);
      return t;
    };
    /** @param {() => void} fn */
    const frame = (fn) => {
      if (typeof win.requestAnimationFrame !== "function") return later(fn, 16);
      const f = win.requestAnimationFrame(() => { frames.delete(f); if (!gone) fn(); });
      frames.add(f);
      return f;
    };
    /** @param {any} target @param {string} type @param {(e: any) => void} fn @param {any} [opts] */
    const listen = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      undo.push(() => target.removeEventListener(type, fn, opts));
    };

    /* ── nodes ──────────────────────────────────────────────────────────── */

    /** @param {string} tag @param {string} [cls] @param {any} [text] @returns {any} */
    function h(tag, cls, text) {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined && text !== null) e.textContent = String(text);
      return e;
    }
    /** @param {string} tag @param {string} cls @param {string} label @returns {any} */
    function button(tag, cls, label) {
      const b = h(tag, cls);
      if (tag === "button") b.type = "button";
      if (label) { b.setAttribute("aria-label", label); b.setAttribute("title", label); }
      return b;
    }
    /** @param {string} name @param {string} [cls] @returns {any} */
    function icon(name, cls) {
      const s = doc.createElementNS(SVG, "svg");
      s.setAttribute("class", cls || "ico");
      s.setAttribute("viewBox", "0 0 16 16");
      s.setAttribute("fill", "none");
      s.setAttribute("stroke", "currentColor");
      s.setAttribute("stroke-width", name === "check" ? "1.7" : "1.5");
      s.setAttribute("stroke-linecap", "round");
      s.setAttribute("stroke-linejoin", "round");
      s.setAttribute("aria-hidden", "true");
      for (const d of ICONS[name] || []) {
        const p = doc.createElementNS(SVG, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
      }
      return s;
    }
    /** @param {string} cls @returns {any} */
    const led = (cls) => h("span", "led " + cls);
    /** The three lamps in a row, running. */
    function leds3() { const w = h("span", "leds3"); for (let i = 0; i < 3; i++) w.appendChild(h("i")); return w; }
    /** The dot-matrix loader: a pulse running round a 3×3 sign. */
    function dm() { const w = h("span", "dm"); w.setAttribute("aria-label", "Starting"); for (let i = 0; i < 9; i++) w.appendChild(h("i")); return w; }
    /** @param {any} el @param {any[]} keyframes @param {any} opts */
    function animate(el, keyframes, opts) {
      if (still || !el || typeof el.animate !== "function") return null;
      try { return el.animate(keyframes, opts); } catch { return null; }
    }

    /* ── the frame of the look ──────────────────────────────────────────── */

    const host = h("div", "g-look-host");
    node.appendChild(host);
    /** @type {any} */
    const shadow = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    const style = h("style");
    style.textContent = SHEET;
    shadow.appendChild(style);

    const root = h("div", "g-look");
    root.setAttribute("data-mode", "screen");
    root.setAttribute("data-state", "empty");
    root.setAttribute("data-view", "tools");
    shadow.appendChild(root);

    // The history, down the left on the full screen.
    const threads = h("aside", "threads");
    threads.setAttribute("aria-label", "Chat history");
    const inner = h("div", "inner");
    const thead = h("div", "thead");
    thead.appendChild(h("span", "", "Chat history"));
    const newthread = button("button", "newthread", "");
    newthread.appendChild(icon("plus"));
    newthread.appendChild(doc.createTextNode("New thread"));
    newthread.appendChild(h("kbd", "", "Ctrl N"));
    const tlist = h("div", "tlist");
    tlist.setAttribute("role", "listbox");
    tlist.setAttribute("aria-label", "Chats");
    inner.appendChild(thead); inner.appendChild(newthread); inner.appendChild(tlist);
    threads.appendChild(inner);

    // The panel's head, beside a page.
    const panelhead = h("div", "panelhead");
    const tswitch = button("button", "tswitch", "");
    tswitch.setAttribute("aria-haspopup", "listbox");
    tswitch.setAttribute("aria-expanded", "false");
    const tsEmo = h("span", "emo");
    const tsLed = led("none");
    const tsName = h("span", "nm", "New thread");
    tswitch.appendChild(tsEmo); tswitch.appendChild(tsLed); tswitch.appendChild(tsName); tswitch.appendChild(icon("chev"));
    const pnew = button("button", "iconbtn", "New thread");
    pnew.appendChild(icon("plus"));
    const pexpand = button("button", "iconbtn", "Open full size");
    pexpand.appendChild(icon("expand"));
    const pclose = button("button", "iconbtn", "Close the chat");
    pclose.appendChild(icon("close"));
    panelhead.appendChild(tswitch); panelhead.appendChild(pnew); panelhead.appendChild(pexpand); panelhead.appendChild(pclose);

    // The stage: the ribbon, the start screen's two lines, and the thread.
    const stage = h("div", "stage");
    const fx = h("div", "fx");
    fx.setAttribute("aria-hidden", "true");
    const heroTop = h("div", "hero hero-top");
    const line = h("h1", "line");
    const swap = h("span", "swap");
    swap.appendChild(h("span", "", WORDS[0]));
    line.appendChild(doc.createTextNode("What should we "));
    line.appendChild(swap);
    line.appendChild(doc.createTextNode("?"));
    heroTop.appendChild(line);
    const heroBot = h("div", "hero hero-bot");
    const histwrap = h("div", "histwrap");
    const histlink = button("button", "histlink", "");
    histlink.setAttribute("aria-expanded", "false");
    const hlDot = h("span", "hl-dot");
    const hlText = h("span", "", "View chat history");
    histlink.appendChild(hlDot); histlink.appendChild(hlText);
    histwrap.appendChild(histlink);
    heroBot.appendChild(histwrap);
    const log = h("div", "log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-label", "Chat");
    const col = h("div", "col");
    log.appendChild(col);
    const fade = h("div", "fade");
    const jump = button("button", "jump", "");
    jump.appendChild(icon("down"));
    jump.appendChild(doc.createTextNode("Latest"));
    const minbtn = button("button", "iconbtn minbtn", "Minimize beside the page");
    minbtn.appendChild(icon("shrink"));
    minbtn.hidden = true;
    stage.appendChild(fx); stage.appendChild(heroTop); stage.appendChild(heroBot); stage.appendChild(log);
    stage.appendChild(fade); stage.appendChild(jump); stage.appendChild(minbtn);

    root.appendChild(threads); root.appendChild(panelhead); root.appendChild(stage);

    /** @type {any} the dropdown of chats in the panel, while it is open */
    let menu = null;

    /* ── what is held ───────────────────────────────────────────────────── */

    /** @type {any} the LookState as last handed over */
    let S = null;
    /** The chat whose transcript is built, or undefined before the first state. */
    /** @type {string | null | undefined} */
    let heldChat = undefined;
    /** @type {any} the transcript of the open chat, or null on the start screen */
    let T = null;
    let listOpen = false;
    let mode = "screen";
    /** @type {Set<string>} chats already listed, so a new one slides in */
    const listed = new Set();
    let listedOnce = false;
    let listSig = "";
    let menuSig = "";
    /** @type {Record<string, string>} each chat's face as last drawn, for the flip */
    const rowFaces = {};

    /* ── motion ─────────────────────────────────────────────────────────── */

    const media = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
    function stillNow() {
      if (media && media.matches) return true;
      try { return String(win.getComputedStyle(doc.documentElement).getPropertyValue("--motion")).trim() === "0"; }
      catch { return false; }
    }
    let still = stillNow();
    root.toggleAttribute("data-still", still);
    if (media) {
      const onMedia = () => {
        const was = still;
        still = stillNow();
        root.toggleAttribute("data-still", still);
        if (was === still) return;
        startScreen();
        for (const v of views.values()) paintMood(v, true);
      };
      if (typeof media.addEventListener === "function") listen(media, "change", onMedia);
    }

    /* ── asking the host ────────────────────────────────────────────────── */

    /** EVERY REQUEST GOES THROUGH HERE, and `request` in the model is the
     *  whole of what may be said: an id or a closed word, rebuilt field by
     *  field. A refusal puts back whatever was drawn ahead of the answer.
     *  @param {string} kind @param {any} [params] @param {() => void} [back] */
    function ask(kind, params, back) {
      if (gone) return;
      const r = M.request(kind, params);
      if (!r) return;
      /** @type {any} */
      let sent;
      try { sent = ctx.call(r.kind, r.params); } catch (e) { sent = Promise.reject(e); }
      Promise.resolve(sent).catch((/** @type {any} */ e) => {
        if (!gone && back) back();
        if (glob.console) glob.console.warn("[biom-agent-look] " + r.kind + ": " + String((e && e.message) || e));
      });
    }

    /** Open or shut the list, drawn at once and put back if the host refuses.
     *  @param {boolean} open */
    function setList(open) {
      listOpen = open;
      drawMenu(); layout(); drawStart();
      ask("look.list", { open: open }, () => { listOpen = !!(S && S.list); drawMenu(); layout(); drawStart(); });
    }

    /** @param {string} id */
    function pick(id) {
      if (mode === "panel" && listOpen) { listOpen = false; drawMenu(); ask("look.list", { open: false }); }
      if (S && id === S.chat) return;
      ask("look.open", { chat: id });
    }

    function fresh() {
      if (mode === "panel") {
        if (listOpen) { listOpen = false; drawMenu(); ask("look.list", { open: false }); }
        ask("look.new");
        return;
      }
      // New thread on the full screen is the start screen WITH the history
      // open, as the spec says of the rail's own.
      ask("look.new");
      if (!listOpen) setList(true);
    }

    listen(newthread, "click", fresh);
    listen(pnew, "click", fresh);
    listen(pexpand, "click", () => ask("look.panel", { to: "screen" }));
    listen(pclose, "click", () => ask("look.panel", { to: "closed" }));
    listen(minbtn, "click", () => ask("look.panel", { to: "beside" }));
    listen(tswitch, "click", () => setList(!listOpen));
    listen(histlink, "click", () => setList(!listOpen));
    listen(doc, "keydown", (/** @type {any} */ e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && listOpen && mode === "panel") { setList(false); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "n") { e.preventDefault(); fresh(); }
    });
    listen(doc, "pointerdown", (/** @type {any} */ e) => {
      if (!menu || !listOpen || mode !== "panel") return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      if (path.indexOf(menu) >= 0 || path.indexOf(tswitch) >= 0) return;
      setList(false);
    });

    /* ── the list of chats ──────────────────────────────────────────────── */

    function current() {
      if (!S || !Array.isArray(S.chats) || S.chat === null) return null;
      for (const c of S.chats) if (c && c.id === S.chat) return c;
      return null;
    }

    /** A chat's emoji, or the loader while it is being named. @param {any} c */
    function emoOf(c) {
      const e = h("span", "emo");
      e.setAttribute("aria-hidden", "true");
      const face = M.emojiOf(c.face);
      if (face) e.textContent = face;
      else if (c.turn <= 1 && (c.phase === "starting" || c.phase === "running")) e.appendChild(dm());
      return e;
    }

    /** @param {any} c @param {number} now */
    function rowSig(c, now) {
      const sub = M.subOf(c, now);
      return [c.id, c.name, M.emojiOf(c.face), c.light, sub.text, sub.working, c.id === (S && S.chat), c.phase, c.turn].join("\u0001");
    }

    /** @param {any} c @param {number} now */
    function row(c, now) {
      const r = h("div", "trow");
      r.setAttribute("role", "option");
      r.setAttribute("tabindex", "0");
      r.setAttribute("aria-selected", String(!!S && c.id === S.chat));
      if (listedOnce && !listed.has(c.id)) r.classList.add("enter");
      const emo = emoOf(c);
      const tt = h("span", "tt");
      tt.appendChild(h("span", "t", c.name || "New chat"));
      const sub = M.subOf(c, now);
      const s = h("span", "s");
      if (sub.working) { s.appendChild(h("span", "w", "Working")); s.appendChild(doc.createTextNode(" · " + sub.text)); }
      else s.textContent = sub.text;
      tt.appendChild(s);
      const lamp = led(M.lampOf(c.light));
      const words = M.lampWords(c, now);
      if (words) lamp.setAttribute("title", words);
      r.appendChild(emo); r.appendChild(tt); r.appendChild(lamp);
      r.addEventListener("click", () => pick(c.id));
      r.addEventListener("keydown", (/** @type {any} */ e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(c.id); } });
      // THE NAME'S FACE UNFOLDS the first time Jev has picked one.
      const face = M.emojiOf(c.face);
      if (face && rowFaces[c.id] === "" ) animate(emo, [{ transform: "scaleY(0)" }, { transform: "scaleY(1.15)", offset: 0.7 }, { transform: "scaleY(1)" }], { duration: 200, easing: "ease-out" });
      rowFaces[c.id] = face;
      return r;
    }

    function drawList() {
      if (!S) return;
      const now = Date.now();
      const groups = M.grouped(S.chats, now);
      const sig = groups.map((/** @type {any} */ g) => g.label + "\u0002" + g.chats.map((/** @type {any} */ c) => rowSig(c, now)).join("\u0003")).join("\u0004");
      if (sig === listSig) return;
      listSig = sig;
      tlist.replaceChildren();
      if (!groups.length) tlist.appendChild(h("div", "tnone", "No chats yet. What you ask starts one."));
      for (const g of groups) {
        tlist.appendChild(h("div", "tgroup", g.label));
        for (const c of g.chats) tlist.appendChild(row(c, now));
      }
      for (const g of groups) for (const c of g.chats) listed.add(c.id);
      listedOnce = true;
      newthread.setAttribute("aria-current", String(S.chat === null));
    }

    /** THE HISTORY AS A DROPDOWN, in the panel, while the list is open. */
    function drawMenu() {
      const want = !!S && mode === "panel" && listOpen;
      tswitch.setAttribute("aria-expanded", String(want));
      if (!want) { if (menu) { menu.remove(); menu = null; menuSig = ""; } return; }
      const now = Date.now();
      const groups = M.grouped(S.chats, now);
      const sig = groups.map((/** @type {any} */ g) => g.label + "\u0002" + g.chats.map((/** @type {any} */ c) => rowSig(c, now)).join("\u0003")).join("\u0004");
      if (menu && sig === menuSig) return;
      menuSig = sig;
      if (!menu) {
        menu = h("div", "menu");
        menu.setAttribute("role", "listbox");
        menu.setAttribute("aria-label", "Chats");
        root.appendChild(menu);
      }
      menu.replaceChildren();
      const nt = h("button", "mi");
      nt.type = "button";
      nt.appendChild(icon("plus"));
      nt.appendChild(h("span", "nm", "New thread"));
      nt.addEventListener("click", fresh);
      menu.appendChild(nt);
      for (const g of groups) {
        menu.appendChild(h("div", "mlabel", g.label));
        for (const c of g.chats) {
          const it = h("button", "mi");
          it.type = "button";
          it.setAttribute("role", "option");
          it.setAttribute("aria-selected", String(c.id === S.chat));
          it.appendChild(emoOf(c));
          const txt = h("span", "txt");
          txt.appendChild(h("span", "nm", c.name || "New chat"));
          it.appendChild(txt);
          const lamp = led(M.lampOf(c.light));
          const words = M.lampWords(c, now);
          if (words) lamp.setAttribute("title", words);
          it.appendChild(lamp);
          if (c.id === S.chat) it.appendChild(icon("check", "check"));
          it.addEventListener("click", () => pick(c.id));
          menu.appendChild(it);
        }
      }
    }

    /** THE PANEL'S HEAD: the open chat's face, light and name. */
    function drawHead() {
      const c = current();
      tsName.textContent = c ? (c.name || "New chat") : "New thread";
      tsEmo.textContent = c ? M.emojiOf(c.face) : "";
      tsLed.className = "led " + (c ? M.lampOf(c.light) : "none");
    }

    function drawMin() {
      const beside = S && S.beside && typeof S.beside.name === "string" ? S.beside : null;
      minbtn.hidden = !(mode === "screen" && beside);
      const label = beside ? "Minimize beside " + beside.name : "Minimize beside the page";
      minbtn.setAttribute("aria-label", label);
      minbtn.setAttribute("title", label);
    }

    function layout() {
      root.setAttribute("data-mode", mode);
      root.toggleAttribute("data-threads", mode === "screen" && !!S && (S.chat !== null || listOpen));
    }

    /** THE VIEW THE PERSON PICKED, on the root: the sheet shows each block by
     *  it — a run of tool calls not drawn in Plain, the thinking written out
     *  in Thinking — so a view picked moves no node and draws nothing again,
     *  and a reader at the end of the chat is kept there.
     *  @param {any} v */
    function setView(v) {
      const want = M.viewOf(v);
      if (root.getAttribute("data-view") === want) return;
      root.setAttribute("data-view", want);
      if (pinned) { pin(); frame(pin); }
    }

    /** Biom's input box sits over this box; the look leaves it `height`. @param {any} input */
    function setInput(input) {
      const px = input && typeof input.height === "number" && isFinite(input.height) && input.height > 0 ? Math.min(Math.round(input.height), 2000) : 0;
      root.style.setProperty("--l-in", px + "px");
    }

    /* ── the start screen ───────────────────────────────────────────────── */

    const ribbon = makeRibbon();
    let wordAt = 0;
    /** @type {any} */
    let wordTimer = null;
    let startShown = true;
    /** False until the first state is drawn: the screen a box opens on is
     *  simply there, and only a change after that is animated. */
    let settled = false;

    function nextWord() {
      wordAt = (wordAt + 1) % WORDS.length;
      const old = swap.lastElementChild;
      const n = h("span", "in", WORDS[wordAt]);
      swap.appendChild(n);
      fitWord();
      void n.offsetWidth;
      n.classList.remove("in");
      if (old) { old.classList.add("out"); later(() => old.remove(), 500); }
    }
    /** The word's own width, so the line re-centres as it turns. */
    function fitWord() {
      const probe = h("span", "", WORDS[wordAt]);
      probe.style.setProperty("position", "absolute");
      probe.style.setProperty("visibility", "hidden");
      probe.style.setProperty("white-space", "nowrap");
      line.appendChild(probe);
      const w = probe.getBoundingClientRect ? probe.getBoundingClientRect().width : 0;
      probe.remove();
      if (w > 0) swap.style.setProperty("width", w + "px");
    }

    /** THE START SCREEN SHOWN OR CLEARED, and everything that moves on it
     *  started or stopped with it. */
    function startScreen() {
      const empty = !S || S.chat === null;
      root.setAttribute("data-state", empty ? "empty" : "live");
      if (wordTimer !== null) { win.clearInterval(wordTimer); timers.delete(wordTimer); wordTimer = null; }
      if (empty) {
        if (!startShown) {
          startShown = true;
          for (const hero of [heroTop, heroBot]) { hero.classList.remove("leaving"); hero.classList.remove("arriving"); void hero.offsetWidth; if (!still && settled) hero.classList.add("arriving"); }
        }
        ribbon.enter();
        fitWord();
        if (!still) { wordTimer = win.setInterval(() => { if (!gone) nextWord(); }, 2600); timers.add(wordTimer); }
      } else {
        if (startShown) {
          startShown = false;
          if (!still && settled) {
            for (const hero of [heroTop, heroBot]) hero.classList.add("leaving");
            later(() => { heroTop.classList.remove("leaving"); heroBot.classList.remove("leaving"); }, 560);
          }
        }
        ribbon.exit();
      }
      drawStart();
    }

    /** "View chat history", with how many are working. */
    function drawStart() {
      const working = S && Array.isArray(S.chats) ? S.chats.filter((/** @type {any} */ c) => c && c.light === "working").length : 0;
      hlDot.className = working ? "hl-dot led lit pulse" : "hl-dot";
      hlText.textContent = working ? "View chat history · " + working + " working" : "View chat history";
      histlink.setAttribute("aria-expanded", String(listOpen));
    }

    /** THE LANDING PAGE'S RIBBON OF DOTS, as the mockup draws it: fine strands
     *  of dots at 25 degrees, twisting as they go, drifting along themselves,
     *  brightest where the ribbon is edge-on, with a glow running its length.
     *  Drawn in `--led`, read off a probe because a canvas cannot read a
     *  custom property. Still, it is drawn once and left. */
    function makeRibbon() {
      const c = h("canvas");
      fx.appendChild(c);
      /** @type {any} */
      const g = typeof c.getContext === "function" ? c.getContext("2d") : null;
      const probe = h("span");
      probe.style.setProperty("color", "var(--l-led)");
      probe.style.setProperty("display", "none");
      root.appendChild(probe);
      let colour = "";
      let W = 0, H = 0, L = 0, raf = 0, last = 0, running = false;
      /** @param {number} n @param {number} seed */
      const strands = (n, seed) => {
        let a = seed;
        const r = () => { a = (a + 0x6D2B79F5) | 0; let q = Math.imul(a ^ (a >>> 15), 1 | a); q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q; return ((q ^ (q >>> 14)) >>> 0) / 4294967296; };
        return Array.from({ length: n }, (_, j) => ({ o: (j / (n - 1)) * 2 - 1, b: 0.3 + 0.7 * Math.pow(r(), 0.8), gap: 7 + r() * 10, jit: 0.3 + r() * 0.5, ph: r() * 1000, v: 14 + r() * 30, wa: 2 + r() * 7, wf: 0.004 + r() * 0.01, wp: r() * 6.28 }));
      };
      const R = { deg: 25, fx: 0.5, fy: 0.58, half: 0.4, bend: 0.12, n: 96, gain: 1, tw: -0.05, t0: 0, s: strands(96, 20260923) };
      const ALPHA = [0.28, 0.5, 0.75, 1], FLOW = 7000;
      function recolour() {
        try { colour = String(win.getComputedStyle(probe).color || ""); } catch { colour = ""; }
      }
      function size() {
        if (!g) return;
        const r = stage.getBoundingClientRect();
        const dpr = Math.min(2, win.devicePixelRatio || 1);
        W = r.width; H = r.height; L = Math.hypot(W, H) + 320;
        c.width = Math.max(1, Math.round(W * dpr)); c.height = Math.max(1, Math.round(H * dpr));
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      /** @param {number} now @param {number | null} sp */
      function draw(now, sp) {
        if (!g || !W || !H) return;
        if (!colour) recolour();
        const t = now / 1000, m = Math.min(W, H), narrow = W < 620;
        g.clearRect(0, 0, W, H);
        const buckets = ALPHA.map(() => new win.Path2D());
        const sl = R.deg * Math.PI / 180, dx = Math.cos(sl), dy = Math.sin(sl), nx = -dy, ny = dx;
        const cx = R.fx * W, cy = R.fy * H, half = R.half * m * (narrow ? 1.3 : 1), bend = R.bend * m, tt = t + R.t0;
        const count = narrow ? Math.round(R.n * 0.6) : R.n;
        for (let j = 0; j < count; j++) {
          const st = R.s[Math.round(j * (R.s.length - 1) / Math.max(1, count - 1))];
          if (!st) continue;
          const base = st.ph + tt * st.v, k0 = Math.floor(base / st.gap), shift = base - k0 * st.gap;
          const n = Math.ceil(L / st.gap) + 1;
          for (let k = 0; k < n; k++) {
            const s = -L / 2 + k * st.gap + shift + st.jit * st.gap * 0.5 * Math.sin((k - k0) * 1.7 + st.ph);
            const u = s / L;
            const tw = Math.cos(Math.PI * (u * 1.9 + R.tw) + tt * 0.07);
            const off = bend * Math.sin(Math.PI * 1.5 * u + 0.9 + tt * 0.05) + st.o * half * tw + st.wa * Math.sin(s * st.wf + st.wp + tt * 0.6);
            const x = cx + dx * s + nx * off, y = cy + dy * s + ny * off;
            if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
            const glow = sp === null ? 0 : Math.exp(-(((s - sp) / 150) ** 2));
            const bright = st.b * (0.45 + 0.55 * (1 - Math.abs(tw))) * (1 - 0.35 * Math.abs(st.o) ** 3) * R.gain;
            const a = Math.min(1, bright + glow * 0.6 * R.gain);
            if (a < 0.06) continue;
            const rr = 0.6 + 1.5 * bright + glow * 1.1;
            const bi = a > 0.75 ? 3 : a > 0.5 ? 2 : a > 0.28 ? 1 : 0;
            const path = buckets[bi];
            if (!path) continue;
            path.moveTo(x + rr, y); path.arc(x, y, rr, 0, 6.2832);
          }
        }
        g.fillStyle = colour || "currentColor";
        buckets.forEach((path, i) => { g.globalAlpha = (ALPHA[i] || 1) * 0.82; g.fill(path); });
        g.globalAlpha = 1;
      }
      /** @param {number} now */
      const pulseAt = (now) => ((now % FLOW) / FLOW) * (L + 400) - L / 2 - 200;
      /** @param {number} now */
      function tick(now) {
        frames.delete(raf);
        raf = 0;
        if (gone || !running) return;
        raf = win.requestAnimationFrame(tick);
        frames.add(raf);
        if (now - last < 32) return;
        last = now;
        draw(now, pulseAt(now));
      }
      function stopFrames() { if (raf) { win.cancelAnimationFrame(raf); frames.delete(raf); raf = 0; } }
      /** @type {any} */
      let ro = null;
      if (g && typeof win.ResizeObserver === "function") {
        ro = new win.ResizeObserver(() => {
          if (gone || !running) return;
          size();
          const now = win.performance ? win.performance.now() : 0;
          if (still) draw(0, null); else { draw(now, pulseAt(now)); last = now; }
        });
        ro.observe(stage);
      }
      return {
        enter() {
          if (!g) return;
          running = true;
          c.classList.remove("gone");
          size();
          stopFrames();
          if (still || typeof win.requestAnimationFrame !== "function") { draw(0, null); return; }
          raf = win.requestAnimationFrame(tick);
          frames.add(raf);
        },
        exit() {
          if (!running) return;
          running = false;
          c.classList.add("gone");
          later(() => { if (!running) { stopFrames(); if (g) g.clearRect(0, 0, W, H); } }, still ? 0 : 520);
        },
        recolour() { recolour(); if (running && still) draw(0, null); },
        destroy() { running = false; stopFrames(); if (ro) ro.disconnect(); },
      };
    }

    /* ── the thread ─────────────────────────────────────────────────────── */

    /**
     * @typedef {{ n: number, wrap: any, uw: any, u: any, mood: any, moodKey: string, turn: any, who: any,
     *   whoName: any, whoLed: any, notes: any, changes: any, foot: any, blocks: Map<any, any>, live: boolean }} TurnView
     */
    /** @type {Map<number, TurnView>} */
    const views = new Map();
    /** The index in the transcript's order of the first turn drawn. */
    let drawFrom = 0;
    /** @type {any} */
    let earlier = null;
    /** @type {Set<any>} prose blocks with words not yet drawn */
    const dirty = new Set();

    /** Where a turn is: live while it is the chat's latest and running.
     *  @param {any} t */
    function liveOf(t) {
      if (!t || t.stop) return false;
      const c = current();
      const phase = c && t.n === c.turn ? c.phase : c ? null : t.phase;
      return phase === "held" || phase === "starting" || phase === "running";
    }
    /** @param {any} t */
    function phaseOf(t) {
      const c = current();
      return c && t.n === c.turn ? c.phase : t.phase;
    }

    /** THE MARKDOWN TREE, AS NODES. Tags come from the model's closed set;
     *  every leaf is a text node; the only attributes are the model's.
     *  @param {any[]} tree @param {any} into */
    function build(tree, into) {
      for (const n of tree) {
        if (typeof n === "string") { into.appendChild(doc.createTextNode(n)); continue; }
        if (!n || !M.TAGS.has(n.t)) continue;
        const e = doc.createElement(n.t);
        if (n.a) for (const k of Object.keys(n.a)) if (M.ATTRS.has(k)) e.setAttribute(k, String(n.a[k]));
        build(n.c || [], e);
        into.appendChild(e);
      }
    }

    /** @param {any} b a prose block @param {any} t its turn */
    function proseView(b, t) {
      const el = h("div", "prose");
      const tail = h("div", "tail");
      const caret = h("span", "caret");
      // TWO WAYS TO DRAW THE WORDS, and which is decided on every paint from
      // what the block and its turn say now — never latched. A reply's last
      // chunk and its turn's end often arrive in one patch, in either order,
      // and the summary saying idle can come before either: a block first
      // drawn "finished" while its text was still empty must still draw the
      // words that follow. `whole` is how much of the text was last read
      // whole, or -1 while it streams.
      const bv = {
        kind: "prose", el: el, settled: 0, whole: -1,
        paint() {
          if (b.end !== null || !liveOf(t)) {
            if (bv.whole !== b.text.length) bv.finish();
            return;
          }
          if (bv.whole >= 0) {
            // Read whole while the turn looked over, and it is running after
            // all: stream again from the top.
            el.replaceChildren(tail);
            bv.settled = 0;
            bv.whole = -1;
          }
          const end = M.settledEnd(b.text, bv.settled);
          if (end > bv.settled) {
            const frag = h("div");
            build(M.mdTree(b.text.slice(bv.settled, end)), frag);
            while (frag.firstChild) el.insertBefore(frag.firstChild, tail);
            bv.settled = end;
          }
          tail.replaceChildren();
          build(M.mdTree(b.text.slice(bv.settled)), tail);
          /** @type {any} */
          let at = tail;
          while (at.lastElementChild && /^(P|H[1-6]|UL|OL|LI|BLOCKQUOTE)$/.test(String(at.lastElementChild.tagName).toUpperCase())) at = at.lastElementChild;
          at.appendChild(caret);
        },
        /** The whole reply read once more as one, which puts right a list
         *  or a link a cut had split, and the caret gone. Read again if more
         *  words arrive after it. */
        finish() {
          bv.whole = b.text.length;
          el.replaceChildren();
          build(M.mdTree(b.text), el);
        },
      };
      el.appendChild(tail);
      bv.paint();
      return bv;
    }

    /** A BLOCK OF THINKING, drawn both ways at once: the one line it folds
     *  to — *Thinking*, then *Thought for Ns*, which opens it — and the words
     *  themselves. Which shows is the root's `data-view` in the sheet, so a
     *  view picked moves no node: folded in Plain and Tool calls (the words
     *  there only while the line is opened), written out in Thinking. The
     *  words are a text node, appended as they stream and bounded.
     *  @param {any} b a thinking block @param {any} t its turn */
    function thinkView(b, t) {
      const el = h("div", "bw thinkw");
      const row = h("button", "think");
      row.type = "button";
      const body = h("div", "thought");
      const first = Math.min(b.text.length, THINK_CAP);
      const words = doc.createTextNode(b.text.slice(0, first));
      body.appendChild(words);
      const more = h("span", "more");
      more.hidden = true;
      body.appendChild(more);
      el.appendChild(row); el.appendChild(body);
      let label = "";
      row.addEventListener("click", () => {
        if (!row.classList.contains("done")) return;
        const open = !el.hasAttribute("data-open");
        el.toggleAttribute("data-open", open);
        row.setAttribute("aria-expanded", String(open));
      });
      const bv = {
        kind: "think", el: el, shown: first,
        paint() {
          if (b.text.length > bv.shown && bv.shown < THINK_CAP) {
            const to = Math.min(b.text.length, THINK_CAP);
            words.appendData(b.text.slice(bv.shown, to));
            bv.shown = to;
          }
          if (b.text.length > THINK_CAP) {
            more.hidden = false;
            more.textContent = (b.text.length - THINK_CAP) + " more characters not shown";
          }
          const done = b.end !== null || !liveOf(t);
          const want = done ? "done:" + M.seconds(b.at, b.end) : "live";
          if (want === label) return;
          label = want;
          row.replaceChildren();
          if (done) {
            row.classList.add("done");
            row.setAttribute("aria-expanded", String(el.hasAttribute("data-open")));
            row.appendChild(icon("chevr"));
            row.appendChild(h("span", "", b.end !== null ? "Thought for " + M.seconds(b.at, b.end) + "s" : "Thought"));
          } else {
            row.classList.remove("done");
            row.removeAttribute("aria-expanded");
            row.appendChild(leds3());
            row.appendChild(h("span", "", "Thinking"));
          }
        },
      };
      bv.paint();
      return bv;
    }

    /** What an opened tool line shows: each diff with its path and its rows,
     *  or the output, bounded, or the places it named. @param {any} det @param {any} tool */
    function fillDetail(det, tool) {
      det.replaceChildren();
      const diffs = Array.isArray(tool.diffs) ? tool.diffs : [];
      /** @param {string} cls @param {string} s */
      const dl = (cls, s) => det.appendChild(h("div", "dl " + cls, s.length > LINE_CAP ? s.slice(0, LINE_CAP) + "…" : s));
      for (const d of diffs) {
        if (!d) continue;
        const r = M.lineDiff(d.old, d.new, 400);
        dl("path", String(d.path || "") + (M.countWords(r.added, r.removed) ? "  " + M.countWords(r.added, r.removed) : "") + (d.old === null ? "  new file" : ""));
        for (const one of r.rows) dl(one.k, one.k === "add" ? "+" + one.s : one.k === "del" ? "-" + one.s : one.k === "gap" ? "  ⋯ " + one.s : " " + one.s);
        if (r.cut) dl("dim", "  " + r.cut + " more lines not shown");
      }
      const out = typeof tool.output === "string" ? tool.output : "";
      if (out) {
        const pre = h("pre", "out", out.length > OUTPUT_CAP ? out.slice(0, OUTPUT_CAP) : out);
        det.appendChild(pre);
        if (out.length > OUTPUT_CAP) dl("dim", (out.length - OUTPUT_CAP) + " more characters not shown");
      }
      if (tool.truncated) dl("dim", "The agent's output was cut short before it reached Biom.");
      if (!diffs.length && !out) {
        const locs = Array.isArray(tool.locations) ? tool.locations : [];
        for (const l of locs) if (l && typeof l.path === "string") dl("dim", l.path + (typeof l.line === "number" ? ":" + l.line : ""));
        if (!locs.length && !tool.truncated) dl("dim", "Nothing more to show.");
      }
    }

    /** A RUN OF TOOL CALLS — every call with no thinking and no reply between
     *  them — as ONE line that opens to them: *Used 3 tools ›*, or while the
     *  turn runs *Using 3 tools* with the call in progress after it, muted, and
     *  a failed call's red mark on the line while it is shut, so a failure is
     *  never folded out of sight. Opened, each call is its own line, which
     *  opens to its diff or its output as before. Both are buttons, both keep
     *  whether they are open while the turn streams — a call joining an open
     *  run leaves it open, one joining a shut run leaves it shut — and in
     *  Plain the whole run is not drawn at all (the sheet, by the root's
     *  `data-view`), so a view picked moves no node.
     *  @param {any} b a block of tool lines @param {any} t its turn */
    function actsView(b, t) {
      const el = h("div", "acts");
      const grp = h("button", "grp");
      grp.type = "button";
      grp.setAttribute("aria-expanded", "false");
      const glamp = h("span", "led");
      const glabel = h("span", "glabel");
      const gcur = h("span", "gcur");
      const gfail = h("span", "gfail");
      gfail.hidden = true;
      grp.appendChild(glamp); grp.appendChild(glabel); grp.appendChild(gcur); grp.appendChild(gfail); grp.appendChild(icon("chevr"));
      const list = h("div", "grplist");
      list.hidden = true;
      el.appendChild(grp); el.appendChild(list);
      let gsig = "";
      grp.addEventListener("click", () => {
        const open = grp.getAttribute("aria-expanded") !== "true";
        grp.setAttribute("aria-expanded", String(open));
        list.hidden = !open;
      });
      /** @type {Map<string, any>} */
      const lines = new Map();
      /** The shut line: how many, whether the run is still going and what is
       *  in progress, and how many failed. */
      function paintGroup() {
        /** @type {any[]} */
        const tools = [];
        for (const id of b.ids) { const e = T && T.tools.get(id); if (e) tools.push(e.tool); }
        const anyLive = tools.some((x) => M.toolWords(x).live);
        const w = M.runWords(tools, liveOf(t) && (b.end === null || anyLive));
        const sig = [w.label, w.current, w.failed, w.live].join("\u0001");
        if (sig === gsig) return;
        gsig = sig;
        glabel.textContent = w.label;
        gcur.textContent = w.current;
        gcur.hidden = w.current === "";
        glamp.className = w.live ? "led lit pulse" : "led none";
        gfail.hidden = w.failed === 0;
        gfail.replaceChildren();
        if (w.failed) { gfail.appendChild(led("red")); gfail.appendChild(doc.createTextNode(w.failed + " failed")); }
        grp.setAttribute("data-state", w.live ? "live" : "done");
        grp.setAttribute("aria-label", w.label + (w.current ? ", " + w.current : "") + (w.failed ? ", " + w.failed + " failed" : ""));
      }
      const bv = {
        kind: "acts", el: el, group: paintGroup,
        /** @param {any} entry */
        line(entry) {
          let v = lines.get(entry.id);
          if (!v) {
            const w = h("div", "actw");
            const btn = h("button", "act");
            btn.type = "button";
            btn.setAttribute("aria-expanded", "false");
            const lamp = h("span", "led");
            const verb = h("span", "verb");
            const obj = h("span", "obj");
            const meta = h("span", "meta");
            btn.appendChild(lamp); btn.appendChild(verb); btn.appendChild(obj); btn.appendChild(meta); btn.appendChild(icon("chevr"));
            const det = h("div", "detail");
            det.hidden = true;
            w.appendChild(btn); w.appendChild(det);
            v = { w: w, btn: btn, lamp: lamp, verb: verb, obj: obj, meta: meta, det: det, entry: entry, sig: "", counted: null, counts: null };
            const held = v;
            btn.addEventListener("click", () => {
              const open = btn.getAttribute("aria-expanded") !== "true";
              btn.setAttribute("aria-expanded", String(open));
              det.hidden = !open;
              if (open) fillDetail(det, held.entry.tool); else det.replaceChildren();
            });
            lines.set(entry.id, v);
            list.appendChild(w);
          }
          v.entry = entry;
          const tool = entry.tool || {};
          const words = M.toolWords(tool);
          const stopped = words.live && !liveOf(t);
          // A diff is laid out once per state of the line, not once per paint.
          if (v.counted !== tool) { v.counts = M.countsOf(tool); v.counted = tool; }
          const counts = v.counts;
          const sig = [tool.status, tool.title, words.verb, words.obj, stopped, counts ? counts.added + "/" + counts.removed : "", entry.seq].join("\u0001");
          if (sig === v.sig) return;
          v.sig = sig;
          v.lamp.className = stopped ? "led" : words.live ? "led lit pulse" : words.failed ? "led red" : "led";
          v.verb.textContent = stopped ? "Stopped" : words.verb;
          v.obj.textContent = words.obj;
          if (tool.title) v.obj.setAttribute("title", String(tool.title).slice(0, 2048)); else v.obj.removeAttribute("title");
          v.meta.textContent = words.failed ? "failed" : counts ? M.countWords(counts.added, counts.removed) : "";
          v.btn.setAttribute("data-state", words.live && !stopped ? "live" : "done");
          if (!v.det.hidden) fillDetail(v.det, tool);
        },
        paint() {
          for (const id of b.ids) { const e = T && T.tools.get(id); if (e) bv.line(e); }
          paintGroup();
        },
      };
      bv.paint();
      return bv;
    }

    /** @param {any} b a handover */
    function handView(b) {
      const el = h("div", "handover");
      const s = h("span");
      s.appendChild(h("span", "lit-dot"));
      s.appendChild(doc.createTextNode((b.text || "Another agent") + " took over from " + (b.from || "the last agent") + " · it has the chat so far"));
      el.appendChild(s);
      return { kind: "hand", el: el, paint() {} };
    }

    /** @param {any} b @param {any} t */
    function blockView(b, t) {
      if (b.kind === "prose") return proseView(b, t);
      if (b.kind === "think") return thinkView(b, t);
      if (b.kind === "acts") return actsView(b, t);
      return handView(b);
    }

    /** THE AGENT'S STATUS ON THE PERSON'S MESSAGE: the loader while the turn
     *  starts, then Jev's face, flipping as it changes and the last one
     *  staying; nothing for a finished turn that never had one.
     *  @param {TurnView} v @param {boolean} [force] */
    function paintMood(v, force) {
      const t = T && T.turn(v.n);
      if (!t || !v.mood) return;
      // A face that is neither an emoji nor vendored art is no face at all.
      const face = t.face && (M.emojiOf(t.face) || M.artOf(t.face)) ? t.face : null;
      const art = face && !still ? M.artOf(face) : null;
      const emoji = face ? M.emojiOf(face) : "";
      const key = face ? "f:" + emoji + ":" + (art || "") : liveOf(t) ? "dm" : "";
      if (key === v.moodKey && !force) return;
      const had = v.moodKey;
      v.moodKey = key;
      const inner = h("span", "face");
      if (key === "dm") inner.appendChild(dm());
      else if (face && art) {
        const img = h("img");
        img.setAttribute("alt", "");
        img.setAttribute("width", "26");
        img.setAttribute("height", "26");
        img.addEventListener("error", () => { if (img.parentNode) img.replaceWith(doc.createTextNode(emoji)); });
        img.setAttribute("src", art);
        inner.appendChild(img);
      } else if (face) inner.textContent = emoji;
      if (emoji) v.mood.setAttribute("title", emoji); else v.mood.removeAttribute("title");
      const old = v.mood.firstElementChild;
      if (!key) { v.mood.replaceChildren(); return; }
      const unfold = () => animate(inner, [{ transform: "scaleY(0)" }, { transform: "scaleY(1.12)", offset: 0.7 }, { transform: "scaleY(1)" }], { duration: 170, easing: "ease-out" });
      if (old && had && !force) {
        const a = animate(old, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: 110, easing: "ease-in" });
        if (a) { a.onfinish = () => { if (gone || v.moodKey !== key) return; v.mood.replaceChildren(inner); unfold(); }; return; }
      }
      v.mood.replaceChildren(inner);
      if (!old) animate(v.mood, [{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.16,1,.3,1)" });
    }

    /** THE PAGES THE TURN CHANGED, from its `changed` update and `names`:
     *  the model folds the chat's files into one row a page.
     *  @param {TurnView} v @param {any} t */
    function paintChanges(v, t) {
      const names = S && S.names && typeof S.names === "object" ? S.names : {};
      const rows = M.changedRows(t.changed, names);
      v.changes.replaceChildren();
      v.changes.hidden = rows.length === 0;
      if (!rows.length) return;
      const pages = rows.every((/** @type {any} */ r) => r.page);
      const noun = pages ? (rows.length === 1 ? "page" : "pages") : (rows.length === 1 ? "file" : "files");
      v.changes.appendChild(h("div", "chead", rows.length + " " + noun + " changed"));
      for (const r of rows) {
        const cr = h("div", "crow");
        cr.appendChild(icon("page"));
        const target = r.target;
        const label = target ? h("button", "pg", r.label) : h("span", "pg", r.label);
        if (target) { label.type = "button"; label.addEventListener("click", () => ask("open", { target: target })); }
        if (r.where) label.setAttribute("title", r.where);
        cr.appendChild(label);
        cr.appendChild(h("span", "cverb", M.opWords(r.op)));
        cr.appendChild(h("span", "cmeta", M.countWords(r.added, r.removed)));
        if (target) {
          const open = h("button", "copen", "Open");
          open.type = "button";
          open.addEventListener("click", () => ask("open", { target: target }));
          cr.appendChild(open);
        } else cr.appendChild(h("span"));
        v.changes.appendChild(cr);
      }
    }

    /** What the turn's end says, and what it is still waiting on.
     *  @param {TurnView} v @param {any} t */
    function paintNotes(v, t) {
      v.notes.replaceChildren();
      const red = M.stopWords(t.stop, t.reason);
      if (red) {
        const n = h("div", "note");
        n.appendChild(led("red"));
        const s = h("span");
        s.appendChild(h("b", "", red.head));
        s.appendChild(doc.createTextNode(" " + red.rest));
        n.appendChild(s);
        v.notes.appendChild(n);
      } else if (t.stop === "cancelled") {
        v.notes.appendChild(h("div", "stopped", "Stopped. Nothing after this point was done."));
      }
      for (const message of t.errors) {
        const n = h("div", "note");
        n.appendChild(led("red"));
        n.appendChild(h("span", "", message));
        v.notes.appendChild(n);
      }
      if (liveOf(t) && phaseOf(t) === "held") {
        const w = h("div", "stopped");
        w.appendChild(leds3());
        w.appendChild(h("span", "", "Waiting for an agent to be ready"));
        v.notes.appendChild(w);
      }
      v.notes.hidden = v.notes.childNodes.length === 0;
    }

    /** EVERYTHING IN A TURN THAT IS NOT WORDS ARRIVING, from the model: the
     *  prompt, the agent's name and lamp, the face, the notes, the pages, the
     *  foot. Idempotent; called whenever any of it may have moved.
     *  @param {TurnView} v */
    function paintTurn(v) {
      const t = T && T.turn(v.n);
      if (!t) return;
      const live = liveOf(t);
      v.live = live;
      if (t.prompt !== null) {
        v.uw.hidden = false;
        if (v.u.firstChild !== null && v.u.firstChild.nodeType === 3) { if (v.u.firstChild.nodeValue !== t.prompt) v.u.firstChild.nodeValue = t.prompt; }
        else v.u.insertBefore(doc.createTextNode(t.prompt), v.u.firstChild);
      } else v.uw.hidden = true;
      paintMood(v);
      const c = current();
      v.whoName.textContent = t.agent || (T && T.chat.harness) || (c && c.harness) || "Agent";
      v.whoLed.hidden = !live;
      // Before the first message there is nobody to answer: a handover there
      // is the whole of what the turn says.
      v.who.hidden = t.prompt === null && !live;
      for (const [, bv] of v.blocks) bv.paint();
      paintNotes(v, t);
      paintChanges(v, t);
      if (t.stop === "end_turn") {
        const model = M.modelOf(T ? T.chat.options : []);
        v.foot.textContent = [t.agent || (T && T.chat.harness) || "Agent", model, M.seconds(t.at, t.end) + "s"].filter(Boolean).join(" · ");
        v.foot.hidden = false;
      } else v.foot.hidden = true;
      v.turn.hidden = !(live || t.blocks.length || !v.notes.hidden || !v.changes.hidden || !v.foot.hidden);
    }

    /** ONE TURN, DRAWN WHOLE from the model. @param {any} t @returns {TurnView} */
    function drawTurn(t) {
      const wrap = h("div", "turnw");
      const uw = h("div", "uw");
      const u = h("div", "u");
      const mood = h("span", "mood");
      u.appendChild(mood);
      uw.appendChild(u);
      const turn = h("div", "turn");
      const who = h("div", "who");
      const whoName = h("span");
      const whoLed = led("lit pulse");
      who.appendChild(whoName); who.appendChild(whoLed);
      const notes = h("div", "bw");
      const changes = h("div", "changes");
      const foot = h("div", "tfoot");
      turn.appendChild(who); turn.appendChild(notes); turn.appendChild(changes); turn.appendChild(foot);
      wrap.appendChild(uw); wrap.appendChild(turn);
      /** @type {TurnView} */
      const v = { n: t.n, wrap: wrap, uw: uw, u: u, mood: mood, moodKey: "", turn: turn, who: who, whoName: whoName, whoLed: whoLed, notes: notes, changes: changes, foot: foot, blocks: new Map(), live: false };
      for (const b of t.blocks) {
        const bv = blockView(b, t);
        v.blocks.set(b, bv);
        turn.insertBefore(bv.el, notes);
      }
      paintTurn(v);
      return v;
    }

    /** The turns the transcript holds, in order, that are worth a place: every
     *  turn from the first message on, and turn 0 only where it says something. */
    function shownOrder() {
      if (!T) return [];
      return T.order.filter((/** @type {number} */ n) => {
        if (n > 0) return true;
        const t = T.turn(n);
        return !!t && (t.blocks.length > 0 || t.errors.length > 0);
      });
    }

    function drawEarlier() {
      if (drawFrom <= 0) { if (earlier) { earlier.remove(); earlier = null; } return; }
      if (!earlier) {
        earlier = h("button", "earlier");
        earlier.type = "button";
        earlier.addEventListener("click", showEarlier);
        col.insertBefore(earlier, col.firstChild);
      }
      const more = Math.min(DRAW_TURNS, drawFrom);
      earlier.textContent = "Show " + more + " earlier " + (more === 1 ? "turn" : "turns") + " · " + drawFrom + " not shown";
    }

    /** Forty more turns above, with the reader left where they were. */
    function showEarlier() {
      const order = shownOrder();
      const from = Math.max(0, drawFrom - DRAW_TURNS);
      const before = log.scrollHeight;
      const first = earlier ? earlier.nextSibling : col.firstChild;
      for (let i = from; i < drawFrom; i++) {
        const t = T.turn(order[i]);
        if (!t || views.has(t.n)) continue;
        const v = drawTurn(t);
        views.set(t.n, v);
        col.insertBefore(v.wrap, first);
      }
      drawFrom = from;
      drawEarlier();
      log.scrollTop += log.scrollHeight - before;
    }

    /** THE TRANSCRIPT, BUILT WHOLE: another chat opened, or the first state. */
    function openChat() {
      heldChat = S.chat;
      views.clear();
      dirty.clear();
      col.replaceChildren();
      earlier = null;
      T = null;
      if (S.chat === null) return;
      T = M.makeTranscript();
      for (const u of Array.isArray(S.updates) ? S.updates : []) T.add(u);
      const order = shownOrder();
      drawFrom = Math.max(0, order.length - DRAW_TURNS);
      for (let i = drawFrom; i < order.length; i++) {
        const t = T.turn(order[i]);
        if (!t) continue;
        const v = drawTurn(t);
        views.set(t.n, v);
        col.appendChild(v.wrap);
      }
      drawEarlier();
      T.listen(sink);
      // A chat opens at its end.
      pinned = true;
      frame(pin);
      if (!still) animate(log, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    }

    /** WHAT THE TRANSCRIPT SAYS MOVED, drawn where it moved. A turn not drawn
     *  — one above the forty — is held in the model and drawn if it is asked
     *  for. */
    const sink = {
      /** @param {any} t */
      turn(t) {
        if (t.n === 0 && !(t.blocks.length || t.errors.length)) return;
        if (views.has(t.n)) return;
        const drawn = [...views.keys()].sort((a, b) => a - b);
        const first = drawn[0];
        if (first !== undefined && t.n < first && drawFrom > 0) { drawEarlier(); return; }
        const v = drawTurn(t);
        views.set(t.n, v);
        const next = drawn.find((n) => n > t.n);
        const at = next === undefined ? null : views.get(next);
        col.insertBefore(v.wrap, at ? at.wrap : null);
      },
      /** The person's message arriving slides up into place, as it does in
       *  the mockup. @param {any} t */
      prompt(t) {
        const v = views.get(t.n);
        if (!v) return;
        const was = v.uw.hidden;
        paintTurn(v);
        if (was && !v.uw.hidden) animate(v.u, [{ opacity: 0, transform: "translateY(22px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 550, easing: "cubic-bezier(.16,1,.3,1)" });
      },
      /** @param {any} t @param {any} b */
      block(t, b) {
        let v = views.get(t.n);
        if (!v) { sink.turn(t); v = views.get(t.n); if (v) return; }
        if (!v || v.blocks.has(b)) return;
        const bv = blockView(b, t);
        v.blocks.set(b, bv);
        v.turn.insertBefore(bv.el, v.notes);
        v.turn.hidden = false;
      },
      /** @param {any} t @param {any} b */
      text(t, b) { const v = views.get(t.n); const bv = v && v.blocks.get(b); if (bv) dirty.add(bv); },
      /** @param {any} t @param {any} b */
      close(t, b) {
        const v = views.get(t.n);
        const bv = v && v.blocks.get(b);
        if (!bv) { if (v && !v.blocks.has(b)) sink.block(t, b); return; }
        dirty.delete(bv);
        bv.paint();
      },
      /** @param {any} t @param {any} b @param {any} entry */
      tool(t, b, entry) {
        const v = views.get(t.n);
        if (!v) return;
        let bv = v.blocks.get(b);
        if (!bv) { sink.block(t, b); bv = v.blocks.get(b); }
        if (bv && bv.kind === "acts") { bv.line(entry); bv.group(); }
      },
      /** @param {any} t */
      phase(t) { const v = views.get(t.n); if (v) paintTurn(v); },
      /** @param {any} t */
      face(t) { const v = views.get(t.n); if (v) paintMood(v); },
      /** @param {any} t */
      changed(t) { const v = views.get(t.n); if (v) paintTurn(v); },
      /** @param {any} t */
      error(t) { let v = views.get(t.n); if (!v) { sink.turn(t); v = views.get(t.n); } if (v) paintTurn(v); },
      config() {},
      name() {},
    };

    /** Every drawn turn repainted where its liveness may have moved: the
     *  chat's summary said a turn started, ended or went red. */
    function refreshLive() {
      for (const v of views.values()) {
        const t = T && T.turn(v.n);
        if (!t) continue;
        if (v.live || liveOf(t) || v.n === (current() || { turn: -1 }).turn) paintTurn(v);
      }
    }

    function flush() {
      for (const bv of dirty) bv.paint();
      dirty.clear();
    }

    /** Whether the reader is at the end of the thread. */
    function atEnd() { return log.scrollHeight - log.scrollTop - log.clientHeight < 120; }

    /** PINNED TO THE END WHILE THE READER IS THERE. New words, a turn laid
     *  out at its real height after `content-visibility` measured it at its
     *  placeholder's, a face's art arriving, the input box growing — each
     *  changes a size, and a reader at the end stays at the end through all of
     *  them. One who scrolled up is left where they are, with Latest. */
    let pinned = true;
    const pin = () => { if (pinned && !gone) log.scrollTop = log.scrollHeight; };
    listen(log, "scroll", () => {
      pinned = atEnd();
      jump.classList.toggle("on", log.scrollHeight - log.scrollTop - log.clientHeight > 240);
    });
    /** @type {any} */
    let sizes = null;
    if (typeof win.ResizeObserver === "function") {
      sizes = new win.ResizeObserver(pin);
      sizes.observe(col);
      sizes.observe(log);
    }
    listen(jump, "click", () => {
      if (typeof log.scrollTo === "function") log.scrollTo({ top: log.scrollHeight, behavior: still ? "auto" : "smooth" });
      else log.scrollTop = log.scrollHeight;
    });

    /* ── what the host hands over ───────────────────────────────────────── */

    /** THE UPDATES NOT YET HELD, folded in. A tool line is the model's to
     *  compare by id; any other update is new when its `seq` is above the
     *  highest held when this began — a kept log's compacted tool lines put
     *  high numbers early, so a running maximum would drop words.
     *  @param {any[]} list */
    function foldNew(list) {
      if (!T || !Array.isArray(list)) return;
      const before = T.chat.seq;
      for (const u of list) {
        if (!u || typeof u !== "object") continue;
        if (u.kind === "tool" || (typeof u.seq === "number" && u.seq > before)) T.add(u);
      }
    }

    /**
     * @param {any} state the LookState as it now stands
     * @param {any} patch null for a state handed whole, else what moved
     */
    function apply(state, patch) {
      if (gone || !state || typeof state !== "object") return;
      S = state;
      if (patch === null) {
        mode = state.mode === "panel" ? "panel" : "screen";
        listOpen = !!state.list;
        setInput(state.input);
        setView(state.view);
        if (state.chat !== heldChat) openChat();
        else {
          foldNew(state.updates);
          refreshLive();
          if (T) for (const v of views.values()) { const t = T.turn(v.n); if (t) paintChanges(v, t); }
        }
        drawList(); drawHead(); drawMenu(); drawMin(); layout(); startScreen();
        settled = true;
      } else {
        if (patch.input) setInput(patch.input);
        if (patch.view !== undefined) setView(patch.view);
        if (Array.isArray(patch.updates) && patch.updates.length && patch.chat === heldChat) foldNew(patch.updates);
        if (patch.chats) { drawList(); drawHead(); drawMenu(); drawStart(); refreshLive(); }
        if (patch.names && T) for (const v of views.values()) { const t = T.turn(v.n); if (t && t.changed) paintChanges(v, t); }
        if (patch.beside !== undefined) drawMin();
      }
      flush();
      if (S.chat !== null) { pin(); frame(pin); }
    }

    const offLook = biom.onLook(apply);
    const offTheme = typeof biom.onTheme === "function" ? biom.onTheme(() => ribbon.recolour()) : null;
    if (!S) { drawStart(); startScreen(); }

    return function teardown() {
      gone = true;
      try { if (typeof offLook === "function") offLook(); } catch { /* the shim is going too */ }
      try { if (typeof offTheme === "function") offTheme(); } catch { /* the shim is going too */ }
      for (const t of timers) { win.clearTimeout(t); win.clearInterval(t); }
      timers.clear();
      if (typeof win.cancelAnimationFrame === "function") for (const f of frames) win.cancelAnimationFrame(f);
      frames.clear();
      ribbon.destroy();
      if (sizes) sizes.disconnect();
      for (const fn of undo.splice(0)) { try { fn(); } catch { /* one listener's removal failing is not a reason to leave the rest */ } }
      views.clear();
      dirty.clear();
      host.remove();
    };
  }

  const g = glob.biom;
  if (g && g.plugins && typeof g.plugins.register === "function") {
    g.plugins.register({ id: "biom-agent-look", mount: mount });
  }
})();
