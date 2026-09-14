#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-only
// WHERE THE BUILD ENDS: THE DESKTOP FINDING IT.
//
// `tools/app.ts` produced a bundle under `dist/out/` and stopped there, which is
// a folder nothing on the machine knows about. On Wayland it is worse than
// inconvenient — a window whose application has no `.desktop` file cannot even
// be given its icon in the task bar, because the compositor matches a window's
// app id against an installed entry and there was none to match.
//
// THE OWNER'S DECISION, ON 2026-09-14: *"I'm fine with build from source, but I
// need it to end with the desktop finding it. We also need to make it overwrite
// whatever is already there, for updates or a rerun while I'm developing."*
//
// So OVERWRITE IS THE RULE EVERYWHERE and nothing here ever asks. A rerun
// replaces the bundle, the launcher entry and the icons, because the person
// running it is either updating or in the middle of developing and a prompt is
// the wrong answer to both.
//
//   bun run tools/install.ts --from <bundle>   install that bundle
//   bun run tools/install.ts --uninstall       remove exactly what install wrote
//
// It is a separate file from `tools/app.ts` for the reason `tools/icon.ts` is:
// `app.ts` is the build, this is what happens to the thing it built, and
// `make uninstall` has to reach the second without running the first.
//
// TWO HALVES, AND THE SPLIT IS WHAT MAKES IT CHECKABLE. `installPlan()` is pure
// — given a platform, a home directory, a data directory and the bundle that was
// built, it answers the complete list of what will be written and what would be
// removed, touching no disk. `install()` and `uninstall()` carry it out. The
// test holds the plan for all three systems on any one of them, which is the
// only way the macOS and Windows arms are checked at all from here.

import { chmod, cp, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, posix, win32 } from "node:path";

import { ICO_SIZES, decodePng, encodePng, resize } from "./icon.ts";

declare const Bun: {
  spawn(
    cmd: string[],
    opts?: { stdout?: "pipe" | "ignore" | "inherit"; stderr?: "pipe" | "ignore" | "inherit" },
  ): { exited: Promise<number>; stdout: ReadableStream };
};
declare const process: {
  argv: string[];
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  exit(code: number): never;
};

/** The three systems, spelled as `process.platform` spells them, because every
 *  other name for them is a second vocabulary to translate. */
export type Platform = "linux" | "darwin" | "win32";

/** What the application is called, and what the packager therefore called the
 *  executable inside the bundle. One constant, and `tools/app.ts` has the other
 *  half of it — they are held equal by a test rather than by care. */
export const APP_NAME = "Biom";
/** The launcher entry's file name on Linux, and the desktop name the shell hands
 *  Electron so a Wayland compositor can match the window to it. Spelled here and
 *  in `app/main.js`, and in no third place. */
export const DESKTOP_FILE = "biom.desktop";
/** The icon's name in the hicolor theme — what `Icon=` in the entry names, with
 *  no path and no extension, which is how an icon is named in a theme. */
export const ICON_NAME = "biom";

/** THE SIZES THE HICOLOR THEME GETS, which are the ones `tools/icon.ts` already
 *  derives for the Windows container, plus the source picture itself. The source
 *  is in the list because it is free — it is a copy rather than a resize — and
 *  because a 512 in the theme is what a HiDPI desktop reaches for. */
export const ICON_SIZES = [512, ...ICO_SIZES];

/** One thing install writes that is not the bundle. `kind` is what it is rather
 *  than what it is called, so a test can ask for the entry without knowing the
 *  path the platform puts it at. */
export type Write = { path: string; kind: "desktop-entry" | "icon" | "shortcut"; size?: number };

