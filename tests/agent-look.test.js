// SPDX-License-Identifier: AGPL-3.0-only
// THE AGENT SCREEN'S LOOK, run outside the box.
//
// Four things are held here, against the same source the box loads:
//
//   · the shim's `look.state` / `look.patch` hook in `guest/biom.js`, driven
//     through a stand-in port exactly as the host posts to it;
//   · the mount in `guest/plugins/biom-agent/`, which picks the look from its
//     variable and refuses one it cannot mount in words;
//   · the look's pure half, `biom-agent-look/model.js` — every decision it
//     makes before it touches a node, the markdown reading above all;
//   · the look itself, `biom-agent-look/look.js`, mounted into a SMALL FAKE
//     DOM fed by the real shim. The look uses a deliberately narrow set of DOM
//     calls, and the fake is exactly that set — so what is held is what the
//     look builds and asks for, never how a browser lays it out. That half is
//     `tests/e2e/agent-look.e2e.ts`, in a real box in a real browser.
//
// The fixtures are `tests/agent-look-fixtures.js`, and they are invented.

import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import MarkdownIt from "../vendor/markdown-it.mjs";
import { lookState, chatState, cid, NAMES } from "./agent-look-fixtures.js";
import { CHAT_VIEWS, VIEW_WORDS } from "../contracts/wire.js";

const glob = /** @type {any} */ (globalThis);
const read = (/** @type {string} */ rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8");
const LOOK = "guest/plugins/biom-agent-look/";
const MOUNT = "guest/plugins/biom-agent/";

glob.markdownit = (/** @type {any} */ o) => new MarkdownIt(o);

/* ══ the shim's hook ═════════════════════════════════════════════════════ */

/** THE REAL SHIM, in a stand-in window, handed its two ports. Returns its
 *  `biom` and a function that delivers a host event on the guest port. */
function shim() {
  /** @type {Record<string, Function[]>} */
  const listeners = {};
  const win = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    parent: { postMessage() {} },
  });
  // The surface the shim reaches for at load and in its listeners: the
  // `touch` notice listens for `selectionchange` on the document and reads
  // the selection and the user activation when one fires.
  const doc = {
    querySelectorAll: () => [],
    documentElement: { style: { setProperty() {} } },
    scrollingElement: null,
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
  };
  const nav = { userActivation: { isActive: false, hasBeenActive: false } };
  new Function("window", "document", "navigator", read("guest/biom.js"))(win, doc, nav);
  /** @type {any} */
  const port = { onmessage: null, close() {}, postMessage(/** @type {any} */ m) {
    // Answer the shim's own start-up reads at once, so no call is left waiting.
    if (m && typeof m.id === "string") queueMicrotask(() => port.onmessage({ data: { id: m.id, g: 1, ok: true, value: m.kind === "data.get" ? {} : null } }));
  } };
  const other = { onmessage: null, close() {}, postMessage() {} };
  for (const fn of listeners.message || []) fn({ data: { kind: "ports", g: 1, page: "@agent" }, ports: [other, port] });
  return { biom: win.biom, hear: (/** @type {any} */ m) => port.onmessage({ data: m }) };
}

/** @param {number} seq @param {string} kind @param {Record<string, any>} [rest] */
const u = (seq, kind, rest = {}) => ({ seq, at: seq, turn: 1, kind, ...rest });
const tool = (/** @type {number} */ seq, /** @type {string} */ id, /** @type {string} */ status) =>
  u(seq, "tool", { tool: { id, title: "t", kind: "read", status, locations: [], diffs: [], output: "", truncated: false } });

test("the shim folds the look's patches: a patch before any state is dropped, and a late listener is handed the state whole", () => {
  const s = shim();
  s.hear({ kind: "look.patch", chat: null, chats: [] });
  /** @type {any[]} */
  const heard = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => heard.push({ chat: state.chat, patch }));
  expect(heard).toEqual([]);
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "hi" })] }) });
  expect(heard).toEqual([{ chat: cid("live"), patch: null }]);
  /** @type {any[]} */
  const late = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => late.push([state.updates.length, patch]));
  expect(late).toEqual([[1, null]]);
});

test("a patch's words append only to the chat held, so a stale one after a switch adds nothing", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  /** @type {any[]} */
  const patches = [];
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => { held = state; if (patch) patches.push(patch); });
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "a" })] }) });
  // The host switched to another chat; a patch for the one before is late.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("done"), updates: [u(1, "prompt", { text: "b" })] }) });
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [u(2, "reply", { text: "STALE" })] });
  expect(held.chat).toBe(cid("done"));
  expect(held.updates.map((/** @type {any} */ x) => x.text)).toEqual(["b"]);
  expect(patches[0].updates).toEqual([]);
  s.hear({ kind: "look.patch", chat: cid("done"), updates: [u(2, "reply", { text: "yes" })] });
  expect(held.updates.map((/** @type {any} */ x) => x.text)).toEqual(["b", "yes"]);
  expect(patches[1].updates.map((/** @type {any} */ x) => x.text)).toEqual(["yes"]);
});

test("an update already held is dropped, and a tool line is replaced where it stood and only by a later state", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  s.biom.onLook((/** @type {any} */ state) => { held = state; });
  // A kept log compacts a tool line to its LAST state where it FIRST stood:
  // seq 9 early, the words after it numbered lower.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [u(1, "prompt", { text: "p" }), tool(9, "t1", "completed"), u(3, "reply", { text: "a" }), u(4, "reply", { text: "b" })] }) });
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [u(4, "reply", { text: "b" }), u(8, "reply", { text: "old" }), u(10, "reply", { text: "c" }), tool(5, "t1", "in_progress")] });
  expect(held.updates.filter((/** @type {any} */ x) => x.kind === "reply").map((/** @type {any} */ x) => x.text)).toEqual(["a", "b", "c"]);
  expect(held.updates[1].tool.status).toBe("completed");
  s.hear({ kind: "look.patch", chat: cid("live"), updates: [tool(11, "t1", "failed"), tool(12, "t2", "pending")] });
  expect(held.updates.map((/** @type {any} */ x) => x.kind + (x.tool ? ":" + x.tool.id + ":" + x.tool.status : ""))).toEqual(["prompt", "tool:t1:failed", "reply", "reply", "reply", "tool:t2:pending"]);
  // A state that repeats a line compacts it to one.
  s.hear({ kind: "look.state", state: lookState({ chat: cid("live"), updates: [tool(1, "t9", "pending"), tool(2, "t9", "completed"), u(3, "reply", { text: "x" })] }) });
  expect(held.updates.map((/** @type {any} */ x) => x.seq)).toEqual([2, 3]);
});

test("chats, names, input, beside and the view replace what is held", () => {
  const s = shim();
  /** @type {any} */
  let held = null;
  /** @type {any} */
  let patched = null;
  s.biom.onLook((/** @type {any} */ state, /** @type {any} */ patch) => { held = state; patched = patch; });
  s.hear({ kind: "look.state", state: lookState({}) });
  expect(held.view).toBe("tools");
  s.hear({ kind: "look.patch", chat: null, chats: [], names: { a: { id: "home", name: "home" } }, input: { at: "bottom", height: 90 }, beside: null, view: "thinking" });
  expect(held.chats).toEqual([]);
  expect(held.names).toEqual({ a: { id: "home", name: "home" } });
  expect(held.input).toEqual({ at: "bottom", height: 90 });
  expect(held.beside).toBe(null);
  expect(held.view).toBe("thinking");
  expect(patched.view).toBe("thinking");
  // A patch that names no view leaves the one held.
  s.hear({ kind: "look.patch", chat: null, chats: [] });
  expect(held.view).toBe("thinking");
  expect(patched.view).toBeUndefined();
});

/* ══ the mount ═══════════════════════════════════════════════════════════ */

function mountHalf() {
  delete glob.__gAgentMount;
  const had = glob.document;
  delete glob.document;
  try { new Function(read(MOUNT + "agent.js"))(); } finally { if (had !== undefined) glob.document = had; }
  return glob.__gAgentMount;
}

test("the mount names the look by its variable, and refuses one it cannot mount in words that say where to fix it", () => {
  const m = mountHalf();
  const has = (/** @type {string} */ id) => id === "biom-agent-look" || id === "my-look";
  expect(m.lookOf("biom-agent-look", has)).toEqual({ id: "biom-agent-look" });
  expect(m.lookOf(" my-look ", has)).toEqual({ id: "my-look" });
  const unknown = m.lookOf("no-such-look", has).refused;
  expect(unknown).toContain("\"no-such-look\"");
  expect(unknown).toContain("no plugin by that name is registered");
  expect(unknown).toContain("plugins/biom-agent/extensions.yaml");
  expect(m.lookOf("", has).refused).toContain("empty");
  expect(m.lookOf(["a", "b"], has).refused).toContain("holds a list");
  expect(m.lookOf("Not An Id", has).refused).toContain("not a plugin's name");
  expect(m.OWN).toBe("biom-agent-look");
});

test("the two folders are the one shape: a document and its mount, a look of three files, and a contract naming the default", () => {
  expect(readdirSync(new URL("../" + MOUNT, import.meta.url)).sort()).toEqual(["agent.js", "index.html", "plugin.yaml"]);
  expect(readdirSync(new URL("../" + LOOK, import.meta.url)).sort()).toEqual(["look.js", "model.js", "sheet.js"]);
  const contract = read(MOUNT + "plugin.yaml").split("\n").filter((l) => /^[a-z]/.test(l));
  expect(contract).toEqual(["look: biom-agent-look"]);
  const doc = read(MOUNT + "index.html");
  expect(doc).not.toContain("<script");
  expect(doc).toContain('<main id="g-agent"></main>');
  expect(doc).toContain("--motion: 0");
  // One registration, under the folder's own id.
  const ids = [...read(LOOK + "look.js").matchAll(/id:\s*"([^"]+)"/g)].map((x) => x[1]);
  expect(ids).toEqual(["biom-agent-look"]);
});

test("NO STRING IS EVER MARKUP: none of the look's files writes HTML, sets a url from a string, or opens a frame", () => {
  for (const rel of [LOOK + "look.js", LOOK + "model.js", LOOK + "sheet.js", MOUNT + "agent.js"]) {
    const code = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "srcdoc", "createContextualFragment", "DOMParser", ".href =", "setAttribute(\"href\"", "eval(", "new Function"]) {
      expect([rel, word, code.includes(word)]).toEqual([rel, word, false]);
    }
  }
  // The one `src` the look sets is a face's art, and only through `artOf`.
  const look = read(LOOK + "look.js");
  expect(look.match(/setAttribute\("src"/g)?.length).toBe(1);
  expect(look).toContain("M.artOf(");
});

