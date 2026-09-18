// SPDX-License-Identifier: AGPL-3.0-only
// The agent terminal's keys, as the platform's own terminal answers them.
//
// Every row here is a habit somebody brings from Terminal.app, iTerm2, GNOME
// Terminal or Windows Terminal, and every rewrite is the bytes a line editor
// already understands. The ones that must NOT be rewritten matter as much:
// Ctrl+C is SIGINT everywhere, and ⌘V / Ctrl+Shift+V reach the browser so the
// paste arrives as a paste.

import { test, expect } from "bun:test";

import { terminalKey } from "../client/views/terminal.js";

/** @param {string} key @param {Partial<{ code: string, ctrl: boolean, meta: boolean, alt: boolean, shift: boolean }>} [m] */
const k = (key, m = {}) => ({
  key,
  code: m.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
  ctrlKey: !!m.ctrl,
  metaKey: !!m.meta,
  altKey: !!m.alt,
  shiftKey: !!m.shift,
});

test("macOS: Option moves and deletes by word, Cmd by line, as Terminal.app and iTerm2 do", () => {
  expect(terminalKey(k("ArrowLeft", { alt: true }), true)).toEqual({ send: "\x1bb" });
  expect(terminalKey(k("ArrowRight", { alt: true }), true)).toEqual({ send: "\x1bf" });
  expect(terminalKey(k("Backspace", { alt: true }), true)).toEqual({ send: "\x1b\x7f" });
  expect(terminalKey(k("ArrowLeft", { meta: true }), true)).toEqual({ send: "\x01" });
  expect(terminalKey(k("ArrowRight", { meta: true }), true)).toEqual({ send: "\x05" });
  expect(terminalKey(k("Backspace", { meta: true }), true)).toEqual({ send: "\x15" });
  expect(terminalKey(k("k", { meta: true }), true)).toBe("clear");
  expect(terminalKey(k("a", { meta: true }), true)).toBe("selectAll");
});

test("macOS: ⌘C and ⌘V are left to the Edit menu, and Ctrl stays the shell's", () => {
  expect(terminalKey(k("v", { meta: true }), true)).toBe("pass");
  expect(terminalKey(k("c", { meta: true }), true)).toBe("pass");
  expect(terminalKey(k("c", { ctrl: true }), true)).toBe("pass");
  expect(terminalKey(k("a", { ctrl: true }), true)).toBe("pass");
  // Option with a letter is the keyboard's own character, not a rewrite.
  expect(terminalKey(k("b", { alt: true }), true)).toBe("pass");
  // Shift+arrows and the plain arrows are the emulator's.
  expect(terminalKey(k("ArrowLeft", { shift: true }), true)).toBe("pass");
  expect(terminalKey(k("ArrowLeft"), true)).toBe("pass");
});

test("Linux and Windows: the clipboard is on Ctrl+Shift, and Ctrl+C is SIGINT", () => {
  expect(terminalKey(k("C", { ctrl: true, shift: true, code: "KeyC" }), false)).toBe("copy");
  expect(terminalKey(k("V", { ctrl: true, shift: true, code: "KeyV" }), false)).toBe("host");
  expect(terminalKey(k("A", { ctrl: true, shift: true, code: "KeyA" }), false)).toBe("selectAll");
  expect(terminalKey(k("c", { ctrl: true }), false)).toBe("pass");
  expect(terminalKey(k("Backspace", { ctrl: true }), false)).toEqual({ send: "\x17" });
  // Ctrl+arrows already reach readline as its word motions.
  expect(terminalKey(k("ArrowLeft", { ctrl: true }), false)).toBe("pass");
  // The Mac rewrites do not leak onto another platform.
  expect(terminalKey(k("ArrowLeft", { alt: true }), false)).toBe("pass");
  expect(terminalKey(k("ArrowLeft", { meta: true }), false)).toBe("pass");
});

test("everywhere: Shift+Enter is a new line in an agent's prompt, and the host keeps its own keys", () => {
  for (const mac of [true, false]) {
    expect(terminalKey(k("Enter", { shift: true }), mac)).toEqual({ send: "\x1b\r" });
    expect(terminalKey(k("Enter"), mac)).toBe("pass");
    expect(terminalKey(k("`", { ctrl: true, code: "Backquote" }), mac)).toBe("host");
    expect(terminalKey(k("=", { ctrl: true }), mac)).toBe("host");
    expect(terminalKey(k("0", { meta: true }), mac)).toBe("host");
  }
});