/** THE PLAN: everything that will happen, decided before anything does. */
export type Plan = {
  platform: Platform;
  /** The bundle as the packager left it, or null when there is nothing to copy. */
  from: string | null;
  /** Where the bundle lands, and what `uninstall` removes. */
  appDir: string;
  /** The sibling the copy is built in, so the swap is a rename rather than a
   *  half-overwritten directory somebody has to recover from. */
  incoming: string;
  /** Where the bundle that is being replaced is moved to before it is deleted. */
  outgoing: string;
  /** The executable a launcher entry points at. */
  exec: string;
  /** What is written besides the bundle. */
  writes: Write[];
  /** Everything install wrote, deepest first, which is what uninstall removes
   *  and the whole of it. The person's vaults are not in this list and cannot
   *  be: nothing here is ever above `appDir`. */
  removes: string[];
  /** The sentence at the end — how this person opens what was just installed. */
  launcher: string;
};

/** What the plan is made from. Everything is an input, including the home and
 *  data directories, so a test can plan a Windows install from Linux. */
export type Where = {
  platform: Platform;
  /** The person's home directory. */
  home: string;
  /** This machine's Biom data directory — `dataHome()` in `app/data.js`, which
   *  is the one place that rule is written. It is passed in rather than computed
   *  because a third copy of it is a third thing to go stale. */
  data: string;
  /** The environment, for the two variables Windows addresses itself with. */
  env: Record<string, string | undefined>;
  /** The bundle to install, or null for a plan that only removes. */
  bundle?: string | null;
};

/* ── the plan ───────────────────────────────────────────────────────────── */

/** THE LINUX DATA ROOT, DERIVED FROM THE DATA DIRECTORY RATHER THAN RE-DECIDED.
 *  `dataHome()` answers `<XDG_DATA_HOME>/biom`, so its parent is the XDG data
 *  root — which is where `applications/` and `icons/` belong, and where a test
 *  pointing `XDG_DATA_HOME` at a temporary directory needs them to be. Asking
 *  the environment again here would be a second reading of the same rule, and
 *  the two would disagree the first time one of them grew a case. */
const xdgData = (data: string): string => posix.dirname(data);

/** THE PLAN JOINS PATHS THE TARGET'S WAY RATHER THAN THIS MACHINE'S. `join` is
 *  the host's flavour, so planning a Windows install from Linux produced
 *  `C:\Users\someone\AppData\Local/Programs/Biom` — a path that is not wrong
 *  enough to throw and not right enough to work. Which is also the only reason
 *  the Windows arm can be checked at all from here. */
const joiner = (platform: Platform) => (platform === "win32" ? win32.join : posix.join);

/** The launcher entry, as a whole file. `StartupWMClass` is the load-bearing
 *  line on Wayland: the compositor matches the window's app id against it to
 *  decide which installed application this window is, and without it the task
 *  bar shows a window with no icon and no name. Electron's app id on Linux is
 *  the application's name, which is why the value is `Biom` and not the file's.
 *  A path with a space in it is quoted, which the desktop entry spec asks for. */
