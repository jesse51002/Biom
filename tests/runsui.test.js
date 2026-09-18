// SPDX-License-Identifier: AGPL-3.0-only
// The pieces the automation screens share: the log follower that reads a
// finished log to its end in one draw, and the name asked in place of a
// dialog. Both are pure enough to hold without a browser.

import { test, expect } from "bun:test";
import { followLog, TAIL_KEEP, lastLine, clock } from "../client/widgets/runsui.js";

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