test("the sheet names no colour of its own: every colour is a token, or a mix of two", () => {
  const css = read(LOOK + "sheet.js");
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBe(null);
  expect(css.match(/\b(rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/g)).toBe(null);
  expect(css.match(/:\s*(white|black|red|green|blue|orange|yellow|gray|grey)\b/g)).toBe(null);
  // The LED tokens fall back to tokens every palette has.
  for (const token of ["var(--led, var(--cyan))", "var(--led-red, var(--magenta))", "var(--dot-off, var(--rule-soft))"]) expect(css).toContain(token);
  // EVERY TIME IN AN ANIMATION OR A TRANSITION IS MULTIPLIED BY THE MOTION
  // SWITCH, so `--motion: 0` is a resting frame.
  let times = 0;
  for (const d of css.matchAll(/(?:animation|transition)(?:-delay|-duration)?\s*:[^;}]*/g)) {
    for (const t of d[0].matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)) {
      times++;
      const after = d[0].slice((t.index || 0) + t[0].length);
      expect([d[0], after.startsWith(" * var(--l-m))")]).toEqual([d[0], true]);
    }
  }
  expect(times).toBeGreaterThan(30);
});

/* ══ the model: what the look decides before it draws ════════════════════ */

function model() {
  delete glob.__gAgentLook;
  new Function(read(LOOK + "model.js"))();
  return glob.__gAgentLook;
}
const M = model();

test("an agent's reply is read as markdown with raw HTML off: tags are words, a link has no address to follow, an image is its words", () => {
  const tree = M.mdTree("Hi <img src=x onerror=alert(1)> **bold**\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3)) [site](https://t.invalid/a) ![pic](https://t.invalid/p.png)\n\n```\n<b>code</b>\n```\n");
  /** @type {string[]} */
  const tags = [];
  /** @type {string[]} */
  const texts = [];
  /** @type {Record<string, string>[]} */
  const attrs = [];
  const walk = (/** @type {any[]} */ nodes) => { for (const n of nodes) { if (typeof n === "string") { texts.push(n); continue; } tags.push(n.t); if (n.a) attrs.push(n.a); walk(n.c); } };
  walk(tree);
  for (const t of tags) expect(M.TAGS.has(t)).toBe(true);
  expect(tags).not.toContain("img");
  expect(tags).not.toContain("a");
  expect(texts.join("")).toContain("<img src=x onerror=alert(1)>");
  expect(texts.join("")).toContain("<script>alert(2)</script>");
  expect(texts.join("")).toContain("<b>code</b>");
  // A link is its words with the address as a tooltip, never an href; the
  // library will not even read a `javascript:` one as a link, so it is words.
  expect(attrs).toContainEqual({ class: "lk", title: "https://t.invalid/a" });
  expect(texts.join("")).toContain("[go](javascript:alert(3))");
  expect(attrs).toContainEqual({ class: "img" });
  for (const a of attrs) for (const k of Object.keys(a)) expect(M.ATTRS.has(k)).toBe(true);
  // With no library it is the words in paragraphs, which is safe too.
  expect(M.mdTree("a <b>\n\nb", null)).toEqual([{ t: "p", a: { class: "pre" }, c: ["a <b>"] }, { t: "p", a: { class: "pre" }, c: ["b"] }]);
  // A numbered list continued after a cut keeps its number.
  expect(M.mdTree("3. three\n4. four")[0]).toEqual({ t: "ol", a: { start: "3" }, c: [{ t: "li", c: ["three"] }, { t: "li", c: ["four"] }] });
});

test("a streaming reply is cut only at a blank line outside a fence, and never inside the line still arriving", () => {
  const s = "One.\n\nTwo\n\n```\nfenced\n\nstill fenced\n```\n\nThree is arri";
  const cut = M.settledEnd(s, 0);
  expect(s.slice(0, cut)).toBe("One.\n\nTwo\n\n```\nfenced\n\nstill fenced\n```\n\n");
  expect(M.settledEnd("no blank line yet", 0)).toBe(0);
  expect(M.settledEnd("A.\n\nB", 3)).toBe(4);
  expect(M.settledEnd("```\nopen fence\n\nstill open", 0)).toBe(0);
});

test("a diff says what it added and removed, keeps three lines of context, folds the rest, and is bounded", () => {
  const old = Array.from({ length: 30 }, (_, i) => "line " + i).join("\n") + "\n";
  const neu = old.replace("line 15\n", "line fifteen\nline 15b\n").replace("line 2\n", "");
  const d = M.lineDiff(old, neu);
  expect([d.added, d.removed]).toEqual([2, 2]);
  expect(d.rows.filter((/** @type {any} */ r) => r.k === "gap").map((/** @type {any} */ r) => r.s)).toEqual(["6 unchanged lines", "11 unchanged lines"]);
  expect(M.lineDiff(null, "a\nb\n")).toMatchObject({ added: 2, removed: 0 });
  const big = M.lineDiff("", Array.from({ length: 900 }, (_, i) => "x" + i).join("\n"), 400);
  expect([big.rows.length, big.cut, big.added]).toEqual([400, 500, 900]);
  expect(M.countWords(18, 6)).toBe("+18 −6");
  expect(M.countWords(0, 0)).toBe("");
});

test("a tool line says its verb for its kind and state, and its object without saying the verb twice", () => {
  const t = (/** @type {any} */ o) => M.toolWords({ title: "", kind: "read", status: "completed", locations: [], ...o });
  expect(t({ title: "Read pages/a.yaml" })).toMatchObject({ verb: "Read", obj: "pages/a.yaml", live: false });
  expect(t({ title: "Edit pages/a.yaml", kind: "edit", status: "in_progress" })).toMatchObject({ verb: "Editing", obj: "pages/a.yaml", live: true });
  expect(t({ title: "`bun run check`", kind: "execute" })).toMatchObject({ verb: "Ran", obj: "bun run check" });
  expect(t({ title: "Read the notes", kind: "execute" }).obj).toBe("Read the notes");
  expect(t({ title: "", kind: "edit", locations: [{ path: "a.md", line: 3 }] }).obj).toBe("a.md:3");
  expect(t({ title: "Todo list", kind: "other", status: "failed" })).toMatchObject({ verb: "Todo list", failed: true });
  // A word off the wire is looked up by own key only: the prototype is not a row.
  expect(t({ title: "x", kind: "constructor" })).toMatchObject({ verb: "x" });
  expect(t({ title: "", kind: "__proto__" }).verb).toBe("Done");
  expect(M.stopWords("constructor", null)).toBe(null);
  expect(M.stopWords("toString", null)).toBe(null);
});

test("A RUN OF TOOL CALLS IS ONE LINE: how many, one or many, while it runs with the call under way, and how many failed", () => {
  const line = (/** @type {string} */ status, /** @type {string} */ title = "Read pages/a.yaml", kind = "read") => ({ id: title, title, kind, status, locations: [], diffs: [], output: "", truncated: false });
  expect(M.runWords([line("completed")], false)).toEqual({ label: "Used 1 tool", current: "", failed: 0, live: false });
  expect(M.runWords([line("completed"), line("completed"), line("completed")], false).label).toBe("Used 3 tools");
  // While it runs: the call in progress, in its own words, after the count.
  expect(M.runWords([line("completed"), line("in_progress", "Edit pages/b.yaml", "edit")], true)).toEqual({ label: "Using 2 tools", current: "Editing pages/b.yaml", failed: 0, live: true });
  expect(M.runWords([line("completed")], true)).toEqual({ label: "Using 1 tool", current: "", failed: 0, live: true });
  // A failure is counted whatever else the run did.
  expect(M.runWords([line("failed"), line("completed"), line("failed")], false)).toMatchObject({ label: "Used 3 tools", failed: 2 });
  // A run that is over says nothing of a call it never saw finish.
  expect(M.runWords([line("pending")], false).current).toBe("");
  expect(M.runWords(/** @type {any} */ (null), false).label).toBe("Used 0 tools");
});

test("a chat has three views, and a view the look does not know is Plain, the default", () => {
  expect(["plain", "thinking", "tools"].map(M.viewOf)).toEqual(["plain", "thinking", "tools"]);
  for (const v of [undefined, null, "", "Tools", "constructor", 3]) expect([v, M.viewOf(v)]).toEqual([v, "plain"]);
});

test("the list is grouped as the mockup groups it, newest first, and each row says what the chat is doing and with what", () => {
  const now = new Date(2026, 8, 26, 15, 0).getTime();
  const at = (/** @type {number} */ days, /** @type {number} */ h) => new Date(2026, 8, 26 - days, h, 5).getTime();
  const g = M.grouped([{ id: "a", updated: at(0, 9) }, { id: "b", updated: at(1, 23) }, { id: "c", updated: at(4, 9) }, { id: "d", updated: at(30, 9) }, { id: "e", updated: at(0, 14) }], now);
  expect(g.map((/** @type {any} */ x) => [x.label, x.chats.map((/** @type {any} */ c) => c.id)])).toEqual([["Today", ["e", "a"]], ["Yesterday", ["b"]], ["This week", ["c"]], ["Earlier", ["d"]]]);
  expect(M.subOf({ light: "working", harness: "Codex" }, now)).toEqual({ working: true, text: "Codex" });
  expect(M.subOf({ light: "error", harness: "Codex" }, now).text).toBe("Stopped · Codex");
  expect(M.subOf({ light: "none", harness: null, updated: at(0, 9) }, now).text).toBe("No agent yet · 09:05");
  expect(["working", "done", "error", "none", "x"].map(M.lampOf)).toEqual(["lit pulse", "green", "red", "none", "none"]);
  expect(M.stopWords("end_turn", null)).toBe(null);
  expect(M.stopWords("cancelled", null)).toBe(null);
  expect(M.stopWords("max_tokens", " ")).toEqual({ head: "The reply ran out of room.", rest: "It hit the agent's limit on how long one reply may be." });
  expect(M.stopWords("refusal", "Because of X.")).toEqual({ head: "The agent refused.", rest: "Because of X." });
});

