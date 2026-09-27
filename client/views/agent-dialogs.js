// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — MORE AGENTS AND MORE MODELS: the two pop-ups the Agent screen's
// input box opens, and signing an agent in (*Chat*, `picker` and
// `credentials`).
//
// MORE AGENTS is this machine's agents and then the whole ACP Registry, each
// with its icon and its line, filtered as the person types and worked from the
// keyboard. An agent on this machine is Active or Inactive and carries the ONE
// button that makes it Active — **Sign in**, or **Start Gateway** for OpenClaw
// — and one from the registry carries **Install**; what an install needs and
// this machine lacks, and why one failed, is said in words. It opens by itself
// over a first message that is waiting for an agent, saying so, and it is the
// server that sends the message the moment an agent is Active — this only
// shows it.
//
// MORE MODELS is the same pop-up over one of the agent's long lists, grouped
// the way the agent groups it.
//
// SIGNING IN never calls `authenticate` unasked: the button is on an agent
// that refused a session, and it runs the method the person picks — the
// agent's own, which finishes in the browser and whose verdict is the probe
// after it, on the stream; or a terminal method, which runs in the sign-in
// pop-up from the ticket the server answered, and the server looks at the
// agent again when that command has gone. A method that is a key in the
// environment is named, never asked for: Biom holds no key.
//
// Both pop-ups sit on the document, over the workspace, and under the sign-in
// terminal, which is the one thing above them. Nothing here reaches an agent:
// every act is an `agents.*` kind or a choice handed back to the input box.

/** @import { AgentInfo, AgentKey, AuthMethodInfo, ConfigChoice, ConfigOption, RegistryAgent } from "../../contracts/types.ts" */
/** @import { ChatStore } from "../store/chats.js" */

import { svg } from "../platform/dom.js";
import { buttonOf, groupedChoices, machineAgents, stateWords } from "../store/chats.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */
/** @typedef {(req: { ticket: string, title: string }) => Promise<{ exitCode: number | null }>} OpenSignIn */

/**
 * @typedef {object} AgentsOpts
 * @property {() => string | null} why The sentence over the list — a message
 *   waiting for an agent — read on every draw, or null.
 * @property {() => AgentKey | null} current The agent in use, which says **In use**.
 * @property {(key: AgentKey) => void} use An Active agent was picked.
 */

/**
 * @typedef {object} ModelsOpts
 * @property {string} title
 * @property {ConfigOption} option
 * @property {(value: string) => void} pick
 */

/**
 * @typedef {object} AgentDialogs
 * @property {(opts: AgentsOpts) => void} agents Open More agents.
 * @property {(opts: ModelsOpts) => void} models Open More models.
 * @property {(a: AgentInfo) => void} signIn Open More agents and sign this
 *   agent in — at once where it has one way to, or with its ways shown.
 * @property {() => void} close
 * @property {() => "agents" | "models" | null} shown
 */

/** How long an agent's own sign-in says "Signing in…" while its verdict is on
 *  its way: it finishes in the browser, and the stream says when it did. */
const SIGN_WAIT = 120000;
/** How long a read of the registry is kept before it is read again. */
const REGISTRY_FRESH = 5 * 60000;

/** The mockup's icons, as path data on a 16-pixel grid. Literals only: `svg`
 *  writes them as markup. */
const ICONS = {
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  check: '<path d="m3.25 8.5 3 3 6.5-7" stroke-width="1.7"/>',
  ring: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>',
};

/** @param {keyof typeof ICONS} name @param {string} [cls] */
const icon = (name, cls = "ico") =>
  svg("0 0 16 16", `<g stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`, cls);

/** A sentence out of a refusal: the server's own, which names no path and no
 *  key, or a plain one. @param {unknown} e */
const sentence = (e) => (e instanceof Error && e.message ? e.message : "it did not answer");

/** AN AGENT'S PICTURE, as a mask in the ink rather than an image in its own
 *  colours: the registry's icons are single-colour drawings, which an `<img>`
 *  paints black on a dark palette, and a mask takes the palette's ink. Only an
 *  https url is drawn, and it is quoted so a url cannot end the rule it sits
 *  in. @param {string | null} href @returns {string | null} */
export function iconMask(href) {
  if (typeof href !== "string" || href === "") return null;
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:") return null;
  return 'url("' + u.href.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c)) + '")';
}

/**
 * @param {{ h: H, chats: ChatStore, signInTerminal: OpenSignIn | null, doc?: Document }} deps
 * @returns {AgentDialogs}
 */
