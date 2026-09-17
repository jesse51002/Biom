// SPDX-License-Identifier: AGPL-3.0-only
// THE BUILD: what the program carries, and what it refuses.
//
// Two halves, and they are the two the spec asks to be held in tests rather than
// in a person's memory of having tried it once.
//
//   · THE MANIFEST LOOKUP. A compiled binary has no directory beside it, so
//     everything the server serves travels inside it. What is checked here is
//     the map: that the six directories are walked rather than listed, that
//     `contracts/` is among them — a binary without it serves an application
//     that cannot boot — and that a `Files` over the map reads and lists exactly
//     as one over a disk does, which is the whole reason the seeder was not
//     edited.
//
//   · THE TOKEN REFUSAL. One random value per launch, held by the process that
//     minted it and the window it told. A request without it is refused.
//
// The end-to-end exercises — build it, move it, open it, delete the repository —
// are the runner's, and `.github/workflows/ci.yml` is where they live.

import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NOTHING_EMBEDDED,
  entriesUnder,
  isEmbedded,
  keyUnder,
  makeEmbeddedFiles,
  readEmbedded,
} from "../server/platform/embedded.ts";
import { hostFiles, makeHost, noManifest, tokenOk, MANIFEST_MODULE, PARENT_ENV, TOKEN_PARAM } from "../server/main.ts";
import { dataHome } from "../server/workspace/vault.ts";
import { carried, manifestSource, ICON_BASE, SHELL_FILES } from "../tools/app.ts";
import { ICNS_TYPES, ICO_SIZES, containers, decodePng } from "../tools/icon.ts";
// The shell's own copy of the one rule it shares with the server. Plain CommonJS
// beside `app/main.js`, which is why it is required rather than imported.
import { dataHome as shellDataHome } from "../app/data.js";
import type { EmbeddedMap } from "../server/platform/embedded.ts";

const HERE = join(import.meta.dir, "..");

/** The framework's own files as a carried map — every key pointing at the copy
 *  on disk, which is exactly what the generated manifest is before a compile
 *  turns the values into paths inside the executable. It is the real map rather
 *  than a fixture, so a directory that stopped being carried fails here. */
async function carriedMap(): Promise<EmbeddedMap> {
  const map: Record<string, string> = {};
  for (const key of await carried(HERE)) map[key] = join(HERE, key);
  return map;
}

/* ── what the binary carries ────────────────────────────────────────────── */

test("the carried list is walked, and it carries contracts/ as well as the box's code", async () => {
  const keys = await carried(HERE);

  // Six directories, and every one of them is reached.
  for (const dir of ["client/", "guest/", "vendor/", "vault/", "skill/", "contracts/"]) {
    expect([dir, keys.some((key) => key.startsWith(dir))]).toEqual([dir, true]);
  }

  // THE ONE THAT IS EASY TO LEAVE OUT. Every client module reaches `wire.js` by
  // a relative path that resolves at `/contracts/`, so a binary without these
  // three serves an application that cannot boot at all.
  for (const key of ["contracts/wire.js", "contracts/emitter.js", "contracts/guards.js"]) {
    expect([key, keys.includes(key)]).toEqual([key, true]);
  }

  // The client's entry, the box's shim and the shipped default section — the
  // three files a page needs before it can draw anything.
  for (const key of ["client/index.html", "guest/biom.js", "guest/sections/default.html"]) {
    expect([key, keys.includes(key)]).toEqual([key, true]);
  }

  // A DOT DIRECTORY IS WALKED, and forgetting that is how a vault gets seeded
  // with a guide that points at skills which are not there.
  expect(keys.some((key) => key.startsWith("vault/.agents/skills/"))).toBe(true);

  // Sorted and forward-slashed, so two builds of one tree write one file.
  expect([...keys].sort()).toEqual(keys);
  expect(keys.some((key) => key.includes("\\"))).toBe(false);
});

test("the manifest imports copies rather than the files themselves", () => {
  const source = manifestSource(["client/index.html", "contracts/wire.js"]);

  // A COPY, UNDER A SUFFIX, and both halves are load-bearing. A specifier is one
  // module cache key per process: importing `client/store/ui.js` as a FILE and
  // then as a MODULE hands the second importer the first one's module, which
  // stopped five test files loading. And an extension `tsc` resolves is a file
  // `tsc` typechecks — including every minified bundle in `vendor/`.
  expect(source).toContain('import f0 from "./files/client/index.html.bin" with { type: "file" };');
  expect(source).toContain('import f1 from "./files/contracts/wire.js.bin" with { type: "file" };');
  expect(source).toContain('"client/index.html": f0,');
  expect(source).toContain('"contracts/wire.js": f1,');
  // Checked by nothing: it is generated, and what it imports has no declaration.
  expect(source.startsWith("// @ts-nocheck")).toBe(true);
});

