// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — THE INPUT BOX, which is Biom's (*Chat*, `plugin`): "the Agent
// screen … is drawn by a plugin a workspace can replace, except the input
// box, which is Biom's, so only the person's typing reaches an agent that is
// allowed everything."
//
// IT IS HOST DOM, over the look's box, and it is the only place a chat's agent
// is handed words: the text area's own value, sent by the person's Enter or
// Send, as `chat.new` or `chat.send`. Nothing the look says reaches here but
// the chat it asks to show; the / menu and **Edit** only put words in the
// text area, where the person reads them and sends them or not.
//
// WHAT IT HOLDS, after the mockup's composer: the text area — *Ask anything*
// on the start screen, *Reply* in a chat; under it the agent, model, mode and
// effort, each a chip with the agent's own list, a list longer than five
// showing five and **More models**; Send, which is **Stop** while a turn runs
// because a chat takes one message at a time; **Go to *page*** above it when
// the switcher offers the page the open chat wrote; the / menu of the agent's
// commands and the workspace's skills; and one line under it saying the turn
// is working, or what went wrong.
//
// A FIRST MESSAGE WITH NO AGENT READY is sent all the same, and held by the
// server: More agents opens saying it is waiting, and the server sends it the
// moment an agent is Active — this only shows that it did.
//
// TYPING HERE IS NOT A TOUCH. The whole dock carries `NOT_TOUCH`, because
// talking to the agent is not taking the screen back from it.

/** @import { AgentInfo, AgentKey, ChatId, ChatSummary, ConfigOption, ConfigValue, LookInput, PageId, SlashCommand } from "../../contracts/types.ts" */
/** @import { ChatStore } from "../store/chats.js" */
/** @import { Switcher } from "../store/switcher.js" */
/** @import { Ui } from "../store/ui.js" */
/** @import { AgentDialogs } from "./agent-dialogs.js" */

import { svg } from "../platform/dom.js";
import { NOT_TOUCH } from "../store/switcher.js";
import {
  choiceName, defaultAgent, freshThread, machineAgents, pickersOf, showChat, shownChoices,
  slashQuery, slashRows, stateWords, buttonOf, waitingWords, withValues,
} from "../store/chats.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} AgentInput
 * @property {HTMLElement} el The dock, whole.
 * @property {() => void} sync Draw again from the stores.
 * @property {() => LookInput} measure Where it sits over the look and how
 *   much of the look it covers — the `LookInput` the look leaves room for.
 * @property {(fn: () => void) => () => void} onMove Its size or place changed.
 * @property {(text: string, page: PageId | null) => void} prefill Put words in
 *   and the caret after them — **Edit**'s — naming the page the chat is for.
 * @property {() => void} focus
 * @property {() => void} fresh A new thread began: nothing pending for a page.
 */

/** How the dock stands off the look's foot in a chat, under the composer —
 *  the line that says the turn is working sits in it. The mockup's 34px. */
export const DOCK_FOOT = 34;
/** The most the text area grows before it scrolls, in px. The mockup's. */
const TEXT_MAX = 240;
/** How long after THIS window sent a message a held chat opens More agents. */
const HELD_FRESH = 60000;

/** The mockup's icons, as path data on a 16-pixel grid. Literals only: `svg`
 *  writes them as markup. */
const ICONS = {
  chev: '<path d="m4 6.25 4 4 4-4"/>',
  up: '<path d="M8 13V3.6M3.9 7.6 8 3.5l4.1 4.1" stroke-width="1.9"/>',
  stop: '<rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1.4" fill="currentColor" stroke="none"/>',
  plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
  check: '<path d="m3.25 8.5 3 3 6.5-7" stroke-width="1.7"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
};

/** @param {keyof typeof ICONS} name @param {string} [cls] */
const icon = (name, cls = "ico") =>
  svg("0 0 16 16", `<g stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`, cls);

