// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-items.js — ADD AND REMOVE ON A LIST SLOT, AND NOTHING ELSE.
 *
 * A list a reader can add to is the most ordinary thing a page does, and the
 * code for it has no design content in it at all: read the array, splice it,
 * write it whole, and put the controls back after a redraw. In the workspace
 * this was measured in, 88 section files carried that code — in ELEVEN
 * different shapes, differing in the teardown, the empty-list case and the
 * observer. Eleven shapes of a thing with one correct answer is what a plugin
 * is for.
 *
 *     <span data-g-plugin="items" data-g-for="steps"></span>
 *
 * The node is where the ADD control is drawn, so a section decides where that
 * sits by putting the node there. The per-item delete goes into each item.
 *
 * IT INKS NOTHING. `.add`, `.bar` and `.btn` are the class names — the same ones
 * `base/list/` styles — and every rule about them is the section's. A plugin
 * that set a colour would have set it for every page in the workspace.
 *
 * IT DOES NOT NUMBER. Numbering is `open-list`, which composes on this one; a
 * harness that numbered would be a harness with an opinion about what a list is.
 *
 * WHAT IT DELIBERATELY DOES NOT DRAW IS REORDERING. Nothing is drawn over a
 * page, so there is no grip and no drag. A move is the same splice through the
 * same door, and a list that wants one adds the control in its own section.
 */
(function () {
  "use strict";

  /** The shim owns `window.biom` and is inlined ahead of every plugin, so this is
   *  attaching to an object that is already there. It is reached through the
   *  global rather than by name because there are no imports in the box.
   *  @type {any} */
  var glob = /** @type {any} */ (globalThis);

  /** The one shape both this plugin and `open-list` need, exported through the
   *  registry rather than through an import, because there are none in the box. */
  glob.biom.plugins.register({
    id: "biom-items",

    /**
     * @param {Element} node the node this plugin fills
     * @param {any} content null — a `data-g-plugin` node has no stored content
     * @param {any} ctx the mount context; see `makeCtx` in sections.js
     */
    mount: function (node, content, ctx) {
      var slotName = ctx.options && ctx.options.for;
      if (!slotName) {
        node.textContent = "items: name one of this section's list slots in data-g-for";
        return;
      }
      var slot = ctx.root ? ctx.root.querySelector('[data-g-part="' + slotName + '"]') : null;
      if (!slot) {
        node.textContent = 'items: this section has no slot called "' + slotName + '"';
        return;
      }

      var label = (ctx.options && ctx.options.add) || "＋ Another item";
      /* WHAT A NEW ITEM STARTS AS is the page's and not this plugin's: a list of
         questions, a list of steps and a list of people each open differently.
         `\n` in an attribute is two characters, so it is spelled and unspelled
         here rather than being impossible to write. */
      var blank = String((ctx.options && ctx.options.blank) || "### Another item\n\nWhat it is, in a sentence.")
        .replace(/\\n/g, "\n");

      function items() {
        var held = ctx.read(slotName);
        if (Array.isArray(held)) return held.slice();
        // A LONE STRING IS PROMOTED, not dropped. `parts: { steps: "### One" }`
        // is a legal document — somebody wrote one item and did not write it as a
        // list — and answering `[]` would make the first add overwrite it.
        return held ? [held] : [];
      }

      /** @param {string} cls @param {string} glyph @param {string} title @param {() => void} go */
      function control(cls, glyph, title, go) {
        var b = document.createElement("button");
        b.className = cls;
        b.type = "button";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.textContent = glyph;
        /* The mouse press is refused and the click acted on. Pressing inside an
           open editor blurs it, the blur redraws that item, and the redraw would
           destroy this button before the click reached it. Acting on `click` is
           also what lets Enter and Space reach these. */
        b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
        b.addEventListener("click", function (ev) {
          ev.preventDefault();
          // A click inside an item opens that item's markdown. These are
          // controls and not words, so the click stops here.
          ev.stopPropagation();
          go();
        });
        return b;
      }

      /** @param {Element} holder */
      function drop(holder) {
        /* THE BAR ASKS THE ELEMENT WHERE IT IS rather than holding an index this
           plugin would then have to keep in step. `data-g-item` is the runtime's
           own numbering and is right by construction. */
        var i = Number(holder.getAttribute("data-g-item"));
        var list = items();
        if (!(i >= 0) || i >= list.length) return;
        list.splice(i, 1);
        ctx.write(slotName, list);
      }

      var add = control("add", label, "Add an item", function () {
        ctx.write(slotName, items().concat([blank]));
      });
      node.replaceChildren(add);

      /* ONE BAR PER ITEM, PUT BACK WHENEVER IT IS GONE. The runtime draws the
         items; this only dresses them, and dressing an item that already has its
         bar does nothing — which is what makes it safe to run from an observer.
         It has to run again because an item is redrawn from its markdown
         whenever somebody finishes typing in it, and that takes everything
         inside it with it. */
      function dress() {
        var holders = slot.querySelectorAll(":scope > [data-g-item]");
        Array.prototype.forEach.call(holders, function (holder) {
          if (holder.querySelector(":scope > .bar") !== null) return;
          var bar = document.createElement("span");
          bar.className = "bar";
          bar.appendChild(control("btn", "✕", "Delete this item", function () { drop(holder); }));
          /* THE LAST ONE MAY GO TOO. An empty list is a real state: the slot is
             still there, `ctx.write` still reaches it, and add puts the first
             item back. No floor and no ceiling. */
          holder.appendChild(bar);
        });
      }

      var watch = new MutationObserver(function (records) {
        // Guarded against its own work: a record whose only addition is a bar
        // this plugin inserted is not a redraw, and reacting to it would loop.
        var real = records.some(function (r) {
          return Array.prototype.some.call(r.addedNodes, function (x) {
            return !(x.nodeType === 1 && x.classList && x.classList.contains("bar"));
          }) || r.removedNodes.length > 0;
        });
        if (real) dress();
      });
      watch.observe(slot, { childList: true, subtree: true });
      dress();

      // An observer outlives the nodes it was watching otherwise, and the page
      // gets measurably slower every time somebody edits it.
      return function () { watch.disconnect(); };
    },
  });
})();