test("the stub manifest is a module that imports nothing and carries nothing", () => {
  // WHAT `make types` WRITES, and it is all `tsc` needs: a module the composition
  // root's literal import resolves to. It copies no file into `dist/files/`,
  // because the module opens with `@ts-nocheck` and a typecheck of nothing is
  // what a hundred-odd copies used to buy.
  const source = manifestSource([]);
  expect(source).not.toContain("import ");
  expect(source).toContain("export const FILES: Record<string, string> = {");
  expect(source.startsWith("// @ts-nocheck")).toBe(true);

  // AND IT IS EMPTY, which is what makes it safe to leave lying in a development
  // clone: a server that reads it finds nothing carried and serves off disk.
  expect(source).toContain("export const FILES: Record<string, string> = {\n};");
});

test("the one specifier is spelled the same in the import and in the catch beside it", async () => {
  // THE IMPORT HAS TO BE A LITERAL — `bun build --compile` bundles what it can
  // see — so the constant the catch compares against is a second copy of the same
  // string, and this is what holds the two together. Drift means a clone that has
  // never built the application throws at boot instead of serving off disk.
  const source = await readFile(join(HERE, "server", "main.ts"), "utf8");
  expect(source).toContain(`await import(${JSON.stringify(MANIFEST_MODULE)})`);
  expect(MANIFEST_MODULE).toBe("../dist/embedded.ts");
});

test("a missing manifest is the ordinary case and a broken one is not swallowed with it", async () => {
  // THE SHAPE IS MEASURED RATHER THAN WRITTEN DOWN. A fixture of what bun's
  // resolver is believed to throw goes on passing after bun changes it, which is
  // the one way this can quietly stop guarding anything. So: a module that is
  // genuinely not there, and what actually comes back.
  const gone = await import("./no-such-file-of-any-kind.ts").then(() => null, (why) => why);
  expect((gone as { code?: string; specifier?: string }).code).toBe("ERR_MODULE_NOT_FOUND");
  expect((gone as { specifier?: string }).specifier).toBe("./no-such-file-of-any-kind.ts");

  // That code with THIS specifier is a clone that has never built the
  // application, and it is the ordinary case.
  expect(noManifest({ code: "ERR_MODULE_NOT_FOUND", specifier: MANIFEST_MODULE })).toBe(true);

  // THE SAME CODE, A DIFFERENT SPECIFIER, is a manifest sitting in `dist/` whose
  // own copies are gone. Swallowed, it came back as "nothing is carried" — a
  // compiled binary that serves nothing and says so nowhere.
  expect(noManifest(gone)).toBe(false);
  expect(noManifest({ code: "ERR_MODULE_NOT_FOUND", specifier: "./files/client/index.html.bin" })).toBe(false);

  // And a manifest that will not parse, which carries no code at all.
  expect(noManifest(new SyntaxError("unexpected end of file"))).toBe(false);
  expect(noManifest(null)).toBe(false);
  expect(noManifest(undefined)).toBe(false);
});

/* ── which map a host reads its own files out of ───────────────────────── */

test("a checkout with a manifest in dist/ still reads every one of its own files off disk", async () => {
  // What a build leaves behind: the real map, every value a path into `dist/`.
  const built = await carriedMap();
  expect(isEmbedded(built)).toBe(true);

  // A DIRECTORY BESIDE THE PROGRAM WINS. This is `make dev` in a clone that has
  // run `make app` — or, since the manifest became part of `make check`, one
  // that has merely typechecked. Reading the map here is editing
  // `guest/sections/default.html`, pressing reload, and being shown the copy the
  // last build took. The default section, the shipped plugin documents and the
  // seed root all read this one answer.
  expect(hostFiles(undefined, true, built)).toBe(NOTHING_EMBEDDED);

  // No directory beside it is the compiled binary, and it has nothing else to read.
  expect(hostFiles(undefined, false, built)).toBe(built);

  // A map named by the caller always wins, which is how the seeding test below
  // stands a host up on carried files without compiling anything.
  expect(hostFiles(built, true, NOTHING_EMBEDDED)).toBe(built);
  expect(hostFiles(NOTHING_EMBEDDED, false, built)).toBe(NOTHING_EMBEDDED);
});

