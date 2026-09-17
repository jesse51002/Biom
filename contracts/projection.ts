// SPDX-License-Identifier: AGPL-3.0-only
// The markdown a doc page renders to. Layer 0: pure, no I/O, no DOM.
//
// EVERY PAGE RENDERS ITSELF AS MARKDOWN, and the projection is derived rather
// than stored — the workspace's Architecture page requires it, because a `.md`
// kept beside a page drifts the moment anything on that page reads a live table.
// It is one-way: nothing is ever authored by editing the projection.
//
// WHO COMPUTES IT IS THE PAGE, and this file is the one page kind whose input is
// pure data. A doc page is `contents` in `content.yaml` and nothing else, so it
// can be projected without running anything — which is what lets the local
// process rebuild a whole vault's mirror on mount and lets the migration tool
// write a first projection for a page nobody has opened. An html page and a
// kanban page can only be projected by the code drawing them, so they report
// theirs from inside the box.
//
// THE RULE LIVES TWICE, and that is deliberate rather than sloppy: `guest/` may
// not be imported and may not import, so the box carries a hand copy in
// `guest/runtime/project.js` and a test holds the two byte-equal. It is the same
// bargain `contracts/scale.ts` and `guest/runtime/scale.js` already make.

import type { Child, DrawnSection, Page, Part, Variables } from "./types.ts";

const HOLE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/** Resolve `{{name}}` against one already-merged scope. The same three rules the
 *  box uses: a list joins with ", ", `null` reads as empty, an unknown name is
 *  returned untouched — a projection that swallowed an unresolved variable would
 *  read as a sentence with a hole in it rather than as a page needing a value. */
export function interpolate(text: string, vars: Variables): string {
  if (typeof text !== "string" || text.indexOf("{{") < 0) return text;
  return text.replace(HOLE, (whole: string, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole;
    const v = (vars as Record<string, unknown>)[name];
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? "" : String(x))).join(", ");
    return String(v);
  });
}

/** A child page as a link Obsidian resolves. The mirror is the vault root, so a
 *  page id IS the path — `[[home/clients/ashgrove|Ashgrove]]`. The alias is the
 *  page's own name, because an id is a slug and a name is what somebody wrote. */
const linkTo = (child: Child): string => `- [[${child.id}|${child.name}]]`;

/** One part, projected. `null` where the part contributes nothing.
 *
 *  AN HTML PART CONTRIBUTES NOTHING, and that is the honest answer rather than a
 *  gap: its markup is the section's own drawing, its words are markdown parts
 *  beside it (R56 is exactly that rule), and stripping tags out of it would put
 *  a caption from an `<svg>` into the archive as a paragraph. A TABLE names
 *  itself and does not inline its rows: rows change without the page changing,
 *  so a projection holding them would be stale in a way the page is not. */
function part(one: Part, vars: Variables): string | null {
  if (one.kind === "markdown") return interpolate(one.md, one.vars || vars).trim() || null;
  if (one.kind === "list") {
    const items = one.items.map((item) => part(item, vars)).filter((t): t is string => t !== null);
    return items.length ? items.join("\n\n") : null;
  }
  if (one.kind === "table") return `*(table: ${one.table})*`;
  if (one.kind === "grid") return grid(one.rows, one.head, one.vars || vars);
  if (one.kind === "child") {
    return one.child.kind === "page" ? linkTo(one.child) : `*(table: ${one.child.id})*`;
  }
  return null;
}

/** A GRID IS A MARKDOWN TABLE AGAIN in the mirror, which is the one place a run
 *  of pipes is the right shape: Obsidian draws it and a brain reads it. Cells
 *  are interpolated as prose is. A pipe inside a cell is escaped, because in a
 *  cell it is a character and in this line it would be a column; a line break
 *  inside one becomes `<br>`, which every markdown table reader takes and a
 *  raw newline would end the row. A grid with no header still gets the
 *  delimiter row a table needs to be one, under an empty header. */
function grid(rows: string[][], head: boolean, vars: Variables): string | null {
  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  if (width === 0) return null;
  const cell = (text: string): string =>
    interpolate(text, vars).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
  const line = (row: string[]): string => {
    const cells = row.slice(0, width).map(cell);
    while (cells.length < width) cells.push("");
    return `| ${cells.join(" | ")} |`;
  };
  const rule = `|${" --- |".repeat(width)}`;
  const first = head && rows.length > 0 ? line(rows[0]!) : `|${" |".repeat(width)}`;
  const body = (head ? rows.slice(1) : rows).map(line);
  return [first, rule, ...body].join("\n");
}

/** One section, projected, or null where it says nothing. */
function section(one: DrawnSection, vars: Variables): string | null {
  const parts = Object.values(one.parts || {})
    .map((p) => part(p, vars))
    .filter((t): t is string => t !== null);
  return parts.length ? parts.join("\n\n") : null;
}

/** A section drawn for a child rather than written by anybody. Its name is host-
 *  derived (`@page-<segment>`), so it never becomes a heading — a run of them is
 *  a list of children and reads as one. */
const isChildSection = (one: DrawnSection): boolean => String(one.name).startsWith("@");

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
export function projectDoc(page: Page): string {
  const vars = page.variables || {};
  const out: string[] = [];
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
function dropTitle(body: string, name: string): string {
  const first = body.slice(0, body.indexOf("\n") === -1 ? body.length : body.indexOf("\n"));
  if (first.trim() !== `# ${String(name).trim()}`) return body;
  return body.slice(first.length).replace(/^\s+/, "");
}
