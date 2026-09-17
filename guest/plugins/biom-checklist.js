// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-checklist.js — A STATUS WORD READ OFF A LIST, AND THE VOCABULARY
 * IS THE PAGE'S.
 *
 * A list where some items are done is about the second most ordinary thing a
 * page does, and the word for "done" is never the same twice: built, shipped,
 * answered, paid, closed, departed. So this plugin holds no vocabulary of its
 * own — the node names the word, and everything else follows from it.
 *
 *     <span data-g-plugin="checklist" data-g-for="ideas" data-g-done="Built"></span>
 *
 * A STATUS IS A WORD AND NEVER A MARKER. The word lives in the document, on its
 * own last line of the item, so the markdown mirror and anything reading it say
 * exactly what the page draws. A tick appends the word; an untick trims it. That
 * is the whole of the model: this script keeps no state, re-renders no item, and
 * writes the list whole so the page redraws itself from what was stored.
 *
 * IT DOES ONE THING. It sets `data-status` on the item, inserts one `.dot`
 * switch, and draws the tally into its own node. Adding an item, deleting one
 * and numbering the list are `items` and `open-list`, and a section takes
 * whichever of the three it wants — a plugin that drew all of them would be
 * three plugins wearing one name.
 *
 * IT INKS NOTHING. What any of that LOOKS like is the section's, in the
 * section's own `<style>` — a plugin that set a colour would have set it for
 * every page in the workspace.
 *
 * ORDER IS THE ARRAY. Ticking splices the entry out and pushes it to the end;
 * unticking puts it back before the first still-done entry, so an item somebody
 * has just reopened lands at the foot of the live list where they would look for
 * it. Everything positional — a number, a seam above the done run — is CSS.
 */
