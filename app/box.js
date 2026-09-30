// SPDX-License-Identifier: AGPL-3.0-only
// WHICH FRAME IN THE WINDOW IS THE PAGE, as the shell answers it for Share.
//
// THE WINDOW HOLDS MORE THAN ONE BOX. The page is drawn in one and the Agent
// screen's look in another, built the first time the Agent screen or the chat
// panel shows and kept running, hidden, beside every page from then on. Every
// launch opens on the Agent screen, so the look is made before any page is. The
// main process sees each box only as a frame — every one of them `about:srcdoc`,
// each in a process of its own, handed over in the order they were made rather
// than where they sit — so a capture that took the first frame that was not the
// window took the look, and Share uploaded the Agent screen, with whatever of
// the person's chats it had drawn, as the page.
//
// A FRAME'S NAME IS NOT PROOF, BECAUSE THE BOX OWNS IT. A frame is born with the
// name its `<iframe>` element carries, and from then on its name is the box's
// own `window.name`, which the box's code may set to anything — measured in the
// built application: the look's box saying `window.name = "biom-page"` and the
// capture taking the look. The look is a plugin a workspace can replace, so the
// name a box answers to cannot be the whole of how the page's is chosen.
//
// WHAT NO BOX CAN REACH IS THE WINDOW'S OWN DOCUMENT. The page view gives the
// page's `<iframe>` a name of `PAGE_BOX`, a dash and a word minted for that one
// element (`client/views/page.js`); the main process reads that name out of the
// window's document — `NAMES_IN_WINDOW`, run there and never in a box — and
// takes the one frame of the window's own answering to exactly it. A box cannot
// read another frame's name or the window's document, so no other box can know
// the word to claim it; it can only be told it, by the page's own code.
//
// AND ONLY THE WINDOW'S OWN FRAMES ARE ASKED. The name came off an `<iframe>` in
// the window's document, so the frame it names is one of the window's
// children; a frame any box made — a page drawn inside the page, an iframe of a
// page's or the look's own — sits deeper, and is never taken whatever it calls
// itself. The page drawn inside another is still captured, as part of the box
// it is drawn in.
//
// It is not a probe of each frame for what a page holds, such as `#g-page`:
// only a document keeps its stack there, and the root page, a board and the Map
// draw themselves and hold none — and a probe would run code in the look's box
// to decide not to read it.
//
// WHERE IT GOES WRONG IT GOES WRONG TOWARDS NOTHING. No page box in the window's
// document, or more than one; none of the window's frames answering to its
// name, because the page's own code renamed its window; two answering, because
// the name was handed on — each is no box, and no box is no capture: the client
// sends none and the server says in words that it needed one, rather than
// another box's document going up in the page's place.
//
// Plain CommonJS with no `electron` in it, beside `app/main.js`, so
// `tests/app.test.ts` can require it: the main process cannot be loaded outside
// Electron.

/** The prefix of the name the page's box wears. `PAGE_BOX` in
 *  `contracts/wire.js` is the same string — this file is staged into the bundle
 *  alone and cannot import it — and `tests/app.test.ts` holds the two equal. */
const PAGE_BOX = "biom-page";

/** WHAT THE MAIN PROCESS RUNS IN THE WINDOW'S OWN DOCUMENT: the name every
 *  page box there was given, read off the `<iframe>` element's attribute —
 *  which is the client's, and which nothing inside a box can touch. */
const NAMES_IN_WINDOW = `Array.from(document.querySelectorAll('iframe[name^="${PAGE_BOX}-"]'), (f) => f.getAttribute("name"))`;

/** THE PAGE'S BOX: the one frame of the window's own — a child of the frame
 *  with no parent — answering to the one name `NAMES_IN_WINDOW` found, or
 *  null where the window's document holds no page box or more than one, and
 *  where none of the window's frames, or more than one, answers to the name.
 *  @template {{ name: string, parent: any }} F
 *  @param {F[]} frames every frame in the window, the window's own among them,
 *    in any order
 *  @param {unknown} names what `NAMES_IN_WINDOW` answered
 *  @returns {F | null} */
function pageBox(frames, names) {
  if (!Array.isArray(names) || names.length !== 1 || typeof names[0] !== "string" || names[0] === "") return null;
  const name = names[0];
  const answering = frames.filter((f) => f.name === name && f.parent != null && f.parent.parent == null);
  return answering.length === 1 ? answering[0] ?? null : null;
}

module.exports = { PAGE_BOX, NAMES_IN_WINDOW, pageBox };
