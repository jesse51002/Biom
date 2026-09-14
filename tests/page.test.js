// SPDX-License-Identifier: AGPL-3.0-only
// The page view and Config.
//
// THIS FILE USED TO BE ABOUT DRAWING A PAGE, AND IT IS NOT ANY MORE. `page.js`
// walked `Page.blocks`, asked a `Registry` for a `BlockDraw` per `BlockKind`,
// wrapped the result in the chosen `Render`'s frame and ran an in-place prose
// editor over the top — 1477 lines of it, and about 1400 lines of tests. All
// four of those nouns are gone. A page is a stack of SECTIONS and the thing that
// stacks them is `guest/runtime/`, which lives INSIDE the box, on the far side
// of an opaque origin where nothing in this process can reach it.
//
// So what is left of `client/views/page.js` is a MOUNT POINT with three exports,
// and this file tests exactly those two and nothing it wishes were still true:
//
//   `makePageView`  builds one document and hands it to the frame host
//   `makeDesignView` draws the design doc in a box, like every other page
//
// Config keeps its half of the file: `client/views/config.js` is the other
// screen a page has, it is live code, and the raw-YAML fallback in it is the way
// back into a page whose one bad character took its words with it.
//
// There is no DOM here and deliberately no DOM library: the views take `h` as a
// dependency, so a recording `h` that builds plain objects exercises the real
// code paths with nothing faked but the element factory itself.

import { test, expect, beforeEach } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { makePageView, makeDesignView } from "../client/views/page.js";
import { vaultBase } from "../contracts/wire.js";
import { makeConfigView, fileList } from "../client/views/config.js";

const ROOT = join(import.meta.dir, "..");
/** WHICH FOLDER THIS TAB IS. Every view that builds a document needs one now:
 *  the plugins are files in the vault, so the tags naming them are per-vault. */
const VAULT = "/tmp/a vault";
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/* ── a recording element factory, shaped like client/platform/dom.js ──── */

// A class, not an object literal: `h()` decides whether its second argument is
// props or a child by testing `constructor === Object`, so a fake element made
// from a literal would be read as a bag of properties.
class El {}

function element(tag) {
  const classes = new Set();
  const el = Object.assign(new El(), {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    attrs: {},
    style: {},
    dataset: {},
    children: [],
    childNodes: [],
    parentElement: null,
    listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    replaceChildren: (...nodes) => {
      for (const c of el.children) c.parentElement = null;
      el.children.length = 0;
      el.childNodes.length = 0;
      append(el, nodes);
    },
    setAttribute: (k, v) => { el.attrs[k] = v; },
    getAttribute: (k) => (Object.hasOwn(el.attrs, k) ? String(el.attrs[k]) : null),
    addEventListener: (name, fn) => { (el.listeners[name] ||= []).push(fn); },
    append: (...nodes) => append(el, nodes),
    fire: (name, ev) => { for (const fn of el.listeners[name] || []) fn(ev); },
  });
  Object.defineProperty(el, "childElementCount", { get: () => el.children.length });
  Object.defineProperty(el, "className", {
    get: () => [...classes].join(" "),
    set: (v) => { classes.clear(); for (const c of String(v).split(" ")) if (c) classes.add(c); },
  });
  return el;
}

function h(spec, props, ...children) {
  const [head, ...classes] = String(spec).split(".");
  const el = element(head.split("#")[0] || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style") Object.assign(el.style, v);
      // `html` is innerHTML in the real helper — markdown.js returns strings and
      // this is how a view spends one. Kept as a field so a test can read it.
      else el.attrs[k] = v === true ? "" : v;
    }
  } else if (props !== undefined && props !== null) {
    children.unshift(props);
  }
  append(el, children);
  return el;
}

function append(el, list) {
  for (const c of list) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    if (typeof c === "object" && c.nodeType === 3) { el.childNodes.push(c); continue; }
    if (typeof c === "object") { c.parentElement = el; el.children.push(c); el.childNodes.push(c); }
    else el.childNodes.push({ nodeType: 3, nodeValue: String(c) });
  }
}

// Another file in this process tears the globals down when it is finished with
// them, so they are put back before every test rather than once.
beforeEach(() => {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    createElement: (tag) => element(tag),
    createTextNode: (s) => ({ nodeType: 3, nodeValue: String(s) }),
    addEventListener() {},
    removeEventListener() {},
  };
});