test("a face is an emoji and its vendored art, and nothing else is ever put in its place", () => {
  expect(M.artOf({ emoji: "🤔", art: "/vendor/noto/1f914.webp" })).toBe("/vendor/noto/1f914.webp");
  expect(M.artOf({ emoji: "😵‍💫", art: "/vendor/noto/1f635_200d_1f4ab.webp" })).toBe("/vendor/noto/1f635_200d_1f4ab.webp");
  for (const art of ["javascript:alert(1)", "/vendor/noto/../../x.webp", "https://evil.invalid/1f914.webp", "/vendor/noto/1F914.webp\"onerror=x", null]) expect(M.artOf({ emoji: "🤔", art })).toBe(null);
  expect(M.emojiOf({ emoji: "😵‍💫" })).toBe("😵‍💫");
  expect(M.emojiOf({ emoji: "🇬🇧" })).toBe("🇬🇧");
  for (const e of ["<b>x</b>", "hello", "", "#", "🤔".repeat(12)]) expect(M.emojiOf({ emoji: e })).toBe("");
});

test("THE LOOK SAYS ONLY ITS OWN WORDS: its look kinds and open, each rebuilt from an id or a closed word, and nothing else at all", () => {
  expect(M.request("look.open", { chat: cid("live"), text: "sneak" })).toEqual({ kind: "look.open", params: { chat: cid("live") } });
  expect(M.request("look.open", { chat: "short" })).toBe(null);
  expect(M.request("look.open", { chat: "has space in it" })).toBe(null);
  expect(M.request("look.new", { text: "hello agent" })).toEqual({ kind: "look.new", params: {} });
  expect(M.request("look.list", { open: "yes" })).toBe(null);
  expect(M.request("look.panel", { to: "anywhere" })).toBe(null);
  expect(M.request("look.panel", { to: "beside" })).toEqual({ kind: "look.panel", params: { to: "beside" } });
  expect(M.request("open", { target: { kind: "page", id: "home/Boards", name: "x", text: "y" } })).toEqual({ kind: "open", params: { target: { kind: "page", id: "home/Boards" } } });
  expect(M.request("open", { target: { kind: "page", id: "@agent" } })).toBe(null);
  for (const kind of ["chat.send", "chat.new", "agents.install", "fetch", "run.start", "sql", "data.set", "page.embed", "settings.set"]) expect(M.request(kind, { text: "x", chat: cid("live"), view: "plain" })).toBe(null);
});

test("the look asks for a view only by one of the three words, and never with anything riding along", () => {
  for (const view of CHAT_VIEWS) expect(M.request("look.view", { view, chat: cid("live"), text: "sneak" })).toEqual({ kind: "look.view", params: { view } });
  for (const view of ["", "Plain", "Tool calls", "everything", "constructor", null, 3, undefined]) expect([view, M.request("look.view", { view })]).toEqual([view, null]);
});

test("THE LOOK'S VIEWS AND THEIR WORDS ARE THE CONTRACT'S: the same three in the same order, each called the same and saying the same", () => {
  expect([...M.VIEWS]).toEqual([...CHAT_VIEWS]);
  expect(JSON.parse(JSON.stringify(M.VIEW_WORDS))).toEqual(JSON.parse(JSON.stringify(VIEW_WORDS)));
  expect(Object.keys(M.VIEW_WORDS)).toEqual([...CHAT_VIEWS]);
});

test("a changed file opens as the page its place names, as a table, or not at all", () => {
  expect(M.changedTarget({ path: "p/c.yaml", place: { view: "page", uid: "uid00000boards01", screen: "page" }, op: "edited" }, NAMES)).toEqual({ label: "Boards", where: "home/Boards", target: { kind: "page", id: "home/Boards" }, page: true });
  expect(M.changedTarget({ path: "p/c.yaml", place: { view: "page", uid: "uid00000boards01", screen: "page" }, op: "deleted" }, NAMES).target).toBe(null);
  expect(M.changedTarget({ path: "p/gone.yaml", place: { view: "page", uid: "nobody", screen: "page" }, op: "edited" }, NAMES)).toMatchObject({ label: "p/gone.yaml", target: null });
  expect(M.changedTarget({ path: "workspace.db", place: { view: "table", id: "leads" }, op: "edited" }, NAMES)).toMatchObject({ label: "leads", target: { kind: "table", id: "leads" } });
  expect(M.changedTarget({ path: "plugins/x/x.js", place: null, op: "created" }, NAMES)).toMatchObject({ label: "plugins/x/x.js", target: null, page: false });
});

test("THE PAGES A TURN CHANGED ARE PAGES: a file made inside a page makes it Edited, and only its own document makes it Created, Deleted or Moved", () => {
  const names = { uidbeta000000001: { id: "home/Beta", name: "Beta" }, uidgamma00000001: { id: "home/Beta/Gamma", name: "Gamma" } };
  const beta = { view: "page", uid: "uidbeta000000001", screen: "page" };
  const gamma = { view: "page", uid: "uidgamma00000001", screen: "page" };
  const rows = (/** @type {any[]} */ edits) => M.changedRows(edits, names).map((/** @type {any} */ r) => [r.label, M.opWords(r.op), M.countWords(r.added, r.removed), r.target && r.target.id]);
  // The walk's case: an agent made notes.md inside Beta.
  expect(rows([{ path: "pages/home/children/Beta/notes.md", place: beta, op: "created", added: 1 }])).toEqual([["Beta", "Edited", "+1", "home/Beta"]]);
  // Several files in one page are one row, their counts summed.
  expect(rows([
    { path: "pages/home/children/Beta/content.yaml", place: beta, op: "edited", added: 3, removed: 1 },
    { path: "pages/home/children/Beta/figure.html", place: beta, op: "created", added: 20 },
  ])).toEqual([["Beta", "Edited", "+23 \u22121", "home/Beta"]]);
  // A page made in the turn is Created, whatever else was made in it; a child
  // page's own document is the child's, not its parent's.
  expect(rows([
    { path: "pages/home/children/Beta/children/Gamma/content.yaml", place: gamma, op: "created", added: 5 },
    { path: "pages/home/children/Beta/children/Gamma/notes.md", place: gamma, op: "created", added: 2 },
    { path: "pages/home/children/Beta/content.yaml", place: beta, op: "edited", added: 1, removed: 1 },
  ])).toEqual([["Gamma", "Created", "+7", "home/Beta/Gamma"], ["Beta", "Edited", "+1 \u22121", "home/Beta"]]);
  // A page whose document went is Deleted and opens nothing — and its files
  // come with NO place, because the page's uid went with its document by the
  // time the turn ended: they are grouped by the page folder their path
  // names. A file removed from a page that stays leaves it Edited.
  expect(rows([{ path: "pages/home/children/Beta/content.yaml", place: null, op: "deleted", removed: 12 }, { path: "pages/home/children/Beta/a.md", place: null, op: "deleted", removed: 3 }])).toEqual([["Beta", "Deleted", "\u221215", null]]);
  expect(rows([{ path: "pages/home/children/Beta/a.md", place: beta, op: "deleted", removed: 4 }])).toEqual([["Beta", "Edited", "\u22124", "home/Beta"]]);
  // A table is one row; a file no screen shows is itself.
  expect(rows([
    { path: "workspace.db", place: { view: "table", id: "leads" }, op: "edited" },
    { path: "workspace.db", place: { view: "table", id: "leads" }, op: "edited" },
    { path: "plugins/x/x.js", place: null, op: "created", added: 9 },
  ])).toEqual([["leads", "Edited", "", "leads"], ["plugins/x/x.js", "Created", "+9", null]]);
  expect(M.changedRows(null, names)).toEqual([]);
});

test("A PAGE DELETED IN THE TURN READS AS THE PAGE: its place-less files grouped by the folder their paths name, labelled by its segment, opening nothing", () => {
  const rows = (/** @type {any[]} */ edits) => M.changedRows(edits, {}).map((/** @type {any} */ r) => [r.label, M.opWords(r.op), M.countWords(r.added, r.removed), r.target, r.page, r.where]);
  // `rm -r` of a page and its child: two pages, each Deleted, each once.
  expect(rows([
    { path: "pages/home/children/Beta/content.yaml", place: null, op: "deleted", removed: 12 },
    { path: "pages/home/children/Beta/notes.md", place: null, op: "deleted", removed: 3 },
    { path: "pages/home/children/Beta/children/Gamma/content.yaml", place: null, op: "deleted", removed: 4 },
    { path: "pages/home/children/Beta/automations/digest/automation.yaml", place: null, op: "deleted" },
  ])).toEqual([
    ["Beta", "Deleted", "\u221215", null, true, "home/Beta"],
    ["Gamma", "Deleted", "\u22124", null, true, "home/Beta/Gamma"],
  ]);
  // A place-less file of a page whose own document is not among them is the
  // page Edited; the root page is a page too.
  expect(rows([{ path: "pages/home/old.md", place: null, op: "deleted", removed: 2 }])).toEqual([["home", "Edited", "\u22122", null, true, "home"]]);
  // The walk is the address table's: a name that is no page segment ends it,
  // and what is left is the page's own — so a content.yaml further down is
  // NOT the page's document, and does not make the page Deleted.
  expect(rows([{ path: "pages/home/children/.hidden/content.yaml", place: null, op: "deleted" }])).toEqual([["home", "Edited", "", null, true, "home"]]);
  // A path under pages/ that names no page folder is the file it is.
  for (const path of ["pages/content.yaml", "pages/../plugins/x.js", "pages", "pages/.git/HEAD"]) {
    expect(rows([{ path, place: null, op: "deleted" }]).map((r) => [r[0], r[4]])).toEqual([[path, false]]);
  }
});

test("the block of pages changed draws a page deleted in the turn as one row, Deleted, with nothing to open", () => {
  const now = Date.now();
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  endsWith(w, [
    { seq: 20, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null },
    { seq: 21, at: now, turn: 2, kind: "changed", edits: [
      { path: "pages/home/children/Beta/content.yaml", place: null, op: "deleted", removed: 12 },
      { path: "pages/home/children/Beta/notes.md", place: null, op: "deleted", removed: 3 },
    ] },
  ]);
  const second = byClass(w.root(), "turnw")[1];
  expect(byClass(second, "chead").map((e) => e.textContent)).toEqual(["1 page changed"]);
  expect(byClass(second, "crow").map((r) => r.textContent)).toEqual(["Beta" + "Deleted" + "\u221215"]);
  expect(byClass(second, "copen").length).toBe(0);
  w.teardown();
});

