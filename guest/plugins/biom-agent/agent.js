// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-agent/agent.js — THE AGENT SCREEN'S MOUNT. A classic
 * script; see registry.js for why there are no imports in here.
 *
 * A PAGE THAT DRAWS ITSELF, and it draws one thing: the plugin its `look`
 * variable names, into `#g-agent`. `index.html` beside this file is the
 * document the server answers `@agent` with, and this script is in the
 * bundle every page in the vault carries: on any other page there is no
 * `#g-agent`, and it does nothing at all. It registers nothing — a registered
 * plugin fills a slot inside somebody else's page, and this IS the page.
 *
 * THE LOOK IS A VARIABLE, read through the three rungs like any plugin's:
 * `plugin.yaml` beside this file says `biom-agent-look`, the framework's own,
 * and a workspace names a plugin of its own in `plugins/biom-agent/extensions.yaml`
 * to replace the whole look without copying this document. It is mounted
 * through the runtime's `rt.page.mount` — the same context and containment a
 * section's `data-g-plugin` node gets, so a look that throws fails in this
 * node, in words, and a look the document names may carry a sheet of its own.
 *
 * A LOOK IT CANNOT MOUNT IS REFUSED IN WORDS, in this node: an empty
 * variable, a list where a name goes, a word that is not an id, and a name no
 * plugin registered each say so and say where the variable is written. The
 * Agent screen is never a blank box.
 *
 * WHAT THE LOOK IS HANDED, AND BY WHAT. The chats reach the box as the host's
 * `look.state` and `look.patch`, and the shim — which is the one listener on
 * the port — folds them and hands them on through `biom.onLook(fn)`. So a look
 * hears them there, whichever look it is; this mount decides only WHICH look,
 * and nothing it could add between the two would be anything but a second
 * copy of the shim's rule. The input box is not the look's and not this
 * document's: it is Biom's, drawn by the host over this box, so only the
 * person's typing ever reaches an agent. */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  /** The framework's own look, and where a workspace names another. */
  const OWN = "biom-agent-look";
  const WHERE = "plugins/biom-agent/extensions.yaml";
  const ID = /^[a-z][a-z0-9-]*$/;

  /** WHICH LOOK, or the sentence that says why none. Pure, so it is read
   *  outside a browser by `tests/agent-look.test.js`.
   *  @param {any} value the `look` variable as the rungs merged it
   *  @param {(id: string) => boolean} has whether a plugin is registered
   *  @returns {{ id: string } | { refused: string }} */
  function lookOf(value, has) {
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      return { refused: "The Agent screen's look is empty, so nothing draws it. Name a plugin as `look` in " + WHERE + ", or remove the line to draw the framework's own, " + OWN + "." };
    }
    if (typeof value !== "string") {
      return { refused: "The Agent screen's `look` holds a " + (Array.isArray(value) ? "list" : typeof value) + " where one plugin's name goes. Write one name in " + WHERE + "." };
    }
    const id = value.trim();
    if (!ID.test(id)) {
      return { refused: "The Agent screen's look is \"" + id + "\", which is not a plugin's name — lowercase letters, digits and dashes. Fix `look` in " + WHERE + "." };
    }
    if (!has(id)) {
      return { refused: "The Agent screen's look is \"" + id + "\", and no plugin by that name is registered in this workspace. Add plugins/" + id + "/, or name another as `look` in " + WHERE + " — " + OWN + " is the framework's own." };
    }
    return { id: id };
  }

  /* THE PURE HALF, on a global, so it can be verified outside a browser. */
  glob.__gAgentMount = { lookOf: lookOf, OWN: OWN };

  function main() {
    const found0 = document.getElementById("g-agent");
    if (!found0) return;
    /** @type {HTMLElement} */
    const node = found0;
    const rt = glob.__gRuntime || (glob.__gRuntime = {});
    const biom = glob.biom;
    let begun = false;
    function begin() {
      if (begun) return;
      begun = true;
      const values = biom && biom.plugin && typeof biom.plugin.extensions === "function" ? biom.plugin.extensions() : {};
      const has = (/** @type {string} */ id) => !!(rt.plugins && typeof rt.plugins.get === "function" && rt.plugins.get(id));
      const found = lookOf(values.look, has);
      if ("refused" in found) {
        if (rt.sections && typeof rt.sections.fail === "function") rt.sections.fail(node, found.refused);
        else { node.setAttribute("data-g-failed", ""); node.textContent = found.refused; }
        return;
      }
      rt.page.mount(node, found.id);
    }
    if (rt.page && typeof rt.page.onDraw === "function") rt.page.onDraw(begin);
    else if (biom && biom.ready) biom.ready.then(begin);
  }

  if (typeof document === "undefined") return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
  else main();
})();
