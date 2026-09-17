// SPDX-License-Identifier: AGPL-3.0-only
// The terminal dock. Layer 15, beside the shell that places it.
//
// It is the terminal's furniture and nothing else: the tab bar, New terminal,
// full screen and Restore, Hide, End with its confirmation, the drag that moves
// the whole dock to any edge of the workspace, the grip that resizes it, and the
// sentences that say what state a session is honestly in. The emulators are the
// view's (`client/views/terminal.js`) and the sessions are the store's; this
// file draws around them and moves the box they sit in.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE BESIDE IT IS NEVER MOVED
// ─────────────────────────────────────────────────────────────────────────────
//
// The shell builds `.work` once, holding the bed and this dock as two fixed
// children, and they stay those two children for the life of the window. Which
// edge the dock is on, how big it is, whether it is shown and whether it fills
// the window are CLASSES and one custom property on `.work` — a grid template —
// so a move is a restyle. Moving an iframe in the DOM reloads it, which is the
// rule `shell.js` is built around, and a dock that reparented either child would
// restart the page on every drag.
//
// HIDE IS NOT END. The labels say which is which: Hide puts the dock away and
// every session goes on running; End asks first, then stops one process tree and
// keeps its final output on screen until the tab is closed.

/** @import { TerminalStore, TerminalState, SessionView, Side } from "../store/terminals.js" */
/** @import { TerminalView } from "../views/terminal.js" */

import { popover, popItem } from "../widgets/popover.js";
import { copyButton } from "../widgets/prompt.js";
import { FONT_MAX, FONT_MIN, SIDES } from "../store/terminals.js";

/** @type {Record<Side, string>} */
export const DOCK_LABELS = { left: "Left", right: "Right", top: "Top", bottom: "Bottom" };

/* ── pure, and therefore testable ─────────────────────────────────────── */

/**
 * WHAT A TAB SHOWS BESIDE ITS ICON. A default label is drawn as its NUMBER: the
 * icon already says the tab is a terminal, and `Terminal 1` spelled out three
 * times fills a bar that has to hold six. A tab somebody RENAMED shows the name
 * they gave it, because that is the only thing telling two agents apart. The
 * full label is still the accessible name and the tooltip, both of them always.
 * @param {string} label
 * @returns {string}
 */
export function tabText(label) {
  const named = /^Terminal (\d+)$/.exec(String(label).trim());
  return named ? /** @type {string} */ (named[1]) : String(label);
}

/**
 * Which edge a point over the workspace is dropping on, or null for the middle —
 * which is not a target, so a drop there changes nothing.
 * @param {number} x @param {number} y within the workspace @param {number} w @param {number} h its size
 * @returns {Side | null}
 */
export function sideAt(x, y, w, h) {
  if (!(w > 0) || !(h > 0)) return null;
  /** @type {[Side, number][]} */
  const d = [["left", x / w], ["right", 1 - x / w], ["top", y / h], ["bottom", 1 - y / h]];
  d.sort((a, b) => a[1] - b[1]);
  const [side, dist] = /** @type {[Side, number]} */ (d[0]);
  return dist <= 0.3 ? side : null;
}

/** @param {SessionView["exit"]} exit */
export function exitText(exit) {
  if (!exit) return "exited";
  if (exit.code !== null && exit.code !== undefined) return `exited with code ${exit.code}`;
  if (exit.signal) return `stopped by ${exit.signal}`;
  return "exited";
}

/**
 * What a tab honestly says about its session. Starting, Connected and
 * Disconnected are about the socket; Running, Ending, Exited and Failed are the
 * server's word. Nothing here is a guess at what an agent is doing.
 * @param {SessionView} s @param {string} link
 */
export function stateText(s, link) {
  if (link !== "open" && (s.state === "running" || s.state === "ending")) return "Disconnected";
  if (s.state === "running") return "Running";
  if (s.state === "ending") return "Ending";
  if (s.state === "exited") return exitText(s.exit).replace(/^./, (c) => c.toUpperCase());
  return "Failed to end";
}

/* ── the dock ─────────────────────────────────────────────────────────── */