test("the transcript: blocks in the order they came, a tool line replaced by a later state only, a handover where it happened", () => {
  const T = M.makeTranscript();
  const add = (/** @type {any} */ x) => T.add(x);
  add({ seq: 1, at: 0, turn: 0, kind: "agent", agentId: "a1", agent: "claude-acp", harness: "Claude Code" });
  add({ seq: 2, at: 10, turn: 1, kind: "prompt", text: "go" });
  add({ seq: 3, at: 11, turn: 1, kind: "thought", text: "hm" });
  add({ seq: 4, at: 12, turn: 1, kind: "tool", tool: { id: "x", status: "pending", kind: "read", title: "Read a" } });
  add({ seq: 5, at: 13, turn: 1, kind: "reply", text: "one " });
  add({ seq: 6, at: 14, turn: 1, kind: "tool", tool: { id: "x", status: "completed", kind: "read", title: "Read a" } });
  add({ seq: 3, at: 15, turn: 1, kind: "tool", tool: { id: "x", status: "failed", kind: "read", title: "Read a" } });
  add({ seq: 7, at: 16, turn: 1, kind: "reply", text: "two" });
  add({ seq: 8, at: 20, turn: 1, kind: "turn", phase: "idle", stop: "end_turn", reason: null });
  add({ seq: 9, at: 21, turn: 1, kind: "agent", agentId: "a2", agent: "codex-acp", harness: "Codex" });
  add({ seq: 10, at: 22, turn: 2, kind: "prompt", text: "again" });
  const t1 = T.turn(1), t2 = T.turn(2);
  expect(t1.blocks.map((/** @type {any} */ b) => b.kind + ":" + b.text)).toEqual(["think:hm", "acts:", "prose:one two", "hand:Codex"]);
  expect(t1.blocks[3].from).toBe("Claude Code");
  expect(T.tools.get("x").tool.status).toBe("completed");
  expect(t1.blocks.every((/** @type {any} */ b) => b.end !== null)).toBe(true);
  expect([t1.agent, t2.agent, t1.stop]).toEqual(["Claude Code", "Codex", "end_turn"]);
  expect(M.modelOf([{ category: "model", value: "o", choices: [{ value: "o", name: "Opus 5.5" }] }])).toBe("Opus 5.5");
});

/* ══ the look, mounted: a small fake DOM, the real shim ══════════════════ */

/** THE FAKE DOM. Exactly the calls the look makes, and a record of every
 *  timer, frame, observer and listener it starts, so teardown can be held.
 *  An interval is kept with what it runs, for a test to run it; `canvas`
 *  gives the ribbon a context that counts how often it was sized. */
function fakeWorld(opts = /** @type {{ reduced?: boolean, canvas?: boolean }} */ ({})) {
  const live = { timers: new Set(), frames: new Set(), observers: new Set(), docListeners: 0, mediaListeners: 0, winListeners: 0,
    /** @type {Map<number, Function>} */ intervals: new Map(), framesAsked: 0, sized: 0 };
  /** @type {Function[]} */
  const onMedia = [];
  /** Which element has the caret, as `focus()` last put it. @type {{ el: any }} */
  const focus = { el: null };
  let nextId = 1;

  class Node {
    constructor() { /** @type {any} */ this.parentNode = null; /** @type {any[]} */ this.childNodes = []; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
    remove() { const p = this.parentNode; if (p) { p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
    /** @param {any} n */ replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); this.remove(); }
  }
  class Text extends Node {
    /** @param {string} s */ constructor(s) { super(); this.nodeType = 3; this.data = String(s); }
    get nodeValue() { return this.data; } set nodeValue(v) { this.data = String(v); }
    get textContent() { return this.data; }
    /** @param {string} s */ appendData(s) { this.data += s; }
  }
  class Element extends Node {
    /** @param {string} tag */
    constructor(tag) {
      super();
      this.nodeType = 1; this.localName = tag; this.tagName = tag.toUpperCase();
      /** @type {Map<string, string>} */ this.attrs = new Map();
      /** @type {Record<string, Function[]>} */ this.on = {};
      /** @type {Map<string, string>} */ this.props = new Map();
      this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.offsetWidth = 0;
      this.ownerDocument = doc;
      const self = this;
      this.style = { setProperty(/** @type {string} */ k, /** @type {string} */ v) { self.props.set(k, v); }, removeProperty(/** @type {string} */ k) { self.props.delete(k); } };
      this.classList = {
        add: (/** @type {string} */ c) => { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(" "); },
        remove: (/** @type {string} */ c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(" "); },
        contains: (/** @type {string} */ c) => self.className.split(/\s+/).includes(c),
        toggle: (/** @type {string} */ c, /** @type {boolean} */ f) => { const on = f === undefined ? !self.classList.contains(c) : f; if (on) self.classList.add(c); else self.classList.remove(c); return on; },
      };
    }
    get className() { return this.attrs.get("class") || ""; } set className(v) { this.attrs.set("class", String(v)); }
    get hidden() { return this.attrs.has("hidden"); } set hidden(v) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
    get type() { return this.attrs.get("type") || ""; } set type(v) { this.attrs.set("type", String(v)); }
    /** @param {string} k @param {any} v */ setAttribute(k, v) { this.attrs.set(k, String(v)); }
    /** @param {string} k */ getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    /** @param {string} k */ removeAttribute(k) { this.attrs.delete(k); }
    /** @param {string} k */ hasAttribute(k) { return this.attrs.has(k); }
    /** @param {string} k @param {boolean} [f] */ toggleAttribute(k, f) { const on = f === undefined ? !this.attrs.has(k) : f; if (on) this.attrs.set(k, ""); else this.attrs.delete(k); return on; }
    get firstElementChild() { return this.childNodes.find((n) => n.nodeType === 1) || null; }
    get lastElementChild() { return [...this.childNodes].reverse().find((n) => n.nodeType === 1) || null; }
    get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
    set textContent(v) { this.replaceChildren(); if (v !== "") this.appendChild(new Text(String(v))); }
    /** @param {any} n */ appendChild(n) { return this.insertBefore(n, null); }
    /** @param {any} n @param {any} ref */
    insertBefore(n, ref) {
      if (n.parentNode) n.remove();
      const at = ref ? this.childNodes.indexOf(ref) : -1;
      if (at < 0) this.childNodes.push(n); else this.childNodes.splice(at, 0, n);
      n.parentNode = this;
      return n;
    }
    /** @param {...any} ns */ replaceChildren(...ns) { for (const c of this.childNodes.slice()) c.remove(); for (const n of ns) this.appendChild(n); }
    /** @param {string} t @param {Function} fn */ addEventListener(t, fn) { (this.on[t] = this.on[t] || []).push(fn); }
    /** @param {string} t @param {Function} fn */ removeEventListener(t, fn) { const l = this.on[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
    /** @param {string} t @param {any} [ev] */ fire(t, ev = {}) { for (const fn of (this.on[t] || []).slice()) fn({ type: t, target: this, preventDefault() {}, composedPath: () => [], ...ev }); }
    attachShadow() { const r = new Element("#shadow"); r.parentNode = null; this.shadow = r; return r; }
    getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; }
    focus() { focus.el = this; }
    getContext() { return opts.canvas ? { setTransform() { live.sized++; }, clearRect() {} } : null; }
    /** @param {any} o */ scrollTo(o) { this.scrollTop = o.top; }
  }
  const doc = /** @type {any} */ ({
    createElement: (/** @type {string} */ t) => new Element(t),
    createElementNS: (/** @type {string} */ _ns, /** @type {string} */ t) => new Element(t),
    createTextNode: (/** @type {string} */ s) => new Text(s),
    documentElement: null,
    addEventListener() { live.docListeners++; },
    removeEventListener() { live.docListeners--; },
  });
  doc.documentElement = new Element("html");
  const media = { matches: !!opts.reduced, addEventListener(/** @type {string} */ _t, /** @type {Function} */ fn) { live.mediaListeners++; onMedia.push(fn); }, removeEventListener() { live.mediaListeners--; } };
  /** Reduced motion asked for, or taken back. @param {boolean} on */
  const reduce = (on) => { media.matches = on; for (const fn of onMedia.slice()) fn(); };
  const win = {
    addEventListener() { live.winListeners++; },
    removeEventListener() { live.winListeners--; },
    setTimeout: (/** @type {Function} */ fn, /** @type {number} */ ms) => { const id = nextId++; live.timers.add(id); const t = setTimeout(() => { live.timers.delete(id); fn(); }, Math.min(ms, 5)); timerOf.set(id, t); return id; },
    clearTimeout: (/** @type {number} */ id) => { live.timers.delete(id); clearTimeout(timerOf.get(id)); },
    setInterval: (/** @type {Function} */ fn, /** @type {number} */ _ms) => { const id = nextId++; live.timers.add(id); live.intervals.set(id, fn); return id; },
    clearInterval: (/** @type {number} */ id) => { live.timers.delete(id); live.intervals.delete(id); },
    requestAnimationFrame: (/** @type {Function} */ fn) => { const id = nextId++; live.framesAsked++; live.frames.add(id); frameFns.set(id, fn); return id; },
    cancelAnimationFrame: (/** @type {number} */ id) => { live.frames.delete(id); frameFns.delete(id); },
    matchMedia: () => media,
    getComputedStyle: () => ({ getPropertyValue: () => "", color: "" }),
    ResizeObserver: class { constructor() { live.observers.add(this); } observe() {} unobserve() {} disconnect() { live.observers.delete(this); } },
    devicePixelRatio: 1,
  };
  /** @type {Map<number, any>} */
  const timerOf = new Map();
  /** @type {Map<number, Function>} */
  const frameFns = new Map();
  doc.defaultView = win;
  return { doc, win, live, focus, reduce, node: new Element("main") };
}

/** Every element under a root, shadow roots included, in document order. @param {any} root @returns {any[]} */
function everything(root) {
  /** @type {any[]} */
  const out = [];
  const walk = (/** @type {any} */ n) => { for (const c of n.childNodes) if (c.nodeType === 1) { out.push(c); walk(c); if (c.shadow) walk(c.shadow); } if (n.shadow) walk(n.shadow); };
  walk(root);
  return out;
}
/** @param {any} root @param {string} cls */
const byClass = (root, cls) => everything(root).filter((e) => e.classList.contains(cls));
/** @param {any} root @param {string} cls */
const one = (root, cls) => byClass(root, cls)[0];

/** THE LOOK, MOUNTED: the real shim's `onLook`, the real model and sheet,
 *  the look's own file, a fake DOM and a `ctx.call` that records. */
function mounted(opts = /** @type {{ reduced?: boolean, canvas?: boolean }} */ ({})) {
  const world = fakeWorld(opts);
  const s = shim();
  delete glob.__gAgentLook; delete glob.__gAgentLookSheet;
  new Function(read(LOOK + "model.js"))();
  new Function(read(LOOK + "sheet.js"))();
  /** @type {any} */
  let def = null;
  const had = glob.biom;
  glob.biom = { plugins: { register: (/** @type {any} */ d) => { def = d; } }, onLook: s.biom.onLook, onTheme: s.biom.onTheme };
  new Function(read(LOOK + "look.js"))();
  /** @type {any[]} */
  const calls = [];
  const ctx = { call: (/** @type {string} */ kind, /** @type {any} */ params) => { calls.push({ kind, ...params }); return Promise.resolve(null); } };
  const teardown = def.mount(world.node, null, ctx);
  glob.biom = had;
  return { ...world, hear: s.hear, calls, teardown, root: () => world.node.childNodes[0] && world.node.childNodes[0].shadow };
}

test("the look draws the start screen: the line, the history link with who is working, and no thread", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: lookState({}) });
  const root = w.root();
  const look = one(root, "g-look");
  expect(look.getAttribute("data-state")).toBe("empty");
  expect(one(root, "line").textContent).toBe("What should we automate?");
  expect(one(root, "histlink").textContent).toBe("View chat history · 1 working");
  expect(byClass(root, "turnw").length).toBe(0);
  expect(look.hasAttribute("data-threads")).toBe(false);
  expect(look.props.get("--l-in")).toBe("118px");
  w.teardown();
});