/** every element in the tree, depth first */
function all(el, out = []) {
  out.push(el);
  for (const c of el.children) all(c, out);
  return out;
}
const find = (el, cls) => all(el).find((n) => n.classList.contains(cls));
const findAll = (el, cls) => all(el).filter((n) => n.classList.contains(cls));

/** The text a subtree shows, in order. */
const flatten = (el) =>
  (el.childNodes || []).map((n) => (n.nodeType === 3 ? n.nodeValue : flatten(n))).join("");

const flush = () => new Promise((done) => setTimeout(done, 0));

/* ── the world ────────────────────────────────────────────────────────── */

/** A section as the server resolves it. `fallback` says it named no file of its
 *  own and took the shipped default SECTION — a file, not a branch.
 *  @param {string} name @param {Record<string, any>} parts @param {object} [rest] */
const sect = (name, parts, rest = {}) =>
  ({ name, html: '<div data-g-part="body"></div>', fallback: true, parts, vars: {}, ...rest });

const prose = (md, vars = {}) => ({ kind: "markdown", md, vars });

/** A page: an id, a name, its own variables and a stack of sections. There is no
 *  `kind`, no `render` and no `artifact` — a page whose whole reason to exist is
 *  the surface it draws is one section whose `data` names the file that draws it.
 *  @param {string} id @param {any[]} sections @param {object} [extra] */
const page = (id, sections, extra = {}) =>
  ({ id, name: id, variables: {}, sections, page: [], ports: null, ...extra });

/** A frame host, keyed and reused exactly like `client/frame/frame.js`: the same
 *  key hands back the same element whether or not the html changed. */
function fakeFrameHost(report = null) {
  const frames = new Map();
  return {
    /** every `for(key, html, ctx)` this host was asked for, in order */
    mounts: [],
    /** every key `compliance` was asked about */
    asked: [],
    setShim() {}, broadcast() {}, refresh() {},
    drop(key) { frames.delete(key); },
    for(key, html, ctx) {
      this.mounts.push({ key, html, ctx });
      let frame = frames.get(key);
      if (!frame) { frame = { el: element("iframe"), post() {}, drop() {} }; frames.set(key, frame); }
      return frame;
    },
    compliance(key) { this.asked.push(key); return report; },
  };
}

/* ══ makePageView: one box, one document, one key ══════════════════════ */

test("a page is ONE box, keyed by the page's own id", () => {
  const frameHost = fakeFrameHost();
  const draw = makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT });

  const el = draw(page("quote", [sect("intro", { body: prose("# Quote") }), sect("grid", {})]));

  // ONE mount for a two-section page. There is no box per block: the box IS the
  // page, and the sections are stacked by a runtime inside it.
  expect(frameHost.mounts).toHaveLength(1);
  expect(frameHost.mounts[0].key).toBe("quote");
  // ONE BOX IS ONE PAGE, so the context is one field. There is no block to name.
  expect(frameHost.mounts[0].ctx).toEqual({ page: "quote" });
  expect(el.tagName).toBe("IFRAME");
});

test("THE IFRAME ITSELF, WITH NO WRAPPER, and that is not tidiness", () => {
  // Moving an iframe to a new parent RELOADS IT — the browser tears the document
  // down and starts again. So wrapping the reused element in a fresh div on every
  // repaint hands the shell a node it has never seen, the shell inserts it, and
  // the box is rebuilt from nothing. Returning the element the frame host already
  // keyed is what makes the shell's `plate.firstChild !== node` guard able to
  // fire at all.
  const frameHost = fakeFrameHost();
  const draw = makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT });
  const quote = page("quote", [sect("intro", { body: prose("#") })]);

  const first = draw(quote);
  const again = draw({ ...quote, variables: { rate: 62 } });   // a store write: a new object

  expect(again).toBe(first);
  expect(first.parentElement).toBe(null);   // nothing was wrapped around it
});

