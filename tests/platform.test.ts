// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1's tests. The weight is on yaml.ts, because it is the module where
// being wrong is silent: a content.yaml that parses to the wrong thing loses a
// user's text without anybody's code throwing — and the text is IN there now,
// so a page that will not read has lost its words and not only its shape.
//
// THE ROUND TRIP IS EQUALITY OF MEANING, NOT OF BYTES, and that is the one
// thing in this file the format change moved. `format` writes the SHORT
// spelling for a markdown part with no variables of its own — `body: hello`
// rather than a three-line map — so a document read in the long spelling comes
// back in the short one and is still the same page. `sameDoc` inside the codec
// canonicalises both sides before it compares them, and `canonical` below is
// this file's own statement of the same equivalences. Anything stricter would
// be demanding that the writer refuse a document it had just read.

import { test, expect } from "bun:test";
import { mkdtemp, rm, symlink, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse, format, YamlError, FlatnessError } from "../server/platform/yaml.ts";
import { makeFiles, initVault, PathError } from "../server/platform/files.ts";
import { makeDb } from "../server/platform/db.ts";

import type { Content, PageDoc, Section, Variables } from "../contracts/types.ts";

const scratch = () => mkdtemp(join(tmpdir(), "biom-"));

/** The fixtures below are invented. Rendering rates, job names and everything
 *  priced in them represent nothing real.
 *
 *  Written in exactly the spelling `format` produces, because one of the two
 *  load-bearing properties is that a file this module wrote reads back byte for
 *  byte — so a fixture asserting that has to be a file this module would write. */
const PAGE = [
  "name: Rendering rates",
  "plugin: biom-doc",
  "variables:",
  "  rate: 62",
  "contents:",
  "  - name: intro",
  "    parts:",
  "      body: |",
  "        # Rendering rates",
  "",
  "        The base rate is {{rate}}.",
  "  - name: calc",
  "    data: calc.html",
  "    variables:",
  "      title: What a job costs",
  "    parts:",
  "      headline: |-",
  "        # Ship faster",
  "      figures:",
  "        type: table",
  "        data: jobs",
  "",
].join("\n");

/** A page reduced to what it MEANS, so two spellings of one document compare
 *  equal. Deliberately the same equivalences `sameDoc` makes inside the codec: a
 *  bare string is markdown with no variables of its own, and absent and empty
 *  are the same thing on a page, on a section and on a part alike. */
const canonical = (doc: PageDoc): unknown => ({
  name: doc.name,
  plugin: doc.plugin,
  input: doc.input ?? {},
  variables: doc.variables ?? {},
  contents: doc.contents.map((section) => ({
    name: section.name,
    data: section.data ?? "",
    variables: section.variables ?? {},
    // `Object.entries` keeps insertion order and `toEqual` ignores it, so the
    // ORDER of the slots is asserted on its own rather than smuggled in here.
    parts: Object.fromEntries(
      Object.entries(section.parts ?? {}).map(([id, part]) => [
        id,
        typeof part === "string"
          ? { type: "markdown", data: part, variables: {} }
          : { type: part.type, data: part.data, variables: part.variables ?? {} },
      ]),
    ),
  })),
});

/** A document holding one section with one slot in it, which is the shape most
 *  of the awkward-value tests below want. */
const oneSlot = (part: string | Content, name = "x"): PageDoc => ({
  name,
  plugin: "biom-doc",
  variables: {},
  contents: [{ name: "intro", parts: { body: part } }],
  input: {},
});

/* ── yaml: one file holds everything a page says ───────────────────────── */

test("the whole page comes out of one file, prose included", () => {
  expect(parse(PAGE)).toEqual({
    name: "Rendering rates",
    plugin: "biom-doc",
    input: {},
    variables: { rate: 62 },
    contents: [
      { name: "intro", parts: { body: "# Rendering rates\n\nThe base rate is {{rate}}.\n" } },
      {
        name: "calc",
        data: "calc.html",
        parts: { headline: "# Ship faster", figures: { type: "table", data: "jobs" } },
        variables: { title: "What a job costs" },
      },
    ],
  });
});

test("a page this module wrote reads back byte for byte", () => {
  // The property the first slot edit depends on: a save that reflows the file
  // turns one changed word into a diff nobody can read.
  expect(format(parse(PAGE))).toBe(PAGE);
});

test("markdown is written as a block scalar and never as a quoted line", () => {
  const text = format(oneSlot("# Heading\n\nTwo paragraphs, and a {{slot}}.\n"));
  expect(text).toContain("body: |");
  // The failure this is guarding: prose folded onto one line with escapes in it.
  expect(text).not.toContain("\\n");
  expect(text.split("\n")).toContain("        # Heading");
  expect(parse(text).contents[0]?.parts?.["body"]).toBe("# Heading\n\nTwo paragraphs, and a {{slot}}.\n");
});

