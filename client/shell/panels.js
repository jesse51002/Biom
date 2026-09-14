// SPDX-License-Identifier: AGPL-3.0-only
// The two panels that slide over the workspace. Layer 15.
//
// BOTH ARE NON-FUNCTIONAL CHROME, DELIBERATELY, AND BOTH SAY SO. The mock's
// versions faked a canned agent reply and offered Undo and Restore buttons that
// only moved state around. Neither survives here, because the framework is carried
// into a room and shown to somebody, and a control that does nothing is a claim
// the build cannot back the moment they press it.
//
// What replaces them is the truth, which is more interesting than the fake:
//
//   · The change loop is Claude Code writing a file and this window noticing.
//     The server watches the folder and re-reads it, so what an agent saves is
//     on screen a moment later without anybody pressing anything. Nothing in
//     this window calls a model, and the panel's whole job is to say where the
//     agent works and what to say to it.
//   · Reversibility is also something you ask for. Where versions are being
//     kept, undoing one is a sentence you hand the agent like any other — not a
//     terminal command, because nobody using this touches the repo directly and
//     a panel that sent them to one would be a different product. Snapshot and
//     rollback are out of scope by decision, not by omission.
//
//     WHETHER THEY ARE BEING KEPT AT ALL IS A FACT AND NOT AN ASSUMPTION.
//     `git init` fails on a machine with no git, and the workspace goes on
//     working — pages read and write, the mirror rebuilds — with no undo behind
//     any of it. `VaultInfo.history` is the answer, and this panel is the one
//     surface that would otherwise promise what is not there.
//
// So there is no thread, no composer, no Send, no Undo and no Restore. There is
// a path, three sentences you could say, and a plain statement of what this
// panel does not do yet.

/** @import { Page, VaultInfo } from "../../contracts/types.ts" */

import { promptCard } from "../widgets/prompt.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} PanelDeps
 * @property {H} h
 */

/** Where the agent works, when the workspace has not said. It used to be the
 *  only answer — `workspace/`, hardcoded, on the reasoning that the client never
 *  learns the vault's absolute path. That reasoning was already wrong: the
 *  picker and the rail both show `VaultInfo.path`. And it is now wrong in a way
 *  somebody would act on, because several folders are open at once and this line
 *  would send them to `cd` into whichever one the framework happened to ship with.
 *  It is a placeholder for the moment before the workspace has answered. */
const UNKNOWN_VAULT = "<vault>";

/** Where a page is on disk, relative to the vault root. A page's id is its path
 *  of segments, but each level below the root sits inside the parent's
 *  `children/`, so `home/Launch-plan` is `pages/home/children/Launch-plan/`. This
 *  printed `pages/` plus the id once, which named a folder that does not exist
 *  for every page below the top.
 *  @param {string} id @returns {string} */
const folderOf = (id) => "pages/" + id.split("/").join("/children/") + "/";

/**
 * @param {PanelDeps} deps
 * @returns {{
 *   agent: (page: Page | null, vault: VaultInfo | null) => HTMLElement,
 *   history: (page: Page | null, history?: boolean) => HTMLElement,
 * }}
 */
export function makePanels(deps) {
  const { h } = deps;

  return {
    /** THE PATH SOMEBODY TYPES AFTER `cd`, which is why it is absolute: the
     *  agent is a separate program in a separate terminal and has no idea what
     *  this one considers the current directory.
     *  @param {Page | null} page
     *  @param {VaultInfo | null} vault */
    agent(page, vault) {
      const root = vault ? vault.path.replace(/\/+$/, "") : UNKNOWN_VAULT;
      const name = page ? page.name : "<page name>";

      // THE VAULT ROOT, NOT THE PAGE'S FOLDER. It used to print
      // `pages/<id>/`, which reads as "open your agent here" — and an agent
      // opened there never finds the vault's AGENTS.md or its skills, which are
      // at the root and are the whole reason pointing an agent at this folder
      // works. The page's own folder is still shown, as where the page is, and
      // never as where to start.
      return h("aside.panel-side", { "aria-label": "Modify page" },
        h("div.panel-h", h("span", "Modify page"), h("b", page ? page.name : "")),
        h("div.panel-body",
          h("p.lead", "Ask your agent. Nothing here calls a model."),

          h("h5", "Open your agent in"),
          h("code.path", root + "/"),

          h("h5", "The page to change"),
          page
            ? h("p", h("b", name), " — its folder is ", h("code", folderOf(page.id)))
            : h("p", "Open a page first."),

          h("h5", "Say something like"),
          h("ul.says",
            h("li", "“Read AGENTS.md in this vault, then turn my page named " + name + " into [what you want].”")),

          h("p", "What it writes appears here on its own.")));
    },

    /**
     * @param {Page | null} page
     * @param {boolean} [history] whether this folder is keeping versions.
     *   Absent means not known yet — the shell reads `vaultInfo` after its
     *   first paint — and not-known is written the same way as yes, because the
     *   sentence that has to be earned is the negative one.
     */
    history(page, history) {
      const kept = history !== false;
      return h("aside.panel-side", { "aria-label": "History" },
        h("div.panel-h", h("span", "History"), h("b", page ? page.name : "workspace")),
        h("div.panel-body",
          kept
            ? h("p.lead", "Every version is kept. Undoing one is something you ask for.")
            // NO UNDO, SAID PLAINLY AND WITH THE FIX IN IT. The prompt below is
            // left exactly as it is: it is what to say once there is something
            // to revert to, and hiding it would leave a panel that says only
            // that something is wrong.
            : h("p.lead.warn",
                "Versions are not being kept in this folder — git could not start here, so there is " +
                "nothing to undo back to. Install git and reopen the workspace, and everything from " +
                "then on is kept."),

          // A prompt to copy, not a command to run. The change loop is asking
          // the agent, and telling somebody to open a terminal and type
          // `git revert` in the middle of it is a different product — one
          // where reversibility is a thing you operate rather than a thing you
          // request. Nobody using this touches git directly.
          promptCard(h, page
            ? "I want to revert " + page.name + " to an earlier version. Show me what changed " +
              "recently and ask me which version to go back to."
            : "I want to revert something in this workspace to an earlier version. Ask me which " +
              "page, then show me what changed recently and ask me which version to go back to.",
            { lead: "Undoing something" }),

          h("p.notyet", "No version list yet.")));
    },
  };
}
