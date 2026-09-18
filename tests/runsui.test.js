// SPDX-License-Identifier: AGPL-3.0-only
// The pieces the automation screens share: the log follower that reads a
// finished log to its end in one draw, and the name asked in place of a
// dialog. Both are pure enough to hold without a browser.

import { test, expect } from "bun:test";
import { fileTree, followLog, TAIL_KEEP, lastLine, clock } from "../client/widgets/runsui.js";

/** A log of `size` bytes served in chunks of `chunk`, ended or not. */
function served(size, chunk, ended) {
  const whole = Array.from({ length: Math.ceil(size / 10) }, (_, i) => `line ${i}`).join("\n").slice(0, size);
  const reads = [];
  const readRun = async (_id, _stream, from = 0) => {
    reads.push(from);
    const text = whole.slice(from, from + chunk);
    return { text, next: from + text.length, ended };
  };
  return { whole, reads, readRun };
}

test("followLog reads a finished log to its end in one draw, and keeps only the tail", async () => {
  const size = 200 * 1024;
  const { whole, reads, readRun } = served(size, 64 * 1024, true);
  const tails = new Map();
  await followLog(readRun, tails, "r1");
  const tail = tails.get("r1");
  // Read until nothing more arrived — four chunks and one empty answer — not
  // one chunk per draw with the line at 64K shown as the last.
  expect(reads).toEqual([0, 65536, 131072, 196608, 204800]);
  expect(tail.next).toBe(size);
  expect(tail.ended).toBe(true);
  expect(tail.text.length).toBe(TAIL_KEEP);
  expect(lastLine(tail.text)).toBe(lastLine(whole));
  // Ended and caught up: not asked again.
  await followLog(readRun, tails, "r1");
  expect(reads.length).toBe(5);
});

test("followLog on a live log stops at nothing-new and asks again next draw", async () => {
  const { whole, reads, readRun } = served(1000, 64 * 1024, false);
  const tails = new Map();
  await followLog(readRun, tails, "r2");
  expect(reads).toEqual([0, whole.length]);
  expect(tails.get("r2").ended).toBe(false);
  await followLog(readRun, tails, "r2");
  expect(reads.length).toBe(3);
});

test("followLog keeps what it had when a read fails", async () => {
  const tails = new Map([["r3", { text: "kept", next: 4, ended: false }]]);
  await followLog(async () => { throw new Error("gone"); }, tails, "r3");
  expect(tails.get("r3")).toEqual({ text: "kept", next: 4, ended: false });
});

test("clock and lastLine", () => {
  expect(clock(0)).toBe("00:00");
  expect(clock(65 * 1000)).toBe("01:05");
  expect(clock(3601 * 1000)).toBe("1:00:01");
  expect(lastLine("a\nb\n\n")).toBe("b");
  expect(lastLine("")).toBe("");
});

/* ── the file tree ──────────────────────────────────────────────────────── */

/** The least DOM a tree needs: an element with a class, attributes, children,
 *  listeners, and `replaceChildren`. The `h` under test is `dom.js`'s shape. */
function fakeH(spec, props, ...kids) {
  const [head = "", ...classes] = String(spec).split(".");
  const el = { tag: head || "div", classes, attrs: {}, children: [], listeners: {}, text: "" };
  el.replaceChildren = (...nodes) => { el.children = nodes.filter((n) => n != null && n !== false); };
  el.fire = (name) => { for (const fn of el.listeners[name] ?? []) fn(); };
  if (props && props.constructor === Object) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) (el.listeners[k.slice(2)] ||= []).push(v);
      else if (k === "style") el.attrs.style = v;
      else el.attrs[k] = v;
    }
  } else if (props != null) kids.unshift(props);
  for (const k of kids.flat()) { if (k == null || k === false) continue; el.children.push(typeof k === "object" ? k : { text: String(k), children: [], classes: [] }); }
  return el;
}
const rowsOf = (tree) => tree.children.map((n) => ({ path: n.attrs["data-path"] ?? "root", dir: n.classes.includes("dir"), node: n }));
const names = (tree) => rowsOf(tree).map((r) => r.path);
const clickDir = (tree, path) => rowsOf(tree).find((r) => r.path === path).node.children[0].fire("click");

