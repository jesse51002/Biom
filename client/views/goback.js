// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — **GO BACK TO**, top left: the person's work, named, while an
// agent has the screen.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track B2 builds it.
//
// It shows when an agent has moved the screen and the screen is not the
// person's; it names the latest screen in the history that is theirs,
// skipping every one the switcher brought up; pressing it goes there, as an
// open by the person; it goes when pressed or when the screen becomes theirs,
// and with nothing of theirs to go back to it does not show
// (*History and View Switcher*, `popups`). What it reads is the switcher's
// `back`, and the page's name comes from the tree the store already holds.

/** @import { UiStore } from "../../contracts/types.ts" */

/**
 * NOT BUILT: throws.
 * @param {{ h: Function, ui: UiStore, switcher: unknown, ws: unknown }} _deps
 * @returns {() => HTMLElement | null}
 */
export function makeGoBack(_deps) {
  throw new Error("client/views/goback.js: Go back to is not built yet");
}