/* ── a Files over the map, which is why the seeder was not edited ───────── */

test("an embedded root reads and lists what it carries, and refuses to leave", async () => {
  const map = await carriedMap();
  expect(isEmbedded(map)).toBe(true);
  expect(isEmbedded(NOTHING_EMBEDDED)).toBe(false);

  const seed = makeEmbeddedFiles(map, "vault");
  const agents = await seed.read("AGENTS.md");
  expect(agents).toBe(await readFile(join(HERE, "vault", "AGENTS.md"), "utf8"));

  // Listed the way a directory lists: names, and whether something is deeper.
  const root = await seed.list(".");
  expect(root.some((e) => e.name === "AGENTS.md" && !e.dir)).toBe(true);
  expect(root.some((e) => e.name === ".agents" && e.dir)).toBe(true);
  expect(entriesUnder(map, "vault/.agents").map((e) => e.name)).toEqual(["skills"]);

  // Nothing carried under that name is null rather than an error, exactly as a
  // missing file on disk is.
  expect(await seed.read("nothing-of-the-sort.md")).toBe(null);

  // THE ROOT IS READ-ONLY. Refusing rather than no-opping, because a silent
  // no-op turns the day somebody writes into a file that mysteriously is not
  // there.
  expect(seed.write("AGENTS.md", "no")).rejects.toThrow();
  expect(seed.remove("AGENTS.md")).rejects.toThrow();
  expect(seed.commit("no")).rejects.toThrow();

  // `..` buys nothing, in a map that has nothing to escape from anyway.
  expect(keyUnder("vault", "../skill/check.ts")).toBe(null);
  expect(keyUnder("vault", "AGENTS.md")).toBe("vault/AGENTS.md");
  expect(keyUnder("", "contracts/wire.js")).toBe("contracts/wire.js");
  expect(await readEmbedded(map, "no/such/key")).toBe(null);
});

test("a vault is seeded out of the carried map with no directory read at all", async () => {
  const map = await carriedMap();
  const where = await mkdtemp(join(tmpdir(), "biom-carried-"));
  const vault = join(where, "vault");
  const host = await makeHost({
    vault,
    memory: join(where, "vaults.json"),
    // Deliberately nonsense: with a map in hand the paths are never looked at,
    // which is the property that makes a binary in /Applications able to seed a
    // workspace at all.
    presets: join(where, "nowhere", "presets"),
    vaultSeed: join(where, "nowhere", "vault"),
    skill: join(where, "nowhere", "skill"),
    checkerLib: join(where, "nowhere"),
    carried: map,
  });
  try {
    const files = (rel: string) => readFile(join(vault, rel), "utf8");
    // The guide, a skill under it, the design doc, a base block and the checker
    // — everything `vault/` and `skill/` carry, out of the map.
    expect((await files("AGENTS.md")).length).toBeGreaterThan(0);
    expect((await files(".agents/skills/pages/SKILL.md")).length).toBeGreaterThan(0);
    expect((await files("design/content.yaml")).length).toBeGreaterThan(0);
    expect((await files(".agents/skills/check.ts")).length).toBeGreaterThan(0);
    // The checker's own imports, which is what makes the copy runnable rather
    // than a file that throws on load.
    expect((await files(".agents/skills/_lib/wire.js")).length).toBeGreaterThan(0);
    // And the page that is born with it.
    expect((await files("pages/home/content.yaml")).length).toBeGreaterThan(0);
  } finally {
    host.close();
    await rm(where, { recursive: true, force: true });
  }
});

/* ── the bridge, and the window it works ───────────────────────────────── */