test("A STATE HANDED WHOLE AGAIN MOVES NOTHING ON THE START SCREEN: the word keeps its one interval and turns on it, and the ribbon is not entered again", () => {
  const w = mounted({ canvas: true });
  w.hear({ kind: "look.state", state: lookState({}) });
  const words = [...w.live.intervals.keys()];
  expect(words.length).toBe(1);
  const sized = w.live.sized;
  const asked = w.live.framesAsked;
  expect(sized).toBe(1);
  // The host hands the start screen over whole whenever its shape moves: the
  // history opened and shut, the panel beside a page and back.
  for (const over of [{ list: true }, { list: false }, { mode: "panel" }, { mode: "screen" }, {}]) w.hear({ kind: "look.state", state: lookState(over) });
  expect([...w.live.intervals.keys()]).toEqual(words);
  expect(w.live.sized).toBe(sized);
  expect(w.live.framesAsked).toBe(asked);
  const swap = one(w.root(), "swap");
  /** @type {Function} */ (w.live.intervals.get(words[0]))();
  expect(swap.lastElementChild.textContent).toBe("plan");
  // Into a chat the word stops and the ribbon goes; back, each starts once.
  w.hear({ kind: "look.state", state: chatState("done") });
  w.hear({ kind: "look.state", state: chatState("done") });
  expect(w.live.intervals.size).toBe(0);
  w.hear({ kind: "look.state", state: lookState({}) });
  w.hear({ kind: "look.state", state: lookState({ list: true }) });
  expect(w.live.intervals.size).toBe(1);
  expect(w.live.sized).toBe(sized + 1);
  w.teardown();
});

test("reduced motion asked for while the start screen shows stops the word and rests the ribbon, and taken back starts the word once", () => {
  const w = mounted({ canvas: true });
  w.hear({ kind: "look.state", state: lookState({}) });
  expect(w.live.intervals.size).toBe(1);
  w.reduce(true);
  expect(one(w.root(), "g-look").hasAttribute("data-still")).toBe(true);
  expect(w.live.intervals.size).toBe(0);
  expect(w.live.frames.size).toBe(0);
  w.hear({ kind: "look.state", state: lookState({ list: true }) });
  expect(w.live.intervals.size).toBe(0);
  w.reduce(false);
  expect(w.live.intervals.size).toBe(1);
  expect(w.live.frames.size).toBe(1);
  w.teardown();
});

test("INTO A CHAT THE START SCREEN'S TWO LINES LEAVE, every time: going takes the coming in off, and coming back takes the leaving off", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: lookState({}) });
  const lines = () => [one(w.root(), "hero-top").className, one(w.root(), "hero-bot").className];
  w.hear({ kind: "look.state", state: chatState("done") });
  expect(lines()).toEqual(["hero hero-top leaving", "hero hero-bot leaving"]);
  w.hear({ kind: "look.state", state: lookState({}) });
  expect(lines()).toEqual(["hero hero-top arriving", "hero hero-bot arriving"]);
  // A finished coming in held on its last frame stands in front of the
  // leaving's transition, and the lines would vanish rather than lift away.
  w.hear({ kind: "look.state", state: chatState("done") });
  expect(lines()).toEqual(["hero hero-top leaving", "hero hero-bot leaving"]);
  w.teardown();
});

test("THE START SCREEN'S LINES HOLD THEIR PLACE WHILE THE INPUT GOES TO THE FOOT: they sit either side of a centred input, and one at the foot moves only the thread's end", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: lookState({ input: { at: "center", height: 118 } }) });
  const look = one(w.root(), "g-look");
  expect([look.props.get("--l-mid"), look.props.get("--l-in")]).toEqual(["118px", "118px"]);
  // A chat picked: the host moves the input to the foot as soon as it is
  // asked, and hands the chat over once its stream is read.
  w.hear({ kind: "look.patch", chat: null, input: { at: "bottom", height: 300 } });
  expect([look.props.get("--l-mid"), look.props.get("--l-in")]).toEqual(["118px", "300px"]);
  w.hear({ kind: "look.state", state: lookState({ input: { at: "center", height: 140 } }) });
  expect([look.props.get("--l-mid"), look.props.get("--l-in")]).toEqual(["140px", "140px"]);
  w.teardown();
});

test("the look draws a chat: the list, each turn in order, the loader on the running message and the face on the finished one", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const root = w.root();
  expect(one(root, "g-look").getAttribute("data-state")).toBe("live");
  expect(one(root, "g-look").hasAttribute("data-threads")).toBe(true);
  expect(byClass(root, "tgroup").map((g) => g.textContent)).toEqual(["Today", "Yesterday", "This week", "Earlier"]);
  const rows = byClass(root, "trow");
  expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
  expect(byClass(rows[0], "led")[0].className).toBe("led lit pulse");
  expect(one(rows[0], "s").textContent).toBe("Working · Claude Code");
  const turns = byClass(root, "turnw");
  expect(turns.length).toBe(2);
  const moods = turns.map((t) => one(t, "mood"));
  expect(everything(moods[0]).find((e) => e.localName === "img").getAttribute("src")).toBe("/vendor/noto/1f60c.webp");
  expect(byClass(moods[1], "dm").length).toBe(1);
  expect(byClass(turns[0], "act").map((a) => one(a, "verb").textContent + " " + one(a, "meta").textContent)).toEqual(["Read ", "Edited +1 −2", "Ran "]);
  expect(byClass(turns[1], "act").map((a) => one(a, "verb").textContent)).toEqual(["Reading"]);
  expect(one(turns[0], "prose").textContent).toBe("Merged the two backlog columns and renamed Someday to Later, so every board uses the same four columns.Backlog and Someday are one column nowThe checker came back clean");
  expect(everything(one(turns[0], "prose")).map((e) => e.localName)).toEqual(["p", "strong", "code", "ul", "li", "li"]);
  expect(byClass(turns[0], "crow").map((r) => r.textContent)).toEqual(["Boards" + "Edited" + "+1 −2" + "Open"]);
  expect(byClass(turns[0], "tfoot")[0].textContent).toBe("Claude Code · Opus 5.5 · 21s");
  expect(byClass(turns[1], "tfoot")[0].hidden).toBe(true);
  w.teardown();
});

/** Every run line in a root, in order: its words, open or shut, and the
 *  count of call lines it holds. @param {any} root */
const runs = (root) => byClass(root, "grp").map((g) => ({
  label: one(g, "glabel").textContent,
  current: one(g, "gcur").hidden ? "" : one(g, "gcur").textContent,
  failed: one(g, "gfail").hidden ? "" : one(g, "gfail").textContent,
  open: g.getAttribute("aria-expanded") === "true",
  shown: !one(g.parentNode, "grplist").hidden,
  calls: byClass(one(g.parentNode, "grplist"), "act").length,
}));

test("EACH RUN OF TOOL CALLS IS ONE SHUT LINE in every view: Used N tools, Using N tools with the call under way while it runs, and a failure marked while it is shut", () => {
  for (const view of ["plain", "thinking", "tools"]) {
    const w = mounted();
    w.hear({ kind: "look.state", state: chatState("live", { view }) });
    const look = one(w.root(), "g-look");
    expect(look.getAttribute("data-view")).toBe(view);
    const turns = byClass(w.root(), "turnw");
    expect(runs(turns[0])).toEqual([{ label: "Used 3 tools", current: "", failed: "", open: false, shown: false, calls: 3 }]);
    expect(runs(turns[1])).toEqual([{ label: "Using 1 tool", current: "Reading pages/home/children/Specs/content.yaml", failed: "", open: false, shown: false, calls: 1 }]);
    // Each is a button with its own words said, shut until pressed.
    const grp = one(turns[0], "grp");
    expect(grp.localName).toBe("button");
    expect(grp.getAttribute("type")).toBe("button");
    expect(grp.getAttribute("aria-label")).toBe("Used 3 tools");
    w.teardown();
    const r = mounted();
    r.hear({ kind: "look.state", state: chatState("red", { view }) });
    expect(runs(r.root())).toEqual([{ label: "Used 2 tools", current: "", failed: "1 failed", open: false, shown: false, calls: 2 }]);
    expect(byClass(one(r.root(), "gfail"), "led")[0].className).toBe("led red");
    r.teardown();
  }
});

test("a run line opens to its calls and each call to its diff, and both stay as they were while the turn streams: a call joining an open run leaves it open, one joining a shut run leaves it shut", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const [first, second] = byClass(w.root(), "turnw");
  const grp = one(first, "grp");
  grp.fire("click");
  expect(runs(first)[0]).toMatchObject({ open: true, shown: true, calls: 3 });
  // The second level: a call opens to its diff, as it always did.
  const edit = byClass(first, "act")[1];
  edit.fire("click");
  expect(edit.getAttribute("aria-expanded")).toBe("true");
  expect(byClass(one(edit.parentNode, "detail"), "dl").map((d) => d.className).slice(0, 2)).toEqual(["dl path", "dl ctx"]);
  // Streaming on: the shut run of the running turn takes a call and stays
  // shut; the first turn's open run is left open.
  const now = Date.now();
  const call = (/** @type {number} */ seq, /** @type {string} */ id, /** @type {string} */ status) => ({ seq, at: now, turn: 2, kind: "tool", tool: { id, title: "Edit pages/home/children/Specs/content.yaml", kind: "edit", status, locations: [], diffs: [], output: "", truncated: false } });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [call(20, "tool-edit-2", "in_progress")] });
  expect(runs(second)[0]).toEqual({ label: "Using 2 tools", current: "Editing pages/home/children/Specs/content.yaml", failed: "", open: false, shown: false, calls: 2 });
  expect(runs(first)[0]).toMatchObject({ open: true, shown: true });
  // Opened while it runs, it stays open as the next call joins and the last
  // one fails — and the failure is on the line, open or shut.
  one(second, "grp").fire("click");
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [call(21, "tool-edit-2", "failed"), call(22, "tool-edit-3", "in_progress")] });
  expect(runs(second)[0]).toEqual({ label: "Using 3 tools", current: "Editing pages/home/children/Specs/content.yaml", failed: "1 failed", open: true, shown: true, calls: 3 });
  // The turn ends: the run says what it used, and still says what failed.
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [call(23, "tool-edit-3", "completed"), { seq: 24, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null }],
    chats: chatState("live").chats.map((/** @type {any} */ c) => (c.id === cid("live") ? { ...c, phase: "idle", light: "done", stop: "end_turn" } : c)) });
  expect(runs(second)[0]).toMatchObject({ label: "Used 3 tools", current: "", failed: "1 failed", open: true });
  // Pressed again, it shuts.
  one(second, "grp").fire("click");
  expect(runs(second)[0]).toMatchObject({ open: false, shown: false });
  w.teardown();
});

