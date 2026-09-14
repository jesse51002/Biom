// SPDX-License-Identifier: AGPL-3.0-only
// Config: what this page actually is.
//
// IT IS DELIBERATELY EMPTY OF PORTS. The framework grants artifacts unrestricted
// access to workspace data, so there is nothing to scope, nothing to bind and
// nothing to confirm — and a screen that showed approved destinations, a
// request count or "anywhere else → blocked" would be making a claim this
// build cannot back if anyone in the room asks. The mock shows those because a
// mock may; the framework may not. What is left is true: the page's files, the
// sections it is made of, what the page itself reports about them, and one
// sentence saying plainly that nothing here is restricted.
//
// The other half of this screen is the guard `Prototype.md` insists on: the
// raw-YAML fallback, for a page whose generated HTML did not carry its slots.
// Ugly, always available, and the difference between a broken demo and a
// clumsy one. It does not depend on the page having worked.
//
// IT MATTERS MORE THAN IT DID. The prose used to live in `.md` files that
// survived a broken `content.yaml` untouched; one file holds the words now, so
// this box is the only way back to a page whose one bad character took its
// sentences with it.

/** @import { Page, PageId, WorkspaceStore, UiStore, FrameHost } from "../../contracts/types.ts" */

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} ConfigViewDeps
 * @property {H} h
 * @property {WorkspaceStore} ws
 * @property {UiStore} ui
 * @property {FrameHost} frameHost
 * @property {boolean} [production] which build this is; absent means
 *   development. Production drops the Sections group, and changes one sentence
 *   in Data: Files, Data and Raw are each about the person's own page, and Raw
 *   is the way back into a page whose one bad character took its sentences with
 *   it. Data stays because what a page can reach is the person's business too —
 *   it just has to say what THIS build allows rather than what the development
 *   one does.
 */

/**
 * @param {ConfigViewDeps} deps
 * @returns {(page: Page) => HTMLElement}
 */
