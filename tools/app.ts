#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// THE BUILD. One script rather than a Makefile recipe, and that is the whole
// reason it is here: `make app` runs it and `bun run app` runs it, so a Windows
// shell with no make builds the application by typing the second. Build logic
// that lived in a recipe would be build logic one of the three systems could
// not run.
//
//   bun run tools/app.ts [--target <name>] [--manifest] [--stub] [--no-package]
//                        [--no-install]
//
//   --target      linux-x64 | darwin-arm64 | darwin-x64 | windows-x64
//                 Default: the machine this is running on. Cross-compiling the
//                 server is something `bun build --compile` does; packaging a
//                 macOS bundle from Linux is not something anybody has checked,
//                 so a runner per system is what `.github/workflows/ci.yml` is.
//   --manifest    write the embedded-file manifest and stop. What the tests use.
//   --stub        write an EMPTY manifest and stop, copying nothing. What
//                 `make types` uses, and it takes no target.
//   --no-package  compile the server and stop, leaving the staging directory.
//   --no-install  package the bundle and stop, leaving it under `dist/out/`.
//                 WHAT CI PASSES, and the only thing that should: a runner has
//                 no desktop to install into, and a build that wrote a launcher
//                 entry on a runner would be writing it into a machine that is
//                 deleted a minute later.
//
// It does six things in order: generate the embedded-file manifest, compile the
// server for the target, stage the shell beside it, generate the bundle's icon
// containers out of the one committed PNG, package the Electron bundle around
// all of it, and INSTALL it — because a bundle under `dist/out/` is a folder
// nothing on the machine knows about, and the build has to end with the desktop
// finding it. `tools/install.ts` is the whole of that last step, and
// `make uninstall` is its reverse.
//
// IT ONLY INSTALLS WHAT IT BUILT FOR THIS MACHINE. A cross-target build —
// `make app TARGET=windows-x64` on Linux — packages and stops, because there is
// nothing on this desktop that could open it.
//
// EVERYTHING IT WRITES IS UNDER `dist/`, which is gitignored and which the
// layering gate already skips — which is also where the manifest has to live.
// A generated module inside `server/` would be walked by that gate, and a module
// in the server tier importing a hundred files out of `client/`, `guest/` and
// `vendor/` is every violation the gate exists to report, all at once. Under
// `dist/` it is not on the stack at all, and the one edge that does exist — the
// composition root's dynamic import of it — is named in `tools/layers.mjs` and
// reported rather than failed.

import { mkdir, readdir, readFile, rm, writeFile, copyFile, chmod } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { containers } from "./icon.ts";
import { APP_NAME, hostPlatform, install, installPlan } from "./install.ts";
// The shell's own copy of the one rule it shares with the server — where this
// machine keeps its Biom data. The install lands beside it, so the build reads
// the same module the application will.
import { dataHome } from "../app/data.js";

declare const Bun: {
  env: Record<string, string | undefined>;
  file(path: string): { text(): Promise<string> };
  spawn(cmd: string[], opts?: { cwd?: string; stdout?: "inherit"; stderr?: "inherit" }): {
    exited: Promise<number>;
  };
};
declare const process: {
  argv: string[];
  platform: string;
  arch: string;
  exit(code: number): never;
};

const HERE = resolve(import.meta.dir, "..");
const DIST = join(HERE, "dist");
const STAGE = join(DIST, "stage");
const MANIFEST = join(DIST, "embedded.ts");
// THE CARRIED FILES ARE COPIED HERE FIRST, AND THAT IS NOT TIDINESS.
//
// The manifest imports every one of them with `{ type: "file" }`. A module
// specifier is one cache key per process, so importing `client/store/ui.js` AS A
// FILE and then importing it AS A MODULE — which is exactly what `bun test` does,
// since the tests load both the server and the client — hands the second
// importer the first one's module: an object with a default export and none of
// the named ones. Five test files stopped loading, with a syntax error naming an
// export that is plainly there.
//
// Importing a COPY gives the two readings two specifiers, so nothing collides
// and the manifest reaches outside `dist/` for nothing at all.
//
// EACH COPY GAINS A SUFFIX, and that is the second half of the same argument.
// The import is a LITERAL — it has to be, because `bun build --compile` bundles
// what it can see and a computed specifier is a file it silently leaves out,
// which is a binary that carries nothing and says so at boot. A literal is also
// a module `tsc` resolves: pointed at `…/ui.js` it typechecks the copy, and
// pointed at `…/yaml.mjs` it typechecks eight hundred lines of somebody else's
// minified bundle that this repository deliberately never checks. Pointed at
// `…/ui.js.bin` it resolves nothing at all and reports one error in a file that
// opens with `@ts-nocheck`. The suffix is invisible everywhere else: a content
// type is read off the KEY the request asked for, never off the path it landed
// on.
const FILES_DIR = join(DIST, "files");
const CARRIED_SUFFIX = ".bin";