test("interpolation is the client's job: the braces come back untouched", () => {
  const doc = parse(PAGE);
  expect(doc.contents[0]?.parts?.["body"]).toContain("{{rate}}");
  // Resolving here would round-trip 62 over the top of {{rate}} the first time
  // somebody edited the paragraph it sits in.
  expect(doc.contents[0]?.parts?.["body"]).not.toContain("62");
});

test("variables nest three deep, and each scope keeps its own", () => {
  const doc = parse(PAGE);
  expect(doc.variables).toEqual({ rate: 62 });
  expect(doc.contents[1]?.variables).toEqual({ title: "What a job costs" });

  const own = parse(
    [
      "name: x",
      "plugin: biom-doc",
      "contents:",
      "  - name: intro",
      "    parts:",
      "      body:",
      "        type: markdown",
      "        data: The base rate is {{rate}}.",
      "        variables:",
      "          rate: 62",
      "",
    ].join("\n"),
  );
  expect((own.contents[0]?.parts?.["body"] as Content).variables).toEqual({ rate: 62 });

  // The old spelling. `calc.title` is now a key of the `calc` section, so on a
  // DOC PAGE — whose shape is closed — a dotted key at the top level is simply
  // an unknown key. On a plugin page it would be that plugin's own input, which
  // is why the page has to say `plugin: biom-doc` for this to be a refusal at all.
  expect(() => parse("name: x\nplugin: biom-doc\ncalc.title: y\n")).toThrow(FlatnessError);
});

test("contents is the order, and the order is what comes back", () => {
  const doc = parse(
    ["name: Three", "plugin: biom-doc", "contents:", "  - name: c", "  - name: a", "  - name: b", ""].join("\n"),
  );
  expect(doc.contents.map((s) => s.name)).toEqual(["c", "a", "b"]);
  // and format does not sort it back into something tidier
  expect(parse(format(doc)).contents.map((s) => s.name)).toEqual(["c", "a", "b"]);
});

test("a slot's id is its key in parts, and the keys keep the order they were written in", () => {
  const doc = parse(
    [
      "name: x",
      "plugin: biom-doc",
      "contents:",
      "  - name: hero",
      "    data: hero.html",
      "    parts:",
      "      third: c",
      "      first: a",
      "      second: b",
      "",
    ].join("\n"),
  );
  expect(Object.keys(doc.contents[0]?.parts ?? {})).toEqual(["third", "first", "second"]);
  // A map that reordered its keys on a save would turn a one-word edit into an
  // unreadable diff, so the order is held even though the section's HTML is
  // what actually decides where a slot draws.
  expect(Object.keys(parse(format(doc)).contents[0]?.parts ?? {})).toEqual(["third", "first", "second"]);
});

test("a bare string is markdown, and the short spelling survives a save", () => {
  const short = parse("name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: hello\n");
  expect(short.contents[0]?.parts?.["body"]).toBe("hello");

  const long = parse(
    "name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body:\n        type: markdown\n        data: hello\n",
  );
  expect(long.contents[0]?.parts?.["body"]).toEqual({ type: "markdown", data: "hello" });

  // The two are the same page, which is exactly what the round trip promises —
  // and the one `format` writes is the short one, so an edit to a plain
  // paragraph is not a three-line diff.
  expect(canonical(short)).toEqual(canonical(long));
  expect(format(long)).toBe(format(short));
  expect(format(short)).not.toContain("type: markdown");
  // Prose gets the block scalar, which is the readable spelling of a string.
  expect(format(short)).toBe("name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: |-\n        hello\n");
});

test("a Content has no name of its own: the key in parts already states it", () => {
  expect(() =>
    parse(
      "name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body:\n        name: body\n        type: markdown\n        data: hi\n",
    ),
  ).toThrow(FlatnessError);
  expect(() =>
    parse(
      "name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body:\n        name: body\n        type: markdown\n        data: hi\n",
    ),
  ).toThrow(/"name" is not part of/);
});

test("a bare number or boolean in a slot is prose YAML read as a value", () => {
  // `body: 2026` is a paragraph somebody forgot to quote, not a broken page.
  const doc = parse("name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: 2026\n      done: true\n");
  expect(doc.contents[0]?.parts).toEqual({ body: "2026", done: "true" });
});

test("a section that names no file takes the shipped default, spelled by an absence", () => {
  const doc = parse("name: x\nplugin: biom-doc\ncontents:\n  - name: intro\n    parts:\n      body: hello\n");
  expect(doc.contents[0]?.data).toBeUndefined();
  // Writing `data: null` on every plain section would put a key in the file
  // that says nothing, so the absence is what the writer produces too.
  expect(format(doc)).not.toContain("data:");
  expect(format({ name: "x", plugin: "biom-doc", variables: {}, contents: [{ name: "intro", data: "" }], input: {} })).not.toContain("data:");
});

