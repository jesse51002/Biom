// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/reveal.js — PLAY ONCE, THEN REST.
 *
 * An `IntersectionObserver` that puts one class on the section the first time it
 * comes into view and disconnects. Five lines, written slightly differently in
 * 89 section files in the workspace this was measured in, and the two ways it
 * goes wrong are both invisible until somebody notices the page is tired:
 *
 *   · AN OBSERVER THAT NEVER DISCONNECTS keeps firing for as long as the page is
 *     open, and — worse — outlives the section when it is redrawn, holding a
 *     detached element alive. The page gets measurably slower every time
 *     somebody edits it.
 *   · AN ANIMATION THAT STARTS AT LOAD plays the whole choreography below the
 *     fold, so a reader who scrolls down arrives after it has finished and sees
 *     a figure that never moved.
 *
 *     <span data-g-plugin="reveal"></span>
 *     <span data-g-plugin="reveal" data-g-on=".board" data-g-class="is-seen"></span>
 *
 * IT INKS NOTHING AND ANIMATES NOTHING. It adds a class and that is all; what
 * happens under that class is the section's own `<style>`, which is where the
 * motion belongs and where `--motion` — the frame's reduced-motion switch — is
 * already waiting to be multiplied into a duration.
 *
 * THE BOX IS ITS OWN VIEWPORT, which is why `root: null` is right here: one
 * iframe fills the canvas and scrolls inside itself, so the frame's own viewport
 * IS the scroller a reader is looking through.
 */
(function () {
  "use strict";

  /** The shim owns `window.biom` and is inlined ahead of every plugin, so this is
   *  attaching to an object that is already there. It is reached through the
   *  global rather than by name because there are no imports in the box.
   *  @type {any} */
  var glob = /** @type {any} */ (globalThis);

  glob.biom.plugins.register({
    id: "reveal",

    /**
     * @param {Element} node the node this plugin fills
     * @param {any} content null — a `data-g-plugin` node has no stored content
     * @param {any} ctx the mount context; see `makeCtx` in sections.js
     */
    mount: function (node, content, ctx) {
      /* IT DRAWS NOTHING INTO ITS OWN NODE, so a section can place the node
         anywhere without leaving a gap — including inside a wrap it is about. */
      node.textContent = "";

      var root = ctx.root || null;
      if (!root) {
        node.textContent = "reveal: there is no section here to watch";
        return;
      }

      /* WHAT GETS THE CLASS. The section itself by default, because that is what
         a figure's motion is usually written against; a selector where the
         section wants it narrower. Refused in words rather than silently doing
         nothing, because a typo'd selector is exactly the case that looks like a
         broken plugin. */
      var pick = ctx.options && ctx.options.on;
      var target = root;
      if (pick) {
        target = root.querySelector(String(pick));
        if (!target) {
          node.textContent = 'reveal: nothing in this section matches "' + pick + '"';
          return;
        }
      }

      var mark = (ctx.options && ctx.options.class) || "is-seen";
      var threshold = Number(ctx.options && ctx.options.threshold);
      if (!(threshold >= 0 && threshold <= 1)) threshold = 0.05;

      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var seen = entries[i];
          if (!seen || !seen.isIntersecting) continue;
          target.classList.add(mark);
          // ONCE. Disconnecting here is the whole difference between a figure
          // that plays and a page that is watching forever.
          io.disconnect();
          return;
        }
      }, { root: null, threshold: threshold });
      io.observe(target);

      return function () { io.disconnect(); };
    },
  });
})();
