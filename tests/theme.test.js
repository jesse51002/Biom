// SPDX-License-Identifier: AGPL-3.0-only
// The theme module. What is worth a test here is the one conversion that
// crosses into the box, the two hand-copies of the token rule — the shim's and
// tokens.css's — the apply path onto the host document, and the one that will
// actually catch something: a hex literal creeping back into a file that is not
// `palettes.js`.
//
// THE CHROME FOLLOWS THE VAULT, so there is an apply path again and it is worth
// more than the old one was: it decides what the whole window looks like, not
// just what a page is handed. `applyTheme` takes its root as a parameter for
// exactly this — these tests run with no document — so what is asserted is the
// full set of properties written and the scheme chosen, against a stub.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_THEME, cleanName, tokenOf } from "../client/theme/palettes.js";
import { applyTheme, hostVars, lumaOf, paperOf, schemeOf, shadowOf, themeVars } from "../client/theme/theme.js";
import { FACES, faceCss } from "../client/theme/faces.js";

const ROOT = join(import.meta.dir, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** A document root that is not one: `applyTheme` writes here in these tests. */
function stub() {
  /** @type {Record<string, string>} */
  const props = {};
  return {
    props,
    style: { colorScheme: "", setProperty: (name, value) => { props[name] = value; } },
  };
}

/** The same theme wearing a different palette, so a light case and a dark case
 *  are one line each rather than a second fixture to keep in step. */
const wearing = (colors) => ({
  ...DEFAULT_THEME,
  palette: { ...DEFAULT_THEME.palette, colors: { ...DEFAULT_THEME.palette.colors, ...colors } },
});

test("themeVars produces every role, every extra and all three faces", () => {
  const vars = themeVars(DEFAULT_THEME);

  // This is what crosses into the artifact frame, where var(--ink) resolves to
  // nothing until the shim re-declares it. A role missing here is a role that
  // silently stops existing inside every generated page.
  for (const key of Object.keys(DEFAULT_THEME.palette.colors)) {
    expect(vars[tokenOf(key)]).toBe(DEFAULT_THEME.palette.colors[key]);
  }
  for (const x of DEFAULT_THEME.palette.extra) {
    expect(vars[tokenOf(x.name)]).toBe(x.value);
  }
  for (const token of ["--sheet-face", "--furniture-face", "--gauge-face"]) {
    expect(typeof vars[token]).toBe("string");
  }
  // A role holds a face NAME; the token has to hold its STACK.
  const sheet = DEFAULT_THEME.fonts.available.find((f) => f.name === DEFAULT_THEME.fonts.roles.sheet);
  expect(vars["--sheet-face"]).toBe(sheet.stack);
});

test("a page's paper is its palette's lightest stock, and nothing before the vault answers", () => {
  // The box is transparent, so the host paints the canvas under it with THIS:
  // the page's own paper, which is not the workspace's stock. A null theme
  // paints nothing, which leaves the canvas until the vault has answered.
  expect(paperOf(DEFAULT_THEME)).toBe(DEFAULT_THEME.palette.colors.stockHi);
  expect(paperOf({ ...DEFAULT_THEME, palette: { name: "", colors: { stock: "cream" }, extra: [] } })).toBe("cream");
  expect(paperOf({ ...DEFAULT_THEME, palette: { name: "", colors: {}, extra: [] } })).toBeNull();
});

// ── the chrome follows the vault ────────────────────────────────────────────
//
// Everything below guards the apply path. The light case is the shipped palette
// with its stock and its ink SWAPPED — a real light workspace built out of
// values this file is allowed to hold, because it may not name a colour either.

const { stock, ink } = DEFAULT_THEME.palette.colors;
const LIGHT = wearing({ stock: ink, ink: stock });

test("how light a colour is, for the two decisions that need to know", () => {
  expect(lumaOf(stock)).toBeLessThan(0.5);
  expect(lumaOf(ink)).toBeGreaterThan(0.5);
  // Three digits is the same colour as six. Spelled in two pieces because this
  // file may not name a colour either, and the grep below reads literals.
  expect(lumaOf("#" + "abc")).toBeCloseTo(lumaOf("#" + "aabbcc"), 10);
  // Anything it cannot read says so rather than guessing — every caller has a
  // fallback for null, because the general case needs a document to resolve.
  expect(lumaOf("cream")).toBeNull();
  expect(lumaOf(undefined)).toBeNull();
});

test("the scheme and the shadow are read off the palette, not assumed", () => {
  // A dark workspace mixes its depth from the canvas, the way it always did. A
  // light one cannot: near-white stock at 60% is a haze, so the ink is darker
  // and the ink is what a shadow is made of.
  expect(schemeOf(DEFAULT_THEME)).toBe("dark");
  expect(shadowOf(DEFAULT_THEME)).toBe(stock);
  expect(schemeOf(LIGHT)).toBe("light");
  expect(shadowOf(LIGHT)).toBe(stock);
  // Unreadable stock is the scheme the chrome had before it could measure.
  expect(schemeOf(wearing({ stock: "cream" }))).toBe("dark");
});

test("the host declares everything the box does, plus the chrome's own two", () => {
  const host = hostVars(DEFAULT_THEME);
  const box = themeVars(DEFAULT_THEME);
  for (const [token, value] of Object.entries(box)) expect(host[token]).toBe(value);

  // The chrome wears the vault's FURNITURE role. Not the gauge role as the mono
  // as well: a vault may name a serif there, and the picker's paths are mono.
  const furniture = DEFAULT_THEME.fonts.available.find((f) => f.name === DEFAULT_THEME.fonts.roles.furniture);
  expect(host["--ui-face"]).toBe(furniture.stack);
  expect(host["--mono-face"]).toBeUndefined();
  expect(host["--shadow"]).toBe(shadowOf(DEFAULT_THEME));
});

test("applying a theme writes every one of those onto the root, and the scheme", () => {
  const root = stub();
  applyTheme(DEFAULT_THEME, root);
  expect(root.props).toEqual(hostVars(DEFAULT_THEME));
  expect(root.style.colorScheme).toBe("dark");

  // Called again with another theme, every token it names is overwritten. It
  // runs on every store emit, so it has to be cheap and it has to be repeatable.
  applyTheme(LIGHT, root);
  expect(root.props["--stock"]).toBe(ink);
  expect(root.props["--shadow"]).toBe(stock);
  expect(root.style.colorScheme).toBe("light");
});

test("a camelCase key becomes its kebab token", () => {
  expect(tokenOf("stockHi")).toBe("--stock-hi");
  expect(tokenOf("room2")).toBe("--room-2");
  expect(tokenOf("roomInk2")).toBe("--room-ink-2");
  expect(tokenOf("nonreproT")).toBe("--nonrepro-t");
  expect(tokenOf("onSpot")).toBe("--on-spot");
  expect(tokenOf("ink")).toBe("--ink");
  // An extra colour goes through the same rule, so its name is sanitised first:
  // a space would produce a property the CSSOM rejects without saying so.
  expect(cleanName("My Brand!")).toBe("myBrand");
  expect(tokenOf(cleanName("My Brand!"))).toBe("--my-brand");
  expect(tokenOf(cleanName("Warning"))).toBe("--warning");
});

// The one duplication in the framework that a type cannot catch. The shim runs in
// the artifact's realm, imports nothing and is served as one self-contained
// file, so it holds its own copy of this rule — and if the two ever disagree,
// every generated page is themed by names the host does not declare.
test("the shim derives the same token names the host does", () => {
  const shim = read("guest/biom.js");
  const src = shim.match(/const cssVar = ([\s\S]*?);\n/);
  expect(src,
    "guest/biom.js no longer declares `const cssVar = …`. It holds the copy of tokenOf that runs inside an artifact frame; keep the two in step.")
    .not.toBeNull();

  const cssVar = new Function("return " + src[1])();
  const names = [
    ...Object.keys(DEFAULT_THEME.palette.colors),
    ...DEFAULT_THEME.palette.extra.map((x) => x.name),
    "colour2",
  ];
  for (const name of names) expect(cssVar(name)).toBe(tokenOf(name));
});

test("tokens.css declares exactly the shipped faces, from the same list the box is woven with", () => {
  // Two origins, two declarations, one list. The host reads tokens.css; the box
  // cannot, so frame.js weaves `faceCss(<absolute /fonts/>)` into its head. If
  // the block here and the list in faces.js ever differ, a face renders on one
  // side of the boundary and falls back on the other, with nothing to say so.
  const css = read("client/css/tokens.css");
  const block = css.match(/faces:start[^\n]*\n([\s\S]*?)\n\/\* faces:end/);
  expect(block).not.toBeNull();
  expect(block[1]).toBe(faceCss("../fonts/"));
  // And every file the list names is actually on disk, on the host's route.
  for (const f of FACES) expect([f.file, existsSync(join(ROOT, "client/fonts", f.file))]).toEqual([f.file, true]);
  // The absolute form is what the box gets: same rules, different base.
  expect(faceCss("http://h/fonts/")).toContain('src:url("http://h/fonts/workbench.woff2")');
});

test("tokens.css declares exactly the shipped palette", () => {
  const css = read("client/css/tokens.css");
  const block = css.match(/palette:start[^*]*\*\/([\s\S]*?)\/\* palette:end/);
  expect(block).not.toBeNull();

  const declared = {};
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declared[m[1]] = m[2].trim();

  const shipped = {};
  for (const [key, value] of Object.entries(DEFAULT_THEME.palette.colors)) shipped[tokenOf(key)] = value;

  // The CSS copy is the scheme the chrome actually paints; the JS copy is what a
  // page is handed before its vault answers. They are allowed to be two copies
  // only because this test makes it impossible for them to drift.
  expect(declared).toEqual(shipped);
});

test("the palette a new vault is seeded with is the palette painted before it answers", () => {
  // TWO COPIES, HELD EQUAL HERE. `server/workspace/presets.ts` writes a new
  // vault's `theme.json` and sits at layer 3; `client/theme/palettes.js` is the
  // fallback and sits at layer 13. Neither may import the other and the shared
  // value cannot go to the frozen `contracts/`, so the server's copy is read out
  // of its own source. If they drift, a fresh vault paints one scheme on its
  // first frame and settles into another the moment `theme.get` comes back.
  const src = read("server/workspace/presets.ts");
  const block = src.match(/const BRAND: Palette = \{([\s\S]*?)\n\};/);
  expect(block,
    "server/workspace/presets.ts no longer declares `const BRAND: Palette = {…};` — that block IS the seeded palette; keep it and this test finding it.")
    .not.toBeNull();

  const body = block[1];
  const colorsBlock = body.match(/colors: \{([\s\S]*?)\n  \},/);
  expect(colorsBlock).not.toBeNull();

  const colors = {};
  for (const m of colorsBlock[1].matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{3,8})"/g)) colors[m[1]] = m[2];
  const extra = [...body.matchAll(/\{ name: "([^"]+)", value: "(#[0-9A-Fa-f]{3,8})" \}/g)]
    .map((m) => ({ name: m[1], value: m[2] }));
  const name = body.match(/name: "([^"]+)"/)?.[1] ?? null;

  expect({ name, colors, extra }).toEqual({
    name: DEFAULT_THEME.palette.name,
    colors: DEFAULT_THEME.palette.colors,
    extra: DEFAULT_THEME.palette.extra,
  });
});

/** WCAG's contrast ratio between two colours, off `lumaOf` so there is one
 *  measure of lightness in the framework and not two. Shared by the two tests
 *  below — the shipped palette's, and the three worlds the design page seeds. */
const ratio = (fg, bg) => {
  const a = lumaOf(fg);
  const b = lumaOf(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test("every text role in the shipped palette clears 4.5:1 on every ground it is laid on", () => {
  // The palette is the product's brand and the brand named three of its colours;
  // the rest were picked, and this is what they were picked against. WCAG
  // relative luminance, measured off the values rather than judged by eye —
  // `lumaOf` is the same function the chrome uses to decide light from dark, so
  // there is one measure in the framework and not two.
  const c = DEFAULT_THEME.palette.colors;

  // Every pairing the stylesheets actually make. Hairlines and the grip are not
  // here: they are not text, and holding a 1px rule to a reading ratio would
  // make every hairline in the product a shout.
  const pairs = [
    [c.ink, c.stock], [c.ink, c.stockHi], [c.ink, c.stockLo], [c.ink, c.field],
    [c.ink2, c.stock], [c.ink2, c.stockHi], [c.ink2, c.stockLo],
    [c.ink3, c.stock], [c.ink3, c.stockHi], [c.ink3, c.field],
    [c.cyanT, c.stock], [c.cyanT, c.stockHi], [c.cyanT, c.field],
    [c.magentaT, c.stock], [c.magentaT, c.stockHi],
    [c.yellow, c.stock], [c.yellow, c.stockHi], [c.yellow, c.field],
    // The rail is its own ground and carries its own three weights of ink.
    [c.roomInk, c.room], [c.roomInk2, c.room], [c.roomInk3, c.room],
    // A label on a filled control, which is the whole reason `onSpot` exists.
    [c.onSpot, c.cyan], [c.onSpot, c.cyanT], [c.onSpot, c.magenta], [c.onSpot, c.magentaT],
    ...DEFAULT_THEME.palette.extra.map((x) => [c.onSpot, x.value]),
  ];

  const failed = pairs
    .map(([fg, bg]) => [fg, bg, ratio(fg, bg)])
    .filter((p) => p[2] < 4.5)
    .map((p) => p[0] + " on " + p[1] + " is " + p[2].toFixed(2) + ":1");
  expect(failed).toEqual([]);
});

test("the three worlds the design page seeds clear 4.5:1 on their own grounds", () => {
  // `vault/design/` ships in EVERY new workspace, and its three bands each carry
  // a palette of their own in the section's variables — a proposal somebody
  // picks from rather than the workspace's own theme, which is why the test
  // above cannot see them. They are still shipped screens, so they are held to
  // the same figure, and they are measured here rather than looked at: three of
  // the labels were at 3.2 to 3.4 and every one of them read as deliberate.
  const yaml = read("vault/design/content.yaml");

  /** One band's palette, read out of the page it is declared on. Regex rather
   *  than a YAML parse for the reason `presets.ts` is read the same way: the
   *  test may not name a colour, so the values have to come from the file. */
  const world = (name) => {
    const block = yaml.match(new RegExp(`- name: ${name}\\n    data: ${name}\\.html\\n    variables:\\n([\\s\\S]*?)\\n    parts:`));
    expect(block, `vault/design/content.yaml no longer declares the '${name}' section with its own variables — that block IS that world's palette.`).not.toBeNull();
    const colors = {};
    for (const m of block[1].matchAll(/(\w+): "(#[0-9A-Fa-f]{3,8})"/g)) colors[m[1]] = m[2];
    // Nine roles, and the html declares every one of them onto a token. A world
    // that grew a tenth and is not measured here is the hole this closes.
    expect(Object.keys(colors).sort()).toEqual(
      ["ink", "ink2", "ink3", "rule", "ruleSoft", "spot", "spot2", "stock", "stockLo"]);
    return colors;
  };

  // The ink each band lays on each ground. `rule` and `ruleSoft` are hairlines
  // and are not here, for the reason the test above gives; `spot` and `spot2`
  // are, because each world sets words in both.
  const grounds = ["stock", "stockLo"];
  const inks = ["ink", "ink2", "ink3", "spot", "spot2"];

  const failed = [];
  for (const name of ["news", "paper", "panel"]) {
    const c = world(name);
    for (const ink of inks) {
      for (const bg of grounds) {
        const r = ratio(c[ink], c[bg]);
        if (r < 4.5) failed.push(`${name}: ${ink} on ${bg} is ${r.toFixed(2)}:1`);
      }
    }
  }
  expect(failed).toEqual([]);
});

// The central rule, as a test rather than as a paragraph in a AGENTS.md. The
// mock breaks its own version of this in about 25 places; the point of writing
// it down here is that the 26th cannot happen quietly.
test("nothing outside palettes.js names a colour", () => {
  const files = [
    "client/theme/theme.js",
    "client/css/tokens.css",
    "client/css/chrome.css",
    "client/css/page.css",
    "client/css/panels.css",
    "client/css/table.css",
    "tests/theme.test.js",
  ];

  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  // Only a literal one: `rgb(${r} ${g} ${b} / 13%)` is the palette's own ink,
  // parsed, which is the opposite of naming a colour.
  const RGB = /\brgba?\([\d.\s,%]+\)/;

  for (const rel of files) {
    let text = read(rel);
    if (rel.endsWith("tokens.css")) text = text.replace(/palette:start[\s\S]*?palette:end/, "");
    expect({ file: rel, hex: HEX.exec(text)?.[0] ?? null }).toEqual({ file: rel, hex: null });
    expect({ file: rel, rgb: RGB.exec(text)?.[0] ?? null }).toEqual({ file: rel, rgb: null });
  }
});