test("the document is the PAGE'S, and it carries none of the page's words", () => {
  const frameHost = fakeFrameHost();
  const draw = makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT });

  draw(page("quote", [sect("a", { body: prose("# Quote") })]));
  draw(page("board", []));
  draw(page("quote", [sect("a", { body: prose("# Quote, rewritten") })]));

  const [one, two, three] = frameHost.mounts;
  // A page names the plugin that draws it, so the document is no longer one
  // constant — it is that plugin's file, or the page's own `index.html`, with
  // the runtime spliced into its head.
  //
  // WHAT IT STILL CARRIES NONE OF IS THE PAGE'S WORDS. The runtime asks for
  // those over its port once it has one, so rewriting a paragraph leaves the
  // document byte-identical and the box the user is typing in survives. A
  // document built from the page's prose would rebuild it on every keystroke.
  expect(three.html).toBe(one.html);
  expect(one.html).not.toContain("Quote");
  // The page's own identity and its plugin's input DO travel with it, because a
  // page that draws itself needs them synchronously — and they change only when
  // the page's shape does.
  expect(one.html).toContain('window.__gInput=');
  expect(one.html).toContain('"id":"quote"');
  expect(two.html).toContain('"id":"board"');
  // Two pages are two keys, so the second is a second box rather than the first
  // one navigated.
  expect(frameHost.mounts.map((m) => m.key)).toEqual(["quote", "board", "quote"]);
});

test("the document loads the runtime IN THE ORDER boot.js says it must", () => {
  // These are CLASSIC scripts sharing globals — a module script does not load at
  // an opaque origin — so the order of the tags is the only sequencing there is.
  // `guest/runtime/boot.js` states the required order in its own header, and
  // this reads that statement rather than restating it: a reordering there and
  // not here is exactly the drift a hand-copied list cannot catch.
  const frameHost = fakeFrameHost();
  makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT })(page("quote", []));
  const doc = frameHost.mounts[0].html;

  const declared = [...read("guest/runtime/boot.js")
    .matchAll(/<script src="(\/guest\/runtime\/[a-z]+\.js)">/g)].map((m) => m[1]);
  expect(declared,
    "guest/runtime/boot.js no longer states the load order in its header. It is the only statement of it; keep it and keep this in step.")
    .toHaveLength(7);

  const loaded = [...doc.matchAll(/<script src="(\/guest\/runtime\/[^"]+)"><\/script>/g)].map((m) => m[1]);
  expect(loaded).toEqual(declared);
});

test("every slot plugin is in the document, out of the VAULT, and the vendored build is the classic one", () => {
  const frameHost = fakeFrameHost();
  makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT })(page("quote", []));
  const doc = frameHost.mounts[0].html;

  // ONE TAG, AND IT NAMES THE FOLDER. There is no list of plugin ids in the
  // document any more and there must never be one again: the list was what made
  // a vault's own slot plugin unreachable. The server reads `plugins/` and
  // answers with every `.js` in it, so a plugin somebody wrote loads by being on
  // disk. Nothing is shipped, and no tag may name `/guest/plugins/`.
  const base = vaultBase(VAULT) + "/plugin/";
  const loaded = [...doc.matchAll(new RegExp(`<script src="${base}([^"]*)"><\\/script>`, "g"))]
    .map((m) => m[1]);
  expect(loaded).toEqual([""]);
  expect(doc).not.toContain("/guest/plugins/");

  // The UMD build and never the `.mjs`. Measured, and re-measured when this was
  // vendored: a module script fetched from this same `/vendor/` is refused by
  // CORS from `origin: null`.
  expect(doc).toContain('<script src="/vendor/markdown-it.min.js"></script>');
  expect(doc).not.toContain("markdown-it.mjs");
  expect(doc).not.toContain('type="module"');
});

/* ══ makeDesignView: the design doc is a page, drawn like one ═════════ */

// It used to render host-side and read-only, and this block used to say so and
// call it a hole. The hole is closed: `design/` is a page-shaped root beside
// `pages/`, the design doc answers to the reserved id `@design`, and `pageDir`
// sends that id to `design/`. So the same reader reads it, the same runtime
// draws it, and the same wave edits it — there is nothing left here but a mount.
//
// `@design` cannot collide with a page somebody makes: a page segment is
// `^[a-z0-9][a-z0-9-]*$`, so the `@` is the whole mechanism. It also closed a
// real hole, because the doc used to answer to the id `design`, which IS a legal
// page id.