(function () {
  "use strict";

  /** The shim owns `window.biom` and is inlined ahead of every plugin, so this is
   *  attaching to an object that is already there. It is reached through the
   *  global rather than by name because there are no imports in the box.
   *  @type {any} */
  var glob = /** @type {any} */ (globalThis);

  /** The words this node calls "done", lowercased for matching. The FIRST one is
   *  what a tick writes, in the case the node spelled it — a page that says
   *  `Built` gets `Built` in its document and not `built`. */
  /** @param {any} raw @returns {string[] | null} */
  function vocabulary(raw) {
    var words = String(raw || "").split(",").map(function (w) { return w.trim(); }).filter(Boolean);
    return words.length === 0 ? null : words;
  }

  glob.biom.plugins.register({
    id: "biom-checklist",

    /**
     * @param {Element} node the node this plugin fills
     * @param {any} content null — a `data-g-plugin` node has no stored content
     * @param {any} ctx the mount context; see `makeCtx` in sections.js
     */
    mount: function (node, content, ctx) {
      /* REFUSE IN WORDS, IN THIS NODE, AND DRAW NOTHING ELSE. A blank rectangle
         sends the next hour to the wrong file; a sentence naming the attribute
         that is missing is read and acted on. The rest of the page is untouched
         either way — a plugin fills one node. */
      var slotName = ctx.options && ctx.options.for;
      var words = vocabulary(ctx.options && ctx.options.done);
      if (!slotName) {
        node.textContent = "checklist: name one of this section's list slots in data-g-for";
        return;
      }
      if (words === null) {
        node.textContent = 'checklist: name the word an item wears when it is done, in data-g-done — "Built", "Shipped", "Paid"';
        return;
      }
      var slot = ctx.root ? ctx.root.querySelector('[data-g-part="' + slotName + '"]') : null;
      if (!slot) {
        node.textContent = 'checklist: this section has no slot called "' + slotName + '"';
        return;
      }

      /* The unit the tally counts in. It defaults to the word itself, which is
         the reading that is right more often than not: "3 / 8 built". */
      var unit = (ctx.options && ctx.options.unit) || String(words[0]).toLowerCase();
      var mark = String(words[0]);
      var any = words.map(escape).join("|");
      var DONE = new RegExp("\\n+\\s*(" + any + ")\\s*$", "i");
      var WORD = new RegExp("^(" + any + ")$", "i");

      /** @param {string} w */
      function escape(w) { return w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

      function items() {
        var held = ctx.read(slotName);
        if (Array.isArray(held)) return held.slice();
        // A LONE STRING IS PROMOTED, not dropped: one item written as a scalar is
        // a legal document, and answering `[]` would let the first tick lose it.
        return held ? [held] : [];
      }
      /** @param {string} md */
      function isDone(md) { return DONE.test(md); }
      /** @param {string} md */
      function strip(md) { return md.replace(DONE, "").replace(/\s+$/, ""); }

      /** @param {number} i */
      function tick(i) {
        var list = items();
        if (i < 0 || i >= list.length) return;
        var entry = list.splice(i, 1)[0];
        if (isDone(entry)) {
          var at = list.length;
          for (var k = 0; k < list.length; k++) { if (isDone(list[k])) { at = k; break; } }
          list.splice(at, 0, strip(entry));
        } else {
          list.push(strip(entry) + "\n\n" + mark);
        }
        ctx.write(slotName, list);
      }
      /** @param {string} cls @param {string} glyph @param {string} title @param {() => void} go */
      function control(cls, glyph, title, go) {
        var b = document.createElement("button");
        b.className = cls;
        b.type = "button";
        b.title = title;
        b.setAttribute("aria-label", title);
        if (glyph) b.textContent = glyph;
        /* The press is refused and the click acted on: a press blurs an open
           editor, the blur redraws the item, and the redraw would destroy this
           button before the click arrived. The click stops here because a click
           inside an item opens its words. */
        b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        b.addEventListener("click", function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          go();
        });
        return b;
      }

      /** @param {Element} holder */
      function at(holder) { return Number(holder.getAttribute("data-g-item")); }

      /* DRESS FROM WHAT IS ON SCREEN. An item is redrawn whenever its words
         change and takes its controls with it, so this runs again off the DOM
         rather than off anything remembered. */
      function dress() {
        var holders = slot.querySelectorAll(":scope > [data-g-item]");
        var done = 0;
        Array.prototype.forEach.call(holders, function (holder) {
          var last = holder.querySelector(":scope > p:last-of-type");
          var word = last && WORD.test(last.textContent.trim()) ? last.textContent.trim().toLowerCase() : null;
          /* THE WORD ITSELF, lowercased, so a list with two vocabularies can be
             styled per word — `[data-status="shipped"]` and
             `[data-status="paid"]` are different rules on the same list. */
          if (word !== null) { holder.setAttribute("data-status", word); done++; }
          else holder.removeAttribute("data-status");

          /* ONE CONTROL AND NOTHING ELSE. Adding an item, deleting one and
             numbering the list are `items` and `open-list`; a plugin that drew
             all three would be three plugins wearing one name, and a section
             that wanted the status without the delete could not have it. */
          var dot = holder.querySelector(":scope > .dot");
          if (!dot) {
            dot = control("dot", "", "", function () { tick(at(holder)); });
            dot.setAttribute("role", "switch");
            holder.insertBefore(dot, holder.firstChild);
          }
          dot.setAttribute("aria-checked", String(word !== null));
          dot.title = word !== null ? "Mark as not " + unit : "Mark as " + unit;
          dot.setAttribute("aria-label", dot.title);
        });

        node.textContent = "";
        var n = document.createElement("b");
        n.textContent = String(done);
        var rest = document.createElement("span");
        rest.textContent = " / " + holders.length + " " + unit;
        node.appendChild(n);
        node.appendChild(rest);
      }

      var watch = new MutationObserver(function (records) {
        /* Guarded against its own work: a record whose only change is a control
           this plugin inserted is not a redraw. */
        var real = records.some(function (r) {
          return Array.prototype.some.call(r.addedNodes, function (x) {
            return !(x.nodeType === 1 && x.classList && (x.classList.contains("dot") || x.classList.contains("ord") || x.classList.contains("bar")));
          }) || r.removedNodes.length > 0;
        });
        if (real) dress();
      });
      watch.observe(slot, { childList: true, subtree: true });
      dress();
      return function () { watch.disconnect(); };
    },
  });
})();