test("the preload exposes one object with three keys, and nothing else crosses", async () => {
  // THE SHELL USED TO INJECT NOTHING, then one function, and it is three keys
  // now because the application draws its own title bar: a page that draws the
  // window's controls has to be able to work them, and minimising a window is
  // as far outside a web page's reach as an absolute path is.
  //
  // READ AS SOURCE rather than loaded, because the module `require`s `electron`
  // and there is no Electron in a test runner. That is enough: the surface is a
  // single literal call.
  const preload = await readFile(join(HERE, "app", "preload.js"), "utf8");

  const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(exposed).toEqual(["biomShell"]);

  // THE WHOLE SURFACE, AND THE POINT OF THE TEST IS THAT IT IS A CLOSED LIST.
  // Top level is two-space keys; the window's own acts are four-space keys
  // inside the one nested object, so the two lists come apart on indentation.
  const surface = preload.slice(preload.indexOf("exposeInMainWorld"));
  expect([...surface.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]))
    .toEqual(["chooseFolder", "logo", "windowControls"]);
  expect([...surface.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]))
    .toEqual(["minimize", "toggleMaximize", "toggleFullScreen", "close", "state", "onChange", "onClosing", "lights", "inset"]);

  // NOTHING ELSE IS REQUIRED. No node, no `fs`, no `shell`, and `ipcRenderer` is
  // used rather than handed through — a bare `ipcRenderer` on the world is every
  // channel the main process ever answers.
  const required = [...preload.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  expect(required).toEqual(["electron"]);
  expect(preload).not.toContain("node:");
  // Every mention of it is a call on it. `invoke`, and the one `on`/
  // `removeListener` pair the state subscription needs — never the object
  // itself onto the world, and never a channel read from an argument.
  const uses = [...surface.matchAll(/ipcRenderer\.(\w+)/g)].map((m) => m[1]);
  expect(new Set(uses)).toEqual(new Set(["invoke", "on", "removeListener"]));
  expect(surface.match(/ipcRenderer(?!\.)/g)).toBe(null);

  // Every channel is spelled in the preload and in the shell, and nowhere else.
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");
  const channels = [
    "biom:choose-folder", "biom:logo", "biom:window-minimize", "biom:window-maximize",
    "biom:window-fullscreen", "biom:window-close", "biom:window-state", "biom:window-changed",
    "biom:window-closing",
  ];
  for (const channel of channels) {
    expect([channel, preload.includes(JSON.stringify(channel))]).toEqual([channel, true]);
    expect([channel, main.includes(JSON.stringify(channel))]).toEqual([channel, true]);
  }

  // ONE `ipcMain.handle` PER ACT, and the push channel is a send rather than a
  // handle — it is the only thing the main process says without being asked.
  for (const name of ["CHOOSE", "LOGO", "MINIMIZE", "MAXIMIZE", "FULLSCREEN", "CLOSE", "STATE"]) {
    expect([name, main.includes(`ipcMain.handle(${name}`)]).toEqual([name, true]);
  }
  expect(main).not.toContain("ipcMain.handle(CHANGED");
  expect(main).toContain("webContents.send(CHANGED");
  // THE SECOND PUSH: the close held over a live run. A send, never a handle,
  // and the window's own close event is where the hold lives — so the bar's
  // button, Alt+F4 and a window manager's close all run through it.
  expect(main).not.toContain("ipcMain.handle(CLOSING");
  expect(main).toContain("webContents.send(CLOSING");
  expect(main).toContain('win.on("close"');
  expect(main).toContain('kind: "run.live"');
  // And the window actually loads the preload. One that ships and is not named
  // is a built application with no chooser and no controls at all.
  expect(main).toContain("preload: PRELOAD");
});

test("the window is frameless on every desktop, and macOS keeps its traffic lights", async () => {
  // THE APPLICATION DRAWS ITS OWN TITLE BAR, so the desktop's one is taken away
  // — and the option that takes it away is different on each platform for a
  // reason each time. Read as source: `chromeOf` is inside the single-instance
  // block in a module that `require`s electron, so there is nothing to import.
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");
  const chrome = main.slice(main.indexOf("function chromeOf()"));

  // macOS FIRST, because the lights are the controls there and a Mac window
  // that drew its own three dots would be wrong in a way anyone can see.
  expect(chrome).toContain('if (process.platform === "darwin") return { titleBarStyle: "hiddenInset" };');
  // Windows keeps the NATIVE FRAME under the hidden bar: resize edges, Aero
  // Snap and the shadow are the window manager's and all still work. `frame:
  // false` there throws all three away.
  expect(chrome).toContain('if (process.platform === "win32") return { titleBarStyle: "hidden" };');
  // Linux has no `titleBarStyle` at all — it is macOS and Windows only — so
  // `frame: false` is the only frameless there, and it is the fallthrough.
  expect(chrome.slice(0, chrome.indexOf("}\n"))).toContain("return { frame: false };");

  // And it is actually spread into the window rather than written and unused.
  expect(main).toContain("...chromeOf(),");

  // F11 SURVIVES THE BUTTON. The bar's full-screen control is the discoverable
  // way and F11 is the one every browser already trained people to reach for.
  expect(main).toContain("function fullscreenOnF11(w)");
  expect(main).toContain('input.key !== "F11"');

  // THE BAR FOLLOWS THE WINDOW, not the button that was pressed: every event
  // that can move either boolean pushes the new state, so the icons are right
  // after F11, after a drag to the top of the screen, and after a tiling
  // manager did it.
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    expect([ev, main.includes(`"${ev}"`)]).toEqual([ev, true]);
  }
});

