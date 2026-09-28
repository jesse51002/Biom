// SPDX-License-Identifier: AGPL-3.0-only
// INVENTED FOR THE FOURTEENTH CONTRACTS EDIT'S EQUIVALENCE SUITE. A plugin that
// draws nothing and writes onto its own node what the runtime handed it: the
// scope in `ctx.vars` and the content, which a `data-g-plugin` node is handed
// as null. The drawn-DOM golden reads these two attributes, so a change to
// what a plugin is given is a change to the golden, visible in words.
(function () {
  "use strict";
  var glob = /** @type {any} */ (globalThis);

  /** Keys sorted at every depth, so the attribute is one spelling of one value.
   *  @param {any} v @returns {string} */
  function stable(v) {
    if (v === undefined) return "undefined";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }

  glob.biom.plugins.register({
    id: "recorder",
    /** @param {Element} node @param {any} content @param {any} ctx */
    mount: function (node, content, ctx) {
      node.setAttribute("data-scope-ctx", stable(ctx.vars));
      node.setAttribute("data-scope-content", stable(content));
    },
  });
})();