test("thinking is drawn both ways at once and the view picks which: folded to its line in Plain, opened by a press, and written out in Thinking and Tool calls", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("done", { view: "plain", updates: [
    ...chatState("done").updates.slice(0, 3),
    { seq: 30, at: Date.now() - 200000, turn: 1, kind: "thought", text: "Read the run first, then say what wants the person's eye." },
    ...chatState("done").updates.slice(3),
  ] }) });
  const root = w.root();
  const think = one(root, "think");
  const thinkw = think.parentNode;
  const thought = one(root, "thought");
  expect(thought.textContent).toBe("Read the run first, then say what wants the person's eye.");
  // Folded: the words are there and the sheet shows them only when opened.
  expect(thinkw.hasAttribute("data-open")).toBe(false);
  think.fire("click");
  expect(thinkw.hasAttribute("data-open")).toBe(true);
  expect(think.getAttribute("aria-expanded")).toBe("true");
  think.fire("click");
  expect(thinkw.hasAttribute("data-open")).toBe(false);
  // The sheet says what each view shows, by the root's attribute — a
  // ladder: the thinking written out in every view but Plain, and the runs
  // of tool calls in Tool calls alone.
  const sheet = glob.__gAgentLookSheet;
  expect(sheet).toContain(".thinkw[data-open] .thought { display: block;");
  expect(sheet).toContain(".g-look:not([data-view=plain]) .thinkw .think { display: none; }");
  expect(sheet).toMatch(/\.g-look:not\(\[data-view=plain\]\) \.thinkw \.thought \{ display: block;[^}]*border-left: 1px solid var\(--rule\);[^}]*font: italic/);
  expect(sheet).toContain(".g-look:not([data-view=tools]) .acts { display: none; }");
  expect(sheet).not.toMatch(/data-view=(plain|thinking|tools)\][^{]*\.acts \{ display: block/);
  w.teardown();
});

test("A VIEW PICKED MOVES NO NODE: the root's view changes and every turn, run and thought drawn stays where it was, with the reader kept at the end", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const root = w.root();
  const before = everything(root);
  const log = one(root, "log");
  for (const view of ["thinking", "plain", "tools", "nonsense"]) {
    log.scrollHeight = 5000 + before.length;
    log.scrollTop = 0;
    w.hear({ kind: "look.patch", chat: cid("live"), view });
    expect(one(root, "g-look").getAttribute("data-view")).toBe(view === "nonsense" ? "plain" : view);
    expect(everything(root)).toEqual(before);
    // The reader was at the end, so the end is where they are left.
    expect(log.scrollTop).toBe(log.scrollHeight);
  }
  w.teardown();
});

test("thinking written out is bounded as an output is, and says how much more there was", () => {
  const w = mounted();
  const long = "x".repeat(20000) + "y".repeat(345);
  const state = chatState("done");
  w.hear({ kind: "look.state", state: { ...state, view: "thinking", updates: [...state.updates.slice(0, 3), { seq: 30, at: Date.now() - 200000, turn: 1, kind: "thought", text: long }, ...state.updates.slice(3)] } });
  const thought = one(w.root(), "thought");
  expect(thought.childNodes[0].textContent).toBe("x".repeat(20000));
  expect(one(thought, "more").textContent).toBe("345 more characters not shown");
  w.teardown();
});

test("a turn that ended red says why; a held message waits in words; a cancelled one says it stopped", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("red") });
  let root = w.root();
  expect(byClass(root, "note").map((n) => n.textContent)).toEqual([
    "The reply ran out of room. It hit the agent's limit on how long one reply may be.",
    "Codex stopped mid-reply; nothing after the last line above was written.",
  ]);
  expect(one(root, "handover").textContent).toBe("Codex took over from Claude Code · it has the chat so far");
  w.hear({ kind: "look.state", state: chatState("held") });
  root = w.root();
  expect(byClass(root, "stopped").map((n) => n.textContent)).toEqual(["Waiting for an agent to be ready"]);
  const now = Date.now();
  w.hear({ kind: "look.patch", chat: cid("held"), updates: [{ seq: 3, at: now, turn: 1, kind: "turn", phase: "idle", stop: "cancelled", reason: null }], chats: chatState("held").chats.map((/** @type {any} */ c) => (c.id === cid("held") ? { ...c, phase: "idle", stop: "cancelled" } : c)) });
  expect(byClass(root, "stopped").map((n) => n.textContent)).toEqual(["Stopped. Nothing after this point was done."]);
  w.teardown();
});

test("A PATCH IS DRAWN WHERE IT LANDS: the nodes already drawn stay, words stream into the running reply, and a stale patch adds nothing", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const root = w.root();
  const [first, second] = byClass(root, "turnw");
  const firstProse = one(first, "prose");
  const now = Date.now();
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 20, at: now, turn: 2, kind: "reply", text: "Drawing the four columns.\n\nThen the " }] });
  w.hear({ kind: "look.patch", chat: cid("done"), updates: [{ seq: 21, at: now, turn: 2, kind: "reply", text: "WRONG CHAT" }] });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 20, at: now, turn: 2, kind: "reply", text: "Drawing the four columns.\n\nThen the " }] });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 22, at: now, turn: 2, kind: "reply", text: "figure." }] });
  const after = byClass(root, "turnw");
  expect(after[0]).toBe(first);
  expect(after[1]).toBe(second);
  expect(one(after[0], "prose")).toBe(firstProse);
  const prose = byClass(second, "prose")[0];
  // The settled paragraph is drawn once; the one still arriving has the caret.
  expect(everything(prose).map((e) => e.className || e.localName)).toEqual(["p", "tail", "p", "caret"]);
  expect(prose.textContent).toBe("Drawing the four columns.Then the figure.");
  // A new tool line joins the running turn; its later state replaces it in place.
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 23, at: now, turn: 2, kind: "tool", tool: { id: "tool-edit-2", title: "Edit pages/home/children/Specs/content.yaml", kind: "edit", status: "in_progress", locations: [], diffs: [], output: "", truncated: false } }] });
  const line = byClass(second, "act").pop();
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 24, at: now, turn: 2, kind: "tool", tool: { id: "tool-edit-2", title: "Edit pages/home/children/Specs/content.yaml", kind: "edit", status: "completed", locations: [], diffs: [{ path: "a", old: "x\n", new: "y\nz\n" }], output: "", truncated: false } }] });
  expect(byClass(second, "act").pop()).toBe(line);
  expect(one(line, "verb").textContent).toBe("Edited");
  expect(one(line, "meta").textContent).toBe("+2 −1");
  // The turn ends: the reply is read once more as a whole, the caret gone.
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 25, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null }] });
  expect(byClass(second, "caret").length).toBe(0);
  expect(byClass(second, "prose").pop().textContent).toBe("Drawing the four columns.Then the figure.");
  w.teardown();
});

/** THE LIVE CHAT, the summary moved to idle, and `updates` as one patch —
 *  the way a server that coalesces a frame's worth of the stream sends the
 *  last words of a reply and the turn's end together. */
function endsWith(/** @type {any} */ w, /** @type {any[]} */ updates) {
  const chats = chatState("live").chats.map((/** @type {any} */ c) => (c.id === cid("live") ? { ...c, phase: "idle", light: "done", stop: "end_turn" } : c));
  w.hear({ kind: "look.patch", chat: cid("live"), updates, chats });
}

test("A REPLY THAT ARRIVES WITH ITS TURN'S END IS DRAWN, whichever of the two comes first in the patch", () => {
  const now = Date.now();
  const reply = { seq: 20, at: now, turn: 2, kind: "reply", text: "Done." };
  const end = { seq: 21, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null };
  for (const order of [[reply, end], [{ ...end, seq: 20 }, { ...reply, seq: 21 }]]) {
    const w = mounted();
    w.hear({ kind: "look.state", state: chatState("live") });
    endsWith(w, order);
    const second = byClass(w.root(), "turnw")[1];
    const prose = byClass(second, "prose");
    expect([order[0].kind, prose.map((p) => p.textContent)]).toEqual([order[0].kind, ["Done."]]);
    expect(byClass(second, "caret").length).toBe(0);
    w.teardown();
  }
});

test("a reply's last words are drawn when they come a patch after the turn has ended, and when the summary moves first", () => {
  const now = Date.now();
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  // The summary says idle before the stream has said anything more.
  endsWith(w, []);
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 20, at: now, turn: 2, kind: "reply", text: "First " }] });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 21, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null }] });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 22, at: now, turn: 2, kind: "reply", text: "and **last**." }] });
  const second = byClass(w.root(), "turnw")[1];
  expect(byClass(second, "prose").map((p) => p.textContent).join("|")).toBe("First and last.");
  expect(everything(second).some((e) => e.localName === "strong" && e.textContent === "last")).toBe(true);
  w.teardown();
});

test("the block of pages changed draws a new file inside a page as the page Edited, one row a page", () => {
  const now = Date.now();
  const w = mounted();
  const state = chatState("live");
  state.names = { ...state.names, uidbeta000000001: { id: "home/Beta", name: "Beta" } };
  w.hear({ kind: "look.state", state });
  const beta = { view: "page", uid: "uidbeta000000001", screen: "page" };
  endsWith(w, [
    { seq: 20, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null },
    { seq: 21, at: now, turn: 2, kind: "changed", edits: [
      { path: "pages/home/children/Beta/notes.md", place: beta, op: "created", added: 1 },
      { path: "pages/home/children/Beta/content.yaml", place: beta, op: "edited", added: 2, removed: 1 },
    ] },
  ]);
  const second = byClass(w.root(), "turnw")[1];
  expect(byClass(second, "chead").map((e) => e.textContent)).toEqual(["1 page changed"]);
  expect(byClass(second, "crow").map((r) => r.textContent)).toEqual(["Beta" + "Edited" + "+3 \u22121" + "Open"]);
  w.teardown();
});