/** WHAT THE BINARY CARRIES. Six directories, walked rather than listed: a list
 *  of a hundred files is a list that is wrong the first time anybody adds one.
 *
 *  `contracts/` is in here and it is not optional. The server serves it at
 *  `/contracts/`, and every client module reaches `wire.js`, `emitter.js` and
 *  `guards.js` by a relative path that resolves there — so a binary without it
 *  serves an application that cannot boot. `vault/` and `skill/` are in it
 *  because the seed and the checker have to reach somebody who never cloned
 *  anything. `presets/` is in neither list, because no such directory exists. */
const CARRIED = ["client", "guest", "vendor", "vault", "skill", "contracts",
  // The automation templates New copies — the framework's own, beside its
  // code and never in the vault, so a binary has to carry them the way it
  // carries the seed. `TEMPLATES_DIR` in `server/main.ts` is the same spelling.
  "server/runs/templates"];

/** Not a file the program serves, in any of those directories. */
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

/** bun's compile target, electron-packager's platform and arch, and what the
 *  compiled server is called on each. */
const TARGETS: Record<string, { bun: string; platform: string; arch: string; exe: string }> = {
  "linux-x64": { bun: "bun-linux-x64", platform: "linux", arch: "x64", exe: "" },
  "linux-arm64": { bun: "bun-linux-arm64", platform: "linux", arch: "arm64", exe: "" },
  "darwin-arm64": { bun: "bun-darwin-arm64", platform: "darwin", arch: "arm64", exe: "" },
  "darwin-x64": { bun: "bun-darwin-x64", platform: "darwin", arch: "x64", exe: "" },
  "windows-x64": { bun: "bun-windows-x64", platform: "win32", arch: "x64", exe: ".exe" },
};

/** What the compiled server is called inside the bundle. `app/main.js` looks for
 *  this name beside itself, so the two spellings are one constant apart. */
export const SERVER_BINARY = "biom-server";
/** What the application is called. `@electron/packager` needs a name and there
 *  was none; this is it, and the icon it has is the one the packager ships.
 *  It is declared in `tools/install.ts` rather than here, because the install
 *  step names the executable inside the bundle, the launcher entry and the
 *  window class off the same word — and a build that packaged one name while the
 *  desktop looked for another would install an entry pointing at nothing. */
export { APP_NAME };

/** What the shell IS, copied into the staging directory that gets packaged.
 *  `preload.js` is not optional: without it the built application has no folder
 *  dialog, and the picker falls back to a Browse listing the production server
 *  refuses. `icon.png` is the logo the WINDOW wears, read by `app/main.js` from
 *  beside itself. `data.js` is the one rule the shell shares with the server —
 *  where this machine keeps its Biom data — and a bundle without it is a shell
 *  that cannot start at all, because `main.js` requires it before it does
 *  anything else. A test holds this list against what is on disk. */
export const SHELL_FILES = ["main.js", "preload.js", "data.js", "icon.png", "package.json"];