export function makeConfigView(deps) {
  const { h, ws, frameHost } = deps;
  const production = deps.production === true;

  /**
   * The raw editor's state between draws.
   *
   * `source` is the Page object the current text was read against, and it is
   * what says when to read again. Caching on the page ID alone meant the
   * sidecar was read once for the life of the tab: Reload showed the YAML from
   * first open, and Save wrote it back over whatever Claude Code had changed in
   * the meantime — silent, and in the one screen that exists to rescue a page
   * that has already gone wrong. The store hands out a NEW Page object every
   * time it re-reads from disk, and this view is drawn on nothing else, so a
   * different object is exactly "the file may have moved".
   *
   * `text` is what is in the box; `base` is what was last read off disk, so a
   * file that changed under an unsaved edit can be noticed rather than one side
   * of it silently thrown away.
   */
  let raw = {
    page: /** @type {PageId | null} */ (null),
    source: /** @type {Page | null} */ (null),
    text: /** @type {string | null} */ (null),
    base: /** @type {string | null} */ (null),
    dirty: false,
  };

  /** @param {string} title @param {string} tag @param {...any} body */
  const group = (title, tag, ...body) =>
    h("div.pgroup", h("h3", title, h("b", "— " + tag)), ...body.filter(Boolean));

  /** @param {Page} page @returns {HTMLElement} */
  return function configView(page) {
    return h("div.ports",
      h("h2", "Config"),
      h("p.sub", "What this page is, and what it can reach."),
      filesGroup(page),
      // A TABLE OF EVERY SECTION, what drew it and how many slots it has, over a
      // sentence about what the frame reported. It is `content.yaml` restated
      // for somebody who is about to edit one, which is nobody in a built
      // application. Both of the group's shapes go — the empty one says "ask the
      // agent pointed at this vault", which is the same audience.
      production ? null : sectionsGroup(page),
      dataGroup(page),
      rawGroup(page));
  };

  /** @param {Page} page */
  function filesGroup(page) {
    const files = fileList(page);
    return group("Files", "pages/" + page.id + "/",
      h("table.ports-t",
        h("thead", h("tr", h("th", "file"), h("th", "what it is"))),
        h("tbody", ...files.map((f) =>
          h("tr", h("td.role", f.name), h("td.to", f.what))))),
      h("p.portsnote",
        "These are the files on disk. Claude Code edits them in place, and this window re-reads them "
        + "when they change."));
  }

  /** WHAT THE PAGE IS MADE OF, and what the page says it drew.
   *
   *  Both halves are here because they can disagree and the difference is the
   *  only thing worth reading. The left column is `content.yaml` — the sections
   *  the document declares, in order. The number underneath is what the runtime
   *  reported over the port once its DOM existed, and the host cannot check it:
   *  a sandboxed frame has an opaque origin and there is nothing to scrape.
   *  @param {Page} page */
  function sectionsGroup(page) {
    const sections = page.sections || [];
    // THE KEY IS THE PAGE ID, with nothing appended. It used to be
    // `page#block` because there was one box per BLOCK and the block had to be
    // named; there is one box per PAGE now and `client/views/page.js` mounts it
    // under the bare id. The stale `+ "#"` did not error — it simply asked about
    // a box that has never existed, so this report could only ever say nothing.
    const report = frameHost ? frameHost.compliance(page.id) : null;

    if (!sections.length) {
      return group("Sections", "none",
        h("p.portsnote",
          "This page declares no sections, so it draws nothing. Add one in the box below, or ",
          "ask the agent pointed at this vault for one."));
    }

    const rows = sections.map((s) =>
      h("tr",
        h("td.role", s.name),
        h("td.ty", s.fallback ? "the shipped section" : "its own HTML"),
        h("td.arrow", "→"),
        h("td.to", slotWord(Object.keys(s.parts).length))));

    return group("Sections", sections.length === 1 ? "1 section" : sections.length + " sections",
      h("table.ports-t",
        h("thead", h("tr", h("th", "section"), h("th", "drawn with"), h("th", ""), h("th", "slots"))),
        h("tbody", ...rows)),
      h("p.portsnote",
        "The page is drawn by one runtime in one sandboxed frame, and it reported ",
        report ? h("b", String(report.sections)) : h("b", "nothing"),
        report ? " section" + (report.sections === 1 ? "" : "s") + " on screen. " : " back. ",
        "The host cannot check that — it cannot read inside a null-origin frame — so this is what ",
        "the page says about itself. A page reporting nothing either never finished loading or ",
        "failed while drawing; either way the raw YAML below still edits its text."));
  }

  /** WHAT THIS PAGE CAN REACH, and it is the one group on this screen that says
   *  something DIFFERENT in a built application rather than saying nothing.
   *
   *  Tables are unrestricted in every build: `table.get` and `row.insert` resolve
   *  against any table, with no scoping and no record. `sql` and `fetch` are not
   *  — a production server refuses both, because a page can say either without
   *  touching a control anybody could hide. So the development sentence, which
   *  promises the internet, is a promise this build does not keep, and a screen
   *  that exists to state plainly what a page can reach may not be the one thing
   *  on it that is out of date.
   *  @param {Page} page */
  function dataGroup(page) {
    const declared = page.ports && page.ports.ports.length ? page.ports.ports.length : 0;
    return group("Data", "unrestricted",
      h("p.portsnote",
        "This workspace applies no restrictions on its own data. Anything on this page can read ",
        "and write every table in the workspace. Nothing is scoped and nothing is recorded.",
        production
          ? h("span", " This build refuses the two things that leave it: a page cannot run SQL and " +
              "cannot call out to the internet.")
          : h("span", " Anything on this page can also run SQL and call out to the internet."),
        declared
          ? h("span", " This page declares " + declared + " data port" + (declared === 1 ? "" : "s") +
              "; the framework does not enforce them.")
          : null));
  }

  /** @param {Page} page */
  function rawGroup(page) {
    if (raw.page !== page.id) raw = { page: page.id, source: null, text: null, base: null, dirty: false };

    const area = /** @type {HTMLTextAreaElement} */ (h("textarea.rawyaml", {
      spellcheck: "false", rows: "14", "aria-label": "Raw document for " + page.name,
    }));
    const status = h("span.hint", raw.dirty ? "Unsaved." : "");

    // Read on open and on every Reload, which is every Page object this view
    // has not already read against.
    const stale = raw.source !== page;
    raw.source = page;

    area.value = raw.text === null ? "Reading…" : raw.text;

    if (stale) {
      const was = raw.base;
      ws.readDocRaw(page.id).then((/** @type {string} */ text) => {
        if (raw.page !== page.id || raw.source !== page) return;   // drawn again since
        raw.base = text;
        if (!raw.dirty) {
          raw.text = text;
          area.value = text;
        } else if (was !== null && text !== was) {
          // Neither side is thrown away without saying so: an agent rewriting
          // the file while someone is typing into it is a collision the user is
          // told about and decides, not one this view resolves quietly.
          status.textContent =
            "This file changed on disk while you were editing. Saving overwrites it; " +
            "rereading takes the version on disk and loses what is in the box.";
        }
      }).catch((/** @type {unknown} */ err) => {
        if (raw.page !== page.id || raw.source !== page) return;
        if (!raw.dirty) area.value = "";
        status.textContent = "Could not read the document: " + message(err);
      });
    }

    area.addEventListener("input", () => {
      raw.dirty = true;
      raw.text = area.value;
      status.textContent = "Unsaved.";
    });

    const save = h("button.btn", {
      type: "button",
      onclick: () => {
        status.textContent = "Writing…";
        const sent = area.value;
        ws.writeDocRaw(page.id, sent).then(() => {
          raw.dirty = false;
          raw.text = sent;
          raw.base = sent;
          status.textContent = "Saved.";
        }).catch((/** @type {unknown} */ err) => {
          // Flatness is the likely one, and the message is the whole point of
          // showing this: it names the line that is not flat.
          status.textContent = "Refused: " + message(err);
        });
      },
    }, "Save the YAML");

    return group("Raw", "content.yaml",
      h("p.portsnote",
        "ONE FILE HOLDS EVERYTHING THIS PAGE SAYS: its name, its sections in order, the prose ",
        "inside them and every variable they resolve. This is the way in when a generated section ",
        "did not mark its slots, and the way to rename the page or reorder it by hand."),
      h("div.rawbox", area, h("div.row", status, save)));
  }
}

