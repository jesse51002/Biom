// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-inview.js — PLAY WHILE IN VIEW, REST WHILE NOT.
 *
 * The twin of `reveal`. Where `reveal` puts one class on a section the first
 * time it is seen and disconnects, this keeps watching and keeps the class
 * honest: on while the section is intersecting, off while it is not. A scene
 * that loops pauses its cycle under the off state, so a page of nine loops
 * costs the machine only the ones a reader is actually looking at, and a
 * reader who scrolls back sees the loop pick up rather than a figure that has
 * been spinning unseen.
 *
 *     <span data-g-plugin="inview"></span>
 *     <span data-g-plugin="inview" data-g-on=".plate" data-g-class="in-view" data-g-threshold="0.2"></span>
 *
 * IT INKS NOTHING AND ANIMATES NOTHING. It adds and removes a class; what pauses
 * under it is the section's own `<style>`:
 *
 *     .run { animation-play-state: paused; }
 *     :scope.in-view .run { animation-play-state: running; }
 *
 * IT DISCONNECTS ON TEARDOWN, which is the one thing an observer written by hand
 * in a section forgets, and the reason this is a plugin.
 */
(function () {
  "use strict";

  /** @type {any} */
  var glob = /** @type {any} */ (globalThis);

  glob.biom.plugins.register({
    id: "biom-inview",

    /**
     * @param {Element} node the node this plugin fills
     * @param {any} content null — a `data-g-plugin` node has no stored content
     * @param {any} ctx the mount context
     */
    mount: function (node, content, ctx) {
      node.textContent = "";

      var root = ctx.root || null;
      if (!root) {
        node.textContent = "inview: there is no section here to watch";
        return;
      }

      var pick = ctx.options && ctx.options.on;
      var target = root;
      if (pick) {
        target = root.querySelector(String(pick));
        if (!target) {
          node.textContent = 'inview: nothing in this section matches "' + pick + '"';
          return;
        }
      }

      var mark = (ctx.options && ctx.options.class) || "in-view";
      var threshold = Number(ctx.options && ctx.options.threshold);
      if (!(threshold >= 0 && threshold <= 1)) threshold = 0.1;

      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e) continue;
          if (e.isIntersecting) target.classList.add(mark);
          else target.classList.remove(mark);
        }
      }, { root: null, threshold: threshold });
      io.observe(target);

      return function () { io.disconnect(); target.classList.remove(mark); };
    },
  });
})();