/** THE ONE PICTURE, AND THE TWO CONTAINERS GENERATED FROM IT. `app/icon.png` is
 *  the logo at 512 and is the only icon committed; macOS wants an `.icns` and
 *  Windows wants an `.ico`, and both are written into the gitignored `dist/` on
 *  the way past. A generated icon in the repository is a second copy of the logo
 *  that goes stale the day somebody redraws the first one.
 *
 *  THE PACKAGER IS HANDED THE PATH WITHOUT AN EXTENSION and appends the one its
 *  platform reads, which is why the two files are named alike and sit together.
 *  Linux takes neither — `@electron/packager` writes no `.desktop` file, so
 *  there is nothing there to name a PNG in; the Linux icon is the window's,
 *  which is `icon.png` inside the bundle. */
const ICON_SOURCE = join(HERE, "app", "icon.png");
export const ICON_BASE = join(DIST, "icon");

const hostTarget = (): string => {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
};

/* ── the manifest ───────────────────────────────────────────────────────── */

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else yield abs;
  }
}

/** Every file to carry, framework-relative and forward-slashed — which is the key
 *  space `server/platform/embedded.ts` reads and the way this repository spells
 *  a path. Sorted, so two builds of one tree produce the same file. */
export async function carried(root = HERE): Promise<string[]> {
  const out: string[] = [];
  for (const dir of CARRIED) {
    const at = join(root, dir);
    if (!existsSync(at)) continue;
    for await (const abs of walk(at)) out.push(relative(root, abs).split("\\").join("/"));
  }
  return out.sort();
}

/** The module the composition root imports. One module rather than one per
 *  directory: it is read exactly once, by one line, and a file per directory
 *  would be six imports to keep in step for no reader's benefit. */
export function manifestSource(keys: string[]): string {
  const lines = [
    // TYPECHECKED BY NOTHING, on purpose. `tsc` pulls this file into the program
    // the moment the composition root's import resolves — `exclude` only filters
    // the globs, not what an import reaches — and then reports a hundred errors
    // about a `.woff2` having no declaration and a client module having no
    // default export. Both are true and neither is a fault: an import attribute
    // says `this is a file`, which is a bun loader rather than a type.
    "// @ts-nocheck",
    "// GENERATED by tools/app.ts — do not edit, and do not commit. It is what the",
    "// compiled server carries instead of the directory it no longer has beside it.",
    "//",
    "// Every value is a path `Bun.file` reads: the path on disk when bun runs the",
    "// source, and the path inside the executable when bun compiled it. That is why",
    "// nothing downstream had to learn a second way to read a file.",
    "",
  ];
  keys.forEach((key, i) => lines.push(`import f${i} from "./files/${key}${CARRIED_SUFFIX}" with { type: "file" };`));
  lines.push("");
  lines.push("export const FILES: Record<string, string> = {");
  keys.forEach((key, i) => lines.push(`  ${JSON.stringify(key)}: f${i},`));
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

async function writeManifest(): Promise<number> {
  const keys = await carried();
  // Rebuilt from empty, so a file deleted from the repository cannot go on being
  // carried by every build after it.
  await rm(FILES_DIR, { recursive: true, force: true });
  for (const key of keys) {
    const to = join(FILES_DIR, key + CARRIED_SUFFIX);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(HERE, key), to);
  }
  await mkdir(DIST, { recursive: true });
  await writeFile(MANIFEST, manifestSource(keys), "utf8");
  return keys.length;
}

/** AN EMPTY MANIFEST, WHICH IS EVERYTHING `tsc` NEEDS. The composition root
 *  imports `../dist/embedded.ts` by a literal, so `tsc` follows it and a clone
 *  that has never built the application has nothing there to follow — which is
 *  why `make types` writes one first. What it does NOT need is the files: the
 *  generated module opens with `@ts-nocheck`, so nothing in it is checked and
 *  copying a hundred of the repository's own files into `dist/files/` on every
 *  `make check` bought a typecheck nothing.
 *
 *  IT IS ALSO THE SAFE THING TO LEAVE BEHIND. A real manifest sitting in a
 *  development clone is a map of `dist/files/` copies; this one is empty, so a
 *  server run from source reads it, finds nothing carried, and serves every file
 *  off the disk it is sitting on. `make app` writes the real one on its way to a
 *  compile and nothing else ever does. */
async function writeStubManifest(): Promise<void> {
  await mkdir(DIST, { recursive: true });
  await writeFile(MANIFEST, manifestSource([]), "utf8");
}