test("a child key is one segment and stays a legal filename", () => {
  // Two parents may each hold a "notes": the key is scoped to the file it is in.
  const doc = parse(
    [
      "name: Team",
      "plugin: biom-doc",
      "contents:",
      "  - name: \"@page-Notes\"",
      "    parts:",
      "      body:",
      "        type: child",
      "        data: Notes",
      "",
    ].join("\n"),
  );
  expect(doc.contents[0]).toEqual({
    name: "@page-Notes",
    parts: { body: { type: "child", data: "Notes" } },
  });
  expect(format(doc)).toContain("@page-Notes");
});

test("plugin: names the ONE reader that draws a page, and its own keys pass through untouched", () => {
  const doc = parse(
    ["name: Plants", "plugin: biom-kanban", "input:", "  table: plants", "  lanes: status", "  name: species", "  show:", "    - bed", "    - height", ""].join("\n"),
  );
  // The host has no opinion about a plugin's input and never validates it,
  // because a host that validated one would have to know every plugin. It sits
  // UNDER `input:` so the host's keys and the plugin's cannot collide — which
  // they would here: the board titles its cards by a column called `name`.
  expect(doc.plugin).toBe("biom-kanban");
  expect(doc.input).toEqual({ table: "plants", lanes: "status", name: "species", show: ["bed", "height"] });
  expect(doc.name).toBe("Plants");
  // A plugin page has no sections: a section is the doc plugin's concept.
  expect(doc.contents).toEqual([]);
  expect(parse(format(doc))).toEqual(doc);

  // `page:` was the list of plugins mounting on the whole page. One page, one
  // plugin now, so the old key is refused by name rather than read as input.
  expect(() => parse("name: x\nplugin: biom-kanban\npage:\n  - plugin: progress\n")).toThrow(/older format/);
  // And a plugin's key beside the host's, rather than under input:, is refused
  // on every kind of page.
  expect(() => parse("name: x\nplugin: biom-kanban\ntable: plants\n")).toThrow(FlatnessError);
  expect(() => parse("name: x\nplugin: Kanban\n")).toThrow(FlatnessError);
  expect(() => parse("name: x\nplugin: 3\n")).toThrow(FlatnessError);
});

/* ── yaml: the defaults, and what is refused instead ───────────────────── */

test("what a page may leave out, and what it gets when it does", () => {
  // A page that names no plugin is its own html: the shape with the fewest
  // assumptions in it, and what a page written by hand outside this format is.
  expect(parse("name: Bare\n")).toEqual({ name: "Bare", plugin: "html", variables: {}, contents: [], input: {} });
  expect(parse("name: Bare\nplugin: biom-doc\n")).toEqual({ name: "Bare", plugin: "biom-doc", variables: {}, contents: [], input: {} });
  // A page with no name at all: the domain names it after its folder, so this
  // is a blank rather than a refusal.
  expect(parse("contents: []\n").name).toBe("");
  // `page:` is gone entirely: there is no key by that name on a PageDoc.
  expect(Object.hasOwn(parse("name: Bare\n"), "page")).toBe(false);
});

test("a page with nothing in it is a page, and contents is written even when it is empty", () => {
  const text = format({ name: "Job board", plugin: "biom-doc", variables: {}, contents: [], input: {} });
  // `plugin:` is ALWAYS written, even where the file it came from left it out —
  // a page that states what draws it can be read by somebody who has never seen
  // this format, and the default is only a default at the moment of parsing.
  expect(text).toBe(["name: Job board", "plugin: biom-doc", "contents: []", ""].join("\n"));
  expect(format(parse(text))).toBe(text);
});

/** THE FILE A PERSON MIGRATING ACTUALLY HITS. Each of these keys was a fact the
 *  format used to state, and each is refused BY NAME with the sentence that says
 *  what replaced it — because "unknown key" tells somebody their page is broken
 *  and this tells them which format it was written for. */
const RETIRED: [string, string, RegExp][] = [
  ["kind", "kind: doc", /one kind of page/],
  ["render", "render: null", /the render is gone/],
  ["order", "order: [calc]", /contents IS the order/],
  ["parent", "parent: home", /the folder a page sits in is where it is/],
  ["sections", "sections: [calc]", /the key is contents/],
];

for (const [key, line, says] of RETIRED) {
  test(`the retired key ${key}: is refused by name, with what replaced it`, () => {
    const bad = "name: Old\n" + line + "\n";
    expect(() => parse(bad)).toThrow(FlatnessError);
    expect(() => parse(bad)).toThrow(new RegExp('"' + key + '" is from an older format'));
    expect(() => parse(bad)).toThrow(says);
  });
}

