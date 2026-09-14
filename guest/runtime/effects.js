// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/effects.js — the bookkeeping that makes scroll effects survive
 * an edit. A classic script sharing globals; see registry.js for why there are
 * no imports in here.
 *
 * THE EFFECTS THEMSELVES ARE NOT IMPLEMENTED HERE, AND THAT IS THE POINT. One
 * box, one document, one scroller: the box takes the whole canvas and scrolls
 * inside itself, so it IS the viewport. `animation-timeline: scroll()` finds a
 * scroller, `view()` has a view, `position: sticky` sticks, `100vh` means the
 * box, `position: fixed` pins to it and an `IntersectionObserver` with a null
 * root gets the right root. Every one of those works natively and none of them
 * needs a line of JavaScript from us. If the box measured itself and the HOST
 * page scrolled instead, the scroll container would be OUTSIDE the box and all
 * six would break at once — which is why `GuestNotice` has no `size`.
 *
 * What does need us is the bookkeeping either side of a redraw.
 *
 * TEARDOWN. A section's script may open an `IntersectionObserver`, a
 * `ResizeObserver`, a `setInterval` or an event listener on the document. When
 * that section is redrawn or removed its NODES go away and the observers do
 * not: they hold references to detached elements, keep firing, and the page
 * gets measurably slower every time somebody edits it. So every `onTeardown`
 * a section registered runs before its element is replaced, and the failure
 * this prevents is a page that is fast in a demo and slow after ten minutes of
 * use.
 *
 * REORDER. Moving a section moves its element; the section's own script is
 * still bound to that element and to nothing else, so it is left alone. A
 * PAGE-SCOPED script — `<script data-g-scope="page">` — is the opposite case:
 * it measured or observed the whole stack, and after a reorder its picture of
 * the page is wrong. So exactly those are torn down and re-run, in the stack's
 * new order. Re-running everything would be wasteful and visibly janky, because
 * every section-local effect would restart mid-scroll; re-running nothing is
 * quietly broken, which is worse.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  /** Bucket key → the teardowns registered against it. A section's own bucket
   *  is its name; a page-scoped script gets `<name>::script<i>`, so disposing a
   *  section disposes the scripts it declared without a second index to keep in
   *  step. @type {Map<string, (() => void)[]>} */
  const buckets = new Map();

  /** Section name → how to re-run each of its page-scoped scripts, in the order
   *  the section declared them. @type {Map<string, {key: string, run: () => void}[]>} */
  const pageScripts = new Map();

  /** @param {string} message */
  function say(message) {
    if (typeof rt.report === "function") rt.report(message);
    else console.error("[biom] " + message);
  }

  /** Run one teardown without letting it take the others with it. A teardown
   *  that throws is a bug in one plugin; a redraw that stops halfway because of
   *  it leaves every later section mounted twice.
   *  @param {() => void} fn */
  function safely(fn) {
    try {
      fn();
    } catch (e) {
      say("a teardown threw: " + String((e && /** @type {Error} */ (e).message) || e));
    }
  }

  const effects = {
    /** @param {string} key @param {() => void} fn */
    onTeardown(key, fn) {
      if (typeof fn !== "function") return;
      const held = buckets.get(key);
      if (held) held.push(fn);
      else buckets.set(key, [fn]);
    },

    /** Run and forget everything a section registered — its own teardowns and
     *  those of every page-scoped script it declared. Called before the section
     *  is redrawn or removed, and idempotent, so a caller that is not sure
     *  whether a section was ever drawn may call it anyway.
     *  @param {string} section */
    dispose(section) {
      const prefix = section + "::";
      for (const key of [...buckets.keys()]) {
        if (key !== section && !key.startsWith(prefix)) continue;
        const held = buckets.get(key) || [];
        buckets.delete(key);
        // Last registered, first torn down. An effect built on top of another
        // has to come down before the thing it was built on, exactly as it went
        // up in the other order.
        for (let i = held.length - 1; i >= 0; i--) {
          const fn = held[i];
          if (fn) safely(fn);
        }
      }
      pageScripts.delete(section);
    },

    /** Every bucket, for a whole-page redraw and for the box going away. */
    disposeAll() {
      for (const key of [...buckets.keys()]) {
        const held = buckets.get(key) || [];
        buckets.delete(key);
        for (let i = held.length - 1; i >= 0; i--) {
          const fn = held[i];
          if (fn) safely(fn);
        }
      }
      pageScripts.clear();
    },

    /** Remember a page-scoped script so a reorder can put it back. `run` is
     *  expected to re-create and re-append a fresh script node — a script
     *  element that has already executed will not execute again if it is merely
     *  moved, which is a browser rule and not a preference.
     *  @param {string} section @param {string} key @param {() => void} run */
    remember(section, key, run) {
      const held = pageScripts.get(section);
      if (held) held.push({ key: key, run: run });
      else pageScripts.set(section, [{ key: key, run: run }]);
    },

    /** Re-run every page-scoped script, in the order the sections are in NOW.
     *  The order is read from the DOM rather than from the order they were
     *  remembered in, because the whole reason to replay is that the stack
     *  moved and a script that walks it must see it as it is.
     *  @param {Element} root the page root, whose children are the sections */
    replay(root) {
      /** @type {{key: string, run: () => void}[]} */
      const ordered = [];
      for (const el of Array.from(root.children)) {
        const name = el.getAttribute("data-g-section");
        if (!name) continue;
        for (const rec of pageScripts.get(name) || []) ordered.push(rec);
      }
      // Torn down first, all of them, and only then re-run. Interleaving would
      // let an early script observe a page half of whose effects had already
      // been rebuilt, which is a state that never occurs on a fresh draw.
      for (const rec of ordered) {
        const held = buckets.get(rec.key) || [];
        buckets.delete(rec.key);
        for (let i = held.length - 1; i >= 0; i--) {
          const fn = held[i];
          if (fn) safely(fn);
        }
      }
      for (const rec of ordered) rec.run();
    },

    /** How many teardowns are outstanding, by bucket. Nothing draws from this;
     *  it is here because "observers outlive their nodes" is invisible until
     *  something can be asked, and a number that only ever grows is the symptom.
     *  @returns {Record<string, number>} */
    outstanding() {
      /** @type {Record<string, number>} */
      const out = {};
      for (const [key, held] of buckets) out[key] = held.length;
      return out;
    },
  };

  rt.effects = effects;
})();
