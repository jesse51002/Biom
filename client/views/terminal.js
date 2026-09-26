// SPDX-License-Identifier: AGPL-3.0-only
// The terminal emulator's keys. Layer 14.
//
// What is left of the agent terminal's view once the dock went: the pure table
// of what a key does inside the emulator, which the sign-in pop-up keeps.

/** @typedef {"pass" | "host" | "copy" | "selectAll" | "clear" | { send: string }} KeyAct */

/** WHAT A KEY DOES IN THE TERMINAL, AS THE PLATFORM'S OWN TERMINAL DOES IT.
 *  A person who lives in Terminal.app, iTerm2, GNOME Terminal or Windows
 *  Terminal has hands that already know these, and an emulator that answers
 *  them with silence — or with an escape sequence the shell ignores — reads as
 *  a broken terminal. Each rewrite sends the bytes a line editor (readline, zle,
 *  and the agent CLIs' own prompts) already understands; nothing is bound in the
 *  shell. Pure, so the table can be read and tested without an emulator.
 *
 *  - `pass` leaves the key to the emulator, and through it to the browser —
 *    which is how paste arrives, with bracketed paste intact.
 *  - `host` keeps the key out of the shell and lets the page have it.
 *  - `{ send }` types those bytes into the session in the key's place.
 *
 *  @param {Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">} e
 *  @param {boolean} mac
 *  @returns {KeyAct} */
export function terminalKey(e, mac) {
  const { key, code, ctrlKey: ctrl, metaKey: meta, altKey: alt, shiftKey: shift } = e;
  // ZOOM IS THE WINDOW'S, NOT THE SHELL'S. Ctrl/Cmd with `+`, `-` or `0` would
  // otherwise reach the program as an ordinary keystroke.
  if ((ctrl || meta) && !alt && ["=", "+", "-", "_", "0"].includes(key)) return "host";
  // SHIFT+ENTER IS A NEW LINE, NOT A SUBMIT. The agent CLIs read ESC+Return as
  // "newline in the prompt" — it is what their own terminal setup binds Shift+
  // Enter to — and a bare Return here sent a half-written prompt.
  if (shift && !ctrl && !meta && !alt && key === "Enter") return { send: "\x1b\r" };
  if (mac) {
    // Terminal.app and iTerm2: Cmd is the application's, Option is the word.
    if (meta && !ctrl && !alt) {
      if (key === "ArrowLeft") return { send: "\x01" }; // start of line
      if (key === "ArrowRight") return { send: "\x05" }; // end of line
      if (key === "Backspace") return { send: "\x15" }; // delete to start of line
      if (key === "k" && !shift) return "clear"; // clear the scrollback
      if (key === "a" && !shift) return "selectAll";
      return "pass"; // ⌘C and ⌘V: the Edit menu's, and the emulator answers them
    }
    if (alt && !ctrl && !meta && !shift) {
      if (key === "ArrowLeft") return { send: "\x1bb" }; // back a word
      if (key === "ArrowRight") return { send: "\x1bf" }; // forward a word
      if (key === "Backspace") return { send: "\x1b\x7f" }; // delete the word behind
    }
    return "pass";
  }
  // LINUX AND WINDOWS: Ctrl+C must stay SIGINT, so the clipboard is on
  // Ctrl+Shift, as in GNOME Terminal and Windows Terminal. Paste is handed back
  // to the browser, whose paste event the emulator reads.
  if (ctrl && shift && !alt && !meta) {
    if (code === "KeyC") return "copy";
    if (code === "KeyV") return "host";
    if (code === "KeyA") return "selectAll";
  }
  // Ctrl+Backspace deletes the word behind, as Windows Terminal and VS Code send it.
  if (ctrl && !shift && !alt && !meta && key === "Backspace") return { send: "\x17" };
  return "pass";
}