test("a long chat draws its latest forty turns, and forty more on asking, above the ones already there", () => {
  const w = mounted();
  const now = Date.now();
  /** @type {any[]} */
  const updates = [];
  let seq = 0;
  for (let n = 1; n <= 95; n++) {
    updates.push({ seq: ++seq, at: now - 1e6 + n, turn: n, kind: "prompt", text: "message " + n });
    updates.push({ seq: ++seq, at: now - 1e6 + n, turn: n, kind: "reply", text: "answer " + n });
    updates.push({ seq: ++seq, at: now - 1e6 + n, turn: n, kind: "turn", phase: "idle", stop: "end_turn", reason: null });
  }
  w.hear({ kind: "look.state", state: lookState({ chat: cid("done"), updates }) });
  const root = w.root();
  expect(byClass(root, "turnw").length).toBe(40);
  const earlier = one(root, "earlier");
  expect(earlier.textContent).toBe("Show 40 earlier turns · 55 not shown");
  const had = byClass(root, "turnw")[0];
  earlier.fire("click");
  const turns = byClass(root, "turnw");
  expect(turns.length).toBe(80);
  expect(turns[40]).toBe(had);
  expect(one(turns[0], "u").textContent).toBe("message 16");
  one(root, "earlier").fire("click");
  expect(byClass(root, "turnw").length).toBe(95);
  expect(byClass(root, "earlier").length).toBe(0);
  w.teardown();
});

test("an agent's words are words: nothing in the hostile chat becomes an element, a handler or a url", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("evil") });
  const root = w.root();
  for (const a of byClass(root, "act")) a.fire("click");
  for (const t of byClass(root, "think")) t.fire("click");
  const els = everything(root);
  const tags = new Set(els.map((e) => e.localName));
  for (const bad of ["script", "iframe", "img", "a", "object", "embed", "form", "input", "div onclick"]) expect(tags.has(bad)).toBe(false);
  for (const e of els) for (const k of e.attrs.keys()) {
    expect(/^on/i.test(k)).toBe(false);
    expect(["src", "href", "srcdoc", "style", "action", "formaction"].includes(k)).toBe(false);
  }
  const text = one(root, "log").textContent;
  expect(text).toContain("<script>window.__pwned=7</script>");
  expect(text).toContain("<img src=y onerror=\"window.__pwned=6\">");
  expect(one(one(root, "act"), "obj").textContent).toBe("<img src=x onerror=\"window.__pwned=1\">");
  expect(one(root, "tlist").textContent).toContain("<img src=n onerror=");
  // The markup-shaped face and art draw no face at all.
  expect(byClass(root, "mood")[0].childNodes.length).toBe(0);
  w.teardown();
});

test("A CHAT'S THREE DOTS: a button beside every row, in the history and in the panel's list, opening a menu whose Delete ASKS with the chat's id and nothing else", async () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const root = w.root();
  const boxes = byClass(root, "trowbox");
  expect(boxes.length).toBe(5);
  for (const b of boxes) {
    const [rowEl, dots] = b.childNodes;
    expect(rowEl.classList.contains("trow")).toBe(true);
    // Beside the row and never inside it: a control inside the row's own
    // option is one no key could reach.
    expect(dots.localName).toBe("button");
    expect(dots.classList.contains("tmore")).toBe(true);
    expect(dots.getAttribute("aria-haspopup")).toBe("menu");
    expect(dots.getAttribute("aria-expanded")).toBe("false");
    expect(byClass(rowEl, "tmore").length).toBe(0);
  }
  const dots = boxes[1].childNodes[1];
  expect(dots.getAttribute("aria-label")).toBe("More for Summarise what the Socials run did today");
  dots.fire("click");
  expect(dots.getAttribute("aria-expanded")).toBe("true");
  const menuEl = one(root, "rowmenu");
  expect(menuEl.getAttribute("role")).toBe("menu");
  const items = byClass(menuEl, "mi");
  expect(items.map((i) => [i.localName, i.getAttribute("role"), i.textContent])).toEqual([["button", "menuitem", "Delete"]]);
  // Opening the menu picked nothing, and asked for nothing.
  await Promise.resolve();
  expect(w.calls).toEqual([]);
  items[0].fire("click");
  await Promise.resolve();
  expect(w.calls).toEqual([{ kind: "look.delete", chat: cid("done") }]);
  expect(byClass(root, "rowmenu").length).toBe(0);
  expect(dots.getAttribute("aria-expanded")).toBe("false");
  // Escape shuts it and asks nothing; so do the dots pressed again.
  dots.fire("click");
  one(root, "rowmenu").fire("keydown", { key: "Escape" });
  expect(byClass(root, "rowmenu").length).toBe(0);
  dots.fire("click");
  dots.fire("click");
  expect(byClass(root, "rowmenu").length).toBe(0);
  expect(w.calls.length).toBe(1);
  // In the panel, the list is a dropdown, and each of its chats has its own.
  w.hear({ kind: "look.state", state: chatState("done", { mode: "panel", list: true }) });
  const pairs = byClass(w.root(), "mirow");
  expect(pairs.length).toBe(5);
  const [item, more] = pairs[0].childNodes;
  expect(item.classList.contains("mi")).toBe(true);
  expect(more.classList.contains("tmore")).toBe(true);
  more.fire("click");
  one(one(w.root(), "rowmenu"), "del").fire("click");
  await Promise.resolve();
  expect(w.calls.at(-1)).toEqual({ kind: "look.delete", chat: cid("live") });
  w.teardown();
});

test("THE CHAT'S ⋯ is drawn only in a chat, at its top right: in the full screen's bar before Minimize, in the panel's head before its own controls", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: lookState({}) });
  const more = one(w.root(), "chatmore");
  expect(more.localName).toBe("button");
  expect(more.getAttribute("aria-label")).toBe("Chat options");
  expect(more.getAttribute("aria-haspopup")).toBe("menu");
  expect(more.getAttribute("aria-expanded")).toBe("false");
  // The start screen has no chat to show one way or another.
  expect(more.hidden).toBe(true);
  w.hear({ kind: "look.state", state: chatState("live") });
  expect(more.hidden).toBe(false);
  const bar = one(w.root(), "chatbar");
  expect(more.parentNode).toBe(bar);
  expect(bar.childNodes.map((/** @type {any} */ n) => n.getAttribute("class"))).toEqual(["iconbtn chatmore", "iconbtn minbtn"]);
  w.hear({ kind: "look.state", state: chatState("done", { mode: "panel" }) });
  expect(more.hidden).toBe(false);
  const head = one(w.root(), "panelhead");
  expect(more.parentNode).toBe(head);
  expect(head.childNodes.map((/** @type {any} */ n) => n.getAttribute("aria-label") || n.getAttribute("class"))).toEqual(["tswitch", "New thread", "Chat options", "Open full size", "Close the chat"]);
  w.hear({ kind: "look.state", state: lookState({ mode: "panel" }) });
  expect(more.hidden).toBe(true);
  w.teardown();
});

test("THE ⋯ OPENS A MENU HEADED VIEW: the three views in the ladder's order, each its name and the line saying what it adds, the one shown checked", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live", { view: "thinking" }) });
  const more = one(w.root(), "chatmore");
  more.fire("click");
  expect(more.getAttribute("aria-expanded")).toBe("true");
  const menuEl = one(w.root(), "viewmenu");
  expect(menuEl.classList.contains("popmenu")).toBe(true);
  expect(menuEl.getAttribute("role")).toBe("menu");
  expect(menuEl.getAttribute("aria-label")).toBe("View");
  expect(one(menuEl, "mlabel").textContent).toBe("View");
  const items = byClass(menuEl, "mi");
  expect(items.map((i) => [i.localName, i.getAttribute("role"), i.getAttribute("data-view")])).toEqual(CHAT_VIEWS.map((v) => ["button", "menuitemradio", v]));
  expect(items.map((i) => [one(i, "nm").textContent, one(i, "sub").textContent])).toEqual([
    ["Plain", "Just the words"],
    ["Thinking", "Adds the agent's thinking"],
    ["Tool calls", "Adds the tools it used"],
  ]);
  expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  expect(items.map((i) => byClass(i, "check").length)).toEqual([0, 1, 0]);
  // Opening it picked nothing and asked for nothing.
  expect(w.calls).toEqual([]);
  // The ⋯ pressed again shuts it.
  more.fire("click");
  expect(byClass(w.root(), "viewmenu").length).toBe(0);
  expect(more.getAttribute("aria-expanded")).toBe("false");
  w.teardown();
});

test("THE VIEW MENU IS WORKED FROM THE KEYBOARD as a row's three dots are: the caret on its first view, the arrows round the three, Escape back to the ⋯", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live", { view: "plain" }) });
  const more = one(w.root(), "chatmore");
  more.fire("click");
  const menuEl = one(w.root(), "viewmenu");
  const items = byClass(menuEl, "mi");
  expect(w.focus.el).toBe(items[0]);
  const key = (/** @type {string} */ k) => menuEl.fire("keydown", { key: k, target: w.focus.el });
  key("ArrowDown");
  expect(w.focus.el).toBe(items[1]);
  key("ArrowDown");
  key("ArrowDown");
  expect(w.focus.el).toBe(items[0]);
  key("ArrowUp");
  expect(w.focus.el).toBe(items[2]);
  key("Escape");
  expect(byClass(w.root(), "viewmenu").length).toBe(0);
  expect(w.focus.el).toBe(more);
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(w.calls).toEqual([]);
  // A row's menu is the same menu: it takes the caret, and Escape gives it
  // back to its dots.
  const dots = byClass(w.root(), "tmore")[1];
  dots.fire("click");
  const rowMenu = one(w.root(), "rowmenu");
  expect(rowMenu.classList.contains("popmenu")).toBe(true);
  expect(w.focus.el).toBe(one(rowMenu, "del"));
  rowMenu.fire("keydown", { key: "Escape", target: w.focus.el });
  expect(w.focus.el).toBe(dots);
  // One menu at a time: the ⋯ opened over a row's menu shuts it.
  dots.fire("click");
  more.fire("click");
  expect(byClass(w.root(), "rowmenu").length).toBe(0);
  expect(byClass(w.root(), "viewmenu").length).toBe(1);
  w.teardown();
});

