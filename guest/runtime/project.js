// SPDX-License-Identifier: AGPL-3.0-only
/* guest/runtime/project.js — the markdown a doc page renders to, inside the box.
 *
 * A HAND COPY OF `contracts/projection.ts`, and the copy is deliberate. Nothing
 * may import `guest/` and `guest/` imports nothing, so the box cannot share the
 * server's module — the same bargain `contracts/scale.ts` and `scale.js` already
 * make. `tests/guest.test.js` holds the two byte-equal below the header, so a
 * change to one that is not made to the other fails rather than drifts.
 *
 * WHY THE BOX COMPUTES IT AT ALL when the server can compute this one: because
 * the server can compute only this one. A page drawn by its own html, or by a
 * board, can be projected only by the code that drew it, and the projection has
 * to arrive by the same route for every kind of page or the archive is honest
 * about documents and guesswork about everything else.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);
  const rt = glob.__gRuntime || (glob.__gRuntime = {});

  const HOLE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

  /** Resolve `{{name}}` against one already-merged scope. The same three rules the
   *  box uses: a list joins with ", ", `null` reads as empty, an unknown name is
   *  returned untouched — a projection that swallowed an unresolved variable would
   *  read as a sentence with a hole in it rather than as a page needing a value. */
  /** @param {string} text @param {Record<string, any>} vars @returns {string} */
  function interpolate(text, vars) {
    if (typeof text !== "string" || text.indexOf("{{") < 0) return text;
    return text.replace(HOLE, (whole, name) => {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
      const v = vars[name];
      if (v === null || v === undefined) return "";
      if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? "" : String(x))).join(", ");
      return String(v);
    });
  }

  /** A child page as a link Obsidian resolves. The mirror is the vault root, so a
   *  page id IS the path — `[[home/clients/ashgrove|Ashgrove]]`. The alias is the
   *  page's own name, because an id is a slug and a name is what somebody wrote. */
  /** @param {any} child @returns {string} */
  const linkTo = (child) => `- [[${child.id}|${child.name}]]`;

  /** One part, projected. `null` where the part contributes nothing.
   *
   *  AN HTML PART CONTRIBUTES NOTHING, and that is the honest answer rather than a
   *  gap: its markup is the section's own drawing, its words are markdown parts
   *  beside it (R56 is exactly that rule), and stripping tags out of it would put
   *  a caption from an `<svg>` into the archive as a paragraph. A TABLE names
   *  itself and does not inline its rows: rows change without the page changing,
   *  so a projection holding them would be stale in a way the page is not. */
  /** @param {any} one @param {Record<string, any>} vars @returns {string | null} */
  function part(one, vars) {
    if (one.kind === "markdown") return interpolate(one.md, one.vars || vars).trim() || null;
    if (one.kind === "list") {
      const items = one.items.map((/** @type {any} */ item) => part(item, vars)).filter((/** @type {string | null} */ t) => t !== null);
      return items.length ? items.join("\n\n") : null;
    }
    if (one.kind === "table") return `*(table: ${one.table})*`;
    if (one.kind === "child") {
      return one.child.kind === "page" ? linkTo(one.child) : `*(table: ${one.child.id})*`;
    }
    return null;
  }

  /** One section, projected, or null where it says nothing. */
  /** @param {any} one @param {Record<string, any>} vars @returns {string | null} */
  function section(one, vars) {
    const parts = Object.values(one.parts || {})
      .map((/** @type {any} */ p) => part(p, vars))
      .filter((/** @type {string | null} */ t) => t !== null);
    return parts.length ? parts.join("\n\n") : null;
  }

  /** A section drawn for a child rather than written by anybody. Its name is host-
   *  derived (`@page-<segment>`), so it never becomes a heading — a run of them is
   *  a list of children and reads as one. */
  /** @param {any} one @returns {boolean} */
  const isChildSection = (one) => String(one.name).startsWith("@");

  /**
   * A doc page as Obsidian-flavoured markdown, body only — the frontmatter and the
   * `# Title` belong to whoever writes the file.
   *
   * A SECTION NEVER BECOMES A HEADING. Its name is a BLOCK ID — `note`, `diagram`,
   * `hero` — chosen so the runtime can address it and the editor can reorder it,
   * and a heading named after one is a heading nobody wrote. This used to emit
   * `## <name>` wherever a page had more than one section; what it produced was
   * `## note` above a page's real title, and, because the projection then no
   * longer opened with that title, it defeated the dedupe below and the file came
   * out with THREE headings. A page that wants a heading writes one, in its own
   * words, in a slot.
   *
   * Consecutive child sections run together as one list, since each contributes a
   * single bullet and a blank line between them would break the list into
   * one-item lists.
   *
   * A LEADING `# Title` THE PAGE ALREADY CARRIES IS DROPPED, because the file the
   * mirror writes opens with the page's name and every page seeded here starts its
   * first part with the same words. Two identical H1s is what a reader notices
   * first about a generated archive.
   */
  /** @param {any} page @returns {string} */
  function projectDoc(page) {
    const vars = page.variables || {};
    /** @type {string[]} */
    const out = [];
    const sections = page.sections || [];

    let inLinks = false;
    for (const one of sections) {
      const body = section(one, vars);
      if (body === null) continue;
      const links = isChildSection(one);
      if (links && inLinks) {
        // Two bullets of one list, so they are joined by a newline and not by the
        // blank line that separates every other pair of sections.
        out[out.length - 1] = `${out[out.length - 1]}\n${body}`;
        continue;
      }
      out.push(body);
      inLinks = links;
    }

    return dropTitle(out.join("\n\n").trim(), page.name);
  }

  /** Drop a first line that is exactly the page's own `# Title`. Anything else —
   *  a different H1, a heading with more in it — is the author's and stays. */
  /** @param {string} body @param {string} name @returns {string} */
  function dropTitle(body, name) {
    const first = body.slice(0, body.indexOf("\n") === -1 ? body.length : body.indexOf("\n"));
    if (first.trim() !== `# ${String(name).trim()}`) return body;
    return body.slice(first.length).replace(/^\s+/, "");
  }

  rt.project = { doc: projectDoc, interpolate: interpolate };
})();