test("a retired key one level down is refused by name too", () => {
  // A section written for the format before this one carries `kind:` or
  // `render:` on the entry rather than on the page.
  for (const line of ["kind: doc", "render: plain", "order: 1"]) {
    const bad = "name: x\nplugin: biom-doc\ncontents:\n  - name: calc\n    " + line + "\n";
    expect(() => parse(bad)).toThrow(FlatnessError);
    expect(() => parse(bad)).toThrow(/is from an older format/);
  }
  // `type:` on a `contents` entry is the sharpest one, because a contents entry
  // used to carry exactly that. It is refused as a key a SECTION does not have:
  // a section is the only thing contents can hold, so there is nothing for a
  // type to distinguish.
  expect(() => parse("name: x\nplugin: biom-doc\ncontents:\n  - name: calc\n    type: markdown\n    data: hi\n")).toThrow(
    /"type" is not part of contents entry 1/,
  );
});

test("a document that is YAML and is not a page throws FlatnessError", () => {
  const notPages = [
    "", // an empty file
    "just a scalar",
    "- a\n- b", // a list at the root
    // (a key that is not part of a page is now a PLUGIN PAGE'S INPUT — the case
    //  that is still a refusal is the same key on a doc page, below)
    "name: x\nplugin: biom-doc\ncontents: nope", // contents is a list
    "name: x\nplugin: biom-doc\ncontents:\n  - just a string",
    "name: x\nplugin: biom-doc\ncontents:\n  - data: calc.html", // a section with no name
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n  - name: a", // one name, one section
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n    extra: z",
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n    parts: body", // parts is a map
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n    parts:\n      body:\n        type: diagram\n        data: y", // gone
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n    parts:\n      body:\n        type: markdown\n        data: y\n        extra: z",
    "name: x\nplugin: biom-doc\ncontents:\n  - name: a\n    parts:\n      body:\n        type: markdown\n        data: [a, b]",
    "name: x\nvariables:\n  rate:\n    tier: 1", // a variable is a scalar
    "name: x\nvariables:\n  rate: [[1, 2]]", // or a list of them, once
    "name: x\nplugin: biom-doc\nextra: y", // a doc page's shape is closed
    "__proto__: 1",
    "name: x\nvariables:\n  __proto__: 1",
  ];
  for (const text of notPages) {
    expect(() => parse(text), text).toThrow(FlatnessError);
    // and a FlatnessError is a YamlError, so one catch covers the wire's
    // `flatness` code for both halves
    expect(() => parse(text), text).toThrow(YamlError);
  }
  expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
});

test("YAML that will not parse throws YamlError and not FlatnessError, and says which line", () => {
  const broken = [
    "name: x\nplugin: biom-doc\ncontents: [1, 2",
    "name: 'unterminated",
    "name: x\nname: y", // one key, one value
    "name: x\n\tvariables: {}", // a tab as indentation
  ];
  for (const text of broken) {
    expect(() => parse(text), text).toThrow(YamlError);
    expect(() => parse(text), text).not.toThrow(FlatnessError);
  }

  try {
    parse("name: x\nname: y\n");
    throw new Error("expected a throw");
  } catch (e) {
    expect(e).toBeInstanceOf(YamlError);
    expect(e).not.toBeInstanceOf(FlatnessError);
    expect((e as YamlError).line).toBe(2);
    // the message is one sentence, not a terminal-shaped block with the source
    // in it — that block goes to the wire otherwise
    expect((e as YamlError).message).not.toContain("\n");
  }
});

test("the scalars are YAML 1.2 core, so the Norway bug is not reproduced", () => {
  const doc = parse(
    ["name: Codes", "variables:", "  a: no", "  b: yes", "  c: on", "  d: off", "  e: 1.2.3", "  f: 12px", ""].join("\n"),
  );
  expect(doc.variables).toEqual({ a: "no", b: "yes", c: "on", d: "off", e: "1.2.3", f: "12px" });
});

test("every variable type reads back as itself, lists included", () => {
  const doc = parse(
    [
      "name: Rates",
      "variables:",
      "  rate: 62",
      "  fine: 42.5",
      "  done: true",
      "  draft: false",
      "  note: null",
      "  blank:",
      "  access: [Ground, Stairs, Scaffold]",
      "  tiers: [1, 1.15, 1.35]",
      "  mixed: [true, null, x]",
      "  empty: []",
      "",
    ].join("\n"),
  );
  expect(doc.variables).toEqual({
    rate: 62,
    fine: 42.5,
    done: true,
    draft: false,
    note: null,
    blank: null,
    access: ["Ground", "Stairs", "Scaffold"],
    tiers: [1, 1.15, 1.35],
    mixed: [true, null, "x"],
    empty: [],
  });
});

/* ── yaml: writing ─────────────────────────────────────────────────────── */