/* ── pure, and therefore testable ─────────────────────────────────────── */

/**
 * The files this page is made of, in the order they matter. A page is a
 * directory holding one document and whatever HTML that document names, so this
 * list is also the answer to "what would I ask Claude Code to change".
 *
 * ONLY REAL FILENAMES GO IN IT. A markdown slot is not a file — its words sit in
 * `content.yaml` beside its name — and a `DrawnSection` deliberately does not
 * carry the name of the HTML it was drawn from, because the runtime that draws
 * it has the markup and never needs the path. So a section with its own HTML is
 * reported as one in the Sections table above and named in `content.yaml`, and
 * naming a file nobody can open is the one thing this table must not do.
 * @param {Page} page
 * @returns {{ name: string, what: string }[]}
 */
export function fileList(page) {
  const out = [{ name: "content.yaml", what: "everything this page says: its sections in order, its prose, and its variables" }];
  for (const section of page.sections || []) {
    for (const [slot, part] of Object.entries(section.parts)) {
      if (part.kind === "html") {
        out.push({ name: part.file, what: `the ${slot} slot of the ${section.name} section` });
      } else if (part.kind === "child" && part.draw) {
        // The CHILD'S file, in the child's own directory: a page decides how it
        // is summarised, wherever it is held. Named with its directory so it
        // cannot be mistaken for something beside this page's document.
        out.push({
          name: "pages/" + part.child.id + "/" + part.draw.file,
          what: `how ${part.child.name} draws itself here — its own file, not this page's`,
        });
      }
    }
  }
  return out;
}

/** @param {number} n @returns {string} */
const slotWord = (n) => (n === 1 ? "1 slot" : n + " slots");

/** @param {unknown} err */
const message = (err) =>
  err instanceof Error ? err.message : typeof err === "string" ? err : "something went wrong";