/* ── the compile, and the bundle around it ──────────────────────────────── */

async function run(cmd: string[], cwd = HERE): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`  failed (${code}):  ${cmd.join(" ")}`);
    process.exit(code === 0 ? 1 : code);
  }
}

/** WHICH VERSION THIS BUILD IS, from the tag the checkout sits at: `v0.1.1`
 *  exactly on a tag, `v0.1.1-2-gf8759a0` between tags, with `-dirty` when the
 *  tree has edits. It is the second and last thing the compiled server knows
 *  about its own build, and its reader is the update check in `server/main.ts`,
 *  which compares it to `biom.dev/version.json` and says nothing unless that
 *  file names something newer. A checkout with no git history — a downloaded
 *  archive — falls back to `package.json`'s version so the compare still has a
 *  number to work with. */
function buildVersion(): string {
  const described = Bun.spawnSync(["git", "describe", "--tags", "--always", "--dirty"], { cwd: HERE, stdout: "pipe", stderr: "ignore" });
  const tag = described.exitCode === 0 ? described.stdout.toString().trim() : "";
  if (/^v?\d+\.\d+\.\d+/.test(tag)) return tag;
  const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as { version?: string };
  return `v${pkg.version ?? "0.0.0"}`;
}

/** The version of electron the bundle is built around, read from the one place
 *  it is declared. Passed to the packager explicitly because the staging
 *  directory it packages has no dependencies of its own — the shell is one file
 *  and imports nothing. */
