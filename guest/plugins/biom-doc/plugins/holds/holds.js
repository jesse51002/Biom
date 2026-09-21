// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-doc/plugins/holds/holds.js — THE BOARD OF CHILDREN, as a
 * plugin of its own inside the document's folder.
 *
 * Every page that holds pages gets a count, a sort control and a row per
 * child, read from `biom.children()`, with NO FILE WRITTEN FOR IT. That
 * replaced eighteen hand-written `row.html` files in the workspace it came
 * from, and the reason it belongs to the framework rather than to that
 * workspace is that a stranger's second page is a child of their first:
 * without this, the paved path is two files per folder page, written against
 * a design doc they have not read yet.
 *
 * IT USED TO BE HARD-WIRED INTO THE DOCUMENT, and that is what this folder
 * undoes. `biom-doc/index.html` draws a node before its stack and one after,
 * reads `head` and `foot` off its own variables, and mounts the plugin each
 * names; its `plugin.yaml` says `foot: biom-holds`, which is the one line that
 * puts this board under every document. So the board is named, not spliced:
 * a vault swaps it with `foot: my-board` in a rung, drops it with `foot:`
 * left empty, and dresses it with a plugin named at `head` — and, being an
 * ordinary plugin, a section may place it too: `<div data-g-plugin="biom-holds">`
 * draws the board where the section wants it, and the page's rung empties
 * `foot` so it is not drawn twice.
 *
 * THE LOOK IS NOT HERE, because a plugin inks nothing. `biom-doc/index.html`
 * carries it as a document stylesheet in `@layer biom.holds`, keyed on the
 * `.g-holds` root this draws, so the board looks the same wherever on a doc
 * page it is mounted and an unlayered rule from anywhere beats it by existing.
 * A workspace that wants the board dressed brings its look as a plugin
 * mounted at `head` that appends a `<style>`.
 *
 * `holds` AND `holdWords` are the parent's own line about each child, as two
 * parallel lists off the page's variables — a variable in this format is a
 * scalar or a list of scalars and never a map. `onRefresh` redraws it when a
 * child is added or removed, and the teardown lets go of everything it took.
 */