test("format is a pure function of the document and puts the keys in one order", () => {
  const a: PageDoc = {
    name: "Job board",
    plugin: "biom-doc",
    variables: { heading: "This week" },
    contents: [{ name: "hero", data: "hero.html", variables: { standfirst: "Four releases" }, parts: { body: "hi" } }],
    input: {},
  };
  const b: PageDoc = {
    contents: [{ parts: { body: "hi" }, variables: { standfirst: "Four releases" }, data: "hero.html", name: "hero" }],
    input: {},
    variables: { heading: "This week" },
    plugin: "biom-doc",
    name: "Job board",
  };
  expect(format(a)).toBe(format(b));
  expect(format(a)).toBe(
    [
      "name: Job board",
      "plugin: biom-doc",
      "variables:",
      "  heading: This week",
      "contents:",
      "  - name: hero",
      "    data: hero.html",
      "    variables:",
      "      standfirst: Four releases",
      "    parts:",
      "      body: |-",
      "        hi",
      "",
    ].join("\n"),
  );
});

test("an empty variables map is left out rather than written as furniture", () => {
  const text = format({
    name: "Bare",
    plugin: "biom-doc",
    variables: {},
    contents: [{ name: "intro", parts: { body: "words" }, variables: {} }],
  });
  expect(text).not.toContain("variables");
  // and handing it back in gives the same file, which is what makes {} and
  // absent the same thing rather than two states that drift apart
  expect(format(parse(text))).toBe(text);
});

test("format refuses what has no spelling rather than writing a lie", () => {
  const base: PageDoc = { name: "x", variables: {}, contents: [] };
  for (const variables of [
    { a: Number.NaN },
    { a: Number.POSITIVE_INFINITY },
    { a: { b: 1 } as never },
    { a: [["x"]] as never },
    // JSON.parse, because an object literal with this key sets the prototype
    // instead of adding one — which is exactly why it is refused off disk.
    JSON.parse('{"__proto__": 1}') as Variables,
  ]) {
    expect(() => format({ ...base, variables })).toThrow(YamlError);
  }
});

test("a long line is written long, because folding it would reflow the diff", () => {
  const long = "A single sentence about rendering that runs well past eighty characters and keeps going.";
  const text = format({ name: "x", plugin: "biom-doc", variables: { blurb: long }, contents: [], input: {} });
  expect(text).toContain(long);
  expect(text.split("\n").some((l) => l.length > 80)).toBe(true);
});

/* ── yaml: the round trip, which is the property that matters ──────────── */

/** The file is written as UTF-8. A lone surrogate has no encoding there, so a
 *  value that only survives in memory has not survived at all — the round trip
 *  has to hold through the bytes, not just through the parser. */
const throughDisk = (text: string): string => new TextDecoder().decode(new TextEncoder().encode(text));

// The set somebody thought of, and then the set that arrives anyway. U+2028
// leads the second: Word emits it for a soft line break and a web copy-paste
// carries it through, so it reaches a slot the first time anybody pastes a
// sentence into one. It is invisible, `\n` does not match it, and every other
// reader of the file treats it as a break.
const CONTROLS = Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i));

const AWKWARD: string[] = [
  "",
  " ",
  "  padded  ",
  "plain",
  "Rendering rates",
  "true",
  "TRUE",
  "null",
  "~",
  "yes",
  "no",
  "007",
  "12",
  "-3.5",
  "1e10",
  "1.2.3",
  "+5",
  "#hash",
  "a # b",
  "key: value",
  "ends:",
  "- dash",
  "? question",
  "[bracket]",
  "{brace}",
  "{{rate}}",
  "a, b",
  "]",
  ",",
  '"quoted"',
  "it's",
  "back\\slash",
  "c:\\path\\to",
  "tab\there",
  "line\nbreak",
  "# Heading\n\nA paragraph.\n",
  "trailing space \nand more",
  "a\n  \nb", // a whitespace-only line, which a block scalar cannot hold
  "\n",
  "\n\n",
  "ends with newline\n",
  " leading",
  "trailing ",
  "\ttab-led",
  "£4,180 — Ashgrove",
  "emoji 🧱",
  "2026-08-16",
  "2026-08-16T10:30:00Z",
  "1:30",
  "12:00 PM",
  "\u2028",
  "\u2029",
  "before\u2028after",
  "both\u2028and\u2029",
  ...CONTROLS,
  ...CONTROLS.map((c) => "x" + c + "y"),
  "\u007f",
  "\ud800",
  "\udfff",
  "a\ud83db",
  "lone \udc00 low",
  "paired 🧱 is not lone",
];

const roundTrips = (doc: PageDoc): void => {
  const text = format(doc);
  // EQUALITY OF MEANING: `format` writes the short spelling wherever it means
  // the same thing, so the comparison is between the canonical forms.
  expect(canonical(parse(text))).toEqual(canonical(doc));
  expect(canonical(parse(throughDisk(text)))).toEqual(canonical(doc));
  // the canonical form is a fixed point, so a re-save is an empty diff
  expect(format(parse(text))).toBe(text);
};

