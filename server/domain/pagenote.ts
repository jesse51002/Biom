// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE NOTE BIOM ADDS ABOUT THE PAGE ON SCREEN, and the one strip
// that takes it out again (*Chat*, `acp`: *Biom adds what the person is
// looking at, and the person never sees it*). Pure: no I/O, no clock.
//
// WHAT IT SAYS is three facts and a caution: which page is open — its name,
// and where its folder is in the workspace — which of its screens is up — the
// page, its Instructions or its Automations — and that this is background,
// which may or may not be what the message is about. Never a word of the
// page's body: the agent can read the folder itself.
//
// WHERE IT GOES is after the person's own words, as a block of its own in
// `session/prompt`, wrapped in `<biom-context>` — a tag only Biom writes. So a
// page's name, which is workspace content anybody's code may have written, is
// NEUTRALISED on the way in: on one line, and with no angle bracket left to
// close the note or open another.
//
// WHEN is the chats' to decide, against what the chat's session was last told
// (`noteFor`): the first message sent with a page on screen, and then only
// when the page on screen is not the one last told — never on a `/` command,
// whose slash has to lead, and never with no page on screen.
//
// THE PERSON NEVER SEES IT, because nothing of Biom's own keeps it: the
// person's bubble, the chat's name, Jev's reading and the history are all made
// from the words as typed, before the note is added. What an agent says back
// can carry it, and `withoutNotes` is the one function that takes it out of
// such text, wherever Biom reads some.

import type { PageId, PageScreen } from "../../contracts/types.ts";
import { PAGE_SCREENS } from "../../contracts/address.js";

/** THE PAGE ON SCREEN in the window a message was sent from — what the note
 *  names, and what a chat keeps as the page it last told its session. */
export interface PageOnScreen {
  page: PageId;
  /** The page's own name, as its document says it: workspace content,
   *  neutralised before it is put in a note. */
  name: string;
  /** Where its folder is in the workspace, vault-relative and
   *  forward-slashed: `pages/home/children/Specs`. */
  folder: string;
  screen: PageScreen;
}

/** The tag the note is wrapped in. Biom writes it, and nothing else may. */
export const NOTE_TAG = "biom-context";
const OPEN = `<${NOTE_TAG}>`;
const CLOSE = `</${NOTE_TAG}>`;

/** EVERY NOTE IN A TEXT, with the space before it — the break Biom puts
 *  between the person's words and its own block when an agent joins them —
 *  and one cut off before it closed taken out to the end. */
const NOTES = new RegExp(`\\s*${OPEN}(?:[\\s\\S]*?${CLOSE}|[\\s\\S]*$)`, "g");

/** How long a page's name may be in a note. A name is a title; past this it
 *  is somebody's paragraph, and the folder names the page anyway. */
const NAME_MAX = 200;

/** Each screen of a page, as the note says it. */
const SCREEN_WORDS: { readonly [S in PageScreen]: string } = {
  page: "the page itself",
  instructions: "its Instructions (the INSTRUCTIONS.md in that folder)",
  automation: "its Automations (the automations folder in it)",
};

/** A word of the workspace's, made safe to stand in a note: control
 *  characters and line breaks are spaces, runs of space are one, every angle
 *  bracket is its single-guillemet look-alike — so nothing in it can close the
 *  note or open another — and past `max` it is cut. */
function neutral(text: string, max: number): string {
  const flat = text
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/</g, "‹")
    .replace(/>/g, "›");
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** THE NOTE, whole: the tag, one line of Biom's, the tag closed. */
export function noteOf(on: PageOnScreen): string {
  const said = `A note from Biom, not typed by the person: they have the page “${neutral(on.name, NAME_MAX)}” open, `
    + `whose folder in this workspace is ${neutral(on.folder, Number.POSITIVE_INFINITY)}, and are looking at ${SCREEN_WORDS[on.screen]}. `
    + "It is background, and may or may not be what their message is about.";
  return `${OPEN}\n${said}\n${CLOSE}`;
}

/** Whether two pages on screen are one — the same page, under the same name,
 *  in the same folder, on the same screen — which is whether a note about the
 *  second would tell a session that heard the first anything. */
export function sameOnScreen(a: PageOnScreen, b: PageOnScreen): boolean {
  return a.page === b.page && a.name === b.name && a.folder === b.folder && a.screen === b.screen;
}

/** A `/` COMMAND: a message whose words start with the slash, which must
 *  reach the agent exactly as typed or the command breaks. */
export function isCommand(text: string): boolean {
  return text.trimStart().startsWith("/");
}

/**
 * THE NOTE A MESSAGE CARRIES, or null: the page on screen when it was sent,
 * unless it is a `/` command, no page was on screen, or the session it goes to
 * was last told this very page.
 * @param text the person's words, as typed
 * @param on the page on screen when it was sent
 * @param told the page the session it goes to was last told, if it was
 */
export function noteFor(text: string, on: PageOnScreen | null, told: PageOnScreen | null): string | null {
  if (on === null || isCommand(text)) return null;
  if (told !== null && sameOnScreen(told, on)) return null;
  return noteOf(on);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A PAGE ON SCREEN READ BACK from a chat's kept log: its four fields, or
 *  null for anything that is not one — a log is a file, and a line of it is
 *  read loosely and never guessed at. */
export function readOnScreen(v: unknown): PageOnScreen | null {
  if (!isObj(v)) return null;
  const { page, name, folder, screen } = v;
  if (typeof page !== "string" || page === "" || typeof name !== "string" || typeof folder !== "string" || folder === "") return null;
  if (typeof screen !== "string" || !PAGE_SCREENS.has(screen as PageScreen)) return null;
  return { page, name, folder, screen: screen as PageScreen };
}

/** EVERY NOTE TAKEN OUT of text an agent said back — the person's words
 *  replayed, a reply that quoted what it was handed — and every other
 *  character left exactly as it was. The one strip: whatever reads such text
 *  for the person, for another agent or for Jev reads it through here. */
export function withoutNotes(text: string): string {
  return text.replace(NOTES, "");
}