test("the design doc mounts the same box as a page, keyed by its reserved id", () => {
  const frameHost = fakeFrameHost();
  const el = makeDesignView({ h, frameHost, ws: {}, ui: {}, vault: VAULT })();

  expect(frameHost.mounts).toHaveLength(1);
  const mount = frameHost.mounts[0];
  expect(mount.key).toBe("@design");
  expect(mount.ctx).toEqual({ page: "@design" });
  // The same document as every page: it carries no page content at all, which is
  // what lets one box be reused across a redraw.
  expect(mount.html).toContain("/guest/runtime/boot.js");
  expect(mount.html).toContain(`<script src="${vaultBase(VAULT)}/plugin/"></script>`);
  // The keyed element itself, with no wrapper: moving an iframe RELOADS it, so a
  // fresh wrapper each repaint would rebuild the box and throw away the caret.
  expect(el.tagName).toBe("IFRAME");
});

test("it asks the store for nothing, because the box reads the page itself", () => {
  // The old view fetched `design.read` and turned the answer into host markup.
  // Nothing here reads the document: the runtime inside the box asks for it over
  // its own port, exactly as it does for any page.
  const asked = [];
  const ws = new Proxy({}, { get: (_, name) => { asked.push(String(name)); return () => {}; } });
  makeDesignView({ h, frameHost: fakeFrameHost(), ws, ui: {}, vault: VAULT })();
  expect(asked).toEqual([]);
});

test("the design box is keyed apart from every page box", () => {
  // Two boxes, two keys, no chance of one being reused as the other — the key is
  // what `frameHost` reuses a frame by, and a page called `design` is a page
  // somebody may legitimately have.
  const frameHost = fakeFrameHost();
  makePageView({ h, frameHost, ws: {}, ui: {}, vault: VAULT })(page("design", []));
  makeDesignView({ h, frameHost, ws: {}, ui: {}, vault: VAULT })();
  expect(frameHost.mounts.map((m) => m.key)).toEqual(["design", "@design"]);
});

/* ══ Config: what this page actually is ════════════════════════════════ */

function configWorld(p, frameHost = fakeFrameHost()) {
  const raws = [];
  const written = [];
  const ws = {
    readDocRaw: async (id) => { raws.push(id); return "name: Quote\n"; },
    writeDocRaw: async (id, text) => { written.push({ id, text }); return { name: "Quote", variables: {}, contents: [] }; },
  };
  return { ws, raws, written, frameHost, draw: makeConfigView({ h, ws, ui: {}, frameHost }) };
}

/** The same screen, built as the application a stranger downloaded. */
function productionConfig(p, frameHost = fakeFrameHost()) {
  const w = configWorld(p, frameHost);
  return { ...w, draw: makeConfigView({ h, ws: w.ws, ui: {}, frameHost, production: true }) };
}

test("the files list is the page as it sits on disk, and invents nothing", () => {
  // ONLY REAL FILENAMES. A markdown slot is not a file — its words sit in
  // `content.yaml` beside its name — and a `DrawnSection` deliberately does not
  // carry the name of the HTML it was drawn from, because the runtime that draws
  // it has the markup and never needs the path.
  const p = page("quote", [
    sect("intro", { body: prose("# Quote") }),
    sect("calc", { body: { kind: "html", file: "calc.html", html: "", vars: {} } }, { fallback: false }),
    sect("@page-Notes", {
      body: {
        kind: "child",
        child: { kind: "page", id: "quote/notes", name: "Notes" },
        // THE CHILD'S OWN FILE, in the child's directory: a page knows how it
        // wants to be summarised better than every page that might hold it.
        draw: { file: "child.html", html: "<a>" },
      },
    }),
    sect("kids", { body: { kind: "child", child: { kind: "table", id: "jobs", name: "jobs" } } }),
  ]);

  expect(fileList(p).map((f) => f.name)).toEqual([
    "content.yaml", "calc.html", "pages/quote/notes/child.html",
  ]);
  // A child with no `child.html` of its own is not a file: deleting that file is
  // a supported act, and the child plugin draws its built-in row instead.
  expect(fileList(page("bare", [sect("a", { body: prose("x") })])).map((f) => f.name))
    .toEqual(["content.yaml"]);
});

