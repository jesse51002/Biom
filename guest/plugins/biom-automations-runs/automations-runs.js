// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-automations-runs/automations-runs.js — THE PAGE TYPE THAT
 * SHOWS A PAGE'S CHILDREN ONE AT A TIME, NEWEST FIRST. A classic script; see
 * registry.js for why there are no imports in here.
 *
 * A PAGE THAT DRAWS ITSELF. `index.html` beside this file is the document a
 * page names with `plugin: automations-runs`, and this script is in the bundle
 * every page carries: on a page that is not one of these there is no
 * `#g-runs`, and it does nothing at all. It registers nothing — a registered
 * plugin fills a slot inside somebody else's page, and this IS the page.
 *
 * WHAT IT READS, and it is all: `biom.children()`, pages only, for the
 * children; `biom.doc(id)` for a child's H1, which is what the bar shows;
 * `biom.embedInto` for the shown one; `biom.plugin.extensions()` for its
 * three variables. It reads no table, no registry, no session: it knows
 * nothing about runs, and the word is the page's.
 *
 * THE ORDER is `created` descending where the host answers it, the leading
 * date of the name where it does not — a run's page is named for its minute —
 * and the name where neither. A refresh re-lists and keeps the shown child by
 * id; a reader on the newest follows a newer arrival, because that is what
 * newest means.
 *
 * THE TWO SLIDES AHEAD. `progress` and `home` each name a plugin, and each is
 * mounted once into a slide node of its own through the runtime's own
 * `rt.page.mount` — the same context and containment a section's
 * `data-g-plugin` node gets, with `{ page }` in ctx and the page's variables,
 * so the plugin that draws the launcher reads `automation` off them. The
 * mounts outlive a redraw, as the doc document's head and foot do. The
 * progress node is handed over HIDDEN, and the plugin takes the attribute off
 * while something is running and puts it back when nothing is; the attribute
 * is watched, and the slide is first while the node is shown and skipped
 * while it is not — so the page opens on what is happening while something
 * is, and on the launcher when nothing is. A slide plugin may also write
 * `data-title` on its node, and the bar shows it. */