export function desktopEntry(exec: string): string {
  const quoted = exec.includes(" ") ? `"${exec}"` : exec;
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${APP_NAME}`,
    "Comment=A workspace whose pages are folders",
    `Exec=${quoted}`,
    `Icon=${ICON_NAME}`,
    "Terminal=false",
    `StartupWMClass=${APP_NAME}`,
    "Categories=Office;Utility;",
    "",
  ].join("\n");
}

/** WHAT WILL HAPPEN, AND NOTHING HAPPENS HERE. Pure: no disk, no environment
 *  beyond what it was handed, no platform check against the machine it is
 *  running on. */
export function installPlan(where: Where): Plan {
  const { platform, home, data, env } = where;
  const bundle = where.bundle ?? null;
  const at = joiner(platform);

  if (platform === "darwin") {
    // `~/Applications` rather than `/Applications`: the second needs an
    // administrator on a managed machine, and the Dock, Spotlight and Launchpad
    // read the first exactly as they read the second.
    const appDir = at(home, "Applications", `${APP_NAME}.app`);
    return {
      platform,
      from: bundle === null ? null : at(bundle, `${APP_NAME}.app`),
      appDir,
      incoming: `${appDir}.incoming`,
      outgoing: `${appDir}.outgoing`,
      exec: at(appDir, "Contents", "MacOS", APP_NAME),
      // Nothing beside the bundle: a `.app` in `~/Applications` IS the launcher
      // entry on this system, and its icon is inside it.
      writes: [],
      removes: [appDir],
      launcher: `open it from Launchpad or Spotlight — “${APP_NAME}”`,
    };
  }

  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    const programs =
      local !== undefined && local.trim() !== "" ? at(local, "Programs") : at(home, "AppData", "Local", "Programs");
    const appDir = at(programs, APP_NAME);
    const roaming = env.APPDATA;
    const startMenu =
      roaming !== undefined && roaming.trim() !== ""
        ? at(roaming, "Microsoft", "Windows", "Start Menu", "Programs")
        : at(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
    const shortcut = at(startMenu, `${APP_NAME}.lnk`);
    return {
      platform,
      from: bundle,
      appDir,
      incoming: `${appDir}.incoming`,
      outgoing: `${appDir}.outgoing`,
      exec: at(appDir, `${APP_NAME}.exe`),
      writes: [{ path: shortcut, kind: "shortcut" }],
      removes: [shortcut, appDir],
      launcher: `open it from the Start menu — “${APP_NAME}”`,
    };
  }

  // Linux. The bundle goes BESIDE THE DATA THE APPLICATION ALREADY KEEPS rather
  // than into `~/.local/bin` or `/opt`: it is one directory the person already
  // has, it needs no administrator, and `make uninstall` removing `<data>/app`
  // can never reach a vault sitting next to it.
  const appDir = at(data, "app");
  const share = xdgData(data);
  const entry = at(share, "applications", DESKTOP_FILE);
  const icons = ICON_SIZES.map((size) => ({
    path: at(share, "icons", "hicolor", `${size}x${size}`, "apps", `${ICON_NAME}.png`),
    kind: "icon" as const,
    size,
  }));
  return {
    platform,
    from: bundle,
    appDir,
    incoming: `${appDir}.incoming`,
    outgoing: `${appDir}.outgoing`,
    exec: at(appDir, APP_NAME),
    writes: [{ path: entry, kind: "desktop-entry" }, ...icons],
    // Deepest first, so a reader of the list sees the leaves before the tree.
    removes: [entry, ...icons.map((i) => i.path), appDir],
    launcher: `open it from your applications menu — “${APP_NAME}”`,
  };
}

/* ── carrying it out ────────────────────────────────────────────────────── */

/** IS THE INSTALLED APPLICATION RUNNING RIGHT NOW. Advisory, and it says so by
 *  never failing: every arm answers false rather than throwing, because a
 *  question this cannot answer must not stop an install that would have worked.
 *
 *  On Linux it reads `/proc` rather than shelling out, which is exact — the
 *  `exe` link IS the file the process is running — and needs no tool that might
 *  not be installed. The other two ask the one command their system always has. */
export async function running(plan: Plan): Promise<boolean> {
  try {
    if (plan.platform === "linux") {
      for (const entry of await readdir("/proc")) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          if ((await readlink(join("/proc", entry, "exe"))) === plan.exec) return true;
        } catch {
          // A process that exited between the listing and the read, or one that
          // is not ours to look at. Neither is an answer.
        }
      }
      return false;
    }
    const cmd =
      plan.platform === "darwin"
        ? ["ps", "-A", "-o", "comm="]
        : ["tasklist", "/FI", `IMAGENAME eq ${APP_NAME}.exe`, "/NH"];
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return plan.platform === "darwin" ? out.includes(plan.exec) : out.includes(`${APP_NAME}.exe`);
  } catch {
    return false;
  }
}

/** Run a command and do not care whether it worked. `update-desktop-database`
 *  and `gtk-update-icon-cache` are refreshes of a cache the desktop rebuilds on
 *  its own schedule anyway: present, they make the entry appear now; absent —
 *  and on a machine with no GTK they are absent — there is nothing to say. */
async function nudge(cmd: string[]): Promise<void> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    // No such command. Silently, which is the whole point.
  }
}

/** The one committed picture, in every size the theme takes. The source is
 *  copied at its own size and resized for the rest — `tools/icon.ts` is the
 *  decoder, the box filter and the encoder, and this reaches for it rather than
 *  for `sips` or Pillow for the reason that file gives. */
async function writeIcons(plan: Plan, source: Uint8Array): Promise<void> {
  const decoded = decodePng(source);
  for (const write of plan.writes) {
    if (write.kind !== "icon" || write.size === undefined) continue;
    await mkdir(dirname(write.path), { recursive: true });
    const bytes = write.size === decoded.width ? source : encodePng(resize(decoded, write.size));
    await writeFile(write.path, bytes);
  }
}

/** REPLACE THE BUNDLE, and the order is the whole of why this is not two lines.
 *  The copy is built in a sibling and swapped in, so an install interrupted
 *  halfway leaves the working application where it was rather than a directory
 *  that is half one version and half another. The old one is moved aside before
 *  it is deleted, so the window of no-application-at-all is a rename rather than
 *  a recursive delete.
 *
 *  A RUNNING INSTANCE IS FINE ON LINUX AND MACOS AND IS NOT ON WINDOWS. There
 *  the running process holds its old inode and goes on working until it is
 *  closed; here the files are locked and the delete fails, which is reported as
 *  itself rather than as a mysterious permission error. */
async function replace(plan: Plan, say: (line: string) => void): Promise<void> {
  if (plan.from === null) throw new Error("nothing to install: no bundle was named");
  if (!existsSync(plan.from)) throw new Error(`nothing to install: ${plan.from} is not there`);

  await rm(plan.incoming, { recursive: true, force: true });
  await mkdir(dirname(plan.incoming), { recursive: true });
  // `verbatimSymlinks`, because a macOS bundle is full of them — every framework
  // inside it is a link to a versioned directory — and following them writes the
  // same megabytes several times over and produces a bundle macOS will not load.
  await cp(plan.from, plan.incoming, { recursive: true, verbatimSymlinks: true });

  const staged = join(plan.incoming, plan.exec.slice(plan.appDir.length + 1));
  if (plan.platform !== "win32" && existsSync(staged)) await chmod(staged, 0o755);

  await rm(plan.outgoing, { recursive: true, force: true });
  if (existsSync(plan.appDir)) {
    try {
      await rename(plan.appDir, plan.outgoing);
    } catch (e) {
      if (plan.platform === "win32") {
        await rm(plan.incoming, { recursive: true, force: true });
        throw new Error(
          `${plan.appDir} could not be replaced — Windows locks the files of a running program. Close ${APP_NAME} and run this again.`,
        );
      }
      throw e;
    }
  }
  await rename(plan.incoming, plan.appDir);
  await rm(plan.outgoing, { recursive: true, force: true });
  say(`  installed          →  ${plan.appDir}`);
}

/** The Start menu shortcut, written by the one scripting host every Windows has.
 *  No third-party package: `WScript.Shell` has created shortcuts since before
 *  PowerShell existed, and reaching for an npm module to write five lines of it
 *  would be a dependency in the build a person is trying to trust. */
async function writeShortcut(plan: Plan, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const script = [
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(" + quotePs(path) + ")",
    "$s.TargetPath = " + quotePs(plan.exec),
    "$s.WorkingDirectory = " + quotePs(plan.appDir),
    "$s.IconLocation = " + quotePs(plan.exec),
    `$s.Description = "${APP_NAME}"`,
    "$s.Save()",
  ].join("; ");
  await nudge(["powershell", "-NoProfile", "-NonInteractive", "-Command", script]);
}

/** A PowerShell single-quoted string, where the only escape is a doubled quote. */
export function quotePs(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

/** THE WHOLE OF IT: replace the bundle, write the launcher entry and the icons,
 *  nudge the two caches, say where it went. */
export async function install(
  plan: Plan,
  opts: { iconSource: Uint8Array; say?: (line: string) => void },
): Promise<void> {
  const say = opts.say ?? ((line: string) => console.log(line));

  if (await running(plan)) {
    say(
      plan.platform === "win32"
        ? `  note                  ${APP_NAME} is running, and Windows locks a running program's files`
        : `  note                  ${APP_NAME} is running; its files are being replaced and the open window keeps the old ones until it is closed`,
    );
  }

  await replace(plan, say);

  for (const write of plan.writes) {
    if (write.kind === "desktop-entry") {
      await mkdir(dirname(write.path), { recursive: true });
      await writeFile(write.path, desktopEntry(plan.exec), "utf8");
      say(`  launcher entry     →  ${write.path}`);
    }
    if (write.kind === "shortcut") {
      await writeShortcut(plan, write.path);
      say(`  start menu         →  ${write.path}`);
    }
  }

  if (plan.writes.some((w) => w.kind === "icon")) {
    await writeIcons(plan, opts.iconSource);
    const theme = posix.join(xdgData(posix.dirname(plan.appDir)), "icons", "hicolor");
    say(`  icons              →  ${theme}  (${ICON_SIZES.join(", ")})`);
    await nudge(["update-desktop-database", dirname(plan.writes[0].path)]);
    await nudge(["gtk-update-icon-cache", "-f", "-t", theme]);
  }

  say(`  ${plan.launcher}`);
}