test("Config names each section, whether it drew with its own HTML, and its slots", () => {
  const p = page("quote", [
    sect("intro", { body: prose("# Quote") }),
    sect("calc", {
      left: { kind: "html", file: "calc.html", html: "", vars: {} },
      right: prose("Notes."),
    }, { fallback: false }),
  ]);
  const w = configWorld(p);
  const root = w.draw(p);

  const words = flatten(root);
  // THE SHIPPED DEFAULT IS A FILE AND NOT A BRANCH, and `fallback` is how the
  // page says it took it. A page that is nothing but defaults is a generation
  // that did not use the freedom it had, which is a thing worth being able to see.
  expect(words).toContain("the shipped section");
  expect(words).toContain("its own HTML");
  expect(words).toContain("1 slot");
  expect(words).toContain("2 slots");
  expect(words).toContain("2 sections");
});

test("a page that declares no sections is told it draws nothing", () => {
  const p = page("blank", []);
  const w = configWorld(p);
  expect(flatten(w.draw(p))).toContain("draws nothing");
});

test("Config states the truth: unrestricted, and the count is SELF-REPORTED", () => {
  const p = page("quote", [sect("intro", { body: prose("#") })]);
  const reported = configWorld(p, fakeFrameHost({ sections: 3 }));
  const words = flatten(reported.draw(p));

  // The framework applies no restrictions, and a screen showing approved
  // destinations or "anywhere else → blocked" would make a claim this build
  // cannot back if anyone in the room asks.
  expect(words).toContain("unrestricted");
  expect(words).not.toContain("blocked");
  expect(words).not.toContain("approved");

  // The host CANNOT CHECK this: a sandboxed frame has an opaque origin and there
  // is nothing to scrape, so the number is what the page says about itself.
  expect(words).toContain("3 section");
  expect(words).toContain("cannot read inside a null-origin frame");
  // It asks the host about this page and nothing else, UNDER THE KEY THE BOX IS
  // ACTUALLY MOUNTED WITH. This assertion used to spell `quote#` and pass, which
  // is the whole reason it is worth having: the trailing `#` is the old
  // one-box-per-BLOCK key, it named a mount that has never existed, and the
  // report therefore said "not reported" on every page in the product without
  // anything erroring. Compare `frameHost.mounts[0].key` in the first test in
  // this file — the two must agree, and this is what makes them.
  expect(reported.frameHost.asked).toEqual(["quote"]);
});

test("a page nothing has reported on says so rather than claiming zero", () => {
  // Zero is a real answer from a runtime and means an empty page. Silence is a
  // different answer — never finished loading, or failed while drawing — and
  // printing it as 0 would make the two indistinguishable.
  const p = page("quote", [sect("intro", { body: prose("#") })]);
  const w = configWorld(p, fakeFrameHost(null));
  const words = flatten(w.draw(p));
  expect(words).toContain("it reported nothing back");
  expect(words).not.toContain("reported 0");
  // A page reporting nothing either never finished loading or failed while
  // drawing; either way the raw YAML below still edits its text, so the fallback
  // is never behind the thing that went wrong.
  expect(words).toContain("either way the raw YAML below still edits its text");
  expect(find(w.draw(p), "rawyaml")).toBeTruthy();
});

/* ── the raw-YAML fallback ────────────────────────────────────────────────
   ONE FILE HOLDS EVERYTHING A PAGE SAYS now, so this box matters MORE than it
   did: the prose used to live in `.md` files that survived a broken
   `content.yaml` untouched, and this is the only way back to a page whose one
   bad character took its sentences with it.

   It has to be right about what is on disk NOW. The store hands out a new Page
   object every time it re-reads, which is what Reload does, and that object
   identity is the signal this reads. */

test("the raw YAML is re-read on open and on reload, never served from a cache", async () => {
  const p = page("quote", []);
  const w = configWorld(p);
  let disk = "name: Quote\n";
  w.ws.readDocRaw = async (id) => { w.raws.push(id); return disk; };

  w.draw(p);
  await flush();
  expect(w.raws).toEqual(["quote"]);

  // Claude Code rewrites content.yaml; Reload re-reads the page, so the view is
  // handed a new Page object for the same id.
  disk = "name: Quote\nvariables:\n  heading: Rewritten\n";
  const root = w.draw({ ...p });
  await flush();

  expect(w.raws).toEqual(["quote", "quote"]);
  expect(find(root, "rawyaml").value).toBe(disk);
});