test("the tree lists the files of a level before its folders, so INSTRUCTIONS.md is the first row and not the last", () => {
  const files = [".agents/skills/deep/SKILL.md", ".agents/skills/deep/ref/a.md", ".agents/skills/deep/ref/more/b.md", ".agents/skills/tiny/SKILL.md", "INSTRUCTIONS.md"];
  const tree = fileTree(fakeH, { root: "the workspace", files, open: "INSTRUCTIONS.md", pick: () => {} });
  expect(names(tree)).toEqual(["root", "INSTRUCTIONS.md", ".agents", ".agents/skills", ".agents/skills/deep", ".agents/skills/deep/SKILL.md",
    ".agents/skills/deep/ref", ".agents/skills/deep/ref/a.md", ".agents/skills/deep/ref/more", ".agents/skills/deep/ref/more/b.md",
    ".agents/skills/tiny", ".agents/skills/tiny/SKILL.md"]);
});

test("the entries of a fold folder start shut, the one holding the open file starts open, and a click flips either — kept across a redraw", () => {
  const files = [".agents/skills/deep/SKILL.md", ".agents/skills/deep/ref/more/b.md", ".agents/skills/tiny/SKILL.md", "INSTRUCTIONS.md"];
  const folds = new Map();
  const draw = (open) => fileTree(fakeH, { root: "w", files, open, pick: () => {}, fold: [".agents/skills"], folds });
  // Shut: the skills folder is open and each skill is one closed row.
  let tree = draw("INSTRUCTIONS.md");
  expect(names(tree)).toEqual(["root", "INSTRUCTIONS.md", ".agents", ".agents/skills", ".agents/skills/deep", ".agents/skills/tiny"]);
  expect(rowsOf(tree)[4].node.children[0].attrs["aria-expanded"]).toBe("false");
  // The skill holding the open file starts open, all the way down to it.
  tree = draw(".agents/skills/deep/ref/more/b.md");
  expect(names(tree)).toEqual(["root", "INSTRUCTIONS.md", ".agents", ".agents/skills", ".agents/skills/deep", ".agents/skills/deep/SKILL.md",
    ".agents/skills/deep/ref", ".agents/skills/deep/ref/more", ".agents/skills/deep/ref/more/b.md", ".agents/skills/tiny"]);
  // A click opens a shut one in place, without the caller redrawing …
  tree = draw("INSTRUCTIONS.md");
  clickDir(tree, ".agents/skills/tiny");
  expect(names(tree)).toEqual(["root", "INSTRUCTIONS.md", ".agents", ".agents/skills", ".agents/skills/deep", ".agents/skills/tiny", ".agents/skills/tiny/SKILL.md"]);
  expect(folds.get(".agents/skills/tiny")).toBe(true);
  // … and a redraw by the caller keeps it, because the folds are the caller's.
  tree = draw("INSTRUCTIONS.md");
  expect(names(tree)).toContain(".agents/skills/tiny/SKILL.md");
  // WHAT IS KEPT IS THE CHOICE, NOT A FLIP OF THE DEFAULT: a skill opened by
  // hand and then picked into stays open, though the default under it moved.
  clickDir(tree, ".agents/skills/deep");
  tree = draw(".agents/skills/deep/ref/more/b.md");
  expect(names(tree)).toContain(".agents/skills/deep/ref/more/b.md");
  // A click shuts an open-by-default folder too, and shuts what is under it.
  clickDir(tree, ".agents");
  expect(names(tree)).toEqual(["root", "INSTRUCTIONS.md", ".agents"]);
  clickDir(tree, ".agents");
  expect(names(tree)).toContain(".agents/skills/tiny/SKILL.md");
});