/** THE REVERSE, AND EXACTLY THE REVERSE. It removes what the plan says install
 *  writes and not one path more — no vault, no `workspace.db`, nothing under the
 *  data directory but `app/`. Anything already gone is not an error. */
export async function uninstall(plan: Plan, say: (line: string) => void = console.log): Promise<string[]> {
  const gone: string[] = [];
  for (const path of plan.removes) {
    if (!existsSync(path)) continue;
    await rm(path, { recursive: true, force: true });
    gone.push(path);
    say(`  removed            →  ${path}`);
  }
  // The two halves of an interrupted install, which are ours and are never
  // anybody's data.
  for (const path of [plan.incoming, plan.outgoing]) await rm(path, { recursive: true, force: true });
  if (gone.length === 0) say(`  nothing installed  —  ${plan.appDir} is not there`);
  else if (plan.platform === "linux") {
    await nudge(["update-desktop-database", dirname(plan.removes[0])]);
    await nudge(["gtk-update-icon-cache", "-f", "-t", posix.join(xdgData(posix.dirname(plan.appDir)), "icons", "hicolor")]);
  }
  return gone;
}

/* ── the command ────────────────────────────────────────────────────────── */

/** The host's own platform, in this file's vocabulary. */
export function hostPlatform(): Platform {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

async function main(): Promise<void> {
  const { homedir } = await import("node:os");
  // The shell's copy of where this machine keeps its data — the same module
  // `app/main.js` reads, so the install lands beside the data the application
  // will actually use.
  const { dataHome } = (await import("../app/data.js")) as { dataHome: () => string };
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--from");
  const plan = installPlan({
    platform: hostPlatform(),
    home: homedir(),
    data: dataHome(),
    env: process.env,
    bundle: at >= 0 ? argv[at + 1] : null,
  });

  if (argv.includes("--uninstall")) {
    await uninstall(plan);
    return;
  }
  const source = new Uint8Array(await readFile(join(import.meta.dir, "..", "app", "icon.png")));
  await install(plan, { iconSource: source });
}

if (import.meta.main) {
  await main();
}