export function makeAgentDialogs(deps) {
  const { h, chats } = deps;
  const doc = deps.doc ?? document;

  /** @typedef {{ kind: "agents", opts: AgentsOpts } | { kind: "models", opts: ModelsOpts }} Shown */
  /** @type {Shown | null} */
  let shown = null;
  let q = "";
  let sel = -1;
  /** The rows that can be picked, and whether a row is one Enter may do
   *  unasked: an agent on this machine or a model is; an INSTALL is not, so a
   *  second Enter after a send never puts software on the machine.
   *  @type {{ el: HTMLElement, act: (() => void) | null, safe: boolean }[]} */
  let items = [];
  /** @type {RegistryAgent[] | null} */
  let registry = null;
  let registryAt = 0;
  let registryBusy = false;
  let registrySaid = "";
  /** What is under way for an agent, by its key. @type {Map<AgentKey, string>} */
  const busy = new Map();
  /** Why the last act on an agent did not happen, by its key. @type {Map<AgentKey, string>} */
  const said = new Map();
  /** The agent whose ways to sign in are shown. @type {AgentKey | null} */
  let expanded = null;
  /** @type {HTMLElement | null} */
  let restore = null;
  /** @type {(() => void) | null} */
  let off = null;

  /* ── the pop-up, built once ────────────────────────────────────────── */

  const title = h("b#agentsdlgtitle");
  const why = h("p.why");
  const search = /** @type {HTMLInputElement} */ (h("input", {
    type: "search", autocomplete: "off", spellcheck: "false", "aria-label": "Search",
    "aria-controls": "agentsdlglist",
    oninput: () => { q = search.value; sel = -1; draw(); },
    onkeydown: (/** @type {KeyboardEvent} */ e) => key(e),
  }));
  const list = h("div#agentsdlglist.alist", { role: "listbox", "aria-label": "Agents" });
  const dialog = h("div.adialog", { role: "dialog", "aria-modal": "true", "aria-labelledby": "agentsdlgtitle", onkeydown: (/** @type {KeyboardEvent} */ e) => dialogKey(e) },
    h("div.dh", title, h("button.iconbtn.x", { type: "button", "aria-label": "Close", title: "Close", onclick: () => close() }, icon("close"))),
    why,
    h("label.asearch", icon("search"), search),
    list);
  const modal = h("div.amodal", h("div.ascrim", { onpointerdown: () => close() }), dialog);

  /** Keep Tab inside while it is up: it is modal. @param {KeyboardEvent} e */
  function trap(e) {
    if (e.key !== "Tab") return;
    const all = /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll("button:not([disabled]), input")]);
    if (!all.length) return;
    const first = /** @type {HTMLElement} */ (all[0]);
    const last = /** @type {HTMLElement} */ (all[all.length - 1]);
    const at = doc.activeElement;
    if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }

  /** @param {KeyboardEvent} e */
  function key(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const acting = items.filter((it) => it.act !== null);
      if (!acting.length) return;
      const now = acting.indexOf(/** @type {any} */ (items[sel]));
      const next = now < 0
        ? (e.key === "ArrowDown" ? 0 : acting.length - 1)
        : (now + (e.key === "ArrowDown" ? 1 : -1) + acting.length) % acting.length;
      sel = items.indexOf(/** @type {any} */ (acting[next]));
      mark();
      items[sel]?.el.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[sel]?.act?.();
    }
  }

  /** Escape shuts it from anywhere inside, and Tab stays inside.
   *  @param {KeyboardEvent} e */
  function dialogKey(e) {
    trap(e);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  function mark() {
    items.forEach((it, i) => it.el.setAttribute("aria-selected", String(i === sel)));
  }

  /** @param {HTMLElement} el @param {(() => void) | null} act @param {boolean} [safe] */
  function item(el, act, safe = true) {
    const at = items.length;
    items.push({ el, act, safe });
    el.addEventListener("mouseenter", () => { if (act) { sel = at; mark(); } });
    el.addEventListener("click", (/** @type {MouseEvent} */ e) => {
      // A button in the row does its own thing; the row does the first one.
      if (/** @type {HTMLElement} */ (e.target).closest("button")) return;
      act?.();
    });
    return el;
  }

  /* ── drawing ───────────────────────────────────────────────────────── */

  /** @param {string | null} href */
  function pic(href) {
    const mask = iconMask(href);
    if (mask === null) return h("span.aic", { "aria-hidden": "true" }, icon("ring"));
    const el = h("span.aic", { "aria-hidden": "true" }, h("span.aicmask"));
    /** @type {HTMLElement} */ (el.firstChild).style.setProperty("--icon", mask);
    return el;
  }

  /** @param {string} text @param {() => void} act @param {string} [cls] */
  const btn = (text, act, cls = "") =>
    h("button.abtn" + cls, { type: "button", onclick: (/** @type {Event} */ e) => { e.stopPropagation(); act(); } }, text);
  /** @param {string} text */
  const held = (text) => h("button.abtn", { type: "button", disabled: "" }, text);

  /** What an agent on this machine's row can do, and the button that does it.
   *  @param {AgentInfo} a @param {AgentKey | null} current
   *  @returns {{ act: (() => void) | null, el: HTMLElement }} */
  function actionOf(a, current) {
    const doing = busy.get(a.key);
    if (doing) return { act: null, el: held(doing) };
    if (a.state === "active") {
      if (a.key === current) return { act: null, el: h("span.abtn.on", "In use") };
      const use = () => { const o = shown; close(); if (o && o.kind === "agents") o.opts.use(a.key); };
      return { act: use, el: btn("Use", use, ".go") };
    }
    const b = buttonOf(a);
    if (b === "signin") { const go = () => void signIn(a, null); return { act: go, el: btn("Sign in", go, ".go") }; }
    if (b === "gateway") { const go = () => void startGateway(a); return { act: go, el: btn("Start Gateway", go) }; }
    // WORK UNDER WAY is shown the mockup's way, as a button held while it
    // runs, with the lamp pulsing beside it. Anything else carries nothing
    // (DECISIONS O28): an Inactive agent carries only the one button that
    // makes it Active, and a failed one has none — its line says why.
    if (a.reason === "checking") return { act: null, el: held("Checking…") };
    if (a.reason === "installing") return { act: null, el: held("Installing…") };
    return { act: null, el: h("span") };
  }

  function drawAgents() {
    const o = /** @type {{ kind: "agents", opts: AgentsOpts }} */ (shown);
    const all = chats.get().agents;
    const want = q.trim().toLowerCase();
    /** @param {{ name: string, line: string, key: string }} x */
    const hit = (x) => !want || (x.name + " " + x.line + " " + x.key).toLowerCase().includes(want);
    const here = machineAgents(all).filter(hit);
    const keys = new Set(all.map((a) => a.key));
    const reg = (registry ?? []).filter((r) => !r.here && !keys.has(r.key) && hit(r)).sort((a, b) => a.name.localeCompare(b.name));
    const current = o.opts.current();

    title.textContent = "More agents";
    const sentenceNow = o.opts.why();
    why.hidden = !sentenceNow;
    why.textContent = sentenceNow ?? "";
    search.placeholder = registry ? `Search ${keys.size + reg.length} agents` : "Search agents";

    /** @type {HTMLElement[]} */
    const out = [];
    if (here.length) out.push(h("div.agrp", "On this machine"));
    for (const a of here) {
      const { act, el } = actionOf(a, current);
      const line = said.get(a.key) ?? (a.state !== "active" && a.message ? a.message : a.line);
      const lamp = a.state === "active" ? "led lit" : busy.has(a.key) || a.reason === "checking" || a.reason === "installing" ? "led lit pulse" : "led";
      out.push(item(h("div.arow", { role: "option", "data-agent": a.key, "aria-selected": "false" },
        pic(a.icon),
        h("span.txt", h("span.nm", a.name), h("span.ds" + (said.has(a.key) ? ".bad" : ""), line)),
        h("span.st", h("span", { class: lamp }), stateWords(a)),
        el), act));
      if (expanded === a.key || (a.reason === "signin" && a.auth.some((m) => m.type === "env_var"))) out.push(ways(a));
    }

    out.push(h("div.agrp", "From the ACP Registry"));
    if (registry === null) {
      out.push(registryBusy ? h("div.anone", "Reading the ACP Registry…")
        : h("div.anone", registrySaid ? "The ACP Registry could not be read: " + registrySaid + " " : "", registrySaid ? btn("Try again", () => void readRegistry(true)) : ""));
    } else {
      for (const r of reg) {
        const doing = busy.get(r.key);
        const saidNow = said.get(r.key);
        const install = () => void installOne(r);
        const act = doing || r.needs ? null : install;
        const el = doing ? held(doing) : r.needs ? h("button.abtn", { type: "button", disabled: "", title: r.needs }, "Install") : btn("Install", install);
        out.push(item(h("div.arow", { role: "option", "data-agent": r.key, "aria-selected": "false" },
          pic(r.icon),
          h("span.txt", h("span.nm", r.name), h("span.ds" + (saidNow || r.needs ? ".bad" : ""), saidNow ?? r.needs ?? r.line)),
          h("span.st"),
          el), act, false));
      }
      if (!reg.length && want) out.push(h("div.anone", "Nothing in the registry matches “" + q.trim() + "”."));
    }
    if (!here.length && want && registry !== null && !reg.length) out.unshift(h("div.anone", "No agent matches “" + q.trim() + "”."));
    return out;
  }

  /** AN AGENT'S WAYS TO SIGN IN, under its row: each method of its own as a
   *  button, and a key in the environment named rather than asked for.
   *  @param {AgentInfo} a */
  function ways(a) {
    const methods = a.auth.filter((m) => m.type === "agent" || m.type === "terminal");
    const vars = a.auth.filter((m) => m.type === "env_var").flatMap((m) => m.vars);
    return h("div.aways", { "data-agent": a.key },
      expanded === a.key && methods.length
        ? h("span.awayrow", h("span.awaylabel", "Sign in with"), ...methods.map((m) => btn(m.name, () => void signIn(a, m))))
        : null,
      vars.length
        ? h("span.awayrow", h("span.awaylabel", "Or set " + vars.join(", ") + " in your login shell, then"), btn("Check again", () => void probe(a)))
        : null);
  }

  function drawModels() {
    const o = /** @type {{ kind: "models", opts: ModelsOpts }} */ (shown);
    const option = o.opts.option;
    title.textContent = o.opts.title;
    why.hidden = true;
    search.placeholder = `Search ${option.choices.length} ${option.category === "model" ? "models" : "choices"}`;
    /** @type {HTMLElement[]} */
    const out = [];
    const groups = groupedChoices(option, q);
    for (const g of groups) {
      out.push(h("div.agrp", g.group ?? option.name));
      for (const c of g.choices) {
        const pick = () => { close(); o.opts.pick(c.value); };
        out.push(item(h("div.arow.mrow", { role: "option", "aria-selected": "false", "data-value": c.value },
          h("span.txt", h("span.nm", c.name), c.description ? h("span.ds", c.description) : null),
          c.value === option.value ? icon("check", "check") : h("span")), pick));
      }
    }
    if (!groups.length) out.push(h("div.anone", "Nothing matches “" + q.trim() + "”."));
    return out;
  }

  function draw() {
    if (shown === null) return;
    // The row that was lit stays lit by what it is, not by where it was.
    const litKey = items[sel]?.el.getAttribute("data-agent") ?? items[sel]?.el.getAttribute("data-value") ?? null;
    const focusWasIn = list.contains(doc.activeElement);
    items = [];
    const rows = shown.kind === "agents" ? drawAgents() : drawModels();
    list.setAttribute("aria-label", shown.kind === "agents" ? "Agents" : "Choices");
    list.replaceChildren(...rows);
    const again = litKey === null ? -1 : items.findIndex((it) => it.act !== null && (it.el.getAttribute("data-agent") ?? it.el.getAttribute("data-value")) === litKey);
    // NOTHING IS LIT UNASKED BUT A ROW ENTER MAY DO: an install waits for an
    // arrow key or the pointer.
    sel = again >= 0 ? again : items.findIndex((it) => it.act !== null && it.safe);
    mark();
    // A button the redraw took from under the caret hands it back to the
    // search, inside the dialog, rather than to the page behind it.
    if (focusWasIn && !list.contains(doc.activeElement)) search.focus({ preventScroll: true });
  }

  /** What a redraw of More agents would show that moved: the agents, and the
   *  sentence over them. A chat streaming moves neither, and redraws nothing. */
  let drawnFor = "";
  function maybeDraw() {
    if (shown === null) return;
    const s = chats.get();
    const why = shown.kind === "agents" ? shown.opts.why() : null;
    const key = JSON.stringify([s.agents, why]);
    if (key === drawnFor) return;
    drawnFor = key;
    draw();
  }

  /* ── acts ──────────────────────────────────────────────────────────── */

  /** Whether an agent's line in the list moved since `was`, waiting at most
   *  `ms`. @param {AgentKey} key @param {string} was @param {number} ms */
  function moved(key, was, ms) {
    return new Promise((resolve) => {
      const now = () => JSON.stringify(chats.get().agents.find((x) => x.key === key) ?? null);
      if (now() !== was) { resolve(undefined); return; }
      const t = setTimeout(done, ms);
      const stop = chats.on(() => { if (now() !== was) done(); });
      function done() { clearTimeout(t); stop(); resolve(undefined); }
    });
  }

  /** @param {AgentInfo} a @param {AuthMethodInfo | null} method */
  async function signIn(a, method) {
    said.delete(a.key);
    const methods = a.auth.filter((m) => m.type === "agent" || m.type === "terminal");
    const m = method ?? (methods.length === 1 ? methods[0] ?? null : null);
    if (m === null) {
      // More than one way, or only a key in the environment: shown, and the
      // person picks.
      expanded = expanded === a.key && methods.length ? null : a.key;
      if (!methods.length && !a.auth.some((x) => x.type === "env_var")) said.set(a.key, `${a.name} offers no way to sign in from here; sign in from its own command, then Check again`);
      draw();
      return;
    }
    expanded = null;
    busy.set(a.key, "Signing in…");
    draw();
    try {
      const was = JSON.stringify(chats.get().agents.find((x) => x.key === a.key) ?? null);
      const answer = await chats.signIn(a.key, m.id);
      if (answer.kind === "terminal") {
        if (deps.signInTerminal === null) throw new Error("this window has no sign-in terminal");
        // The pop-up runs what the ticket stands for and closes when it exits;
        // the server looks at the agent again then, and the stream says.
        await deps.signInTerminal({ ticket: answer.ticket, title: "Sign in to " + a.name });
      } else {
        await moved(a.key, was, SIGN_WAIT);
      }
    } catch (e) {
      said.set(a.key, "Not signed in: " + sentence(e));
    } finally {
      busy.delete(a.key);
      draw();
    }
  }

  /** @param {AgentInfo} a */
  async function startGateway(a) {
    said.delete(a.key);
    busy.set(a.key, "Starting…");
    draw();
    try { await chats.start(a.key); } catch (e) { said.set(a.key, "The Gateway did not start: " + sentence(e)); }
    finally { busy.delete(a.key); draw(); }
  }

  /** @param {AgentInfo} a */
  async function probe(a) {
    said.delete(a.key);
    busy.set(a.key, "Checking…");
    draw();
    try { await chats.probe(a.key); } catch (e) { said.set(a.key, sentence(e)); }
    finally { busy.delete(a.key); draw(); }
  }

  /** @param {RegistryAgent} r */
  async function installOne(r) {
    said.delete(r.key);
    busy.set(r.key, "Installing…");
    draw();
    try { await chats.install(r.key); } catch (e) { said.set(r.key, "Not installed: " + sentence(e)); }
    finally { busy.delete(r.key); draw(); }
  }

  /** @param {boolean} [force] */
  async function readRegistry(force = false) {
    if (registryBusy) return;
    if (!force && registry !== null && Date.now() - registryAt < REGISTRY_FRESH) return;
    registryBusy = true;
    registrySaid = "";
    draw();
    try {
      registry = await chats.registry();
      registryAt = Date.now();
    } catch (e) {
      registrySaid = sentence(e);
    } finally {
      registryBusy = false;
      draw();
    }
  }

  /* ── open and shut ─────────────────────────────────────────────────── */

  /** @param {Shown} what */
  function show(what) {
    const was = shown;
    shown = what;
    if (was === null || was.kind !== what.kind) { q = ""; search.value = ""; sel = -1; expanded = null; }
    if (was === null) {
      const at = doc.activeElement;
      restore = at instanceof HTMLElement ? at : null;
      doc.body.append(modal);
      drawnFor = "";
      off = chats.on(() => maybeDraw());
    }
    draw();
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
  }

  function close() {
    if (shown === null) return;
    shown = null;
    off?.();
    off = null;
    modal.remove();
    const back = restore;
    restore = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }

  return {
    agents(opts) {
      show({ kind: "agents", opts });
      void readRegistry();
    },
    models(opts) {
      show({ kind: "models", opts });
    },
    signIn(a) {
      if (shown === null || shown.kind !== "agents") return;
      void signIn(a, null);
    },
    close,
    shown: () => (shown === null ? null : shown.kind),
  };
}