/** A refusal's own sentence, or a plain one. @param {unknown} e */
const sentence = (e) => (e instanceof Error && e.message ? e.message : "it did not answer");
/** @param {unknown} e */
const codeOf = (e) => (e && typeof e === "object" ? /** @type {{ code?: unknown }} */ (e).code : undefined);

/** What each picker is called in its menu's heading. */
const CATEGORY_WORD = /** @type {Record<string, string>} */ ({ model: "model", mode: "mode", thought_level: "effort" });
/** What a picker's long list is called on its More row. */
const MORE_WORD = /** @type {Record<string, string>} */ ({ model: "More models", mode: "More modes", thought_level: "More levels" });

/**
 * @param {{ h: H, ui: Ui, chats: ChatStore, switcher: Switcher | null, dialogs: AgentDialogs, doc?: Document, win?: Window }} deps
 * @returns {AgentInput}
 */
export function makeAgentInput(deps) {
  const { h, ui, chats, switcher, dialogs } = deps;
  const doc = deps.doc ?? document;
  const win = deps.win ?? window;

  /** The agent a new chat goes to. @type {AgentKey | null} */
  let picked = null;
  /** What the person set the start screen's pickers to, for the new chat. @type {Map<string, ConfigValue>} */
  const startConfig = new Map();
  /** The page **Edit** opened this new chat for. @type {PageId | null} */
  let pendingPage = null;
  let sending = false;
  let stopping = false;
  /** Why the last send, stop or pick did not happen, or "". */
  let said = "";
  /** The chat the dock was last drawn for; undefined before the first draw.
   *  @type {ChatId | null | undefined} */
  let lastChat = undefined;
  /** The held chat More agents was opened over, so it closes when the
   *  message goes out. @type {ChatId | null} */
  let heldFor = null;
  /** @type {Set<() => void>} */
  const movers = new Set();

  /* ── the dock, built once ──────────────────────────────────────────── */

  const slash = h("div#agentslash.slash", { role: "listbox", "aria-label": "Commands and skills", hidden: "" });
  const text = /** @type {HTMLTextAreaElement} */ (h("textarea#agentta.agentta", {
    rows: "1", spellcheck: "true", placeholder: "Ask anything",
    "aria-label": "Message", "aria-controls": "agentslash", "aria-expanded": "false", "aria-autocomplete": "list",
    oninput: () => { said = ""; autosize(); paint(); void drawSlash(true); },
    onkeydown: (/** @type {KeyboardEvent} */ e) => keydown(e),
  }));
  const agentLed = h("span.led");
  const agentName = h("span.nm");
  const agentChip = h("button.chip.agentchip", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", title: "The agent", onclick: () => agentMenu() },
    agentLed, agentName, icon("chev"));
  const sep = h("span.sep");
  /** The three pickers, kept, each redrawn in place. */
  const chipsFor = ["model", "mode", "thought_level"].map((cat) => {
    const label = h("span.nm");
    const el = h("button.chip", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "data-category": cat, hidden: "", onclick: () => pickerMenu(cat) },
      label, icon("chev"));
    return { cat, el, label };
  });
  const send = h("button.send", { type: "button", "aria-label": "Send", onclick: () => press() }, icon("up"));
  const cbar = h("div.cbar", agentChip, sep, ...chipsFor.map((c) => c.el), send);
  const composer = h("div.composer", slash, text, cbar);
  const followName = h("b");
  const follow = h("button.follow", { type: "button", hidden: "", onclick: () => switcher?.go() },
    h("span.led.lit.pulse"), h("span.ft", "Editing ", followName), h("span.go", "Go to page"));
  const workingText = h("span.wt", "Working");
  const working = h("span.working", h("span.leds3", h("i"), h("i"), h("i")), workingText);
  const saidLine = h("span.said", { role: "status" });
  const below = h("div.below", working, saidLine);
  const el = h("div.agentdock", { [NOT_TOUCH]: "" }, follow, composer, below);

  /* ── what the dock is for, now ─────────────────────────────────────── */

  function now() {
    const u = ui.get();
    const s = chats.get();
    const chatId = u.chat;
    const chat = chatId === null ? null : chats.summary(chatId);
    if (chat === null) picked = defaultAgent(s.agents, picked);
    const agentKey = chat !== null ? chat.agent : picked;
    const agent = agentKey === null ? null : s.agents.find((a) => a.key === agentKey) ?? null;
    const busy = chat !== null && chat.phase !== "idle";
    /** @type {ConfigOption[]} */
    const options = chat !== null
      ? (s.open === chat.id && s.config !== null ? s.config : agent?.options ?? [])
      : withValues(agent?.options ?? [], startConfig);
    const name = chat !== null ? chat.harness ?? agent?.name ?? "No agent yet" : agent?.name ?? (s.agentsKnown ? "No agent yet" : "Looking for agents");
    return { u, s, chatId, chat, agentKey, agent, busy, options, name };
  }

  function autosize() {
    text.style.height = "auto";
    text.style.height = Math.min(TEXT_MAX, text.scrollHeight) + "px";
  }

  function paint() {
    const n = now();

    // ANOTHER CHAT: the draft was for the one before it, as the mockup has
    // it, and nothing pending for a page carries over.
    if (n.chatId !== lastChat) {
      if (lastChat !== undefined) { text.value = ""; autosize(); }
      lastChat = n.chatId;
      pendingPage = null;
      said = "";
      closeSlash();
      closeMenu();
      if (n.chat !== null && n.chat.agent !== null) picked = n.chat.agent;
    }

    place(n.chatId === null ? "center" : "bottom");
    text.placeholder = n.chatId === null ? "Ask anything" : "Reply";

    agentName.textContent = n.name;
    agentLed.className = n.busy && n.chat?.phase !== "held" ? "led lit pulse" : n.agent?.state === "active" ? "led lit" : "led";

    const pickers = pickersOf(n.options);
    for (const c of chipsFor) {
      const o = pickers.find((p) => p.category === c.cat);
      c.el.hidden = !o;
      if (o) c.label.textContent = choiceName(o);
    }
    sep.hidden = !pickers.length;

    send.className = n.busy ? "send stop" : "send";
    send.replaceChildren(icon(n.busy ? "stop" : "up"));
    send.setAttribute("aria-label", n.busy ? "Stop" : "Send");
    send.title = n.busy ? "Stop" : "";
    if (n.busy) send.toggleAttribute("disabled", stopping);
    else send.toggleAttribute("disabled", sending || text.value.trim() === "");

    const offer = switcher?.get().offer ?? null;
    follow.hidden = offer === null;
    if (offer !== null) followName.textContent = offer.name;

    const phase = n.chat?.phase ?? "idle";
    working.hidden = !n.busy;
    workingText.textContent = phase === "held" ? "Waiting for an agent" : phase === "starting" ? "Starting " + n.name : "Working";
    saidLine.textContent = said;
    below.hidden = n.chatId === null && said === "";

    held(n.chat);
    tell();
  }

  /** WHERE THE DOCK SITS, and the move between the two drawn as a move: the
   *  start screen's input going down to the foot of the chat the first
   *  message made, as the mockup has it, from where it was to where it is —
   *  and no move at all where the person asked for stillness.
   *  @param {"center" | "bottom"} at */
  function place(at) {
    const was = el.getAttribute("data-at");
    if (was === at) return;
    const still = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const before = was === null || still || !el.isConnected ? null : el.getBoundingClientRect();
    el.setAttribute("data-at", at);
    if (before === null || before.height === 0 || typeof el.animate !== "function") return;
    const dy = before.top - el.getBoundingClientRect().top;
    if (dy !== 0) el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: 700, easing: "cubic-bezier(.16,1,.3,1)" });
  }

  /** MORE AGENTS OVER A WAITING MESSAGE: opened when a chat this window just
   *  sent to is held, and shut when its message goes out. A held chat seen
   *  from another window, or long after, opens nothing.
   *  @param {ChatSummary | null} chat */
  function held(chat) {
    if (chat !== null && chat.phase === "held") {
      const sentAt = chats.lastSent(chat.id);
      if (heldFor !== chat.id && sentAt !== null && Date.now() - sentAt < HELD_FRESH) {
        heldFor = chat.id;
        openAgents();
      }
      return;
    }
    if (heldFor !== null && (chat === null || chat.id === heldFor)) {
      if (dialogs.shown() === "agents") dialogs.close();
      heldFor = null;
    }
  }

  /** @type {string} */
  let told = "";
  function tell() {
    const m = measure();
    const key = m.at + ":" + m.height;
    if (key === told) return;
    told = key;
    for (const fn of [...movers]) fn();
  }

  /** @returns {LookInput} */
  function measure() {
    const at = ui.get().chat === null ? "center" : "bottom";
    const c = composer.getBoundingClientRect();
    if (at === "center") return { at, height: Math.round(c.height) };
    const holder = el.parentElement;
    const foot = holder ? holder.getBoundingClientRect().bottom : c.bottom + DOCK_FOOT;
    return { at, height: Math.max(0, Math.round(foot - c.top)) };
  }

  if (typeof ResizeObserver === "function") new ResizeObserver(() => tell()).observe(composer);

  /* ── sending, and Stop ─────────────────────────────────────────────── */

  function press() {
    const n = now();
    if (n.busy) void stop();
    else void submit();
  }

  async function submit() {
    const words = text.value;
    if (words.trim() === "" || sending) return;
    const n = now();
    // ONE MESSAGE AT A TIME: while a turn runs the button is Stop and Enter
    // sends nothing.
    if (n.busy) return;
    closeSlash();
    said = "";
    sending = true;
    paint();
    try {
      if (n.chat !== null) {
        await chats.send(n.chat.id, words);
        if (text.value === words) text.value = "";
      } else {
        /** @type {Record<string, ConfigValue>} */
        const config = Object.fromEntries(startConfig);
        const made = await chats.create({ agent: n.agentKey ?? undefined, text: words, page: pendingPage ?? undefined, config });
        if (text.value === words) text.value = "";
        startConfig.clear();
        pendingPage = null;
        // The draft went with the chat, so showing it clears nothing.
        lastChat = made.id;
        showChat(ui, made.id, "made");
      }
      autosize();
    } catch (e) {
      said = codeOf(e) === "limit" ? "One message at a time: this chat’s turn is still going." : "Not sent: " + sentence(e);
    } finally {
      sending = false;
      paint();
    }
  }

  async function stop() {
    const n = now();
    if (n.chat === null || stopping) return;
    stopping = true;
    paint();
    try {
      await chats.cancel(n.chat.id);
    } catch (e) {
      said = "Not stopped: " + sentence(e);
    } finally {
      stopping = false;
      paint();
    }
  }

  /* ── the keyboard ──────────────────────────────────────────────────── */

  /** @param {KeyboardEvent} e */
  function keydown(e) {
    if (slashKey(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "n") {
      // New thread, as the look binds it inside its box.
      e.preventDefault();
      freshThread(ui);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!now().busy) void submit();
      return;
    }
    if (e.key === "Escape" && now().busy && menu === null) {
      e.preventDefault();
      void stop();
    }
  }

  /* ── the / menu ────────────────────────────────────────────────────── */

  /** @type {SlashCommand[]} */
  let rows = [];
  let lit = 0;
  /** The / menu as the server merged it, by the chat or agent it is for. @type {Map<string, SlashCommand[]>} */
  const menus = new Map();
  /** The agents list the cache was filled against: another one empties it. */
  let menusFor = chats.get().agents;
  let slashGen = 0;

  function closeSlash() {
    slash.hidden = true;
    rows = [];
    text.setAttribute("aria-expanded", "false");
    text.removeAttribute("aria-activedescendant");
  }

  /** The commands for what the dock is for: the open chat's own last list,
   *  or asked of the server for a chat or an agent and kept. @returns {Promise<SlashCommand[]>} */
  async function commandsNow() {
    const n = now();
    if (n.s.agents !== menusFor) { menus.clear(); menusFor = n.s.agents; }
    if (n.chat !== null && n.s.open === n.chat.id && n.s.commands !== null) return n.s.commands;
    const key = n.chat !== null ? "chat:" + n.chat.id : "agent:" + (n.agentKey ?? "");
    const had = menus.get(key);
    if (had) return had;
    const got = await chats.commands(n.chat !== null ? { chat: n.chat.id } : n.agentKey !== null ? { agent: n.agentKey } : {});
    menus.set(key, got);
    return got;
  }

  /** @param {boolean} fresh the text changed, so the first row is lit again */
  async function drawSlash(fresh) {
    const q = slashQuery(text.value);
    if (q === null) { closeSlash(); return; }
    const my = ++slashGen;
    /** @type {SlashCommand[]} */
    let all;
    try { all = await commandsNow(); } catch { all = []; }
    if (my !== slashGen || slashQuery(text.value) !== q) return;
    rows = slashRows(all, q);
    if (fresh) lit = 0;
    lit = Math.min(lit, Math.max(0, rows.length - 1));
    slash.replaceChildren(...(rows.length
      ? rows.map((c, i) => h("button.srow", {
        type: "button", role: "option", id: "agentslash-" + i, tabindex: "-1",
        "aria-selected": String(i === lit), "data-name": c.name,
        onmousedown: (/** @type {Event} */ e) => e.preventDefault(),
        onclick: () => pick(c.name),
      }, h("span.sn", "/" + c.name), h("span.sw", c.description + (c.hint ? " · " + c.hint : ""))))
      : [h("div.none", "Nothing starts with /" + q)]));
    slash.hidden = false;
    text.setAttribute("aria-expanded", "true");
    markSlash();
  }

  function markSlash() {
    [...slash.children].forEach((r, i) => { if (r.matches(".srow")) r.setAttribute("aria-selected", String(i === lit)); });
    if (rows.length) text.setAttribute("aria-activedescendant", "agentslash-" + lit);
    else text.removeAttribute("aria-activedescendant");
  }

  /** PICKING ONE PUTS `/name` IN THE INPUT, and nothing is sent: the person
   *  says the rest and presses Enter. @param {string} name */
  function pick(name) {
    text.value = "/" + name + " ";
    closeSlash();
    autosize();
    paint();
    text.focus({ preventScroll: true });
    text.setSelectionRange(text.value.length, text.value.length);
  }

  /** @param {KeyboardEvent} e @returns {boolean} whether the menu took it */
  function slashKey(e) {
    if (slash.hidden) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) {
        lit = (lit + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        markSlash();
        slash.children[lit]?.scrollIntoView?.({ block: "nearest" });
      }
      return true;
    }
    if (((e.key === "Enter" && !e.shiftKey && !e.isComposing) || e.key === "Tab") && rows.length) {
      e.preventDefault();
      pick(/** @type {SlashCommand} */ (rows[lit]).name);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSlash();
      return true;
    }
    return false;
  }

  /* ── the pickers' menus ────────────────────────────────────────────── */

  /** @type {{ el: HTMLElement, anchor: HTMLElement, off: () => void } | null} */
  let menu = null;

  function closeMenu() {
    if (menu === null) return;
    const m = menu;
    menu = null;
    m.off();
    m.el.remove();
    m.anchor.setAttribute("aria-expanded", "false");
  }

  /**
   * A MENU HUNG FROM A CHIP, on the document above everything but the pop-ups:
   * under the chip where there is room, above it where there is not. It shuts
   * on a press anywhere else, on Escape, and when the window loses focus —
   * which is what a press inside the look's box looks like from here, because
   * nothing inside an iframe reaches this document's listeners.
   * @param {HTMLElement} anchor @param {(close: () => void) => HTMLElement[]} build
   */
  function openMenu(anchor, build) {
    const mine = menu !== null && menu.anchor === anchor;
    closeMenu();
    if (mine) return;
    const m = h("div.agentmenu", { role: "menu" }, ...build(closeMenu));
    doc.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mr = m.getBoundingClientRect();
    const room = win.innerHeight - r.bottom;
    const top = room > mr.height + 16 || room > r.top ? r.bottom + 6 : r.top - mr.height - 6;
    const left = Math.max(8, Math.min(r.left, win.innerWidth - mr.width - 8));
    m.style.top = Math.max(8, Math.round(top)) + "px";
    m.style.left = Math.round(left) + "px";
    anchor.setAttribute("aria-expanded", "true");
    /** @param {PointerEvent} e */
    const down = (e) => { const t = /** @type {Node} */ (e.target); if (!m.contains(t) && !anchor.contains(t)) closeMenu(); };
    /** @param {KeyboardEvent} e */
    const key = (e) => {
      const all = /** @type {HTMLElement[]} */ ([...m.querySelectorAll(".mi:not([disabled])")]);
      const at = all.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); }
      else if (e.key === "ArrowDown" && all.length) { e.preventDefault(); all[(at + 1) % all.length]?.focus(); }
      else if (e.key === "ArrowUp" && all.length) { e.preventDefault(); all[(at - 1 + all.length) % all.length]?.focus(); }
    };
    const blur = () => closeMenu();
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("keydown", key, true);
    win.addEventListener("blur", blur);
    win.addEventListener("resize", blur);
    menu = {
      el: m, anchor,
      off: () => {
        doc.removeEventListener("pointerdown", down, true);
        doc.removeEventListener("keydown", key, true);
        win.removeEventListener("blur", blur);
        win.removeEventListener("resize", blur);
      },
    };
    /** @type {HTMLElement | null} */ (m.querySelector(".mi:not([disabled])"))?.focus({ preventScroll: true });
  }

  /** @param {string} text */
  const label = (text) => h("div.mlabel", text);
  /** @param {string} text */
  const foot = (text) => h("div.mfoot", text);

  /** MORE AGENTS, saying why a waiting message waits where one does. */
  function openAgents() {
    dialogs.agents({
      why: () => {
        const n = now();
        return n.chat !== null && n.chat.phase === "held" ? waitingWords(n.chat, n.s.agents) : null;
      },
      current: () => now().agentKey,
      use: (key) => void choose(key),
    });
  }

  function agentMenu() {
    openMenu(agentChip, (close) => {
      const n = now();
      const list = machineAgents(n.s.agents);
      /** @type {HTMLElement[]} */
      const out = [label(list.length ? "On this machine" : n.s.agentsKnown ? "No agent on this machine yet" : "Looking for agents…")];
      for (const a of list) {
        const b = buttonOf(a);
        const lamp = a.state === "active" ? "led lit" : a.reason === "checking" || a.reason === "installing" ? "led lit pulse" : "led";
        const row = h("button.mi", { type: "button", role: "menuitem", "data-agent": a.key },
          h("span", { class: lamp }),
          h("span.txt", h("span.nm", a.name), h("span.sub", stateWords(a))),
          a.key === n.agentKey ? icon("check", "check") : null,
          b ? h("span.mact", { role: "button", "data-act": b }, b === "signin" ? "Sign in" : "Start Gateway") : null);
        row.addEventListener("click", (e) => {
          const act = /** @type {HTMLElement} */ (e.target).closest("[data-act]");
          close();
          if (a.state === "active") { void choose(a.key); return; }
          openAgents();
          if (act && b === "signin") dialogs.signIn(a);
          else if (act && b === "gateway") void chats.start(a.key).catch((err) => { said = "The Gateway did not start: " + sentence(err); paint(); });
        });
        out.push(row);
      }
      out.push(h("button.mi.addagent", { type: "button", role: "menuitem", onclick: () => { close(); openAgents(); } }, icon("plus"), h("span.nm", "More agents")));
      out.push(foot(n.chat !== null
        ? "Switching hands the new agent the chat so far. Each agent uses its own login and subscription."
        : "Found by looking on this machine. Each agent uses its own login and subscription."));
      return out;
    });
  }

  /** @param {string} cat */
  function pickerMenu(cat) {
    const chip = chipsFor.find((c) => c.cat === cat);
    if (!chip) return;
    const n0 = now();
    const option0 = pickersOf(n0.options).find((o) => o.category === cat);
    if (!option0) return;
    if (option0.type === "boolean") { void setConfig(option0, option0.value !== true); return; }
    openMenu(chip.el, (close) => {
      const n = now();
      const option = pickersOf(n.options).find((o) => o.category === cat) ?? option0;
      const { shown, more } = shownChoices(option);
      /** @type {HTMLElement[]} */
      const out = [label(n.name + " · " + (CATEGORY_WORD[cat] ?? cat))];
      for (const c of shown) {
        out.push(h("button.mi", {
          type: "button", role: "menuitemradio", "aria-checked": String(c.value === option.value), "data-value": c.value,
          onclick: () => { close(); void setConfig(option, c.value); },
        }, h("span.txt", h("span.nm", c.name), c.description ? h("span.sub", c.description) : null), c.value === option.value ? icon("check", "check") : null));
      }
      if (more) {
        out.push(h("button.mi.addagent", {
          type: "button", role: "menuitem",
          onclick: () => { close(); dialogs.models({ title: n.name + " · " + (cat === "model" ? "models" : CATEGORY_WORD[cat] ?? cat), option, pick: (v) => void setConfig(option, v) }); },
        }, icon("search"), h("span.nm", MORE_WORD[cat] ?? "More"), h("span.mcount", String(option.choices.length))));
      }
      out.push(foot("What this list offers is what the agent reported when its session started."));
      return out;
    });
  }

  /** A PICKER SET: on a chat, the agent's own option, by its id — mid-turn it
   *  applies from the next message; on the start screen, kept for the chat
   *  the first message makes. @param {ConfigOption} option @param {ConfigValue} value */
  async function setConfig(option, value) {
    const n = now();
    if (n.chat === null) { startConfig.set(option.id, value); paint(); return; }
    try { await chats.config(n.chat.id, option.id, value); }
    catch (e) { said = "Not changed: " + sentence(e); paint(); }
  }

  /** ANOTHER AGENT: for the next new chat on the start screen; for a chat,
   *  switched — the new agent is handed the chat so far — and on a waiting
   *  message, the message re-targeted. @param {AgentKey} key */
  async function choose(key) {
    const n = now();
    picked = key;
    if (n.chat === null) { startConfig.clear(); paint(); text.focus({ preventScroll: true }); return; }
    if (n.chat.agent === key) return;
    try { await chats.switchAgent(n.chat.id, key); }
    catch (e) { said = codeOf(e) === "limit" ? "Stop this turn before switching agent." : "Not switched: " + sentence(e); }
    paint();
    text.focus({ preventScroll: true });
  }

  paint();

  return {
    el,
    sync: paint,
    measure,
    onMove(fn) {
      movers.add(fn);
      return () => { movers.delete(fn); };
    },
    prefill(words, page) {
      text.value = words;
      pendingPage = page;
      autosize();
      paint();
      text.focus({ preventScroll: true });
      text.setSelectionRange(text.value.length, text.value.length);
    },
    focus() {
      text.focus({ preventScroll: true });
      text.setSelectionRange(text.value.length, text.value.length);
    },
    fresh() {
      pendingPage = null;
      text.focus({ preventScroll: true });
    },
  };
}
