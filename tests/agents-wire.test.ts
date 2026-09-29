// SPDX-License-Identifier: AGPL-3.0-only
// The bounds on the one reading of the protocol, `server/platform/acp-wire.ts`,
// which the chats and the agents' probe share. What an agent sends as its
// pickers and its commands rides every `agents` event and every chat's
// `config` and `commands` update to every window, so no more is believed than
// a picker or a menu can hold. Every agent answer here is invented.
//
// What is held: lists are cut to their bounds; an id or a value too long to be
// the agent's own word is left out rather than cut; a name, a line or a hint
// is cut; an option id given twice is the first, because `chat.config` names
// one; and the older `modes` are the `mode` option — `_mode` where `mode` is
// taken — in the probe's reading and a chat's alike, since both are this one.

import { test, expect } from "bun:test";

import { WIRE_BOUNDS, toConfigOptions, toSlashCommands } from "../server/platform/acp-wire.ts";

const select = (id: string, choices: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Option ${id}`,
  type: "select",
  currentValue: "c0",
  options: Array.from({ length: choices }, (_, i) => ({ value: `c${i}`, name: `Choice ${i}` })),
  ...extra,
});

test("options and choices are cut to what a picker can hold", () => {
  const many = Array.from({ length: WIRE_BOUNDS.options + 10 }, (_, i) => select(`o${i}`, 1));
  expect(toConfigOptions(many, null).options.length).toBe(WIRE_BOUNDS.options);
  const wide = toConfigOptions([select("model", WIRE_BOUNDS.choices + 50, { category: "model" })], null).options[0];
  expect(wide?.choices.length).toBe(WIRE_BOUNDS.choices);
  // Grouped choices count against the same bound.
  const grouped = toConfigOptions([{
    id: "g",
    name: "G",
    type: "select",
    currentValue: "a0",
    options: [
      { group: "a", name: "A".repeat(500), options: Array.from({ length: 800 }, (_, i) => ({ value: `a${i}`, name: `A${i}` })) },
      { group: "b", name: "B", options: Array.from({ length: 800 }, (_, i) => ({ value: `b${i}`, name: `B${i}` })) },
    ],
  }], null).options[0];
  expect(grouped?.choices.length).toBe(WIRE_BOUNDS.choices);
  expect(grouped?.choices[0]?.group?.length).toBe(WIRE_BOUNDS.name);
});

test("an id or a value too long to be the agent's word is left out; a name or a description is cut; an id given twice is the first", () => {
  const read = toConfigOptions([
    select("x".repeat(WIRE_BOUNDS.id + 1), 1),
    { ...select("keep", 0), name: "N".repeat(1000), options: [{ value: "v".repeat(WIRE_BOUNDS.id + 1), name: "long value" }, { value: "ok", name: "Ok", description: "D".repeat(5000) }] },
    { id: "keep", name: "Second", type: "boolean", currentValue: true },
  ], null).options;
  expect(read.map((o) => o.id)).toEqual(["keep"]);
  expect(read[0]?.name.length).toBe(WIRE_BOUNDS.name);
  expect(read[0]?.choices.map((c) => c.value)).toEqual(["ok"]);
  expect(read[0]?.choices[0]?.description?.length).toBe(WIRE_BOUNDS.description);
});

test("the older modes are the mode option, under _mode where mode is taken, and bounded the same", () => {
  const modes = { currentModeId: "m0", availableModes: Array.from({ length: WIRE_BOUNDS.choices + 5 }, (_, i) => ({ id: `m${i}`, name: `Mode ${i}` })) };
  const alone = toConfigOptions([], modes);
  expect(alone.legacyMode).toBe("mode");
  expect(alone.options[0]?.choices.length).toBe(WIRE_BOUNDS.choices);
  const taken = toConfigOptions([{ id: "mode", name: "Style", type: "boolean", currentValue: false }], modes);
  expect(taken.legacyMode).toBe("_mode");
  expect(taken.options.map((o) => o.id)).toEqual(["mode", "_mode"]);
});

test("commands are cut to what a menu can hold, a name too long is left out, and words are cut", () => {
  const many = Array.from({ length: WIRE_BOUNDS.commands + 20 }, (_, i) => ({ name: `c${i}`, description: "d" }));
  expect(toSlashCommands(many).length).toBe(WIRE_BOUNDS.commands);
  const read = toSlashCommands([
    { name: "/" + "n".repeat(WIRE_BOUNDS.name + 1), description: "too long a name" },
    { name: "/review", description: "R".repeat(5000), input: { hint: "H".repeat(5000) } },
  ]);
  expect(read.map((c) => c.name)).toEqual(["review"]);
  expect(read[0]?.description.length).toBe(WIRE_BOUNDS.description);
  expect(read[0]?.hint?.length).toBe(WIRE_BOUNDS.hint);
});
