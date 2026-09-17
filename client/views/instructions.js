// SPDX-License-Identifier: AGPL-3.0-only
// INSTRUCTIONS: the person's file, at two levels, each on its own screen.
//
// THE WORKSPACE'S, from the rail's foot: one tree holding the vault's
// `INSTRUCTIONS.md` and, under it, the workspace's own skills under
// `.agents/skills/` with a ＋ on the folder — never the framework's seeded set,
// because the server seeded those and a copy edited here would be the copy the
// seeder never refreshes — and an editor beside it.
//
// THE PAGE'S, from the page bar: one file and one editor, the page's
// `INSTRUCTIONS.md`, what any agent pointed at this page is told to read, under
// one line to hand your agent. Skills are not here; a skill belongs to an
// automation and is edited with it.
//
// Both write a moment after the last keystroke and have nothing to press.
// `AGENTS.md` is on neither screen: it is the framework's at every level.

/** @import { Page, VaultFile, WorkspaceStore, UiStore } from "../../contracts/types.ts" */
import { askLine, editor, fileTree } from "../widgets/runsui.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/** The one file every level is called. Spelled here and in `server/domain/runs.ts`. */
export const INSTRUCTIONS = "INSTRUCTIONS.md";
/** Where the workspace's own skills are. */
export const SKILLS = ".agents/skills";

/** What the page screen's line says. `{page}` is the page's id — the way an
 *  agent is pointed at one, never its path on disk. */
export const ASK_INSTRUCTIONS = "Modify the instructions of page `{page}` to ___";

/**
 * @typedef {object} InstructionsViewDeps
 * @property {H} h
 * @property {WorkspaceStore} ws
 * @property {UiStore} ui
 */

/**
 * @param {InstructionsViewDeps} deps
 * @returns {{ vault: () => HTMLElement, page: (page: Page) => HTMLElement }}
 */
export function makeInstructionsView(deps) {
  const { h, ws } = deps;

  /** Which file the workspace screen has open, kept across repaints. */
  let vaultOpen = INSTRUCTIONS;

  /** @param {string} message @returns {HTMLElement} */
  const hold = (message) => h("p.hold", message);

  /* ── the workspace's ───────────────────────────────────────────────── */

  function vaultScreen() {
    const plate = h("div.instructions.vaultins", hold("Opening…"));
    void (async () => {
      let files;
      try {
        files = await ws.vaultFiles();
      } catch (e) {
        plate.replaceChildren(hold(e instanceof Error ? e.message : "the workspace's files could not be listed"));
        return;
      }
      draw(plate, files);
    })();
    return plate;
  }

  /** @param {HTMLElement} plate @param {VaultFile[]} files */
  function draw(plate, files) {
    // The seeded skills are the framework's and are not listed; the server
    // marked them, so nothing here carries a roster.
    const own = files.filter((f) => !f.seeded).map((f) => f.path);
    if (!own.includes(vaultOpen)) vaultOpen = INSTRUCTIONS;
    const tree = fileTree(h, {
      root: "the workspace",
      files: own,
      open: vaultOpen,
      pick: (path) => { vaultOpen = path; draw(plate, files); },
      adds: [SKILLS],
      add: () => {
        const name = typeof prompt === "function" ? prompt("The new skill's name, as a folder: lowercase, digits, dashes") : null;
        if (name === null) return;
        const folder = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (folder === "") return;
        const path = `${SKILLS}/${folder}/SKILL.md`;
        void ws.writeVaultFile(path, `---\nname: ${folder}\ndescription: What this skill is for, in one line.\n---\n\n# ${folder}\n`).then(async () => {
          vaultOpen = path;
          draw(plate, await ws.vaultFiles());
        });
      },
    });
    const pane = h("div.pane", hold("Opening…"));
    plate.replaceChildren(h("div.split", tree, pane));
    void (async () => {
      const text = (await ws.readVaultFile(vaultOpen)) ?? "";
      const at = vaultOpen;
      const ed = editor(h, {
        name: at.slice(at.lastIndexOf("/") + 1),
        where: at === INSTRUCTIONS ? "the workspace" : at.slice(0, at.lastIndexOf("/")),
        text,
        placeholder: at === INSTRUCTIONS ? "What this workspace is, and how you want it written. Every agent opened anywhere in it reads this first." : undefined,
        foot: at === INSTRUCTIONS
          ? "Read first by every agent opened anywhere in this workspace. AGENTS.md beside it is the framework's and is rewritten when the workspace opens."
          : "One of this workspace's own skills. The framework's seeded skills are not listed here.",
        save: (next) => ws.writeVaultFile(at, next),
      });
      pane.replaceChildren(ed.el);
    })();
  }

  /* ── the page's ────────────────────────────────────────────────────── */

  /** @param {Page} page */
  function pageScreen(page) {
    const plate = h("div.instructions.pageins",
      askLine(h, ASK_INSTRUCTIONS.replace("{page}", page.id)),
      h("div.pane", hold("Opening…")));
    const pane = /** @type {HTMLElement} */ (plate.lastElementChild);
    void (async () => {
      let text = "";
      try {
        text = (await ws.readPageFile(page.id, INSTRUCTIONS)) ?? "";
      } catch (e) {
        pane.replaceChildren(hold(e instanceof Error ? e.message : "the file could not be read"));
        return;
      }
      const ed = editor(h, {
        name: INSTRUCTIONS,
        where: page.id,
        text,
        placeholder: "What an agent pointed at this page should know: what the page is for, where its rows go, what to leave alone.",
        foot: "What any agent opened on this page reads first, after the workspace's own INSTRUCTIONS.md above it. Every run under this page gets it as page/INSTRUCTIONS.md.",
        save: (next) => ws.writeFile(page.id, INSTRUCTIONS, next),
      });
      pane.replaceChildren(ed.el);
    })();
    return plate;
  }

  return { vault: vaultScreen, page: pageScreen };
}