(function () {
  "use strict";

  /** @type {any} */
  var glob = /** @type {any} */ (globalThis);
  var WORDS = { newer: "newer", older: "older", of: "of", none: "Nothing under this page yet." };
  var DATE = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})-(\d{2}))?/;

  /** @param {string} tag @param {string} [cls] @param {any} [text] */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = String(text); return n; }
  /** @param {string} id */
  function segmentOf(id) { return String(id).slice(String(id).lastIndexOf("/") + 1); }
  /** @param {string} id */
  function parentOf(id) { var at = String(id).lastIndexOf("/"); return at < 0 ? null : String(id).slice(0, at); }

  /** WHEN A CHILD WAS MADE, as a number to sort on, or null. `created` is the
   *  host's word where it has one; the name's leading date is a run page's
   *  own; neither is null and sorts last, by name.
   *  @param {any} child @returns {number | null} */
  function stampOf(child) {
    if (child.created) { var t = Date.parse(String(child.created)); if (!isNaN(t)) return t; }
    var m = DATE.exec(String(child.name || "")) || DATE.exec(segmentOf(child.id));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)).getTime();
  }
  /** @param {any} a @param {any} b */
  function newestFirst(a, b) {
    var sa = stampOf(a), sb = stampOf(b);
    if (sa !== null && sb !== null && sa !== sb) return sb - sa;
    if (sa === null && sb !== null) return 1;
    if (sb === null && sa !== null) return -1;
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
  }

  /** THE H1 OF A PAGE'S PROSE, or null. `biom.doc` answers every markdown
   *  slot in order, so the first heading line is the page's title. A `{{name}}`
   *  in it is filled from the page's own variables, one more call, only then.
   *  @param {any} md @returns {string | null} */
  function titleIn(md) {
    var m = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(String(md || ""));
    if (!m || m[1] === undefined) return null;
    return m[1].replace(/\*\*?|__?|`/g, "").replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2").replace(/\[\[([^\]]+)\]\]/g, "$1").trim();
  }
  /** @param {any} text @param {any} vars */
  function filled(text, vars) {
    return String(text).replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, function (_, k) {
      var v = vars && vars[k]; return v === undefined || v === null ? "" : String(v);
    });
  }

  /** WHICH CHILDREN ARE SHOWN, in the order they are shown: pages only, none
   *  whose name or segment `skip` names, newest first.
   *  @param {any[] | null | undefined} children @param {any} skip @returns {any[]} */
  function shown(children, skip) {
    var names = (Array.isArray(skip) ? skip : skip === undefined || skip === null || skip === "" ? [] : [skip]).map(function (/** @type {any} */ x) { return String(x); });
    return (children || []).filter(function (/** @type {any} */ c) { return c && c.kind === "page" && names.indexOf(String(c.name)) < 0 && names.indexOf(segmentOf(c.id)) < 0; }).slice().sort(newestFirst);
  }

  /* THE PURE HALF, on a global, so it can be verified outside a browser —
   * `tests/automations-runs.test.js` reads it; nothing in the box does. */
  glob.__gAutomationsRuns = { stampOf: stampOf, newestFirst: newestFirst, titleIn: titleIn, filled: filled, shown: shown };

  function main() {
    var root = document.getElementById("g-runs");
    if (!root) return;
    var rt = glob.__gRuntime || (glob.__gRuntime = {});
    var biom = glob.biom;
    root.classList.add("g-runs");

    /* ── the furniture ──────────────────────────────────────────────────── */
    var bar = el("div", "g-runs-bar"), sign = el("span", "sign"), title = el("span", "title"), nOf = el("span", "n");
    bar.appendChild(sign); bar.appendChild(title); bar.appendChild(nOf);
    /** @param {"newer" | "older"} dir */
    function edge(dir) { var b = /** @type {HTMLButtonElement} */ (el("button", "g-runs-edge")); b.type = "button"; b.setAttribute("data-dir", dir); b.setAttribute("aria-label", WORDS[dir]); var c = el("i", "chev"); c.setAttribute("aria-hidden", "true"); b.appendChild(c); b.appendChild(el("span", "w", WORDS[dir])); return b; }
    var newer = edge("newer"), older = edge("older");
    var stage = el("div", "g-runs-stage");
    /** @param {string} key */
    function slideNode(key) { var s = el("div", "g-runs-slide"); s.setAttribute("data-slide", key); return s; }
    var progressSlide = slideNode("progress"), progressNode = el("div", "g-runs-mount"); progressNode.id = "g-progress"; progressNode.hidden = true; progressSlide.appendChild(progressNode);
    var homeSlide = slideNode("home"), homeNode = el("div", "g-runs-mount"); homeNode.id = "g-home"; homeSlide.appendChild(homeNode);
    var childSlide = slideNode("child"), frame = document.createElement("iframe"); frame.className = "g-runs-child"; frame.setAttribute("sandbox", "allow-scripts"); childSlide.appendChild(frame);
    var noneSlide = slideNode("none"); noneSlide.appendChild(el("p", "g-runs-none", WORDS.none));
    stage.appendChild(progressSlide); stage.appendChild(homeSlide); stage.appendChild(childSlide); stage.appendChild(noneSlide);
    root.replaceChildren(bar, newer, stage, older);

    /* ── state ──────────────────────────────────────────────────────────── */
    /** @type {string} */
    var page = "";            // this page's id, once the host has answered
    /** @type {any[]} */
    var kids = [];            // the children shown, newest first
    /** @type {Record<string, string>} */
    var titles = {};          // id → the H1, or the name while it loads
    /** @type {Record<string, boolean>} */
    var asked = {};           // id → true once its title was asked for
    /** @type {string | null} */
    var shownKey = null;      // "progress" | "home" | a child id
    /** @type {any} */
    var embedHandle = null;
    /** @type {string | null} */
    var embedFor = null;
    var mounted = { home: false, progress: false };
    var gone = false;

    /** The slides in order: progress while its node is shown, home while its
     *  node is, then the children. The progress node starts hidden — it is
     *  the plugin's to show.
     *  @returns {{ key: string, slide: HTMLElement, child?: any }[]} */
    function slides() {
      /** @type {{ key: string, slide: HTMLElement, child?: any }[]} */
      var out = [];
      if (mounted.progress && !progressNode.hidden) out.push({ key: "progress", slide: progressSlide });
      if (mounted.home && !homeNode.hidden) out.push({ key: "home", slide: homeSlide });
      kids.forEach(function (k) { out.push({ key: k.id, slide: childSlide, child: k }); });
      return out;
    }
    /** @param {{ key: string }[]} list @param {string | null} key */
    function indexOf(list, key) { for (var i = 0; i < list.length; i += 1) { var one = list[i]; if (one && one.key === key) return i; } return -1; }
    /** @param {{ child?: any }[]} list */
    function firstChild(list) { for (var i = 0; i < list.length; i += 1) { var one = list[i]; if (one && one.child) return i; } return -1; }
    /** The key at `at`, the first key where `at` is out of range, null where
     *  there is nothing. @param {{ key: string }[]} list @param {number} at */
    function firstKey(list, at) { var one = at >= 0 && at < list.length ? list[at] : list[0]; return one ? one.key : null; }

    /* ── the shown one ──────────────────────────────────────────────────── */
    function closeEmbed() { if (embedHandle) { try { embedHandle.close(); } catch (e) { /* already gone */ } } embedHandle = null; embedFor = null; }
    /** @param {any} child */
    function embed(child) {
      if (embedFor === child.id) return;
      closeEmbed(); embedFor = child.id; frame.title = titles[child.id] || child.name;
      biom.embedInto(frame, child.id).then(function (/** @type {any} */ h) { if (gone || embedFor !== child.id) { try { h.close(); } catch (e) { /* */ } return; } embedHandle = h; })
        .catch(function (/** @type {any} */ e) { if (embedFor === child.id) console.error("[automations-runs] " + child.id + ": " + String(e && e.message || e)); });
    }
    /** @param {{ key: string, child?: any }[]} list @param {number} at */
    function drawBar(list, at) {
      var one = list[at];
      if (!one) { title.textContent = ""; nOf.textContent = ""; return; }
      if (one.child) {
        title.textContent = titles[one.child.id] || one.child.name;
        var n = at - firstChild(list) + 1;
        nOf.replaceChildren(el("b", "", String(n)), document.createTextNode(" " + WORDS.of + " " + kids.length));
      } else {
        var node = one.key === "home" ? homeNode : progressNode;
        title.textContent = node.getAttribute("data-title") || "";
        nOf.textContent = "";
      }
      newer.disabled = at <= 0; older.disabled = at >= list.length - 1;
    }
    /** @param {string | null} key @param {"newer" | "older" | null} dir */
    function show(key, dir) {
      var list = slides();
      var at = indexOf(list, key);
      if (at < 0) at = 0;
      var one = list.length > at ? list[at] : undefined;
      shownKey = one ? one.key : null;
      [progressSlide, homeSlide, childSlide, noneSlide].forEach(function (s) { s.removeAttribute("data-shown"); });
      if (!one) { noneSlide.setAttribute("data-shown", ""); closeEmbed(); drawBar(list, at); newer.disabled = true; older.disabled = true; return; }
      if (one.child) embed(one.child); else closeEmbed();
      one.slide.setAttribute("data-shown", "");
      if (dir) { stage.removeAttribute("data-arrive"); void stage.offsetWidth; stage.setAttribute("data-arrive", dir); } else stage.removeAttribute("data-arrive");
      drawBar(list, at);
    }
    /** @param {number} delta */
    function step(delta) {
      var list = slides(), at = indexOf(list, shownKey), to = at + delta;
      var next = list[to];
      if (at < 0 || !next) return;
      show(next.key, delta > 0 ? "older" : "newer");
    }
    newer.addEventListener("click", function () { step(-1); });
    older.addEventListener("click", function () { step(1); });
    document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = /** @type {any} */ (e.target); if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); } else if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    });

    /* ── the titles, and the projection ─────────────────────────────────── */
    function project() {
      biom.toMarkdown = function () {
        var lines = kids.map(function (/** @type {any} */ k) { return "- " + (titles[k.id] || k.name) + " — " + k.id; });
        return lines.length ? lines.join("\n") + "\n" : "";
      };
      try { document.dispatchEvent(new Event("biom:rendered")); } catch (e) { /* an old runtime */ }
    }
    /** @param {any} child */
    function askTitle(child) {
      if (asked[child.id]) return;
      asked[child.id] = true;
      biom.doc(child.id).then(function (/** @type {any} */ md) {
        var t = titleIn(md);
        if (t === null) return null;
        if (t.indexOf("{{") < 0) return t;
        return biom.variables(child.id).then(function (/** @type {any} */ vars) { return filled(t, vars); }, function () { return filled(t, {}); });
      }).then(function (/** @type {string | null} */ t) {
        if (gone) return;
        if (t) { titles[child.id] = t; if (shownKey === child.id) { var list = slides(); drawBar(list, indexOf(list, shownKey)); frame.title = t; } }
        project();
      }).catch(function (/** @type {any} */ e) { console.error("[automations-runs] the title of " + child.id + ": " + String(e && e.message || e)); });
    }

    /* ── the list ───────────────────────────────────────────────────────── */
    function load() {
      if (gone) return Promise.resolve();
      return biom.children().then(function (/** @type {any[]} */ all) {
        if (gone) return;
        var before = kids.length ? kids[0].id : null;
        var wasNewest = shownKey !== null && shownKey === before;
        kids = shown(all, (biom.plugin.extensions() || {}).skip);
        kids.forEach(function (/** @type {any} */ k) { if (!titles[k.id]) titles[k.id] = k.name; askTitle(k); });
        var list = slides();
        var key = shownKey;
        if (key === null) key = firstKey(list, -1);
        else if (wasNewest && kids.length && kids[0].id !== before) key = kids[0].id;
        else if (indexOf(list, key) < 0) key = firstKey(list, firstChild(list));
        show(key, null);
        project();
      }).catch(function (/** @type {any} */ e) { console.error("[automations-runs] children: " + String(e && e.message || e)); });
    }

    /* ── the two slides ahead ───────────────────────────────────────────── */
    /** ONE VARIABLE, ONE NODE, ONE PLUGIN. Empty names nothing and the slide
     *  is left out; a list where a name goes is said in the node; a name that
     *  is not an id, or that nothing registered, is the runtime's refusal in
     *  the same node, listing what is — and the slide shows those words,
     *  because nothing here is ever a blank. */
    /** @param {"home" | "progress"} key @param {HTMLElement} node */
    function place(key, node) {
      var held = biom.plugin.extensions();
      var value = held[key];
      if (value === undefined || value === null || value === "") return false;
      if (typeof value !== "string") { rt.sections.fail(node, key + " holds a " + (Array.isArray(value) ? "list" : typeof value) + " where a plugin name goes"); return true; }
      rt.page.mount(node, value.trim());
      if (node.hasAttribute("data-g-failed")) node.hidden = false;
      return true;
    }
    /** THE PROGRESS NODE'S `hidden` IS WATCHED: shown, it becomes the first
     *  slide and the page goes to it; hidden again, a reader who was on it
     *  lands on the newest child. The bar follows a `data-title` on either. */
    var watcher = new MutationObserver(function (records) {
      var hiddenMoved = false, titleMoved = false;
      records.forEach(function (r) { if (r.attributeName === "hidden") hiddenMoved = true; if (r.attributeName === "data-title") titleMoved = true; });
      if (hiddenMoved) {
        var list = slides();
        if (!progressNode.hidden && shownKey !== "progress" && mounted.progress) show("progress", "newer");
        else if (indexOf(list, shownKey) < 0) show(firstKey(list, firstChild(list)), "older");
        else show(shownKey, null);
      } else if (titleMoved) { var l = slides(); drawBar(l, indexOf(l, shownKey)); }
    });
    watcher.observe(progressNode, { attributes: true, attributeFilter: ["hidden", "data-title"] });
    watcher.observe(homeNode, { attributes: true, attributeFilter: ["hidden", "data-title"] });

    /* ── the sign ───────────────────────────────────────────────────────── */
    function signOf() {
      var parent = parentOf(page);
      sign.textContent = segmentOf(page);
      if (parent === null) return;
      biom.children(parent).then(function (/** @type {any[]} */ all) {
        var me = (all || []).filter(function (/** @type {any} */ c) { return c && c.id === page; })[0];
        if (me && me.name) sign.textContent = me.name;
      }).catch(function () { /* the segment stands */ });
    }

    /* ── go ─────────────────────────────────────────────────────────────── */
    var begun = false;
    function begin() {
      if (begun) return;
      begun = true;
      page = String(biom.page || "");
      signOf();
      mounted.progress = place("progress", progressNode);
      mounted.home = place("home", homeNode);
      void load();
      if (typeof biom.onRefresh === "function") biom.onRefresh(function () { void load(); });
    }
    if (rt.page && typeof rt.page.onDraw === "function") rt.page.onDraw(begin);
    else biom.ready.then(begin);
    window.addEventListener("pagehide", function () { gone = true; closeEmbed(); watcher.disconnect(); });
  }

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
  else main();
})();