test("the packaged staging directory carries the preload and the logo", async () => {
  // IT SHIPS OR THE BUILT APPLICATION HAS NO CHOOSER — and the production server
  // refuses the listing it would fall back to, which is a picker that cannot
  // reach a folder. The list is explicit rather than a walk of `app/`, so this
  // holds it against what is on disk.
  expect(SHELL_FILES).toEqual(["main.js", "preload.js", "data.js", "icon.png", "package.json"]);
  for (const file of SHELL_FILES) {
    expect([file, (await readFile(join(HERE, "app", file), "utf8")).length > 0]).toEqual([file, true]);
  }
});

/* ── the token ─────────────────────────────────────────────────────────── */

test("a request without this launch's token is refused, and a server with no token refuses nothing", () => {
  const at = (query: string) => new URL(`http://localhost:44100/api/call${query}`);
  const token = "2f6c1d";

  expect(tokenOk(token, at(`?${TOKEN_PARAM}=${token}`))).toBe(true);
  expect(tokenOk(token, at(""))).toBe(false);
  expect(tokenOk(token, at(`?${TOKEN_PARAM}=`))).toBe(false);
  expect(tokenOk(token, at(`?${TOKEN_PARAM}=2f6c1e`))).toBe(false);
  // A near miss is a miss: the comparison is the whole value.
  expect(tokenOk(token, at(`?${TOKEN_PARAM}=2f6c1d0`))).toBe(false);

  // NO TOKEN MINTED IS NO TOKEN ASKED FOR. A server run from source is opened by
  // somebody typing a url, and a secret they would have to copy out of a
  // terminal is a development loop with a step in it.
  expect(tokenOk(null, at(""))).toBe(true);
});

test("the server and the client call the token the same thing", async () => {
  // ONE STATEMENT IN TWO PLACES, AND THERE IS NO THIRD PLACE FOR IT. `contracts/`
  // is the only module both tiers may import, and the token is deliberately not
  // in it — a constant there is one an artifact's envelope could reach for. So
  // the two copies are held equal here instead, and a drift is a built
  // application whose every call is refused by the server that minted the key.
  const { TOKEN_PARAM: clientSide } = await import("../client/transport/http.js");
  expect(clientSide).toBe(TOKEN_PARAM);

  // And the client's composition root takes it from the transport rather than
  // spelling a third copy, which is what this asserts of the file itself.
  const boot = await readFile(join(HERE, "client", "boot.js"), "utf8");
  expect(boot).toContain("TOKEN_PARAM");
  expect(boot).not.toContain('"token"');
  // Same for the route: `wire.js` is right there and was imported already.
  expect(boot).not.toContain('"/api/call"');
});

/* ── the menu that is not there ────────────────────────────────────────── */

test("the shell removes the application menu before it opens a window", async () => {
  // ELECTRON'S DEFAULT MENU IS A DEVELOPER'S MENU — File, Edit, View with a
  // Reload and a Toggle Developer Tools in it — and it describes a program this
  // one is not: the window is one page and everything in this application is on
  // it. Read as source, because there is no Electron in a test runner.
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");

  expect(main).toContain("Menu.setApplicationMenu(null)");
  // It is called on the way up — first thing inside `whenReady`, ahead of the
  // spawn that eventually opens the window. A menu set after a window exists is
  // a menu somebody sees flicker.
  const ready = main.slice(main.indexOf("app.whenReady().then(() => {"));
  expect(ready.indexOf("unmenu();")).toBeLessThan(ready.indexOf("server = spawn("));
  // And `Menu` is actually taken off electron rather than assumed global.
  expect(main).toMatch(/require\("electron"\)/);
  expect(main).toMatch(/\bMenu,/);

  // THE ONE THING THAT MAY NOT GO WITH IT. Copy, paste, select all and undo
  // inside a web page are Chromium's on Linux and Windows and the MENU'S on
  // macOS, so a null menu there is a window where ⌘C does nothing. macOS gets
  // the edit roles, hidden — registered accelerators, no bar of ours.
  expect(main).toContain('{ role: "editMenu", visible: false }');
  expect(main).toContain('process.platform !== "darwin"');
});

test("the window answers F11 with full screen, because the menu that reached it is gone", async () => {
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");
  // Linux and Windows: the window's own input handler, F11, toggling the state.
  expect(main).toContain('input.key !== "F11"');
  expect(main).toContain("w.setFullScreen(!w.isFullScreen())");
  expect(main).toContain("fullscreenOnF11(win);");
  // macOS keeps its native role on the hidden menu instead of stealing F11.
  expect(main).toContain('{ role: "togglefullscreen" }');
});