test("parse(format(x)) is x, for every awkward value in every place one can sit", () => {
  for (const s of AWKWARD) {
    // as prose, in both spellings of a markdown slot
    roundTrips(oneSlot(s));
    roundTrips(oneSlot({ type: "markdown", data: s }));
    // as what a slot of every other type points at
    roundTrips(oneSlot({ type: "html", data: s }));
    roundTrips(oneSlot({ type: "table", data: s }));
    roundTrips(oneSlot({ type: "child", data: s }));
    // as a page variable, a section variable, a part variable, a list item, the
    // page's name, a section's name and the file a section names
    roundTrips({
      name: s,
      plugin: "biom-doc",
      variables: { one: s, many: [s, "after"] },
      contents: [
        {
          name: "calc",
          data: s,
          variables: { title: s },
          parts: { body: { type: "markdown", data: s, variables: { rate: s } } },
        },
      ],
    });
  }
});

test("format always ends the file with a newline and never leaves a NUL in it", () => {
  for (const s of AWKWARD) {
    const text = format({
      name: "x",
      plugin: "biom-doc",
      variables: { v: s },
      contents: [{ name: "intro", data: s, parts: { body: s } }],
    });
    expect(text.endsWith("\n")).toBe(true);
    // A NUL is invisible and makes grep treat the whole file as binary, so
    // every search of a vault would return nothing rather than something wrong.
    // The writer escapes it; this is the assertion that it kept doing so.
    expect(text).not.toContain("\u0000");
  }
});

test("U+2028 is written RAW, which is the one thing the vendored writer does not escape", () => {
  // The old hand-rolled writer escaped it, because it split lines with a regex
  // and a raw one split a line that must never split. A real YAML 1.2 reader
  // does not treat it as a break, so the round trip holds \u2014 but an EDITOR does,
  // and so does any agent grepping the vault with a `.`-based pattern. It is
  // recorded here rather than worked around, because working around it would
  // mean either editing a vendored file or dropping a character out of somebody
  // else's sentence.
  const doc: PageDoc = { name: "x", plugin: "biom-doc", variables: { v: "before\u2028after" }, contents: [], input: {} };
  const text = format(doc);
  expect(text).toContain("\u2028");
  expect(parse(text)).toEqual(doc);
  expect(parse(throughDisk(text))).toEqual(doc);
});

test("prose gets the readable spelling and only the awkward cases get quotes", () => {
  const readable = ["# Heading\n\nA paragraph with {{rate}} in it.\n", "one line", "a\nb\nc", "ends without a newline"];
  for (const data of readable) {
    expect(format(oneSlot(data))).toContain("body: |");
  }
  // and the ones a block scalar cannot hold fall back rather than lose a line
  for (const data of ["trailing space \nmore", "a\n  \nb", "\u2028", " indented first line"]) {
    expect(canonical(parse(format(oneSlot(data))))).toEqual(canonical(oneSlot(data)));
  }
});

test("parse(format(x)) is x, for fuzzed documents over the awkward alphabet", () => {
  // Deterministic, so a failure is reproducible: the same seed builds the same
  // documents on every machine.
  const alphabet = [
    "\u2028", "\u2029", "\u0000", "\u0001", "\u0007", "\n", "\r", "\t", "\u000b",
    "\u001b", "\u007f", "\ud800", "\udfff", "🧱", " ", '"', "'", "\\", ":", "#",
    ",", "[", "]", "{", "}", "-", "+", ".", "0", "7", "e", "a", "Z", "£", "—",
    "{{", "}}", "|", ">", "@", "`", "!",
  ];
  const types = ["markdown", "html", "table", "child"] as const;

  let seed = 20260816;
  const rand = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  const values: (string | number | boolean | null | (string | number | boolean | null)[])[] = [];
  for (let i = 0; i < 300; i++) {
    let s = "";
    for (let j = 0, len = rand(7); j <= len; j++) s += alphabet[rand(alphabet.length)];
    values.push(s);
  }
  values.push("", [], [""], ["", ""], [null], [0, false], 0, -1, 42, 3.14, 1e21, true, false, null);

  const pick = (): string => {
    let s = "";
    for (let j = 0, len = rand(9); j <= len; j++) s += alphabet[rand(alphabet.length)];
    return s;
  };

  const vars = (): Variables => {
    const out: Variables = {};
    for (let i = 0, n = rand(4); i < n; i++) out["v" + String(i)] = values[rand(values.length)] as never;
    return out;
  };

  for (let run = 0; run < 200; run++) {
    const contents: Section[] = [];
    for (let i = 0, n = rand(4); i < n; i++) {
      const section: Section = { name: "s" + String(i) };
      if (rand(2) === 0) section.data = pick();

      const parts: Record<string, string | Content> = {};
      for (let k = 0, m = rand(4); k < m; k++) {
        // BOTH SPELLINGS OF A SLOT, because the writer chooses between them and
        // a fuzz that only ever produced one would never exercise the choice.
        if (rand(3) === 0) {
          parts["p" + String(k)] = pick();
          continue;
        }
        const part: Content = { type: types[rand(types.length)] ?? "markdown", data: pick() };
        const own = vars();
        if (Object.keys(own).length > 0) part.variables = own;
        parts["p" + String(k)] = part;
      }
      if (Object.keys(parts).length > 0) section.parts = parts;

      const own = vars();
      if (Object.keys(own).length > 0) section.variables = own;
      contents.push(section);
    }

    const doc: PageDoc = { name: pick(), plugin: "biom-doc", variables: vars(), contents, input: {} };
    roundTrips(doc);
  }
});