async function electronVersion(): Promise<string> {
  const pkg = JSON.parse(await Bun.file(join(HERE, "package.json")).text()) as {
    devDependencies?: Record<string, string>;
  };
  const declared = pkg.devDependencies?.electron;
  if (declared === undefined) throw new Error("package.json declares no electron devDependency");
  return declared.replace(/^[^0-9]*/, "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // Ahead of the target, because an empty manifest is the same file whatever
  // machine is going to be built for and `make types` names none.
  if (argv.includes("--stub")) {
    await writeStubManifest();
    console.log(`  manifest           →  ${relative(HERE, MANIFEST)}  (a stub — nothing carried, nothing copied)`);
    return;
  }

  const at = argv.indexOf("--target");
  const name = at >= 0 ? argv[at + 1] : Bun.env.TARGET;
  const target = name === undefined || name === "" ? hostTarget() : name;

  const spec = TARGETS[target];
  if (spec === undefined) {
    console.error(`  unknown target ${target}\n  one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }

  const n = await writeManifest();
  console.log(`  manifest           →  ${relative(HERE, MANIFEST)}  (${n} files)`);
  if (argv.includes("--manifest")) return;

  // The staging directory IS what gets packaged: the shell, its package.json and
  // the compiled server, and nothing else. Rebuilt from empty every time, so a
  // binary for the last target can never be shipped inside a bundle for this one.
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  // HIDING THE CONSOLE IS A WINDOWS BUILD ON A WINDOWS MACHINE, and bun says so:
  // `--windows-hide-console` is refused outright when the compile is happening
  // anywhere else. The flag matters precisely because this binary is SPAWNED
  // rather than double-clicked — a console-subsystem child flashes a console
  // window on every launch and nobody asked for a terminal — so the Windows
  // bundle a person downloads is built on the Windows runner, which is one more
  // reason `.github/workflows/ci.yml` has three of them. Cross-compiled from
  // here it still runs; it is just not the one to ship, and it says so.
  const hideConsole = spec.platform === "win32" && process.platform === "win32";
  if (spec.platform === "win32" && !hideConsole) {
    console.log("  note                  cross-compiled from another system, so the console cannot be hidden");
  }

  const server = join(STAGE, SERVER_BINARY + spec.exe);
  await run([
    "bun",
    "build",
    "--compile",
    `--target=${spec.bun}`,
    // The one thing the compiled server knows about its own build, and NOTHING
    // READS IT YET. The reader is `environment()` in `server/main.ts`, which
    // arrives with the environment change; until it lands this substitution
    // reaches no expression and the flag is inert. It is provided now rather
    // than added then because the define is a property of the BUILD — a binary
    // compiled without it is a development build, and the two changes landing
    // apart in that order is the only order in which nothing is ever briefly
    // shipped as development by accident.
    "--define",
    'process.env.BIOM_ENV="production"',
    // And which version, read by the update check. See `buildVersion`.
    "--define",
    `process.env.BIOM_VERSION=${JSON.stringify(buildVersion())}`,
    ...(hideConsole ? ["--windows-hide-console"] : []),
    join(HERE, "server", "main.ts"),
    "--outfile",
    server,
  ]);
  console.log(`  server             →  ${relative(HERE, server)}`);

  // The shell, the ONE function it injects, and the manifest Electron reads.
  // `preload.js` is in this list rather than discovered, because a staging
  // directory built from a walk would ship whatever anybody left in `app/`.
  for (const file of SHELL_FILES) {
    await copyFile(join(HERE, "app", file), join(STAGE, file));
  }
  if (spec.platform !== "win32") await chmod(server, 0o755);

  // The bundle's icon, in the two formats two operating systems insist on, out
  // of the one PNG the shell already carries. `tools/icon.ts` is the whole of
  // it, and it is written out rather than shelled out because `sips`, `icotool`
  // and Pillow are three dependencies this build does not have.
  const { ico, icns } = containers(new Uint8Array(await readFile(ICON_SOURCE)));
  await writeFile(ICON_BASE + ".ico", ico);
  await writeFile(ICON_BASE + ".icns", icns);
  console.log(`  icon               →  ${relative(HERE, ICON_BASE)}.ico, ${relative(HERE, ICON_BASE)}.icns`);

  if (argv.includes("--no-package")) return;

  // FETCHED HERE, ONCE, IF IT IS MISSING. `bun run app` is the one command a
  // stranger is told to run, on a machine that has Bun and nothing else, and
  // the packager and Electron are devDependencies a fresh clone does not have
  // — so this is where `bun install` runs, and only when the package is not
  // there, so a clone that has installed pays nothing. `make app` installs
  // ahead of this through its own prerequisite and arrives here with the
  // directory present.
  if (!existsSync(join(HERE, "node_modules", "@electron", "packager"))) {
    console.log("  dependencies       →  bun install (once; the packager and Electron are not in the clone)");
    const installed = Bun.spawnSync(["bun", "install"], { cwd: HERE, stdout: "inherit", stderr: "inherit" });
    if (installed.exitCode !== 0) throw new Error("bun install failed, so the application cannot be packaged");
  }

  // Imported here rather than at the top, because it is a devDependency this
  // step fetches and `make dev` must not: a static import would make this file
  // unloadable in a clone that has never installed anything, and the manifest
  // half above is exactly what the tests load it for.
  const { packager } = await import("@electron/packager");
  const out = join(DIST, "out");
  const made = await packager({
    dir: STAGE,
    out,
    name: APP_NAME,
    platform: spec.platform,
    arch: spec.arch,
    electronVersion: await electronVersion(),
    // Extensionless on purpose: the packager appends `.icns` on macOS and `.ico`
    // on Windows, and reads neither on Linux.
    icon: ICON_BASE,
    // The server is a binary the shell spawns. An archive is a thing no
    // operating system can execute.
    asar: false,
    prune: false,
    overwrite: true,
  });

  for (const path of made) console.log(`  application        →  ${path}`);

  // THE LAST STEP, AND THE ONE THAT MAKES THE BUILD WORTH RUNNING. Skipped for
  // CI, and skipped for a target that is not this machine — a Windows bundle
  // sitting on a Linux desktop has no launcher to be given.
  if (argv.includes("--no-install")) {
    console.log("  not installed         --no-install, so the bundle is where it was packaged");
    return;
  }
  if (spec.platform !== hostPlatform()) {
    console.log(`  not installed         built for ${target}, which is not this machine`);
    return;
  }
  const plan = installPlan({
    platform: hostPlatform(),
    home: homedir(),
    data: dataHome(),
    env: Bun.env,
    bundle: made[0],
  });
  await install(plan, { iconSource: new Uint8Array(await readFile(ICON_SOURCE)) });
}

if (import.meta.main) {
  await main();
}