test("a file that moved under an unsaved edit is said out loud, not clobbered", async () => {
  const p = page("quote", []);
  const w = configWorld(p);
  let disk = "name: Quote\n";
  w.ws.readDocRaw = async () => disk;

  const first = w.draw(p);
  await flush();
  const area = find(first, "rawyaml");
  area.value = "name: Mine\n";
  area.fire("input", {});

  disk = "name: Theirs\n";
  const root = w.draw({ ...p });
  await flush();

  // Neither side is thrown away: the unsaved text stays in the box, and an agent
  // rewriting the file while somebody is typing into it is a collision the user
  // is told about and decides, not one this view resolves quietly.
  expect(find(root, "rawyaml").value).toBe("name: Mine\n");
  expect(String(find(root, "hint").textContent)).toContain("changed on disk");
});

test("saving writes what is in the box and says so", async () => {
  const p = page("quote", []);
  const w = configWorld(p);
  const root = w.draw(p);
  await flush();

  const area = find(root, "rawyaml");
  area.value = "name: Quote\nvariables:\n  rate: 62\n";
  area.fire("input", {});
  findAll(root, "btn").at(-1).fire("click", {});
  await flush();

  expect(w.written).toEqual([{ id: "quote", text: "name: Quote\nvariables:\n  rate: 62\n" }]);
  expect(String(find(root, "hint").textContent)).toBe("Saved.");
});

test("a refusal is shown rather than swallowed, because the message IS the point", async () => {
  // Flatness is the likely one, and naming the line that is not flat is the
  // whole reason this box shows what came back.
  const p = page("quote", []);
  const w = configWorld(p);
  w.ws.writeDocRaw = async () => { throw new Error("a variable is a scalar or a list of scalars"); };
  const root = w.draw(p);
  await flush();

  findAll(root, "btn").at(-1).fire("click", {});
  await flush();
  expect(String(find(root, "hint").textContent)).toContain("a variable is a scalar");
});


test("production drops Config's Sections group and keeps everything else", () => {
  // A TABLE OF EVERY SECTION, what drew it and how many slots it has, over a
  // sentence about what the frame reported. It is `content.yaml` restated for
  // somebody who is about to edit one, which is nobody in a built application.
  const p = page("quote", [
    sect("intro", { body: prose("# Quote") }),
    sect("calc", { left: { kind: "html", file: "calc.html", html: "", vars: {} } }, { fallback: false }),
  ]);
  const built = productionConfig(p);
  const words = flatten(built.draw(p));

  expect(words).not.toContain("its own HTML");
  expect(words).not.toContain("2 sections");
  expect(words).not.toContain("the shipped section");

  // Files, Data and Raw are each about the person's own page, and Raw is the way
  // back into a page whose one bad character took its sentences with it.
  expect(words).toContain("content.yaml");
  expect(words).toContain("unrestricted");
  expect(words).toContain("ONE FILE HOLDS EVERYTHING THIS PAGE SAYS");
});

test("Config's Data group says what THIS build allows, not what development does", () => {
  // The development server resolves `sql` and `fetch` for real; a production one
  // refuses both, and a page can say either without touching a control anybody
  // could hide. A screen whose job is to state plainly what a page can reach
  // must not be the one thing on it that is out of date.
  const p = page("quote", [sect("intro", { body: prose("# Quote") })]);

  const dev = flatten(configWorld(p).draw(p));
  expect(dev).toContain("can also run SQL and call out to the internet");
  expect(dev).not.toContain("This build refuses");

  const built = flatten(productionConfig(p).draw(p));
  expect(built).toContain("cannot run SQL and cannot call out to the internet");
  expect(built).not.toContain("can also run SQL");

  // Tables are unrestricted in EVERY build — `table.get` and `row.insert` are
  // not on the refusal list — so that half of the sentence, and the group's own
  // tag, are the same in both.
  for (const words of [dev, built]) {
    expect(words).toContain("read and write every table in the workspace");
    expect(words).toContain("unrestricted");
  }
});

test("the empty Sections group goes too, because it says the same thing to the same nobody", () => {
  // It reads "ask the agent pointed at this vault", which is the audience the
  // whole group was written for. Both of the group's returns are on the list.
  const p = page("blank", []);
  expect(flatten(productionConfig(p).draw(p))).not.toContain("draws nothing");
  expect(flatten(configWorld(p).draw(p))).toContain("draws nothing");
});