/* ── files ─────────────────────────────────────────────────────────────── */

test("write, read, list and remove, on vault-relative paths", async () => {
  const root = await scratch();
  try {
    const files = makeFiles(root);
    expect(await files.read("pages/team-notes/content.yaml")).toBe(null);

    await files.write("pages/team-notes/content.yaml", "name: Team notes\n");
    expect(await files.read("pages/team-notes/content.yaml")).toBe("name: Team notes\n");

    await files.write("pages/team-notes/calc.html", "<p>hello</p>");
    expect(await files.list("pages/team-notes")).toEqual([
      { name: "calc.html", dir: false },
      { name: "content.yaml", dir: false },
    ]);
    expect(await files.list("pages")).toEqual([{ name: "team-notes", dir: true }]);
    expect(await files.list("nowhere")).toEqual([]);

    // a page is a directory, so remove is recursive, and removing twice is fine
    await files.remove("pages/team-notes");
    await files.remove("pages/team-notes");
    expect(await files.list("pages")).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("created answers when a path was made, as an ISO instant, and null for one that is not there", async () => {
  const root = await scratch();
  try {
    const files = makeFiles(root);
    expect(await files.created!("pages/nowhere")).toBe(null);
    const before = Date.now() - 5000;
    await files.write("pages/team-notes/content.yaml", "name: Team notes\n");
    const when = await files.created!("pages/team-notes");
    expect(typeof when).toBe("string");
    const ms = Date.parse(when!);
    // A real instant, in the last few seconds: the birth time where the
    // filesystem keeps one, the modification time where it does not.
    expect(isNaN(ms)).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now() + 5000);
    await expect(files.created!("../outside")).rejects.toBeInstanceOf(PathError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every path that would leave the vault is refused", async () => {
  const root = await scratch();
  try {
    const files = makeFiles(root);
    const escapes = ["../outside.txt", "pages/../../outside.txt", "/etc/passwd", "", ".", "a\u0000b"];
    for (const rel of escapes) {
      await expect(files.read(rel)).rejects.toBeInstanceOf(PathError);
      await expect(files.write(rel, "x")).rejects.toBeInstanceOf(PathError);
      await expect(files.remove(rel)).rejects.toBeInstanceOf(PathError);
    }
    // list may see the root — that is how the tree is enumerated — but never above it
    expect(await files.list("")).toEqual([]);
    await expect(files.list("..")).rejects.toBeInstanceOf(PathError);
    // and a path that merely looks like an escape is fine
    await files.write("pages/a..b/x.md", "ok");
    expect(await files.read("pages/a..b/x.md")).toBe("ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a symlink out of the vault is refused, live or dangling", async () => {
  const root = await scratch();
  const outside = await scratch();
  try {
    await writeFile(join(outside, "secret.txt"), "not yours");
    await mkdir(join(root, "pages"), { recursive: true });
    await symlink(join(outside, "secret.txt"), join(root, "pages", "live.txt"));
    await symlink(join(outside, "gone.txt"), join(root, "pages", "dangling.txt"));
    await symlink(outside, join(root, "pages", "away"));

    const files = makeFiles(root);
    await expect(files.read("pages/live.txt")).rejects.toBeInstanceOf(PathError);
    // the dangling one matters most: writing through it would create the file
    await expect(files.write("pages/dangling.txt", "x")).rejects.toBeInstanceOf(PathError);
    await expect(files.write("pages/away/new.txt", "x")).rejects.toBeInstanceOf(PathError);
    await expect(files.list("pages/away")).rejects.toBeInstanceOf(PathError);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("commit is a silent no-op until the vault is a git repo, then it is the undo", async () => {
  const root = await scratch();
  try {
    const files = makeFiles(root);
    await files.write("pages/a/content.yaml", "name: A\n");
    await files.commit("before the agent write"); // no repo yet: nothing happens, nothing throws

    expect(await initVault(root)).toBe(true);
    expect(await initVault(root)).toBe(false); // idempotent, which every run after the first is

    await files.commit("seed");
    await files.write("pages/a/content.yaml", "name: B\n");
    await files.commit("the agent wrote a page");
    await files.commit("nothing changed"); // an empty commit is not a failure

    const log = Bun.spawnSync(["git", "log", "--format=%s"], { cwd: root });
    const subjects = log.stdout.toString().trim().split("\n");
    expect(subjects).toEqual(["the agent wrote a page", "seed"]);

    // the history is real: the previous text is recoverable, which is the whole
    // reason snapshot and rollback are out of scope — and it matters MORE than
    // it did, because a page's prose is in this file now
    const before = Bun.spawnSync(["git", "show", "HEAD~1:pages/a/content.yaml"], { cwd: root });
    expect(before.stdout.toString()).toBe("name: A\n");

    // and .git is this module's own bookkeeping, not a page
    expect(await files.list("")).toEqual([{ name: "pages", dir: true }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/* ── db ────────────────────────────────────────────────────────────────── */

test("statements, parameters and what comes back", () => {
  const db = makeDb(":memory:");
  try {
    db.run("CREATE TABLE jobs (id INTEGER PRIMARY KEY, name TEXT, done INTEGER, rate REAL, note TEXT)");

    const first = db.run("INSERT INTO jobs (name, done, rate, note) VALUES (?, ?, ?, ?)", [
      "Ashgrove",
      true, // SQLite has no boolean; the wrapper binds it as one
      4180.5,
      null,
    ]);
    expect(first.changes).toBe(1);
    expect(first.lastInsertRowid).toBe(1);

    db.run("INSERT INTO jobs (name, done) VALUES (?, ?)", ["Fenton", false]);
    expect(db.all("SELECT * FROM jobs ORDER BY id")).toEqual([
      { id: 1, name: "Ashgrove", done: 1, rate: 4180.5, note: null },
      { id: 2, name: "Fenton", done: 0, rate: null, note: null },
    ]);

    // a parameter is a parameter, never a substring of the statement
    expect(db.all("SELECT id FROM jobs WHERE name = ?", ["Ashgrove' OR 1=1 --"])).toEqual([]);

    const updated = db.run("UPDATE jobs SET rate = ? WHERE name = ?", [10, "Fenton"]);
    expect(updated.changes).toBe(1);
  } finally {
    db.close();
  }
});

test("a whole script runs in one call, which is how a generated schema lands", () => {
  const db = makeDb(":memory:");
  try {
    db.run(
      [
        "CREATE TABLE _tables (name TEXT PRIMARY KEY, kind TEXT NOT NULL);",
        "CREATE TABLE _columns (\"table\" TEXT NOT NULL REFERENCES _tables(name) ON DELETE CASCADE, name TEXT NOT NULL);",
        "INSERT INTO _tables (name, kind) VALUES ('rates', 'basic');",
        "INSERT INTO _columns (\"table\", name) VALUES ('rates', 'tier');",
      ].join("\n"),
    );
    expect(db.all("SELECT name FROM _tables")).toEqual([{ name: "rates" }]);

    // foreign keys are on, or the registry's cascades mean nothing
    db.run("DELETE FROM _tables WHERE name = 'rates'");
    expect(db.all("SELECT count(*) AS n FROM _columns")).toEqual([{ n: 0 }]);
  } finally {
    db.close();
  }
});

test("a transaction commits on return and rolls back on a throw", () => {
  const db = makeDb(":memory:");
  try {
    db.run("CREATE TABLE t (x INTEGER)");

    expect(
      db.tx(() => {
        db.run("INSERT INTO t VALUES (1)");
        return "returned";
      }),
    ).toBe("returned");
    expect(db.all("SELECT count(*) AS n FROM t")).toEqual([{ n: 1 }]);

    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES (2)");
        throw new Error("the write failed halfway");
      }),
    ).toThrow("the write failed halfway");
    expect(db.all("SELECT count(*) AS n FROM t")).toEqual([{ n: 1 }]);
  } finally {
    db.close();
  }
});

test("a database file is created, parent directory and all", async () => {
  const root = await scratch();
  try {
    const db = makeDb(join(root, "vault", "workspace.db"));
    db.run("CREATE TABLE t (x INTEGER)");
    db.run("INSERT INTO t VALUES (7)");
    db.close();

    const again = makeDb(join(root, "vault", "workspace.db"));
    expect(again.all("SELECT x FROM t")).toEqual([{ x: 7 }]);
    again.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a list in a slot survives a round trip, and is spelled as a list", () => {
  // A repeating thing is an array of values, so the file has to read like one:
  // a YAML list of block scalars, which is what somebody typed and what they
  // will edit by hand when they open it.
  const doc: PageDoc = {
    name: "Board",
    plugin: "biom-doc",
    variables: {},
    contents: [{
      name: "cards",
      data: "cards.html",
      parts: { items: ["### Alpha\n\nFirst.", "### Bravo\n\nSecond."] },
    }],
    input: {},
  };

  const text = format(doc);
  expect(text).toContain("items:");
  // Two entries, each its own block scalar rather than one joined string.
  expect(text.match(/^\s+- \|-?$/gm) ?? []).toHaveLength(2);

  // parse(format(d)) equals d — the property this module is built on.
  expect(parse(text)).toEqual(doc);
});
