// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-mindmap/mindmap.js — the workspace as a small sky. A classic
 * script; see registry.js for why there are no imports in here.
 *
 * A PLUGIN IS A PAGE THAT READS A DECLARED INPUT, and this is the third one. A
 * page says `plugin: mindmap` and the box is handed this document; the rail's
 * own Map row mounts the same document on `@map`. Either way this file asks the
 * host the same questions any page may ask — which pages exist, what each one's
 * prose says, what a page holds — and draws what it hears. It registers nothing:
 * a registered plugin fills a SLOT inside somebody else's page, and this IS the
 * page.
 *
 * WHAT IT DRAWS. Every page is a light. Its size is how many pages link to it,
 * relative to the most-linked page in the vault, so the pages the vault leans
 * on are suns and the rest are specks. The physics is orbital rather than a
 * settled spring graph: linked pages pull toward each other, too close pushes
 * away and around, a heavy page turns whatever is within its reach — harder the
 * closer — and nothing ever stops moving. The hand is a black hole: what is
 * near the pointer slows and gathers, and the light under it holds still so it
 * can be read and opened.
 *
 * THE CAMERA HOMES on the whole sky whenever the hand has been away for a
 * while; a page that says `follow: true` in its input keeps it homed always,
 * so the sky stays centred even while a light is held, and `zoom: 1.3` keeps
 * the camera that much closer than the fit. The landing page asks for both;
 * the workspace's own Map row asks for neither.
 *
 * THE HOST MAY SPOTLIGHT PAGES. A host that offers `biom.onSpotlight` is handed a
 * function; calling it with a list of page ids lights those pages cream, the
 * way the light under the hand goes, dims the rest, and holds until it is
 * called with none. It is how a
 * host shows which pages an agent is reading while it answers. The workspace's
 * own host does not offer it yet; the landing page's stand-in does.
 *
 * WHERE THE EDGES COME FROM. A prose link is a `[[wikilink]]` in a page's
 * markdown, read over `doc.get`; the tree is each page's place in the id path,
 * which is what `Child` says a parent is. Nothing here is a second store of
 * either: reload and it is read again.
 *
 * COLOURS ARE TOKENS. The shim re-declares the vault's palette on `:root`
 * inside this box, so they are read off the document at draw time — a canvas
 * cannot read a custom property, so the values are looked up once per frame
 * rather than written here. The light is the palette's `--led` where it has
 * one and `--cyan` otherwise, which on the shipped palette is the same amber.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  /* ── the part with no DOM in it ────────────────────────────────────────── */

  /** The parent of an id is everything before its last segment — derived,
   *  never stored, exactly as `Child` says. The root has none.
   *  @param {string} id @returns {string | null} */
  function parentOf(id) {
    const at = id.lastIndexOf("/");
    return at < 0 ? null : id.slice(0, at);
  }

  /** WHICH KIND OF PAGE: the top-level page it sits under, so a map can tell a
   *  pivot from a company without any page saying so.
   *  @param {string} id @returns {string} */
  function kindOf(id) {
    const parts = id.split("/");
    return parts.length < 2 ? "home" : String(parts[1]);
  }

  /** The `[[targets]]` in a run of markdown, aliases and anchors dropped, in
   *  order of appearance, once each. @param {string} md @returns {string[]} */
  function targetsOf(md) {
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (const m of String(md || "").matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const t = String(m[1]).trim();
      if (t !== "" && !seen.has(t)) { seen.add(t); out.push(t); }
    }
    return out;
  }

  /** WHAT A TARGET NAMES, or null. A full id first; then the one page whose id
   *  ends in the bare name a person wrote, folded for case the way the host's
   *  own `link.resolve` folds it. Two pages that both end in it is an ambiguity
   *  this map does not guess at.
   *  @param {string} target @param {Map<string, string>} byFold folded id → id
   *  @param {Map<string, string[]>} bySuffix folded last segment → ids */
  function resolve(target, byFold, bySuffix) {
    const fold = target.toLowerCase();
    const whole = byFold.get(fold);
    if (whole !== undefined) return whole;
    const tail = fold.slice(fold.lastIndexOf("/") + 1);
    const hits = (bySuffix.get(tail) || []).filter((id) => id.toLowerCase().endsWith("/" + fold) || id.toLowerCase() === fold);
    return hits.length === 1 ? String(hits[0]) : null;
  }

  /** THE GRAPH, from what the host answered: the page list, and each page's
   *  prose. Nodes carry what links in, what links out and what they hold; links
   *  are one per pair per direction; the tree is one edge per parent.
   *  @param {{id: string, name: string}[]} pages
   *  @param {Record<string, string>} prose id → markdown
   *  @returns {{nodes: any[], links: [any, any][], tree: [any, any][], byId: Record<string, any>}} */
  function graphOf(pages, prose) {
    /** @type {Record<string, any>} */
    const byId = {};
    const byFold = new Map();
    const bySuffix = new Map();
    const nodes = pages.map((p, i) => {
      const n = { id: p.id, name: p.name || p.id.slice(p.id.lastIndexOf("/") + 1), parent: parentOf(p.id), kind: kindOf(p.id), i, x: 0, y: 0, vx: 0, vy: 0, inn: 0, out: 0, kids: 0, hold: 0 };
      byId[n.id] = n;
      byFold.set(n.id.toLowerCase(), n.id);
      const tail = n.id.toLowerCase().slice(n.id.lastIndexOf("/") + 1);
      bySuffix.set(tail, [...(bySuffix.get(tail) || []), n.id]);
      return n;
    });
    /** @type {[any, any][]} */
    const tree = [];
    for (const n of nodes) {
      if (n.parent !== null && byId[n.parent]) { byId[n.parent].kids += 1; tree.push([byId[n.parent], n]); }
    }
    /** @type {[any, any][]} */
    const links = [];
    for (const n of nodes) {
      const seen = new Set();
      for (const t of targetsOf(prose[n.id] || "")) {
        const to = resolve(t, byFold, bySuffix);
        if (to === null || to === n.id || seen.has(to)) continue;
        seen.add(to);
        n.out += 1;
        byId[to].inn += 1;
        links.push([n, byId[to]]);
      }
    }
    return { nodes, links, tree, byId };
  }

  /** THE MAP AS MARKDOWN, which is this page's half of the archive. A sky is
   *  not a list, so the projection says what the sky says at a glance: the
   *  pages the vault leans on, in order, and how many pages nothing reaches.
   *  @param {any[]} nodes @returns {string} */
  function toMarkdown(nodes) {
    const suns = nodes.filter((n) => n.inn > 0).sort((a, b) => b.inn - a.inn).slice(0, 12);
    const alone = nodes.filter((n) => n.inn === 0 && n.out === 0 && n.kids === 0).length;
    const lines = ["## What the vault leans on", ""];
    if (suns.length === 0) lines.push("*(no page links to another yet)*");
    for (const n of suns) lines.push(`- **${n.name}** · linked from ${n.inn}`);
    lines.push("", "## Alone", "", `${alone} page${alone === 1 ? "" : "s"} that nothing links to and that link nowhere.`);
    return lines.join("\n");
  }

  glob.__gMindmap = { parentOf, kindOf, targetsOf, resolve, graphOf, toMarkdown };

  /* ── the part that draws ───────────────────────────────────────────────── */

  if (typeof document === "undefined" || !glob.biom) return;

  const biom = glob.biom;
  const CSS = `
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--stock, #111); color: var(--ink, #eee);
         font: 400 1rem/1.5 var(--sheet-face, system-ui, sans-serif); -webkit-font-smoothing: antialiased; }
  button, input { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--led, var(--cyan, currentColor)); outline-offset: 2px; }

  /* THE SKY IS THE VIEWPORT. It fills the box; nothing here scrolls. */
  .mm { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100vh; }
  .mm-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; padding: .9rem 1.5rem .8rem; border-block-end: 1px solid var(--rule, currentColor); }
  .mm-title { margin: 0; font: 400 1.35rem/1.2 var(--furniture-face, system-ui, sans-serif); letter-spacing: .02em; text-transform: uppercase; }
  .mm-title small { display: block; margin-block-start: .25rem; font: 400 .6rem/1.4 var(--gauge-face, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3, #888); }
  .tools { display: flex; gap: .4rem; flex-wrap: wrap; align-items: center; }
  .set, .find { font: 400 .66rem/1.4 var(--gauge-face, monospace); letter-spacing: .1em; text-transform: uppercase; padding: .38rem .7rem; background: none; border: 1px solid var(--rule, currentColor); border-radius: 0; color: var(--ink-2, #bbb); }
  .set { cursor: pointer; }
  .set:hover { color: var(--led, var(--cyan, currentColor)); border-color: var(--ink-3, #888); }
  .set[aria-pressed="true"], .set[aria-expanded="true"] { color: var(--led, var(--cyan, currentColor)); border-color: var(--led, var(--cyan, currentColor)); }
  .find { inline-size: 11rem; text-transform: none; letter-spacing: .04em; }
  .find::placeholder { color: var(--ink-3, #888); text-transform: uppercase; letter-spacing: .1em; }

  /* THE PANEL IS PART OF THE PAGE rather than floating over it, so opening it
     never covers the sky it is describing. */
  .panel[hidden] { display: none; }
  .panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: 1rem 2rem; padding: .9rem 1.5rem 1rem; border-block-end: 1px solid var(--rule, currentColor); background: var(--stock-hi, transparent); }
  .panel h2 { margin: 0 0 .3rem; font: 400 .66rem/1.4 var(--gauge-face, monospace); letter-spacing: .1em; text-transform: uppercase; }
  .panel p { margin: 0 0 .45rem; font-size: .8rem; line-height: 1.4; color: var(--ink-3, #888); }
  .panel label { display: flex; align-items: center; gap: .5rem; font-size: .9rem; color: var(--ink-2, #bbb); padding: .1rem 0; }
  .panel input[type=range] { accent-color: var(--led, var(--cyan, currentColor)); inline-size: 100%; }
  .panel input[type=radio] { accent-color: var(--led, var(--cyan, currentColor)); margin: 0; }

  .plate { position: relative; min-block-size: 0; overflow: hidden; cursor: grab;
    background: radial-gradient(circle at 1px 1px, var(--dot-off, var(--rule-soft, transparent)) .9px, transparent 1.1px) 0 0 / .5rem .5rem, var(--stock, #111); }
  .plate.dragging { cursor: grabbing; }
  canvas { display: block; position: absolute; inset: 0; }
  .hold { position: absolute; inset: 0; display: grid; place-items: center; font: 400 .66rem/1.4 var(--gauge-face, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3, #888); pointer-events: none; }
  .hold[hidden] { display: none; }
  .fault { margin: 1.5rem; font-size: .9rem; color: var(--magenta-t, currentColor); }

  /* THE STRIP NEVER CHANGES HEIGHT. Every readout is one line that clips, so
     what is under the hand can never move the sky it is describing. */
  .strip { border-block-start: 1px solid var(--rule, currentColor); background: var(--stock-hi, transparent); display: grid; grid-template-columns: minmax(12rem, 1.6fr) repeat(3, minmax(6rem, .7fr)) minmax(14rem, 2fr); gap: 1.25rem; align-items: baseline; padding: .8rem 1.5rem .9rem; block-size: 5.6rem; box-sizing: border-box; overflow: hidden; }
  .strip dt { font: 400 .58rem/1.4 var(--gauge-face, monospace); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3, #888); margin-block-end: .2rem; white-space: nowrap; }
  .strip dd { margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-inline-size: 0; }
  .who { font: 400 1.05rem/1.2 var(--furniture-face, system-ui, sans-serif); letter-spacing: .02em; text-transform: uppercase; color: var(--led, var(--cyan, currentColor)); }
  .path { font: 400 .58rem/1.4 var(--gauge-face, monospace); letter-spacing: .06em; color: var(--ink-3, #888); }
  .num { font: 400 1.05rem/1.2 var(--furniture-face, system-ui, sans-serif); font-variant-numeric: tabular-nums; }
  .num small { font: 400 .58rem/1.4 var(--gauge-face, monospace); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-2, #bbb); margin-inline-start: .35rem; }
  .say { font-size: .9rem; line-height: 1.45; color: var(--ink-2, #bbb); }
  @container (width <= 52rem) { .strip { grid-template-columns: 1fr 1fr 1fr; block-size: auto; } .strip .wide { grid-column: 1 / -1; } .mm-head, .strip { padding-inline: 1rem; } }
  `;

  /** @param {string} tag @param {string | null} [cls] @param {string} [text] */
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** WHAT THE MAP IS SET TO, and where it lives. On a page that names this
   *  plugin the knobs live in the page's VARIABLES, read with `data.get` and
   *  written with `data.set`, the same arrangement the board uses. On the rail's
   *  own Map there is no page to write to — `@map` has no directory — so the
   *  knobs are kept for the session and no write is attempted. */
  const KNOBS = { spin: 1, pull: 1, room: 2.6, speed: 1, light: "inn", bloom: 1 };

  /** @param {Record<string, any>} vars */
  function knobsOf(vars) {
    /** @type {Record<string, any>} */
    const out = { ...KNOBS };
    for (const k of ["spin", "pull", "room", "speed", "bloom"]) if (typeof vars[k] === "number" && isFinite(vars[k])) out[k] = vars[k];
    if (vars.light === "inn" || vars.light === "deg") out.light = vars.light;
    return out;
  }

  async function main() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const page = biom.input || {};
    const follow = page.follow === true;   // keep the sky centred always, hand or no hand
    const zoom = Number(page.zoom) > 0 ? Number(page.zoom) : 1;   // the homed fit, times this
    const root = document.getElementById("g-map") || document.body;

    /* ── the furniture ────────────────────────────────────────────────── */
    const shell = el("div", "mm");
    const head = el("div", "mm-head");
    const title = /** @type {HTMLElement} */ (el("h1", "mm-title", page.name || "Map"));
    const sub = el("small", null, "reading the workspace…");
    title.appendChild(sub);
    head.appendChild(title);
    const tools = el("div", "tools");
    const find = /** @type {HTMLInputElement} */ (el("input", "find"));
    find.type = "search"; find.placeholder = "Find a page"; find.setAttribute("aria-label", "Find a page");
    const treeBtn = /** @type {HTMLButtonElement} */ (el("button", "set", "Show the tree"));
    treeBtn.type = "button"; treeBtn.setAttribute("aria-pressed", "false");
    const setBtn = /** @type {HTMLButtonElement} */ (el("button", "set", "Settings"));
    setBtn.type = "button"; setBtn.setAttribute("aria-expanded", "false");
    tools.append(find, treeBtn, setBtn);
    head.appendChild(tools);
    shell.appendChild(head);

    const panel = el("div", "panel");
    panel.hidden = true;
    shell.appendChild(panel);

    const plate = el("div", "plate");
    const canvas = /** @type {HTMLCanvasElement} */ (el("canvas"));
    const holding = el("div", "hold", "Reading every page…");
    plate.append(canvas, holding);
    shell.appendChild(plate);

    const strip = el("footer", "strip");
    /** @param {string} label @param {string} cls @param {string} [wide] */
    const readout = (label, cls, wide) => {
      const box = el("div", wide || null);
      box.appendChild(el("dt", null, label));
      const dd = el("dd", cls, "—");
      box.appendChild(dd);
      strip.appendChild(box);
      return dd;
    };
    const rName = readout("Under the hand", "who");
    const rPath = el("dd", "path", "hover a light");
    /** @type {HTMLElement} */ (rName.parentElement).appendChild(rPath);
    const rHolds = readout("Holds", "num");
    const rIn = readout("Linked from", "num");
    const rOut = readout("Links to", "num");
    const rSay = readout("Where it sits", "say", "wide");
    shell.appendChild(strip);
    root.replaceChildren(shell);

    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

    /* ── the knobs ────────────────────────────────────────────────────── */
    const rail = page.input && page.input.rail === true;
    let knobs = knobsOf(rail ? {} : await biom.data().catch(() => ({})));

    /** @param {Record<string, any>} patch */
    const apply = (patch) => {
      knobs = { ...knobs, ...patch };
      if (!rail) void biom.setData(patch).catch(() => { /* a map that cannot save its knobs still turns */ });
      calibrate();
    };

    /** @param {string} label @param {string} note @param {string} key @param {number} min @param {number} max */
    const slider = (label, note, key, min, max) => {
      const box = el("section");
      box.appendChild(el("h2", null, label));
      box.appendChild(el("p", null, note));
      const r = /** @type {HTMLInputElement} */ (el("input"));
      r.type = "range"; r.min = String(min); r.max = String(max); r.step = "0.05"; r.value = String(knobs[key]); r.setAttribute("aria-label", label);
      r.addEventListener("input", () => apply({ [key]: Number(r.value) }));
      box.appendChild(r);
      panel.appendChild(box);
    };
    slider("Spin", "How hard a heavy page turns what is around it.", "spin", 0, 2);
    slider("Pull", "How strongly linked pages draw together.", "pull", 0, 2);
    slider("Room", "The scale of the sky. Everything but a light's size grows with it.", "room", 0.5, 5);
    slider("Speed", "The floor and the ceiling, so nothing ever stops and nothing ever flies.", "speed", 0, 2);
    slider("Bloom", "How far the light around a page carries. At nought a page is a disc and nothing more.", "bloom", 0, 2);
    const light = el("section");
    light.appendChild(el("h2", null, "Light"));
    for (const [value, words] of [["inn", "A page's size is what links to it"], ["deg", "Size is every connection it has"]]) {
      const label = el("label");
      const radio = /** @type {HTMLInputElement} */ (el("input"));
      radio.type = "radio"; radio.name = "light"; radio.value = String(value); radio.checked = knobs.light === value;
      radio.addEventListener("change", () => apply({ light: value }));
      label.append(radio, el("span", null, String(words)));
      light.appendChild(label);
    }
    panel.appendChild(light);

    /** @param {boolean} on */
    const showPanel = (on) => { panel.hidden = !on; setBtn.setAttribute("aria-expanded", String(on)); };
    setBtn.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    setBtn.addEventListener("click", (ev) => { ev.stopPropagation(); showPanel(panel.hidden); });
    panel.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    document.addEventListener("pointerdown", () => { if (!panel.hidden) showPanel(false); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !panel.hidden) { showPanel(false); setBtn.focus(); } });

    /* ── the graph, read over the port ────────────────────────────────── */
    /** @type {any[]} */ let nodes = [];
    /** @type {[any, any][]} */ let links = [];
    /** @type {[any, any][]} */ let tree = [];
    /** @type {Record<string, any>} */ let byId = {};
    /** @type {Record<string, any[]>} */ let adj = {};
    let MAXM = 1;
    /** @type {any[]} */ let ranked = [];
    let generation = 0;

    /** Every page's prose, a few at a time: the bridge caps calls in flight and
     *  a vault of three hundred pages asked all at once would trip it.
     *  @param {{id: string}[]} pages @returns {Promise<Record<string, string>>} */
    async function proseOf(pages) {
      /** @type {Record<string, string>} */
      const out = {};
      const queue = pages.slice();
      const worker = async () => {
        for (;;) {
          const p = queue.shift();
          if (p === undefined) return;
          try { out[p.id] = String(await biom.doc(p.id) || ""); } catch { out[p.id] = ""; }
        }
      };
      await Promise.all([0, 1, 2, 3, 4, 5].map(worker));
      return out;
    }

    async function load() {
      const mine = ++generation;
      holding.hidden = false;
      /** @type {{id: string, name: string}[]} */
      let pages;
      try {
        pages = /** @type {any} */ (await biom.docs());
      } catch (e) {
        holding.hidden = true;
        plate.replaceChildren(el("p", "fault", "the pages could not be listed: " + String((e && /** @type {any} */ (e).message) || e)));
        return;
      }
      if (!Array.isArray(pages)) pages = [];
      const prose = await proseOf(pages);
      if (mine !== generation) return;
      const kept = new Map(nodes.map((n) => [n.id, n]));
      const graph = graphOf(pages, prose);
      // A page that was already on the sky keeps its place and its motion, so a
      // refresh is a change in the sky rather than a new one.
      for (const n of graph.nodes) { const was = kept.get(n.id); if (was) { n.x = was.x; n.y = was.y; n.vx = was.vx; n.vy = was.vy; } }
      const fresh = nodes.length === 0;
      nodes = graph.nodes; links = graph.links; tree = graph.tree; byId = graph.byId;
      adj = {};
      for (const n of nodes) adj[n.id] = [];
      for (const l of links) { (adj[l[0].id] || []).push(l[1]); (adj[l[1].id] || []).push(l[0]); }
      calibrate();
      if (fresh) reset();
      sub.textContent = nodes.length + " pages · " + links.length + " links between them";
      // A FRESH SKY KEEPS THE PLACEHOLDER until it has been settled, because
      // settling it blocks this thread: hiding the placeholder here would put an
      // empty plate on screen for exactly as long as the settling takes.
      if (warm) holding.textContent = "Letting the sky settle…";
      else holding.hidden = true;
      biom.toMarkdown = () => toMarkdown(nodes);
      // THE SKY ARRIVED AFTER THE PAGE DREW, so the projection taken at the draw
      // was of an empty sky. This is the page saying it has something to say now.
      document.dispatchEvent(new CustomEvent("biom:rendered"));
    }

    /* ── mass, size, and the palette ──────────────────────────────────── */
    /** @param {any} n */
    function mass(n) { return 1 + (knobs.light === "inn" ? n.inn : n.inn + n.out + n.kids); }
    /** RELATIVE: the biggest page in the vault is the biggest light, and size
     *  falls away fast below it. @param {any} n */
    function rad(n) { const t = (mass(n) - 1) / Math.max(1, MAXM - 1); return 2.2 + 62 * Math.pow(t, 1.8); }
    /** THE SPACE A PAIR KEEPS BETWEEN THEIR RIMS, from the two radii added up.
     *  It is mostly proportional to their size, and barely a flat amount at all:
     *  a page's own width is the only sensible unit for how much air it wants
     *  around it, and a flat term big enough for a sun holds two specks apart at
     *  seventeen times their own width, which is the whole sky laid out as a
     *  grid of far-apart dots with no room to move BETWEEN anything.
     *  @param {number} skin the two radii @param {number} room */
    function standoff(skin, room) { return (skin * 1.6 + 6) * room; }
    function calibrate() {
      MAXM = nodes.reduce((m, n) => Math.max(m, mass(n)), 1);
      ranked = nodes.slice().sort((a, b) => mass(b) - mass(a));
    }

    /** @type {{ink: string, ink2: string, ink3: string, rule: string, led: string, off: string}} */
    let palette = { ink: "", ink2: "", ink3: "", rule: "", led: "", off: "" };
    let face = "";
    /** @param {string} name @param {string} fallback */
    function tok(name, fallback) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v !== "" ? v : fallback; }
    function colours() {
      const led = tok("--led", tok("--cyan", "#FFB020"));
      palette = { ink: tok("--ink", "#EDE6D6"), ink2: tok("--ink-2", "#B9B3A5"), ink3: tok("--ink-3", "#7E7A70"), rule: tok("--rule", "#2C3036"), led, off: tok("--dot-off", tok("--rule-soft", "#23262B")) };
      face = tok("--furniture-face", "system-ui, sans-serif");
    }
    /** A colour as three numbers, whether it arrived as a token's hex or as an
     *  rgb() this file mixed a moment ago. Never throws: the frame loop must not
     *  die. @param {string} h @returns {number[]} */
    function hex(h) {
      if (typeof h !== "string") return [0, 0, 0];
      if (h[0] === "#") { const n = parseInt(h.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      const m = h.match(/\d+/g);
      return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
    }
    /** @param {string} h @param {number} a */
    function rgba(h, a) { const c = hex(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
    /** @param {string} a @param {string} b @param {number} t */
    function mix(a, b, t) { const A = hex(a), B = hex(b); return "rgb(" + Math.round(Number(A[0]) + (Number(B[0]) - Number(A[0])) * t) + "," + Math.round(Number(A[1]) + (Number(B[1]) - Number(A[1])) * t) + "," + Math.round(Number(A[2]) + (Number(B[2]) - Number(A[2])) * t) + ")"; }

    /* ── the view, the hand, the physics ──────────────────────────────── */
    let W = 0, Hh = 0, dpr = 1;
    let view = { x: 0, y: 0, k: .75 };
    /** @type {any} */ let hover = null;
    /** @type {any} */ let drag = null;
    /** @type {number[] | null} */ let pan = null;
    /** @type {number[] | null} */ let hand = null;
    let query = "", showTree = false;
    /** @type {Set<string> | null} */ let spot = null;
    let touched = performance.now() - 3000;
    let warm = false;   // a sky nobody has seen yet, still owed its settling

    /** HOW BIG THE SKY WILL BE, before it has settled. Every light keeps a room
     *  of about `keep` around itself, so a sky of N lights packs into a disc of
     *  roughly sqrt(N) rooms across; the constant is measured against a real
     *  vault rather than derived.
     *
     *  THE ROOM IS THE LINK'S REST LENGTH, not the standoff, because that is
     *  what actually holds a settled sky open — a linked pair sits at rest, and
     *  there are enough links that the crowd is held out there. Guessing from
     *  the standoff put the first scatter four times too tight, and the whole
     *  first second was then spent expanding: measured against this vault, a
     *  sky started at its own density is where a tight one gets to after four
     *  hundred frames of shoving. */
    function extent() {
      const keep = (2 * 2.2) * 2.4 * knobs.room + 60 * knobs.room;
      return Math.max(120, Math.sqrt(Math.max(1, nodes.length)) * keep * .4);
    }
    function reset() {
      const R = extent();
      nodes.forEach((n, i) => { const a = i * 2.399, r = R * .85 * Math.sqrt((i + 1) / nodes.length); n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.vx = -Math.sin(a) * .4; n.vy = Math.cos(a) * .4; });
      const k = Math.min(2, Math.max(.2, Math.min((W - 80) / (2 * R), (Hh - 80) / (2 * R)))) * zoom;
      view = { x: W / 2, y: Hh / 2, k: isFinite(k) ? k : .75 };
      touched = performance.now() - 3000;
      warm = true;
    }

    /** THE PHYSICS, one step. Room is the scale of the sky: every distance grows
     *  with it and only a light's size does not, so a wider sky is the same sky
     *  with more space in it. Then, for every page: away from and around
     *  whatever is too near — off its rim rather than out of its centre, so a
     *  sun's own width is not mistaken for room around it, hard enough well
     *  before the rims meet that a page rests at its standoff instead of being
     *  squeezed inside it, and without any upper bound as they do meet, so
     *  nothing ever ends up inside anything else — a heavy page's swirl on
     *  whatever is within its reach (harder the closer, and harder the lighter
     *  the page being swung, so a speck falling toward a sun speeds up, whips
     *  around it and slows as it climbs out while the sun barely moves), a
     *  soft centre and a soft rim; for every link, a pull to a rest distance
     *  and the heavier page's spin on the lighter; the hand's black hole; and a
     *  speed floor and ceiling that shrink with size, so a sun is slow and a
     *  speck is never still. */
    function step() {
      const room = knobs.room, pull = .012 * knobs.pull / room, spin = .09 * knobs.spin, Rmax = Math.min(W, Hh) * .5 * room;
      const vmin = .03 * knobs.speed * room, vmax = 3 * Math.max(.2, knobs.speed) * room;
      const cs = 110 * room;
      /** @type {Record<string, any[]>} */
      const grid = {};
      for (const n of nodes) { const k = Math.floor(n.x / cs) + "," + Math.floor(n.y / cs); let cell = grid[k]; if (!cell) { cell = []; grid[k] = cell; } cell.push(n); }
      // HOW FAR THE GRID IS WALKED, AND WHY IT IS NOT ALWAYS ONE CELL. A page's
      // push has to reach the widest page's rim plus the standoff, and for two
      // suns that is more than two cells — so a fixed three-by-three
      // neighbourhood never saw the one pair that most had to be kept apart,
      // and the biggest pages drifted through each other.
      const WIDEST = nodes.reduce((m, n) => Math.max(m, rad(n)), 0);
      for (const n of nodes) {
        const gx = Math.floor(n.x / cs), gy = Math.floor(n.y / cs), rn = rad(n);
        const span = Math.max(1, Math.ceil((rn + WIDEST + standoff(rn + WIDEST, room)) / cs));
        for (let dx = -span; dx <= span; dx += 1) for (let dy = -span; dy <= span; dy += 1) {
          const b = grid[(gx + dx) + "," + (gy + dy)];
          if (!b) continue;
          for (const o of b) {
            if (o === n) continue;
            const ddx = n.x - o.x, ddy = n.y - o.y, d = Math.hypot(ddx, ddy) || .01;
            // THE PUSH IS OFF THE RIM, NOT OUT OF THE CENTRE. `gap` is the space
            // between the two edges, so a speck resting on a sun's rim is as hard
            // pushed as one resting on another speck's; measured centre to centre
            // the sun's own radius counted as room and the speck sank into it.
            const skin = rn + rad(o), want = standoff(skin, room), gap = d - skin;
            const ux = ddx / d, uy = ddy / d, m = Math.pow((mass(o) - 1) / Math.max(1, MAXM - 1), 1.5);
            // A RIM IS A WALL, AND THE STANDOFF IS WHERE A PAGE RESTS. The push
            // is the square of `want / gap`: it rises without bound as the two
            // rims close, so nothing can be pressed into anything else however
            // heavy the thing pressing, and — this is what the square and the
            // weight buy — it is already strong a little way inside the standoff
            // rather than only near the rim. A gentle one made `want` the
            // distance at which the push merely switched ON, and the crowd and
            // the links then squeezed every page well inside it: measured
            // against this vault, pages rested at half their standoff and the
            // tightest at a fifth. They now rest at nine tenths of it. Only the
            // floor under `gap` keeps the number finite, and the speed ceiling
            // below is what stops a wall this hard from flinging what it stops.
            if (gap < want) { const s = want / Math.max(gap, .5 * room), f = s * s - 1; n.vx += ux * f * 8 * room; n.vy += uy * f * 8 * room; }
            const reach = (90 + rad(o) * 7) * room;
            if (m > 0 && d < reach && mass(o) > mass(n)) {
              // THE LIGHTER THE PAGE, THE FASTER IT IS SWUNG. The turn is lifted
              // by how many times heavier the other page is, so a speck whips
              // around a sun and the sun barely notices — which is what makes
              // this a sky of orbits rather than a settled packing. The turn
              // carries the weight; the fall inward does not, or a stronger
              // swirl would only press the pair into the wall it cannot pass.
              const near = 1 - d / reach, base = spin * m * (0.4 + near * near * 5), sw = base * 4 * (mass(o) / mass(n));
              n.vx += -uy * sw * room; n.vy += ux * sw * room; n.vx -= ux * base * .25 * room; n.vy -= uy * base * .25 * room;
            }
          }
        }
        const r = Math.hypot(n.x, n.y);
        n.vx += -n.x * .0006 / room; n.vy += -n.y * .0006 / room;
        if (r > Rmax) { n.vx += -n.x / r * (r - Rmax) * .02; n.vy += -n.y / r * (r - Rmax) * .02; }
      }
      const edges = showTree ? links.concat(tree) : links;
      for (const e of edges) {
        const a = e[0], b = e[1], heavy = mass(a) >= mass(b) ? a : b, light = heavy === a ? b : a;
        const dx = light.x - heavy.x, dy = light.y - heavy.y, d = Math.hypot(dx, dy) || .01, ux = dx / d, uy = dy / d;
        const rest = (rad(heavy) + rad(light)) * 2.4 * room + 60 * room;
        const f = (d - rest) * pull, share = mass(heavy) / (mass(heavy) + mass(light));
        light.vx -= ux * f * share; light.vy -= uy * f * share; heavy.vx += ux * f * (1 - share); heavy.vy += uy * f * (1 - share);
        const near = Math.max(0, 1.6 - d / rest), s = spin * 4 * (mass(heavy) / mass(light)) * Math.pow(mass(heavy) / MAXM, 1.5) * (0.6 + near * near * 5);
        light.vx += -uy * s * room; light.vy += ux * s * room;
      }
      // THE HAND IS A BLACK HOLE. `hold` is how caught each light is, 0..1.
      const hx = hand ? (Number(hand[0]) - view.x) / view.k : null, hy = hand ? (Number(hand[1]) - view.y) / view.k : null, HR = 280 / view.k;
      for (const n of nodes) {
        n.hold = 0;
        if (hx === null || hy === null) continue;
        const dx = hx - n.x, dy = hy - n.y, d = Math.hypot(dx, dy);
        if (d > HR) continue;
        const c = 1 - d / HR;
        n.hold = c * c;
        n.vx *= 1 - n.hold * .8; n.vy *= 1 - n.hold * .8;
        n.vx += dx / (d || 1) * n.hold * .35; n.vy += dy / (d || 1) * n.hold * .35;
      }
      for (const n of nodes) {
        if (n === drag) { n.vx = n.vy = 0; continue; }
        // THE LIGHT UNDER THE HAND HOLDS STILL: a target that moves is not a target.
        if (n === hover) { n.vx = n.vy = 0; continue; }
        const t = (mass(n) - 1) / Math.max(1, MAXM - 1), slow = 1 / (1 + t * 9), hi = vmax * slow;
        // A CEILING EVEN INSIDE THE HAND. A caught light was the one path that
        // moved without one, which was safe while every force was bounded and
        // is not now that a rim pushes without limit.
        if (n.hold > .5) { const v = Math.hypot(n.vx, n.vy); if (v > hi) { n.vx *= hi / v; n.vy *= hi / v; } n.x += n.vx; n.y += n.vy; continue; }
        n.vx *= .9 * (1 - t * .3); n.vy *= .9 * (1 - t * .3);
        const v = Math.hypot(n.vx, n.vy), lo = vmin * slow;
        if (v < lo) { if (v < .0001) { const a = Math.random() * 6.28; n.vx = Math.cos(a) * lo; n.vy = Math.sin(a) * lo; } else { n.vx *= lo / v; n.vy *= lo / v; } }
        else if (v > hi) { n.vx *= hi / v; n.vy *= hi / v; }
        if (!isFinite(n.vx) || !isFinite(n.vy)) { n.vx = n.vy = 0; }
        n.x += n.vx; n.y += n.vy;
        if (!isFinite(n.x) || !isFinite(n.y)) { n.x = (Math.random() - .5) * 50; n.y = (Math.random() - .5) * 50; }
      }
    }

    /** THE CAMERA COMES HOME. From the first frame, and three seconds after the
     *  hand last moved, the view eases toward a frame that holds every light —
     *  slowly at first and gathering pace, the zoom at half the pan's rate. Never
     *  while a light is under the hand or being dragged. */
    /** A STILL HAND LETS GO. Three seconds without moving and the pointer stops
     *  selecting: the light it was on is released, the black hole closes, and
     *  the camera may come home. The next movement picks again. */
    function release() {
      if (drag || pan || performance.now() - touched < 3000) return;
      if (hover !== null || hand !== null) { hover = null; hand = null; read(null); }
    }
    /** THE FRAME THAT HOLDS EVERY LIGHT. @returns {{x: number, y: number, k: number}} */
    function fit() {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of nodes) { const r = rad(n) + 12; x0 = Math.min(x0, n.x - r); y0 = Math.min(y0, n.y - r); x1 = Math.max(x1, n.x + r); y1 = Math.max(y1, n.y + r); }
      const bw = x1 - x0 || 1, bh = y1 - y0 || 1, k = Math.min(6, Math.max(.2, Math.min((W - 80) / bw, (Hh - 80) / bh))) * zoom;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return { x: W / 2 - cx * k, y: Hh / 2 - cy * k, k };
    }
    function home() {
      if (nodes.length === 0 || (!follow && (performance.now() - touched < 3000 || pan || drag || hover))) return;
      const t = fit();
      const idle = follow ? 1 : Math.min(1, Math.max(0, performance.now() - touched - 3000) / 8000), e = follow ? .03 : .0015 + idle * idle * .04;
      view.k += (t.k - view.k) * e * .5; view.x += (t.x - view.x) * e; view.y += (t.y - view.y) * e;
    }

    /** A SKY THAT HAS ALREADY BEEN TURNING FOR A WHILE, before anybody sees it.
     *  A fresh sky is a spiral of specks and settling it is the least
     *  interesting thing it does, so those seconds are spent before the first
     *  paint rather than in front of somebody: run the physics as fast as the
     *  machine will run it, then put the camera where the settled sky is
     *  instead of where the guess said it would be.
     *
     *  Bounded by the CLOCK and not by the count, because the count is
     *  meaningless — a step over three hundred pages is not a step over thirty.
     *  Half a second is the most a page may spend on this; a small sky gets its
     *  full twenty seconds inside that, and a big one gets what it can and
     *  finishes settling in the open, which is the same thing the map has
     *  always done. It cannot run before the plate has a size, because the
     *  physics measures its rim against the viewport. */
    function settle() {
      if (W === 0 || Hh === 0) return;
      warm = false;
      const until = performance.now() + 500;
      for (let i = 0; i < 20 * 60 && performance.now() < until; i += 1) step();
      if (nodes.length > 0) view = fit();
      touched = performance.now() - 3000;
      holding.hidden = true;
    }

    /** @param {any} n */ const sx = (n) => view.x + n.x * view.k;
    /** @param {any} n */ const sy = (n) => view.y + n.y * view.k;
    /** @param {any} n */ const match = (n) => query !== "" && String(n.name).toLowerCase().includes(query);

    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, Hh);
      /** @type {Record<string, number> | null} */
      let near = null;
      if (hover) {
        near = {}; near[hover.id] = 1;
        for (const o of adj[hover.id] || []) near[o.id] = 1;
        if (showTree) { if (hover.parent && byId[hover.parent]) near[hover.parent] = 1; for (const o of nodes) if (o.parent === hover.id) near[o.id] = 1; }
      } else if (spot && spot.size > 0) {
        near = {}; for (const id of spot) near[id] = 1;
      }
      g.lineWidth = 1;
      if (showTree) {
        g.strokeStyle = rgba(palette.ink3, near ? .08 : .22); g.beginPath();
        for (const e of tree) { if (near && (e[0] === hover || e[1] === hover)) continue; g.moveTo(sx(e[0]), sy(e[0])); g.lineTo(sx(e[1]), sy(e[1])); }
        g.stroke();
      }
      g.strokeStyle = rgba(palette.led, near ? .06 : .14); g.beginPath();
      for (const e of links) { if (near && (e[0] === hover || e[1] === hover)) continue; g.moveTo(sx(e[0]), sy(e[0])); g.lineTo(sx(e[1]), sy(e[1])); }
      g.stroke();
      if (hover) {
        g.strokeStyle = palette.led; g.lineWidth = 1.2; g.beginPath();
        for (const e of links.concat(showTree ? tree : [])) { if (e[0] !== hover && e[1] !== hover) continue; g.moveTo(sx(e[0]), sy(e[0])); g.lineTo(sx(e[1]), sy(e[1])); }
        g.stroke(); g.lineWidth = 1;
      } else if (near) {
        // A spotlight: the links between the lit pages, drawn full and in the same cream as the pages.
        g.strokeStyle = palette.ink; g.lineWidth = 1.5; g.beginPath();
        for (const e of links) { if (!near[e[0].id] || !near[e[1].id]) continue; g.moveTo(sx(e[0]), sy(e[0])); g.lineTo(sx(e[1]), sy(e[1])); }
        g.stroke(); g.lineWidth = 1;
      }
      const kk = Math.sqrt(view.k);
      for (const n of nodes) {
        const x = sx(n), y = sy(n), r = rad(n) * kk, t = Math.min(1, (mass(n) - 1) / Math.max(1, MAXM - 1)), dim = (near && !near[n.id]) || (query !== "" && !match(n));
        if (!isFinite(x) || !isFinite(y) || !isFinite(r) || x < -60 || y < -60 || x > W + 60 || y > Hh + 60) continue;
        const hot = n === hover || match(n) || (near !== null && near[n.id] === 1);
        const gr = (r * (2.4 + t * 1.6) + 8) * knobs.bloom;
        if (!isFinite(gr)) continue;
        // A page's halo. `bloom` scales how far it carries; at nought there is no gradient to paint and a
        // page is a disc and nothing more, which is what a small screen wants — the wash is atmosphere at
        // full size and a smear at a third of it.
        const lit = spot !== null && spot.has(n.id);
        if (gr > 0) {
          const gl = g.createRadialGradient(x, y, 0, x, y, gr);
          gl.addColorStop(0, rgba(n === hover || lit || n.hold > .7 ? palette.ink : palette.led, dim ? .02 : hot ? .5 : .03 + Math.pow(t, 1.5) * .45 + n.hold * .1));
          gl.addColorStop(1, rgba(palette.led, 0));
          g.fillStyle = gl; g.beginPath(); g.arc(x, y, gr, 0, 6.2832); g.fill();
        }
        const base = hot ? palette.led : dim ? palette.off : mix(palette.off, palette.led, .2 + Math.pow(t, .7) * .8);
        // ONLY WHAT IS BEING PICKED GOES CREAM: the light under the hand and the
        // one or two right beside it. Everything else in reach just slows.
        const pick = n === hover || lit ? 1 : Math.max(0, (n.hold - .6) / .4);
        g.fillStyle = pick > 0 ? mix(base, palette.ink, pick) : base;
        // UNDER A SPOTLIGHT ONLY THE LIT PAGES SHOW: the rest are ghosts, there but barely.
        if (dim && !hover && spot !== null) g.globalAlpha = .28;
        g.beginPath(); g.arc(x, y, r + pick * 2, 0, 6.2832); g.fill();
        g.globalAlpha = 1;
      }
      // Names: the suns always, more as the view zooms in, the picked always.
      const keep = Math.min(nodes.length, Math.round(14 * view.k * view.k));
      /** @type {Record<string, number>} */
      const named = {};
      for (const n of ranked.slice(0, keep)) named[n.id] = 1;
      g.textAlign = "left"; g.textBaseline = "middle";
      for (const n of nodes) {
        const hot = n === hover || match(n) || (near !== null && near[n.id] === 1);
        if (!hot && !named[n.id] && n.hold < .6) continue;
        if (near && !near[n.id] && !match(n)) continue;
        const x = sx(n), y = sy(n);
        if (!isFinite(x) || !isFinite(y)) continue;
        // THE PICKED NAME STANDS OUT, and never shrinks: whatever the zoom, the
        // light under the hand is named at a size that reads.
        const size = n === hover
          ? Math.max(17, Math.min(14, 8 + Math.sqrt(mass(n)) * 1.3) * Math.min(1.5, kk) * 1.5)
          : Math.max(9, Math.min(14, 8 + Math.sqrt(mass(n)) * 1.3)) * Math.min(1.5, kk);
        g.font = "400 " + size + "px " + face;
        g.fillStyle = n === hover || (spot !== null && spot.has(n.id)) ? palette.ink : hot ? palette.led : palette.ink;
        let words = String(n.name).toUpperCase();
        if (words.length > 30 && n !== hover) words = words.slice(0, 29).trimEnd() + "…";
        g.fillText(words, x + rad(n) * kk + 6, y + 1);
      }
      g.textBaseline = "alphabetic";
    }

    let raf = 0, running = true;
    function frame() {
      raf = 0;
      if (running) { try { if (warm) settle(); release(); step(); home(); draw(); } catch (e) { console.error("[mindmap]", e); } }
      if (running) raf = requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running && !raf) raf = requestAnimationFrame(frame); });

    /* ── the hand ─────────────────────────────────────────────────────── */
    /** @param {number} px @param {number} py */
    function at(px, py) {
      /** @type {any} */ let best = null; let bd = 1e9;
      for (const n of nodes) { const d = Math.hypot(sx(n) - px, sy(n) - py) - rad(n) * Math.sqrt(view.k); if (d < 14 && d < bd) { best = n; bd = d; } }
      return best;
    }
    /** @param {PointerEvent | WheelEvent} ev */
    function pos(ev) { const b = canvas.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; }
    plate.addEventListener("pointermove", (ev) => {
      const p = pos(ev); hand = p; touched = performance.now();
      if (drag) { drag.moved = true; drag.x = (Number(p[0]) - view.x) / view.k; drag.y = (Number(p[1]) - view.y) / view.k; return; }
      if (pan) { view.x = Number(pan[2]) + Number(p[0]) - Number(pan[0]); view.y = Number(pan[3]) + Number(p[1]) - Number(pan[1]); return; }
      const h = at(Number(p[0]), Number(p[1]));
      if (h !== hover) { hover = h; read(h); }
    });
    plate.addEventListener("pointerdown", (ev) => {
      touched = performance.now();
      const p = pos(ev), h = at(Number(p[0]), Number(p[1]));
      plate.classList.add("dragging"); plate.setPointerCapture(ev.pointerId);
      if (h) { drag = h; drag.moved = false; } else pan = [Number(p[0]), Number(p[1]), view.x, view.y];
    });
    plate.addEventListener("pointerup", () => {
      // A PRESS THAT DID NOT MOVE OPENS THE PAGE; a press that dragged lets the
      // light go with a nudge. One control, two gestures, told apart by motion.
      if (drag && !drag.moved) biom.open({ kind: "page", id: drag.id });
      else if (drag) { drag.vx = (Math.random() - .5) * .6; drag.vy = (Math.random() - .5) * .6; }
      drag = null; pan = null; plate.classList.remove("dragging");
    });
    plate.addEventListener("pointerleave", () => { hand = null; if (!drag && !pan) { hover = null; read(null); } });
    plate.addEventListener("wheel", (ev) => {
      ev.preventDefault(); touched = performance.now();
      const p = pos(ev), k = Math.min(6, Math.max(.35, view.k * (ev.deltaY < 0 ? 1.12 : .89)));
      view.x = Number(p[0]) - (Number(p[0]) - view.x) * k / view.k; view.y = Number(p[1]) - (Number(p[1]) - view.y) * k / view.k; view.k = k;
    }, { passive: false });

    /** @param {any} n */
    function read(n) {
      rName.textContent = n ? n.name : "—";
      rPath.textContent = n ? n.id : "hover a light";
      /** @param {HTMLElement} e @param {number} v @param {string} unit */
      const num = (e, v, unit) => { e.textContent = n ? String(v) : "—"; if (n) e.appendChild(el("small", null, unit)); };
      num(rHolds, n && n.kids, "pages"); num(rIn, n && n.inn, "pages"); num(rOut, n && n.out, "pages");
      rSay.textContent = n
        ? (n.parent && byId[n.parent] ? "Under " + byId[n.parent].name + ". " : n.parent ? "Under " + n.parent + ". " : "The root page. ")
          + (n.inn >= MAXM * .5 ? "One of the suns: the vault leans on it." : n.inn === 0 && n.out === 0 ? "Nothing links here and it links nowhere. It orbits alone." : "")
        : "Drag a light and let it go. Press one to open it. Wheel to zoom, drag the ground to pan.";
    }
    find.addEventListener("input", () => { query = find.value.trim().toLowerCase(); });
    treeBtn.addEventListener("click", () => { showTree = !showTree; treeBtn.setAttribute("aria-pressed", String(showTree)); });

    /* ── sizing, and go ───────────────────────────────────────────────── */
    let started = false;
    function size() {
      const oW = W, oH = Hh;
      dpr = Math.min(2, devicePixelRatio || 1); W = plate.clientWidth; Hh = plate.clientHeight;
      canvas.width = W * dpr; canvas.height = Hh * dpr; canvas.style.width = W + "px"; canvas.style.height = Hh + "px";
      colours();
      if (!started) { started = true; raf = requestAnimationFrame(frame); }
      else { view.x += (W - oW) / 2; view.y += (Hh - oH) / 2; }
    }
    new ResizeObserver(size).observe(plate);
    biom.onTheme(colours);
    read(null);
    await load();
    biom.onRefresh(() => void load());
    if (typeof biom.onSpotlight === "function") biom.onSpotlight(/** @param {unknown} ids */ (ids) => { spot = Array.isArray(ids) && ids.length > 0 ? new Set(ids.map(String)) : null; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void main(), { once: true });
  else void main();
})();
