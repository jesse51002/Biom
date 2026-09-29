// SPDX-License-Identifier: AGPL-3.0-only
// WHICH FRAME IN THE WINDOW IS THE PAGE, as the shell answers it for Share.
//
// THE WINDOW HOLDS MORE THAN ONE BOX. The page is drawn in one and the Agent
// screen's look in another, built the first time the Agent screen or the chat
// panel shows and kept running, hidden, beside every page from then on. Every
// launch opens on the Agent screen, so the look is made before any page is. The
// main process sees each box only as a frame — every one of them `about:srcdoc`,
// handed over in the order they were made rather than where they sit — so a
// capture that took the first frame that was not the window took the look, and
// Share uploaded the Agent screen, with whatever of the person's chats it had
// drawn, as the page.
//
// SO THE CLIENT NAMES THE PAGE'S BOX WHERE IT WEAVES IT — `PAGE_BOX` in
// `client/views/page.js` — and this answers the outermost frame wearing that
// name. A name says which box it is and nothing about what is in it, which is
// why it is not a probe of each frame for `#g-page`: only a document keeps its
// stack there, and the root page, a board and the Map draw themselves and hold
// none — and a probe would run code in the look's box to decide not to read it.
//
// WHERE IT GOES WRONG IT GOES WRONG TOWARDS NOTHING. A box whose own code renames
// its window is a box this does not find, and no box found is no capture: the
// client sends none and the server says in words that it needed one, rather
// than another box's document going up in its place.
//
// Plain CommonJS with no `electron` in it, beside `app/main.js`, so
// `tests/app.test.ts` can require it: the main process cannot be loaded outside
// Electron.

/** The name the page's box wears. `PAGE_BOX` in `client/views/page.js` is the
 *  same string, and `tests/app.test.ts` holds the two equal. */
const PAGE_BOX = "biom-page";

/** How many frames stand between this one and the window.
 *  @param {{ parent: any }} frame @returns {number} */
function depth(frame) {
  let n = 0;
  for (let at = frame.parent; at; at = at.parent) n++;
  return n;
}

/** THE PAGE'S BOX among the window's frames: the outermost one named
 *  `PAGE_BOX`, or null where none is. Outermost by depth rather than by where
 *  it falls in the list, because a frame inside the page — a page drawn inside
 *  it, or an iframe of the page's own — may wear any name, this one included.
 *  @template {{ name: string, parent: any }} F
 *  @param {F[]} frames every frame in the window, the window's own among them,
 *    in any order
 *  @returns {F | null} */
function pageBox(frames) {
  /** @type {F | null} */
  let best = null;
  for (const f of frames) {
    if (f.name !== PAGE_BOX) continue;
    if (best === null || depth(f) < depth(best)) best = f;
  }
  return best;
}

module.exports = { PAGE_BOX, pageBox };