test("A VIEW PICKED ASKS THE HOST AND DRAWS NOTHING AHEAD OF IT: the look shows the view the host posts back, and the view already shown asks for nothing", async () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live", { view: "plain" }) });
  const look = one(w.root(), "g-look");
  const more = one(w.root(), "chatmore");
  more.fire("click");
  const pickView = (/** @type {string} */ v) => /** @type {any} */ (byClass(one(w.root(), "viewmenu"), "mi").find((i) => i.getAttribute("data-view") === v)).fire("click");
  pickView("tools");
  await Promise.resolve();
  expect(w.calls).toEqual([{ kind: "look.view", view: "tools" }]);
  expect(byClass(w.root(), "viewmenu").length).toBe(0);
  expect(w.focus.el).toBe(more);
  // Not drawn until the host says so.
  expect(look.getAttribute("data-view")).toBe("plain");
  w.hear({ kind: "look.patch", chat: cid("live"), view: "tools" });
  expect(look.getAttribute("data-view")).toBe("tools");
  // The view shown, picked again, asks nothing.
  more.fire("click");
  pickView("tools");
  await Promise.resolve();
  expect(w.calls.length).toBe(1);
  // A view that moves while the menu is open — another window's pick — moves
  // its check with it.
  more.fire("click");
  w.hear({ kind: "look.patch", chat: cid("live"), view: "thinking" });
  const items = byClass(one(w.root(), "viewmenu"), "mi");
  expect(items.map((i) => i.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
  expect(items.map((i) => byClass(i, "check").length)).toEqual([0, 1, 0]);
  // Back on the start screen the ⋯ goes, and its menu with it.
  w.hear({ kind: "look.state", state: lookState({}) });
  expect(byClass(w.root(), "viewmenu").length).toBe(0);
  expect(more.hidden).toBe(true);
  w.teardown();
});

test("the look asks to delete a chat only by an id of the grammar, and never with anything riding along", () => {
  expect(M.request("look.delete", { chat: cid("done") })).toEqual({ kind: "look.delete", params: { chat: cid("done") } });
  expect(M.request("look.delete", { chat: cid("done"), confirmed: true })).toEqual({ kind: "look.delete", params: { chat: cid("done") } });
  expect(M.request("look.delete", { chat: "short" })).toBe(null);
  expect(M.request("look.delete", {})).toBe(null);
  expect(M.request("chat.delete", { chat: cid("done") })).toBe(null);
});

test("WHAT WAITS IN THE QUEUE is drawn under the running turn, one muted bubble a message saying Queued, each with a × that asks by ids alone; held, it says so", async () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const root = w.root();
  const col = one(root, "col");
  expect(one(root, "queue").hidden).toBe(true);
  const now = Date.now();
  const queued = (/** @type {number} */ seq, /** @type {string} */ id, /** @type {string} */ text) => ({ seq, at: now, turn: 2, kind: "queued", id, text });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [queued(30, "q1nvented-queued-01", "Then draw it again, smaller."), queued(31, "q1nvented-queued-02", "And <b>not</b> in red.")] });
  const box = one(root, "queue");
  expect(box.hidden).toBe(false);
  // Under the running turn: the column's last child.
  expect(col.lastChild).toBe(box);
  const items = () => byClass(root, "qitem").map((q) => [one(q, "qlabel").textContent, one(q, "qtext").textContent]);
  expect(items()).toEqual([["Queued", "Then draw it again, smaller."], ["Queued", "And <b>not</b> in red."]]);
  // The person's words are words: no element came of them.
  expect(everything(one(byClass(root, "qitem")[1], "qtext")).length).toBe(0);
  // The × asks the host to take one out, by the chat and its id, and sends no words.
  const x = one(byClass(root, "qitem")[1], "qx");
  expect(x.localName).toBe("button");
  expect(x.getAttribute("aria-label")).toBe("Remove from the queue");
  x.fire("click");
  await Promise.resolve();
  expect(w.calls).toEqual([{ kind: "look.unqueue", chat: cid("live"), queued: "q1nvented-queued-02" }]);
  // Taken out by the server, it is gone; one sent goes as its turn begins,
  // and that turn is drawn above what still waits.
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 32, at: now, turn: 2, kind: "unqueued", id: "q1nvented-queued-02", sent: false }] });
  expect(items()).toEqual([["Queued", "Then draw it again, smaller."]]);
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [queued(33, "q1nvented-queued-03", "One more.")] });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [
    { seq: 34, at: now, turn: 2, kind: "turn", phase: "idle", stop: "end_turn", reason: null },
    { seq: 35, at: now, turn: 2, kind: "unqueued", id: "q1nvented-queued-01", sent: true },
    { seq: 36, at: now, turn: 3, kind: "prompt", text: "Then draw it again, smaller." },
  ] });
  expect(items()).toEqual([["Queued", "One more."]]);
  const turns = byClass(root, "turnw");
  expect(turns.length).toBe(3);
  expect(col.lastChild).toBe(box);
  expect(col.childNodes.indexOf(turns[2])).toBe(col.childNodes.indexOf(box) - 1);
  // Held: the summary says the queue waits for the person, and the bubble says so.
  const chats = chatState("live").chats.map((/** @type {any} */ c) => (c.id === cid("live") ? { ...c, phase: "idle", light: "none", stop: "cancelled", queued: 1, queueHeld: true } : c));
  w.hear({ kind: "look.patch", chat: cid("live"), chats });
  expect(items()).toEqual([["Queued · held", "One more."]]);
  // Another chat opened has its own queue, and this one's is not drawn.
  w.hear({ kind: "look.state", state: chatState("done") });
  expect(one(w.root(), "queue").hidden).toBe(true);
  expect(byClass(w.root(), "qitem").length).toBe(0);
  w.teardown();
});

test("the look asks to take a queued message out only by the chat's id and the message's", () => {
  expect(M.request("look.unqueue", { chat: cid("live"), queued: "q1nvented-queued-01", text: "x" })).toEqual({ kind: "look.unqueue", params: { chat: cid("live"), queued: "q1nvented-queued-01" } });
  expect(M.request("look.unqueue", { chat: cid("live") })).toBe(null);
  expect(M.request("look.unqueue", { chat: cid("live"), id: "q1nvented-queued-01" })).toBe(null);
  expect(M.request("look.unqueue", { chat: cid("live"), queued: "has spaces in it" })).toBe(null);
});

test("THE LOOK NEVER SENDS TEXT: every control pressed, every request is one of its kinds with ids and closed words only", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: chatState("live") });
  const press = () => {
    for (const e of everything(w.root())) {
      if (e.on.click) e.fire("click");
      if (e.on.keydown) e.fire("keydown", { key: "Enter" });
    }
  };
  press();
  w.hear({ kind: "look.state", state: chatState("done", { mode: "panel", list: true }) });
  press();
  w.hear({ kind: "look.state", state: chatState("evil") });
  press();
  w.hear({ kind: "look.state", state: chatState("live") });
  w.hear({ kind: "look.patch", chat: cid("live"), updates: [{ seq: 40, at: Date.now(), turn: 2, kind: "queued", id: "q1nvented-queued-01", text: "Invented words the person queued" }] });
  press();
  // Every view in the ⋯'s menu, as the controls it opens.
  for (const v of CHAT_VIEWS) {
    if (!byClass(w.root(), "viewmenu").length) one(w.root(), "chatmore").fire("click");
    for (const e of byClass(one(w.root(), "viewmenu"), "mi")) if (e.getAttribute("data-view") === v) e.fire("click");
  }
  expect(w.calls.length).toBeGreaterThan(8);
  const allowed = { "look.open": ["chat"], "look.new": [], "look.list": ["open"], "look.panel": ["to"], "look.delete": ["chat"], "look.unqueue": ["chat", "queued"], "look.view": ["view"], open: ["target"] };
  for (const c of w.calls) {
    const { kind, ...rest } = c;
    expect(Object.keys(allowed)).toContain(kind);
    expect(Object.keys(rest).every((k) => /** @type {any} */ (allowed)[kind].includes(k))).toBe(true);
    if (kind === "look.open" || kind === "look.delete" || kind === "look.unqueue") expect(rest.chat).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    if (kind === "look.unqueue") expect(rest.queued).toBe("q1nvented-queued-01");
    if (kind === "look.panel") expect(["screen", "beside", "closed"]).toContain(rest.to);
    if (kind === "look.list") expect(typeof rest.open).toBe("boolean");
    if (kind === "look.view") expect(CHAT_VIEWS).toContain(rest.view);
    if (kind === "open") expect(Object.keys(rest.target).sort()).toEqual(["id", "kind"]);
  }
  const kinds = new Set(w.calls.map((c) => c.kind));
  for (const k of Object.keys(allowed)) expect(kinds.has(k)).toBe(true);
  w.teardown();
});

test("under reduced motion the look rests: marked still, no word turning, no frame asked for, and a face drawn as its emoji", () => {
  const w = mounted({ reduced: true });
  w.hear({ kind: "look.state", state: lookState({}) });
  expect(one(w.root(), "g-look").hasAttribute("data-still")).toBe(true);
  expect(w.live.timers.size).toBe(0);
  expect(w.live.frames.size).toBe(0);
  w.hear({ kind: "look.state", state: chatState("live") });
  const moods = byClass(w.root(), "mood");
  expect(everything(moods[0]).some((e) => e.localName === "img")).toBe(false);
  expect(moods[0].textContent).toBe("😌");
  w.teardown();
});

test("teardown leaves nothing running: every timer, frame, observer and listener gone, the node empty, and a later state heard by nobody", () => {
  const w = mounted();
  w.hear({ kind: "look.state", state: lookState({}) });
  w.hear({ kind: "look.state", state: chatState("live") });
  w.hear({ kind: "look.state", state: lookState({}) });
  expect(w.live.timers.size + w.live.frames.size).toBeGreaterThan(0);
  expect(w.live.observers.size).toBeGreaterThan(0);
  expect(w.live.docListeners).toBe(2);
  expect(w.live.winListeners).toBe(2);
  w.teardown();
  expect(w.live.timers.size).toBe(0);
  expect(w.live.frames.size).toBe(0);
  expect(w.live.observers.size).toBe(0);
  expect(w.live.docListeners).toBe(0);
  expect(w.live.mediaListeners).toBe(0);
  expect(w.live.winListeners).toBe(0);
  expect(w.node.childNodes.length).toBe(0);
  w.hear({ kind: "look.state", state: chatState("done") });
  expect(w.node.childNodes.length).toBe(0);
});