/**
 * @param {object} deps
 * @param {(spec: string, props?: any, ...kids: any[]) => HTMLElement} deps.h
 * @param {TerminalStore} deps.terms
 * @param {TerminalView} deps.view
 */
export function makeDock(deps) {
  const { h, terms, view } = deps;

  /** @type {HTMLElement | null} */ let work = null;
  let bare = false;
  /** @type {unknown[]} */ let drawn = [];
  /** @type {string | null} */ let renaming = null;
  /** @type {string | null} */ let lastActive = null;
  /** @type {string | null} */ let lastConfirming = null;
  let swallowClick = false;

  /* ── the parts, built once ── */

  /** AN ICON, DRAWN IN CSS FROM ITS KIND — the way the window controls in
   *  `chrome.css` are, and for the same reason: `h()` makes HTML elements and an
   *  `<svg>` made that way is not an SVG. The accessible name is always the
   *  button's `aria-label`, so nothing depends on the shape being understood.
   *  @param {string} kind */
  const glyph = (kind) => h("span.dglyph." + kind, { "aria-hidden": "true" });

  /** A HEADER CONTROL: an icon, a name for a screen reader, and the same name
   *  under the pointer. There is no word on this bar — the dock is plainly a
   *  terminal, and a row of labels is a row that does not fit on a dock docked
   *  to the side.
   *  @param {string} kind @param {string} label @param {() => void} onclick */
  const tool = (kind, label, onclick) =>
    h("button.docktool." + kind, { type: "button", "aria-label": label, title: label, onclick }, glyph(kind));

  const tabs = h("div.docktabs", { role: "tablist", "aria-label": "Terminal sessions", onkeydown: onTabKey });
  const handle = h("button.dockhandle", {
    type: "button",
    "aria-label": "Move the terminal to another edge",
    title: "Drag to any edge of the workspace",
    "aria-haspopup": "menu",
    onpointerdown: startDrag,
    onclick: chooseSide,
  }, glyph("grip"));
  const add = tool("add", "New terminal", () => newTerminal());
  const smaller = tool("zoomout", "Smaller text", () => terms.zoom(-1));
  const larger = tool("zoomin", "Larger text", () => terms.zoom(1));
  const help = tool("help", "How to use the terminal", showHelp);
  const full = tool("full", "Fill the window with the terminal", () => (terms.get().dock.full ? terms.restore() : terms.fullscreen()));
  const hide = tool("hide", "Hide the terminal \u2014 every session keeps running (Ctrl+`)", () => terms.hide());
  const head = h("div.dockhead", handle, tabs, add, h("span.dockacts", smaller, larger, help, full, hide));
  const notes = h("div.docknotes", { "aria-live": "polite" });
  const body = h("div.dockbody", view.el, notes);
  const foot = h("div.dockfoot");
  const grip = h("div.dockgrip", {
    role: "separator",
    tabindex: "0",
    "aria-label": "Resize the terminal",
    onpointerdown: startResize,
    onkeydown: keyResize,
  });
  const el = h("section.dock", { "aria-label": "Agent Terminal", hidden: true }, grip, head, body, foot);

  /* ── drawing ── */

  /** @param {string} text @param {() => void} onclick @param {string} [kind] */
  const btn = (text, onclick, kind = "") => h("button.btn" + (kind ? "." + kind : ""), { type: "button", onclick }, text);
  /** @param {string} kind @param {string} text @param {HTMLElement[]} [actions] */
  const note = (kind, text, actions = []) => h("div.docknote", { "data-kind": kind }, h("p", text), actions.length ? h("span.dockbtns", ...actions) : null);

  /** @param {boolean} [isBare] whether the start page is on screen, which has no workspace for a terminal to be in */
  function sync(isBare = bare) {
    bare = isBare;
    const st = terms.get();
    const now = [st, bare, renaming];
    if (drawn.length === now.length && drawn.every((v, i) => Object.is(v, now[i]))) return;
    drawn = now;

    const d = st.dock;
    const shown = d.visible && !bare;
    el.hidden = !shown;
    if (work) {
      work.className = "work" + (shown ? " dock-" + d.side : "") + (shown && d.full ? " full" : "");
      work.style.setProperty("--dock-size", `${d.sizes[d.side]}px`);
    }
    el.setAttribute("data-side", d.side);
    grip.hidden = d.full;
    grip.setAttribute("aria-orientation", d.side === "left" || d.side === "right" ? "vertical" : "horizontal");
    grip.setAttribute("aria-valuenow", String(d.sizes[d.side]));
    // THE SAME BUTTON, THE OTHER WAY ROUND: corners pointing out, then in.
    full.className = "docktool " + (d.full ? "unfull" : "full");
    full.setAttribute("aria-pressed", String(d.full));
    const fullName = d.full ? "Put the terminal back where it was docked" : "Fill the window with the terminal";
    full.title = fullName;
    full.setAttribute("aria-label", fullName);
    add.toggleAttribute("disabled", st.link === "connecting" || st.link === "closed");
    smaller.toggleAttribute("disabled", d.font <= FONT_MIN);
    larger.toggleAttribute("disabled", d.font >= FONT_MAX);

    if (renaming === null) drawTabs(st);
    drawNotes(st);
    const s = st.sessions.find((x) => x.id === st.active);
    foot.textContent = s ? `Local shell · ${s.cwd}${s.shell ? ` · ${s.shell}` : ""}` : "Local shell";

    view.sync();
    if (shown && st.active !== lastActive && st.active !== null) view.focus();
    lastActive = st.active;
    if (st.confirming !== lastConfirming && st.confirming !== null) {
      const cancel = /** @type {HTMLElement | null} */ (notes.querySelector(".dockconfirm .btn"));
      cancel?.focus();
    }
    lastConfirming = st.confirming;
  }

  /** @param {TerminalState} st */
  function drawTabs(st) {
    const hadFocus = typeof document !== "undefined" && tabs.contains(document.activeElement);
    const rows = st.sessions.map((s) => {
      const selected = s.id === st.active;
      const status = stateText(s, st.link);
      const name = `${s.label}, ${status}${s.unread ? ", new output" : ""}${s.bell ? ", asking for attention" : ""}`;
      const tab = h("button.docktab", {
        type: "button",
        role: "tab",
        id: "docktab-" + s.id,
        "aria-selected": String(selected),
        tabindex: selected ? "0" : "-1",
        "aria-label": name,
        title: s.title ? `${s.label} — ${s.title} (${status})` : `${s.label} (${status})`,
        "data-state": status === "Disconnected" ? "disconnected" : s.state,
        onclick: () => {
          terms.select(s.id);
          view.focus();
        },
        ondblclick: () => startRename(s.id),
      },
      h("span.tabdot", { "aria-hidden": "true" }),
      glyph("prompt"),
      h("span.tablabel", tabText(s.label)),
      s.title ? h("span.tabtitle", s.title) : null,
      s.bell ? h("span.tabmark.bell", { "aria-hidden": "true" }) : s.unread ? h("span.tabmark", { "aria-hidden": "true" }) : null);
      const close = h("button.tabclose", {
        type: "button",
        "aria-label": (s.state === "exited" ? "Close " : "End ") + s.label,
        title: s.state === "exited" ? "Close this tab" : "End this session",
        onclick: () => terms.askEnd(s.id),
      }, "×");
      return h("span.tabwrap", { role: "presentation", "data-selected": String(selected) }, tab, close);
    });
    const starting = st.pending.map(() =>
      h("span.tabwrap", { role: "presentation" },
        h("span.docktab", { role: "tab", "aria-selected": "false", "aria-disabled": "true", "data-state": "starting" },
          h("span.tabdot", { "aria-hidden": "true" }), h("span.tablabel", "Starting…"))));
    tabs.replaceChildren(...rows, ...starting);
    if (hadFocus && st.active) document.getElementById("docktab-" + st.active)?.focus();
    // AN OVERFLOWED BAR SCROLLS, AND THE SELECTED TAB STAYS WHERE IT CAN BE SEEN.
    if (st.active !== lastActive) {
      const sel = tabs.querySelector('[data-selected="true"]');
      if (sel && typeof sel.scrollIntoView === "function") sel.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /** @param {TerminalState} st */
  function drawNotes(st) {
    /** @type {HTMLElement[]} */
    const items = [];
    const s = st.sessions.find((x) => x.id === st.active);

    if (st.link === "closed" && st.sessions.length > 0) {
      items.push(note("warn", "Disconnected from this workspace's terminals — reconnecting. Input is paused, and nothing typed now is sent later."));
    } else if (st.link === "connecting") {
      items.push(note("info", "Connecting…"));
    }
    if (st.notice) items.push(note("warn", st.notice, [btn("Dismiss", () => terms.clearNotice())]));
    for (const f of st.failures) {
      items.push(note("fail", `The terminal did not start: ${f.message}`, [
        btn("Try again", () => {
          // Start the new one first: dismissing the last failure of an empty
          // dock would otherwise close the dock before the retry is asked for.
          newTerminal();
          terms.forgetFailure(f.nonce);
        }),
        btn("Dismiss", () => terms.forgetFailure(f.nonce), "ghost"),
      ]));
    }
    if (st.confirming !== null) {
      const c = st.sessions.find((x) => x.id === st.confirming);
      if (c) {
        items.push(h("div.dockconfirm", {
          role: "alertdialog",
          "aria-label": "End this terminal session?",
          onkeydown: (/** @type {KeyboardEvent} */ e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            terms.cancelEnd();
          },
        },
        h("p", `End “${c.label}”? Its shell and everything it started will be stopped. Other tabs keep running.`),
        h("span.dockbtns", btn("Cancel", () => terms.cancelEnd()), btn("End this session", () => terms.confirmEnd(), "danger"))));
      }
    }
    if (s && s.state === "exited") {
      items.push(note("info", `Session ended — ${exitText(s.exit)}. Its final output is kept. A new terminal is a new shell, not this one resumed.`, [
        btn("Close tab", () => terms.dismiss(s.id)),
        btn("New terminal", () => newTerminal(), "ghost"),
      ]));
    }
    if (s && s.state === "failed") {
      items.push(note("fail", s.message ?? "This session could not be ended.", [btn("Try ending again", () => terms.askEnd(s.id))]));
    }
    if (s && s.truncated) {
      items.push(note("info", "Earlier output from this session was dropped to stay within memory, so the screen may be incomplete. The program was asked to redraw."));
    }
    if (st.sessions.length === 0 && st.pending.length === 0 && st.link === "open") {
      items.push(h("div.dockempty",
        h("p", "No sessions. Choose New terminal to open a shell."),
        btn("New terminal", () => newTerminal(), "primary"),
        h("p.dockhint", "It starts in this workspace’s folder, beside its AGENTS.md. Run the agent you already use there.")));
    } else if (st.sessions.length === 0 && st.pending.length > 0) {
      items.push(h("div.dockempty", h("p", "Starting a shell…")));
    }
    notes.replaceChildren(...items);
  }

  /* ── acts ── */

  function newTerminal() {
    const hint = view.hint();
    if (hint) terms.sizeHint(hint.cols, hint.rows);
    terms.create();
  }

  /** THE AGENTS THE HELP OFFERS, each as the line that starts it and the line
   *  that installs it. Copied, never typed in: Biom does not write into a shell. */
  const AGENTS = [
    { name: "Claude Code", run: "claude", install: "npm install -g @anthropic-ai/claude-code" },
    { name: "Codex CLI", run: "codex", install: "npm install -g @openai/codex" },
    { name: "Gemini CLI", run: "gemini", install: "npm install -g @google/gemini-cli" },
    { name: "Aider", run: "aider", install: "python -m pip install aider-install && aider-install" },
  ];
  /** The first thing worth saying to whichever agent starts. */
  const FIRST_ASK = "Read AGENTS.md, then tell me what this workspace is for and what you can build in it.";

  /** @type {HTMLElement | null} */ let helpEl = null;

  /** A line to copy: the text as code, and a Copy button beside it.
   *  @param {string} text @param {string} [kind] */
  const copyLine = (text, kind = "") => {
    const code = h("code", text);
    return h("div.cmd" + (kind ? "." + kind : ""), code, copyButton(h, text, code, "Copy"));
  };

  function closeHelp() {
    if (!helpEl) return;
    helpEl.remove();
    helpEl = null;
    help.focus();
  }

  /** THE HELP IS A DIALOG IN THE MIDDLE OF THE SCREEN, because what it holds is
   *  commands to copy and a popover off a 22px button is no place to read one.
   *  It is appended to the body, not the dock, so a dock docked to a narrow edge
   *  does not decide how wide it is — which is also why Escape is stopped here:
   *  outside the dock, the shell's own Escape would close a panel as well. */
  function showHelp() {
    if (helpEl) return;
    const done = h("button.btn.ghost", { type: "button", onclick: closeHelp }, "Close");
    const card = h("div.dialog.termhelp", { role: "dialog", "aria-modal": "true", "aria-labelledby": "termhelp-title" },
      h("h2", { id: "termhelp-title" }, "Start an agent in this terminal"),
      h("p", "Every terminal is a shell in this workspace’s folder, beside its AGENTS.md and skills. Copy the command for the agent you use and paste it into the terminal."),
      h("div.agents", ...AGENTS.map((a) =>
        h("section.agent",
          h("h3", a.name),
          copyLine(a.run),
          h("p.install", "Not installed yet?"),
          copyLine(a.install, "quiet")))),
      h("p.poplabel", "Then ask it"),
      copyLine(FIRST_ASK),
      h("p.poplabel", "The terminal"),
      h("p", h("b", "Hide"), " puts it away and every session keeps running. ", h("b", "End"), " stops one session. Drag the grip to move it to any edge. ", h("kbd", "Ctrl+`"), " shows and hides it, and ", h("kbd", "Ctrl+="), " / ", h("kbd", "Ctrl+\u2212"), " size the text."),
      h("p", "It runs exactly as any terminal would: the agent’s own login, model and approvals. An agent’s edits appear on the page because the workspace watches its folder."),
      h("div.foot", done));
    helpEl = h("div.scrim", {
      onclick: (/** @type {MouseEvent} */ e) => { if (e.target === e.currentTarget) closeHelp(); },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        closeHelp();
      },
    }, card);
    document.body.append(helpEl);
    /** @type {HTMLElement | null} */ (card.querySelector(".cmd button"))?.focus();
  }

  function chooseSide() {
    if (swallowClick) return;
    const d = terms.get().dock;
    popover(handle, (close) => [
      h("p.poplabel", "Dock position"),
      ...SIDES.map((side) => popItem(DOCK_LABELS[side], () => {
        close();
        terms.dockTo(side);
      }, { checked: side === d.side && !d.full })),
    ]);
  }

  /** @param {string} id */
  function startRename(id) {
    const s = terms.get().sessions.find((x) => x.id === id);
    const wrap = document.getElementById("docktab-" + id)?.parentElement;
    if (!s || !wrap) return;
    renaming = id;
    const input = /** @type {HTMLInputElement} */ (h("input.tabrename", { value: s.label, "aria-label": "Rename terminal", maxlength: "80" }));
    let done = false;
    const commit = (/** @type {boolean} */ save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      renaming = null;
      if (save && value && value !== s.label) terms.rename(id, value);
      drawn = [];
      sync();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") {
        e.stopPropagation();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
    wrap.replaceChildren(input);
    input.focus();
    input.select();
  }

  /** ROVING TABS. Arrows and Home/End move between sessions, F2 renames, Delete
   *  asks to end — the keyboard reaches everything a pointer does.
   *  @param {KeyboardEvent} e */
  function onTabKey(e) {
    if (/** @type {HTMLElement} */ (e.target).tagName === "INPUT") return;
    const st = terms.get();
    const ids = st.sessions.map((s) => s.id);
    const at = st.active === null ? -1 : ids.indexOf(st.active);
    /** @type {string | undefined} */
    let next;
    if (e.key === "ArrowRight") next = ids[(at + 1) % ids.length];
    else if (e.key === "ArrowLeft") next = ids[(at - 1 + ids.length) % ids.length];
    else if (e.key === "Home") next = ids[0];
    else if (e.key === "End") next = ids.at(-1);
    else if (e.key === "F2" && st.active) {
      e.preventDefault();
      startRename(st.active);
      return;
    } else if (e.key === "Delete" && st.active) {
      e.preventDefault();
      terms.askEnd(st.active);
      return;
    } else return;
    e.preventDefault();
    if (next === undefined) return;
    terms.select(next);
    document.getElementById("docktab-" + next)?.focus();
  }

  /* ── dragging the dock to an edge ── */

  /** @type {{ x: number, y: number, pointer: number, moved: boolean, side: Side | null, overlay: HTMLElement | null, preview: HTMLElement | null } | null} */
  let drag = null;

  /** @param {PointerEvent} e */
  function startDrag(e) {
    if (e.button !== 0 || !work) return;
    drag = { x: e.clientX, y: e.clientY, pointer: e.pointerId, moved: false, side: null, overlay: null, preview: null };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer; the listeners below still work */
    }
    // ON THE WINDOW, NOT THE HANDLE. Capture is asked for, but a drag that
    // crosses the page's frame can lose it, and a release that never reached the
    // handle left the drop targets on screen with nothing to take them down —
    // measured. The window hears every move and every release either way.
    window.addEventListener("pointermove", moveDrag, true);
    window.addEventListener("pointerup", dropDrag, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    document.addEventListener("keydown", escapeDrag, true);
  }

  /** @param {PointerEvent} e */
  function moveDrag(e) {
    if (!drag || !work) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moved = true;
      // THE TARGETS APPEAR ONCE THE DRAG IS REAL. A press that does not move is
      // the keyboard-equivalent menu, not a drag with nowhere to go.
      drag.preview = h("div.droppreview", { hidden: true });
      drag.overlay = h("div.dockdrop", { "aria-hidden": "true" },
        ...SIDES.map((side) => h("div.dropzone", { "data-side": side }, h("span", DOCK_LABELS[side]))),
        drag.preview,
        h("p.drophint", "Drop on an edge · Esc cancels"));
      work.append(drag.overlay);
      el.classList.add("dragging");
    }
    const r = work.getBoundingClientRect();
    const side = sideAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (side === drag.side) return;
    drag.side = side;
    for (const z of /** @type {HTMLElement} */ (drag.overlay).querySelectorAll(".dropzone")) {
      z.classList.toggle("on", z.getAttribute("data-side") === side);
    }
    const preview = /** @type {HTMLElement} */ (drag.preview);
    if (side === null) {
      preview.hidden = true;
      return;
    }
    // THE PREVIEW IS WHERE THE DOCK WILL BE, at the size it will be on that edge.
    const across = side === "left" || side === "right" ? r.width : r.height;
    const px = Math.max(80, Math.min(terms.get().dock.sizes[side], across - 140));
    Object.assign(preview.style, {
      left: side === "right" ? `${r.width - px}px` : "0px",
      top: side === "bottom" ? `${r.height - px}px` : "0px",
      width: side === "left" || side === "right" ? `${px}px` : "100%",
      height: side === "top" || side === "bottom" ? `${px}px` : "100%",
    });
    preview.hidden = false;
  }

  function dropDrag() {
    const was = drag;
    endDrag();
    if (was && was.moved && was.side !== null) terms.dockTo(was.side);
  }

  function cancelDrag() {
    endDrag();
  }

  /** @param {KeyboardEvent} e */
  function escapeDrag(e) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    e.stopPropagation();
    endDrag();
  }

  function endDrag() {
    if (!drag) return;
    const was = drag;
    drag = null;
    window.removeEventListener("pointermove", moveDrag, true);
    window.removeEventListener("pointerup", dropDrag, true);
    window.removeEventListener("pointercancel", cancelDrag, true);
    document.removeEventListener("keydown", escapeDrag, true);
    try {
      handle.releasePointerCapture(was.pointer);
    } catch {
      /* already released */
    }
    was.overlay?.remove();
    el.classList.remove("dragging");
    if (was.moved) {
      // The click that follows a drag's pointerup is not a press of the handle.
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 0);
    }
  }

  /* ── resizing ── */

  /** @type {{ x: number, y: number, size: number, side: Side, pointer: number } | null} */
  let sizing = null;

  /** @param {PointerEvent} e */
  function startResize(e) {
    if (e.button !== 0 || !work) return;
    const d = terms.get().dock;
    sizing = { x: e.clientX, y: e.clientY, size: d.sizes[d.side], side: d.side, pointer: e.pointerId };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* see startDrag */
    }
    // On the window, for the reason `startDrag` gives.
    window.addEventListener("pointermove", moveResize, true);
    window.addEventListener("pointerup", endResize, true);
    window.addEventListener("pointercancel", endResize, true);
    el.classList.add("sizing");
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  function moveResize(e) {
    if (!sizing || !work) return;
    const r = work.getBoundingClientRect();
    const dx = e.clientX - sizing.x;
    const dy = e.clientY - sizing.y;
    const px = sizing.side === "bottom" ? sizing.size - dy
      : sizing.side === "top" ? sizing.size + dy
      : sizing.side === "left" ? sizing.size + dx
      : sizing.size - dx;
    terms.resize(px, sizing.side === "left" || sizing.side === "right" ? r.width : r.height);
  }

  function endResize() {
    if (!sizing) return;
    try {
      grip.releasePointerCapture(sizing.pointer);
    } catch {
      /* already released */
    }
    sizing = null;
    window.removeEventListener("pointermove", moveResize, true);
    window.removeEventListener("pointerup", endResize, true);
    window.removeEventListener("pointercancel", endResize, true);
    el.classList.remove("sizing");
    view.schedule();
  }

  /** @param {KeyboardEvent} e */
  function keyResize(e) {
    if (!work) return;
    const d = terms.get().dock;
    /** @type {Record<Side, [string, string]>} */
    const keysFor = { bottom: ["ArrowUp", "ArrowDown"], top: ["ArrowDown", "ArrowUp"], left: ["ArrowRight", "ArrowLeft"], right: ["ArrowLeft", "ArrowRight"] };
    const [grow, shrink] = keysFor[d.side];
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const r = work.getBoundingClientRect();
    terms.resize(d.sizes[d.side] + (e.key === grow ? 24 : -24), d.side === "left" || d.side === "right" ? r.width : r.height);
  }

  return {
    el,
    /** The element the dock is placed in, which the shell built. @param {HTMLElement} w */
    attach(w) {
      work = w;
      drawn = [];
    },
    sync,
    /** The keyboard toggle. Events from inside a page's box do not bubble out
     *  of its frame, so this reaches the shortcut from the chrome and from the
     *  terminal itself, and the rail's button is the way that always works. */
    mount() {
      if (typeof document === "undefined") return;
      document.addEventListener("keydown", (e) => {
        if (bare) return;
        // ZOOM, AND ONLY FROM INSIDE THE DOCK. `Ctrl+-` anywhere else is the
        // browser's own zoom, and a host that took that key everywhere would be
        // stealing it from the workspace to serve a panel that may not even be
        // open. The emulator hands these back rather than sending them to the
        // shell — see `keys` in `client/views/terminal.js`.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && el.contains(/** @type {Node | null} */ (e.target))) {
          if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            terms.zoom(1);
            return;
          }
          if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            terms.zoom(-1);
            return;
          }
          if (e.key === "0") {
            e.preventDefault();
            terms.resetZoom();
            return;
          }
        }
        if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.code !== "Backquote") return;
        e.preventDefault();
        const was = terms.get().dock.visible;
        terms.toggle();
        if (!was) view.focus();
      });
    },
    /** Whether the terminal is filling the window, which the shell's grid needs. */
    full: () => {
      const d = terms.get().dock;
      return !bare && d.visible && d.full;
    },
    /** Whether an event came from inside the dock — so Escape reaches the
     *  program in the terminal rather than closing a panel of the shell's.
     *  @param {EventTarget | null} node */
    holds: (node) => node instanceof Node && el.contains(node),
  };
}