(function () {
  "use strict";

  /** The shim owns `window.biom` and is inlined ahead of every plugin, so this
   *  is reached as a global rather than by name because there are no imports
   *  in the box. @type {any} */
  var glob = /** @type {any} */ (globalThis);
  var biom = glob.biom;

  /* A leading `YYYY-MM-DD`, and the hour after it where a page carries one.
     This is the ONLY place a date can come from: `children()` hands over
     `{kind, id, name, rows}` and nothing else, so a folder whose pages are
     not named for a day cannot be sorted by one and does not offer to. */
  var DATED = /^(\d{4}-\d{2}-\d{2})(?:-(\d{2}))?[-_](.+)$/;

  /** @param {string} tag @param {string} cls @param {string} [text] */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** @param {any} child */
  function split(child) {
    var raw = String(child.name || child.id);
    var m = DATED.exec(raw);
    if (!m) return { key: "", stamp: "", name: raw.replace(/[-_]+/g, " ") };
    var day = m[1] || "", hour = m[2] || "", rest = m[3] || "";
    return {
      key: day + (hour || "00"),
      stamp: day + (hour ? " " + hour + "h" : ""),
      name: rest.replace(/[-_]+/g, " "),
    };
  }

  /* A CHILD IS A PAGE OR A TABLE, so the word has to be true of both when the
     list holds both. Saying "pages" over a list with a table in it is a small
     lie in the one place on the page that claims to be counting. */
  /** @param {any} child */
  function tag(child) {
    if (child.kind !== "table") return "page";
    if (typeof child.rows !== "number") return "table";
    return child.rows === 1 ? "table · 1 row" : "table · " + child.rows + " rows";
  }

  /* THE PARENT'S OWN LINES, AS TWO PARALLEL LISTS. `holds` names the child —
     its own last segment, which is the folder name on disk, so the line
     follows a rename — `holdWords` says the line, and a child named in neither
     simply has no line. A page with no `holds` is the ordinary case and is
     what every page starts as. */
  /** @param {any} vars */
  function linesFrom(vars) {
    var keys = Array.isArray(vars.holds) ? vars.holds : [];
    var words = Array.isArray(vars.holdWords) ? vars.holdWords : [];
    return function (/** @type {string} */ key) {
      var i = keys.indexOf(key);
      return i >= 0 && i < words.length ? String(words[i]).trim() : "";
    };
  }

  /* WHICH WAY A KEY WANTS TO READ. A folder of dated pages wants the newest
     first and a folder of names wants A to Z, so the direction is a property
     of the key rather than a setting that survives it. */
  /** @param {string} key */
  function facing(key) { return key === "date" ? -1 : 1; }

  /** @param {Element} node @param {any} content @param {any} ctx */
  function mount(node, content, ctx) {
    var holds = el("div", "g-holds");
    holds.hidden = true;
    var rail = el("div", "rail");
    var tallyWrap = el("span", "tally");
    var tally = el("b", "");
    var unit = el("span", "unit");
    tallyWrap.appendChild(tally);
    tallyWrap.appendChild(unit);
    var sort = el("span", "sort");
    sort.setAttribute("role", "group");
    sort.setAttribute("aria-label", "Sort");
    var byName = /** @type {HTMLButtonElement} */ (el("button", "", "Name"));
    byName.type = "button";
    byName.setAttribute("data-by", "name");
    var byDate = /** @type {HTMLButtonElement} */ (el("button", "", "Date"));
    byDate.type = "button";
    byDate.setAttribute("data-by", "date");
    byDate.hidden = true;
    var dirBtn = /** @type {HTMLButtonElement} */ (el("button", "", "↓"));
    dirBtn.type = "button";
    dirBtn.setAttribute("data-dir", "1");
    sort.appendChild(byName);
    sort.appendChild(byDate);
    sort.appendChild(dirBtn);
    rail.appendChild(tallyWrap);
    rail.appendChild(sort);
    var rows = el("div", "rows");
    holds.appendChild(rail);
    holds.appendChild(rows);
    node.textContent = "";
    node.appendChild(holds);

    var by = /** @type {string | null} */ (null);   /* "name" | "date" — null until the first read decides */
    var dir = 1;     /* 1 ascending, -1 descending */
    var seen = false;
    var gone = false;

    /* Switching key resets the direction to that key's own; pressing the same
       key again is not a switch and leaves the toggle where it was. Without
       this, going from newest-first dates to names left the names running Z
       to A, which reads as a broken sort rather than a remembered one. */
    /** @param {string} key */
    function sortBy(key) {
      if (by !== key) dir = facing(key);
      by = key;
    }

    /** @param {any[]} kids @param {(key: string) => string} blurbs */
    function draw(kids, blurbs) {
      var dated = kids.length > 0 && kids.every(function (c) { return split(c).key !== ""; });
      byDate.hidden = !dated;

      /* THE DEFAULT IS READ OFF THE CHILDREN, not declared by the page. */
      if (by === null) sortBy(dated ? "date" : "name");
      if (by === "date" && !dated) sortBy("name");

      byName.setAttribute("aria-pressed", String(by === "name"));
      byDate.setAttribute("aria-pressed", String(by === "date"));
      dirBtn.textContent = dir === 1 ? "↓" : "↑";
      dirBtn.setAttribute("aria-label", dir === 1 ? "Ascending" : "Descending");

      var list = kids.map(function (c) { return { child: c, bits: split(c) }; });
      list.sort(function (a, b) {
        var x = by === "date" ? a.bits.key : a.bits.name.toLowerCase();
        var y = by === "date" ? b.bits.key : b.bits.name.toLowerCase();
        return x < y ? -dir : x > y ? dir : 0;
      });

      tally.textContent = String(list.length);
      var pages = kids.every(function (c) { return c.kind === "page"; });
      unit.textContent = pages
        ? (list.length === 1 ? "page" : "pages")
        : (list.length === 1 ? "item" : "items");

      rows.textContent = "";
      list.forEach(function (entry, i) {
        var child = entry.child, bits = entry.bits;
        var row = el("div", "row");
        row.style.setProperty("--i", String(i));
        /* One control per row and never a control inside it — that is two tab
           stops for one row and a screen reader announcing it twice. */
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");

        row.append(el("span", "ord", String(i + 1).padStart(2, "0")));
        row.append(el("span", "name", bits.name));
        row.append(el("span", "stamp", bits.stamp));
        row.append(el("span", "kind", tag(child)));
        /* The parent's own line about THIS child, keyed by the child's last
           segment, which is the name the folder on disk already has. */
        var key = child.kind === "page" ? child.id.slice(child.id.lastIndexOf("/") + 1) : child.id;
        row.append(el("span", "blurb", blurbs(key)));

        function open() { biom.open(child); }
        row.addEventListener("click", open);
        row.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          open();
        });
        rows.append(row);
      });

      holds.hidden = list.length === 0;
    }

    function paint() {
      return Promise.all([biom.children(), biom.data()]).then(function (answer) {
        if (gone) return;
        var kids = Array.isArray(answer[0]) ? answer[0] : [];
        var vars = answer[1] && typeof answer[1] === "object" ? answer[1] : {};
        draw(kids, linesFrom(vars));
      }).catch(function (e) {
        /* A page whose children could not be read still has a document on
           screen. Say so where a developer will see it and draw nothing — an
           empty board under a page that has children is a lie, and a broken
           one under a page that has none is noise. */
        console.error("[biom] this page's children could not be read", e);
        holds.hidden = true;
      });
    }

    byName.addEventListener("click", function () { sortBy("name"); void paint(); });
    byDate.addEventListener("click", function () { sortBy("date"); void paint(); });
    dirBtn.addEventListener("click", function () { dir = -dir; void paint(); });

    /* `onRefresh` fires when a child is added to or removed from this page,
       among other things, so the board is right without anybody reloading. */
    var off = typeof biom.onRefresh === "function" ? biom.onRefresh(function () { void paint(); }) : null;
    void paint();

    /* ONE PASS, ON FIRST SIGHT, AND THEN IT RESTS. */
    var io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (!e.isIntersecting || seen) return;
            seen = true;
            holds.classList.add("is-seen");
            io && io.disconnect();
          });
        }, { root: null, threshold: 0.05 })
      : null;
    if (io) io.observe(holds);

    ctx.onTeardown(function () {
      gone = true;
      if (typeof off === "function") off();
      if (io) io.disconnect();
    });
  }

  biom.plugins.register({ id: "biom-holds", mount: mount });
})();
