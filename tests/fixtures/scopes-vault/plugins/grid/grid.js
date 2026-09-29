// SPDX-License-Identifier: AGPL-3.0-only
// INVENTED FOR THE FOURTEENTH CONTRACTS EDIT'S EQUIVALENCE SUITE. A workspace's
// own plugin for the `grid` part kind, which a folder at the top of `plugins/`
// may reserve: it writes onto the slot what the runtime handed it — the scope
// in `ctx.vars` and the part's `vars` in `content` — and then draws the grid
// with the framework's own plugin, handing it the same content. `biom-grid`
// reads `content.vars` before `ctx.vars`, so what arrives in `content` is what
// fills `{{rate}}` in a cell, and a workspace plugin of anybody's may read it
// the same way.
(function () {
  "use strict";
  var glob = /** @type {any} */ (globalThis);

  /** @param {any} v @returns {string} */
  function stable(v) {
    if (v === undefined) return "undefined";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    return "{" + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(v[k]); }).join(",") + "}";
  }

  glob.biom.plugins.register({
    id: "grid",
    /** @param {Element} node @param {any} content @param {any} ctx */
    mount: function (node, content, ctx) {
      node.setAttribute("data-scope-ctx", stable(ctx.vars));
      node.setAttribute("data-scope-content", stable(content && content.vars));
      return ctx.use("biom-grid").mount(node, content);
    },
  });
})();