/* ── the icon ──────────────────────────────────────────────────────────── */

test("the window wears the logo, and the file it names ships beside it", async () => {
  // ONE PICTURE, COMMITTED ONCE. `app/icon.png` is the logo, it is in the list
  // `tools/app.ts` copies into the staging directory, and `app/main.js` reads it
  // from beside itself — so the path resolves the same in `dist/stage` as it
  // does inside a packaged bundle, which is the only thing that could be wrong
  // about it.
  expect(SHELL_FILES).toContain("icon.png");

  const png = new Uint8Array(await readFile(join(HERE, "app", "icon.png")));
  const logo = decodePng(png);
  expect([logo.width, logo.height]).toEqual([512, 512]);

  const main = await readFile(join(HERE, "app", "main.js"), "utf8");
  expect(main).toContain('join(__dirname, "icon.png")');
  expect(main).toContain("icon: ICON,");

  // The bundle's icon is a different file in a different format, generated into
  // the gitignored `dist/` and handed to the packager WITHOUT an extension — it
  // appends `.icns` on macOS and `.ico` on Windows.
  expect(ICON_BASE.endsWith("/icon")).toBe(true);
  expect(ICON_BASE.includes("/dist/")).toBe(true);
  const app = await readFile(join(HERE, "tools", "app.ts"), "utf8");
  expect(app).toContain("icon: ICON_BASE,");
});

test("the generated ICO and ICNS are containers the two systems can read", async () => {
  // GENERATED FROM THE REAL LOGO rather than a fixture, because the thing that
  // can break is the decoder meeting the picture that is actually committed.
  // What is checked is the container: the header, the count, and that every
  // entry is a whole PNG at the size its directory claims. A picture nobody can
  // parse is a bundle with the packager's own Electron icon on it.
  const png = new Uint8Array(await readFile(join(HERE, "app", "icon.png")));
  const { ico, icns } = containers(png);

  /* the ICO: a little-endian directory in front of a run of PNGs */
  const dir = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  expect(dir.getUint16(0, true)).toBe(0); // reserved
  expect(dir.getUint16(2, true)).toBe(1); // an icon, not a cursor
  expect(dir.getUint16(4, true)).toBe(ICO_SIZES.length);
  ICO_SIZES.forEach((size, i) => {
    const e = 6 + i * 16;
    // 256 IS SPELLED 0, because the field is one byte — which is the whole
    // reason the 512 has to be made smaller before it can go in here at all.
    expect([size, ico[e]]).toEqual([size, size === 256 ? 0 : size]);
    expect([size, ico[e + 1]]).toEqual([size, size === 256 ? 0 : size]);
    expect(dir.getUint16(e + 6, true)).toBe(32); // bits per pixel
    const length = dir.getUint32(e + 8, true);
    const offset = dir.getUint32(e + 12, true);
    expect(offset + length).toBeLessThanOrEqual(ico.length);
    const entry = decodePng(ico.subarray(offset, offset + length));
    expect([size, entry.width, entry.height]).toEqual([size, size, size]);
  });

  /* the ICNS: 'icns', its own total length, then a four-letter type per entry */
  expect(String.fromCharCode(...icns.subarray(0, 4))).toBe("icns");
  const head = new DataView(icns.buffer, icns.byteOffset, icns.byteLength);
  expect(head.getUint32(0 + 4)).toBe(icns.length);
  let at = 8;
  const seen: string[] = [];
  while (at < icns.length) {
    const type = String.fromCharCode(...icns.subarray(at, at + 4));
    const length = head.getUint32(at + 4);
    expect([type, length > 8, at + length <= icns.length]).toEqual([type, true, true]);
    const entry = decodePng(icns.subarray(at + 8, at + length));
    const want = ICNS_TYPES.find((t) => t.type === type);
    expect([type, entry.width, entry.height]).toEqual([type, want?.size, want?.size]);
    seen.push(type);
    at += length;
  }
  expect(seen).toEqual(ICNS_TYPES.map((t) => t.type));
  // The 512 goes in whole, which is the one thing the ICO cannot do.
  expect(seen).toContain("ic09");
});

