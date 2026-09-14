// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/open-list.js — A NUMBERED LIST WHERE NOTHING HOLDS.
 *
 * Every workspace has a page with open questions on it, and a list where every
 * entry is equally open is a different thing from a checklist: there is no
 * status to read, nothing to light, and the only mark is the number.
 *
 *     <span data-g-plugin="open-list" data-g-for="questions"></span>
 *
 * IT IS `items` PLUS A PLACE TO PUT THE NUMBER, and it says so by composing on
 * it rather than copying it — `ctx.use("items")` is the whole of composition in
 * here, because there are no imports in the box. So add and delete behave
 * identically to every other list in the workspace, and the only thing this file
 * adds is one `<span class="ord">` at the head of each item.
 *
 * THE NUMBER IS A CSS COUNTER AND THIS PLUGIN NEVER WRITES ONE. That is the
 * point: a counter renumbers itself on an add, a delete or a move, while a
 * number written into the DOM is right until the moment the list changes and
 * then quietly is not. The section says it in one rule —
 *
 *     [data-g-part="questions"] { counter-reset: q; }
 *     [data-g-part="questions"] > * { counter-increment: q; }
 *     [data-g-part="questions"] .ord::before { content: counter(q, decimal-leading-zero); }
 *
 * — and the mark is the section's from there: a number, an open square, a dash.
 * `base/open-list/` is the worked copy of exactly that.
 *
 * IT INKS NOTHING, and it holds no status vocabulary at all. A list where some
 * entries are done is `checklist`, which reads its word off the node.
 */
(function () {
  "use strict";

  /** The shim owns `window.biom` and is inlined ahead of every plugin, so this is
   *  attaching to an object that is already there. It is reached through the
   *  global rather than by name because there are no imports in the box.
   *  @type {any} */
  var glob = /** @type {any} */ (globalThis);

  glob.biom.plugins.register({
    id: "open-list",

    /**
     * @param {Element} node the node this plugin fills
     * @param {any} content null — a `data-g-plugin` node has no stored content
     * @param {any} ctx the mount context; see `makeCtx` in sections.js
     */
    mount: function (node, content, ctx) {
      var slotName = ctx.options && ctx.options.for;
      if (!slotName) {
        node.textContent = "open-list: name one of this section's list slots in data-g-for";
        return;
      }
      var slot = ctx.root ? ctx.root.querySelector('[data-g-part="' + slotName + '"]') : null;
      if (!slot) {
        node.textContent = 'open-list: this section has no slot called "' + slotName + '"';
        return;
      }
      /* `use` THROWS on a name nothing registered, and that is right: a plugin
         composing on a plugin that is not there is a bug its author has to see,
         where a silent null would draw a list with no controls and read as
         missing data. It cannot happen in a seeded vault — both files are in
         `plugins/` — and it can happen in a vault somebody has emptied. */
      if (!ctx.has("items")) {
        node.textContent = "open-list: this workspace has no items plugin — plugins/items.js is missing";
        return;
      }
      /* THE OPTIONS ARE PASSED EXPLICITLY, because `use` builds the mounted
         plugin a context of its OWN and its options default to empty — there is
         no node with `data-g-*` on it to read them off when one plugin mounts
         another. Handing this node's own options over is what makes
         `data-g-for` and `data-g-add` reach the harness. */
      var off = ctx.use("items").mount(node, content, ctx.options);

      /* ONE ORDINAL PER ITEM, PUT BACK WHENEVER IT IS GONE, for the same reason
         the bar is: an item is redrawn from its markdown whenever somebody
         finishes typing in it. It is empty and `aria-hidden`, because the number
         is decoration a counter draws and a screen reader already announces a
         list item's position. */
      function dress() {
        var holders = slot.querySelectorAll(":scope > [data-g-item]");
        Array.prototype.forEach.call(holders, function (holder) {
          if (holder.querySelector(":scope > .ord") !== null) return;
          var ord = document.createElement("span");
          ord.className = "ord";
          ord.setAttribute("aria-hidden", "true");
          holder.insertBefore(ord, holder.firstChild);
        });
      }

      var watch = new MutationObserver(function (records) {
        var real = records.some(function (r) {
          return Array.prototype.some.call(r.addedNodes, function (x) {
            return !(x.nodeType === 1 && x.classList && (x.classList.contains("ord") || x.classList.contains("bar")));
          }) || r.removedNodes.length > 0;
        });
        if (real) dress();
      });
      watch.observe(slot, { childList: true, subtree: true });
      dress();

      return function () {
        watch.disconnect();
        if (typeof off === "function") off();
      };
    },
  });
})();