test("a picture this build cannot read is a sentence rather than a wrong icon", () => {
  // The decoder is 8-bit RGBA and non-interlaced, which is what the logo is.
  // Anything else is refused BY NAME: half-drawing a replacement somebody
  // dropped in is how a bundle ships with a smear on it.
  expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow("not a PNG");

  const grey = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, ...new Array(13).fill(0)]);
  grey[24] = 8; // bit depth
  grey[25] = 0; // colour type 0 — greyscale
  expect(() => decodePng(grey)).toThrow("8-bit RGBA");
});

/* ── the crash with no window and no message ───────────────────────────── */

test("a window that never draws is a sentence and a dialog, not a core dump", async () => {
  // WHAT WAS MEASURED. `~/.cache/fontconfig` held caches written by two
  // different fontconfig versions — a host and a toolbox sharing one home —
  // Chromium was handed a font list it could not use, aborted at
  // `SkFontMgr_FontConfigInterface.cpp:163` and dumped core. What a person saw
  // was nothing: no window, no error, an application that did not start.
  //
  // Read as source. The live case cannot be reproduced without poisoning
  // somebody's font cache, so what is held here is that the arms exist, that
  // they are armed on the one gap they are about, and that the fix is spelled.
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");

  // The three ways the gap ends badly, plus the case where nothing dies and
  // nothing draws either.
  expect(main).toContain('win.webContents.on("render-process-gone"');
  expect(main).toContain('app.on("child-process-gone"');
  expect(main).toContain('win.webContents.on("did-finish-load"');
  expect(main).toContain("FIRST_DRAW_MS");

  // ARMED BEFORE THE PAGE IS ASKED FOR. After `loadURL` the first draw may
  // already have happened, and a watcher that starts late watches nothing.
  const open = main.slice(main.indexOf("function open(port, token)"));
  expect(open.indexOf("watchTheFirstDraw();")).toBeLessThan(open.indexOf("win.loadURL("));

  // ONE PLAIN SENTENCE on stderr, and a native box with the fix in it.
  expect(main).toContain("console.error(`biom: the window never drew");
  expect(main).toContain("dialog.showErrorBox(");
  expect(main).toContain("rm -rf ~/.cache/fontconfig && fc-cache -f");
  // The fix is Linux's, and it is only offered there.
  expect(main).toContain('const linux = process.platform === "linux";');

  // Then the server goes and the process exits non-zero — `exit` rather than
  // `quit`, because `quit` is a request a window could still answer and there
  // is nothing behind that window.
  expect(main).toContain("app.exit(1)");

  // AND NOTHING OF THE PERSON'S IS REPAIRED. The application sidesteps their
  // font cache by reading one of its own — the test below — and still does not
  // reach into theirs: no fontconfig path, no font flag, nothing cleared and
  // nothing rewritten.
  expect(main).not.toContain("app.commandLine");
  expect(main).not.toContain("process.env.FONTCONFIG_PATH =");
});

test("the window's Chromium is given a font cache of the application's own", async () => {
  // WHAT THIS IS FOR. The crash above is a `~/.cache/fontconfig` holding two
  // fontconfig versions' files, and a machine-side cleanup is not a fix a
  // stranger will know to run. So the launch that opens the window reads a cache
  // under the application's own data directory, which nothing but this
  // application writes.
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");

  // WHY IT RESTARTS RATHER THAN SETTING A VARIABLE AND GOING ON, measured with
  // the bundle this repository builds: Chromium has already read fontconfig's
  // cache by the time `app/main.js` runs, so a launch that only set the variable
  // here wrote its `fontconfig/` into the caller's cache directory and ours got
  // nothing but the shader caches. The variable has to be in the environment the
  // process STARTS with.
  expect(main).toContain("function ownFontCache()");
  expect(main).toContain("process.execve(process.execPath, [process.execPath, ...process.argv.slice(1)], {");
  expect(main).toContain("XDG_CACHE_HOME: cache,");
  expect(main).toContain('const cache = join(dataHome(), "cache");');
  // The marker, so the second pass does not restart a third time.
  expect(main).toContain('const OWN_CACHE = "BIOM_OWN_CACHE";');
  expect(main).toContain('if (process.env[OWN_CACHE] === "1") return;');
  // Linux only: fontconfig is Linux's, `XDG_CACHE_HOME` means nothing to the
  // other two, and `execve` is not on Windows at all.
  expect(main).toContain('if (process.platform !== "linux") return;');

  // `execve` AND NOT A SECOND PROCESS. It replaces this image: same pid, same
  // streams, same command line — so whatever launched Biom keeps the program it
  // launched. A spawned child supervised by its parent was tried and is worse in
  // a way that is easy to miss: the first process has already taken what its
  // command line asked for, so a `--remote-debugging-port` ends up bound by a
  // process with no window in it.
  expect(main).not.toContain("spawn(process.execPath");

  // BEFORE EVERYTHING ELSE. The lock, the window and the server are all on the
  // far side of it, because a process that has already started Chromium cannot
  // be given a different environment.
  const at = main.indexOf("\nownFontCache();");
  expect(at).toBeGreaterThan(0);
  expect(at).toBeLessThan(main.indexOf("app.requestSingleInstanceLock()"));
  expect(at).toBeLessThan(main.indexOf("app.whenReady()"));

  // AND IT NEVER REFUSES TO START. Every way it can fail ends in a line on
  // stderr and the launch every version before this one made.
  expect(main).toContain('if (typeof process.execve !== "function") {');
});

test("the shell and the server answer where this machine's data lives with one rule", () => {
  // TWO FILES, ONE RULE. The shell cannot ask the server — the server is a
  // binary it has not started yet, in a tier the Electron main process is not on
  // — so `app/data.js` mirrors `dataHome()` from `server/workspace/vault.ts`,
  // and this holds the two equal rather than a memory of having written them the
  // same. The relative value is in the list because ignoring it is the XDG
  // spec's own rule and the easiest half to leave out of a copy.
  const before = process.env.XDG_DATA_HOME;
  try {
    for (const value of ["/tmp/biom-data-home-test", "relative/not/absolute", undefined]) {
      if (value === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = value;
      expect([value, shellDataHome()]).toEqual([value, dataHome()]);
    }
  } finally {
    if (before === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = before;
  }
  // And the cache the shell makes is inside it, so the cache the window reads is
  // never the person's own.
  expect(join(shellDataHome(), "cache").startsWith(dataHome())).toBe(true);
});

/* ── the server never outlives the shell ───────────────────────────────── */

test("the server exits when the pipe its parent holds reaches end of file", async () => {
  // THE FAILURE THIS ENDS. The shell quits the server when the window closes,
  // and a main process that ABORTS runs no handler of ours — which left a
  // `biom-server` holding a port and a workspace open with nothing on screen to
  // say so. Twice, on the owner's machine, after the font crash above.
  const box = await mkdtemp(join(tmpdir(), "biom-parent-"));
  const started = (watched: boolean): ReturnType<typeof Bun.spawn> => {
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: "0",
      VAULT: join(box, watched ? "watched" : "loose"),
      VAULTS: join(box, `${watched ? "watched" : "loose"}.json`),
    };
    if (watched) env[PARENT_ENV] = "1";
    else delete env[PARENT_ENV];
    return Bun.spawn(["bun", "run", join(HERE, "server", "main.ts")], {
      cwd: HERE,
      env,
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });
  };
  /** Did it end inside the bound, or is it still there? Both are answers. */
  const within = async (proc: ReturnType<typeof Bun.spawn>, ms: number): Promise<string> =>
    await Promise.race([proc.exited.then(() => "exited"), Bun.sleep(ms).then(() => "still running")]);

  try {
    // WITH THE MARKER: the end of the pipe is the end of the process.
    const watched = started(true);
    await Bun.sleep(1500);
    watched.stdin.end();
    expect(await within(watched, 15000)).toBe("exited");

    // WITHOUT IT: nothing is watched, and the same closing changes nothing. That
    // is what keeps `make dev`, a terminal and every launcher that points stdin
    // at `/dev/null` the program they were.
    const loose = started(false);
    await Bun.sleep(1500);
    loose.stdin.end();
    expect(await within(loose, 2500)).toBe("still running");
    loose.kill();
    await loose.exited;
  } finally {
    await rm(box, { recursive: true, force: true });
  }
}, 60000);

test("the shell hands the server a pipe and the marker, and the name is spelled in two files", async () => {
  const main = await readFile(join(HERE, "app", "main.js"), "utf8");

  // A PIPE RATHER THAN `ignore`, because `ignore` is `/dev/null` and a
  // `/dev/null` never closes. Nothing is ever written down it: its only message
  // is its own end.
  expect(main).toContain('stdio: ["pipe", "pipe", "pipe"]');
  expect(main).not.toContain('stdio: ["ignore", "pipe", "pipe"]');
  expect(main).not.toContain("server.stdin.write");

  // ONE NAME, IN THESE TWO FILES AND NO THIRD PLACE — the rule every channel
  // between the shell and what it starts is under.
  expect(main).toContain(`const PARENT = ${JSON.stringify(PARENT_ENV)};`);
  expect(main).toContain('[PARENT]: "1"');
});
