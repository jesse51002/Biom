// SPDX-License-Identifier: AGPL-3.0-only
// THE BUILD ENDS WITH THE DESKTOP FINDING IT, and these are the three halves of
// that sentence a person should not have to check by hand.
//
//   · THE PLAN, WHICH IS PURE. Given a platform, a home and a data directory it
//     answers every path that will be written and every path that would be
//     removed, touching no disk — which is the only way the macOS and Windows
//     arms are checked at all from a Linux machine, and the only way the rule
//     that uninstall never reaches a vault can be stated as a test rather than
//     as care.
//
//   · `--no-install` WRITES NOTHING OUTSIDE `dist/`, because CI passes it and a
//     runner that grew a launcher entry would be a build doing something to a
//     machine nobody asked it to.
//
//   · A REAL INSTALL, INTO A TEMPORARY HOME. The bundle, the entry and the icons
//     land; a second install replaces all three rather than adding to them, and
//     the inode of the installed executable changes, which is the difference
//     between replacing a directory and copying into one that was already there.
//     Nothing here touches the machine's own `~/.local/share`.

import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  APP_NAME,
  DESKTOP_FILE,
  ICON_NAME,
  ICON_SIZES,
  desktopEntry,
  install,
  installPlan,
  quotePs,
  uninstall,
} from "../tools/install.ts";
import { ICO_SIZES, decodePng } from "../tools/icon.ts";
import { dataHome } from "../app/data.js";

const HERE = join(import.meta.dir, "..");

/** A plan for a system this test is not necessarily running on. Every input is
 *  named, so the answer depends on nothing about this machine. */
const planFor = (platform: "linux" | "darwin" | "win32", home: string, env: Record<string, string> = {}) =>
  installPlan({
    platform,
    home,
    data:
      platform === "win32"
        ? join(home, "AppData", "Local", "Biom")
        : platform === "darwin"
          ? join(home, "Library", "Application Support", "Biom")
          : join(home, ".local", "share", "biom"),
    env,
    bundle: "/build/dist/out/bundle",
  });

/* ── the plan ───────────────────────────────────────────────────────────── */

test("the Linux plan installs beside the data the application already keeps, and names a launcher entry and the theme's icons", () => {
  const plan = planFor("linux", "/home/someone");

  expect(plan.appDir).toBe("/home/someone/.local/share/biom/app");
  expect(plan.exec).toBe("/home/someone/.local/share/biom/app/Biom");

  const entry = plan.writes.find((w) => w.kind === "desktop-entry");
  expect(entry?.path).toBe(`/home/someone/.local/share/applications/${DESKTOP_FILE}`);

  const icons = plan.writes.filter((w) => w.kind === "icon");
  expect(icons.map((i) => i.size)).toEqual(ICON_SIZES);
  // Every size `tools/icon.ts` derives for the Windows container, and the source
  // picture at its own size. Neither list is typed twice.
  expect(ICON_SIZES).toEqual([512, ...ICO_SIZES]);
  expect(icons[1].path).toBe(`/home/someone/.local/share/icons/hicolor/256x256/apps/${ICON_NAME}.png`);
});

test("the XDG data directory the entry and the icons go under is the one the data directory is in, not a second reading of the environment", () => {
  // The whole point: a temporary `XDG_DATA_HOME` moves all three together, which
  // is what makes the real-install test below safe to run at all.
  const plan = installPlan({
    platform: "linux",
    home: "/home/someone",
    data: "/tmp/elsewhere/biom",
    env: { XDG_DATA_HOME: "/not/read/here" },
    bundle: null,
  });
  expect(plan.appDir).toBe("/tmp/elsewhere/biom/app");
  expect(plan.writes[0].path).toBe(`/tmp/elsewhere/applications/${DESKTOP_FILE}`);
  expect(plan.writes[1].path.startsWith("/tmp/elsewhere/icons/hicolor/")).toBe(true);
});

test("the macOS plan is a bundle in the person's own Applications folder and nothing else", () => {
  const plan = planFor("darwin", "/Users/someone");
  expect(plan.appDir).toBe(`/Users/someone/Applications/${APP_NAME}.app`);
  expect(plan.from).toBe(`/build/dist/out/bundle/${APP_NAME}.app`);
  expect(plan.exec).toBe(`/Users/someone/Applications/${APP_NAME}.app/Contents/MacOS/${APP_NAME}`);
  // A `.app` IS the launcher entry on this system; there is no second file, and
  // `/Applications` is not written to because that needs an administrator.
  expect(plan.writes).toEqual([]);
  expect(plan.removes).toEqual([plan.appDir]);
});

test("the Windows plan is a folder under Programs and a Start menu shortcut", () => {
  const plan = planFor("win32", "C:\\Users\\someone", {
    LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local",
    APPDATA: "C:\\Users\\someone\\AppData\\Roaming",
  });
  expect(plan.appDir).toBe(`C:\\Users\\someone\\AppData\\Local\\Programs\\${APP_NAME}`);
  expect(plan.exec.endsWith(`${APP_NAME}.exe`)).toBe(true);
  const shortcut = plan.writes.find((w) => w.kind === "shortcut");
  expect(shortcut?.path).toBe(
    `C:\\Users\\someone\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\${APP_NAME}.lnk`,
  );
});

test("the Windows plan falls back to the profile when neither variable is set, rather than writing to a relative path", () => {
  const plan = planFor("win32", "C:\\Users\\someone", {});
  expect(plan.appDir.startsWith("C:\\Users\\someone\\AppData\\Local\\Programs")).toBe(true);
  expect(plan.writes[0].path.startsWith("C:\\Users\\someone\\AppData\\Roaming")).toBe(true);
});

test("uninstall removes exactly what install wrote, and nothing above any of it", () => {
  for (const platform of ["linux", "darwin", "win32"] as const) {
    const home = platform === "win32" ? "C:\\Users\\someone" : "/home/someone";
    const plan = planFor(platform, home, {
      LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local",
      APPDATA: "C:\\Users\\someone\\AppData\\Roaming",
    });
    // Everything written is removed, and the bundle is removed too.
    for (const write of plan.writes) expect(plan.removes).toContain(write.path);
    expect(plan.removes).toContain(plan.appDir);
    // And NOTHING ELSE. In particular the data directory itself is never in the
    // list — the vaults, `workspace.db` and the remembered list live there.
    expect(plan.removes.length).toBe(plan.writes.length + 1);
    for (const path of plan.removes) expect(path.length).toBeGreaterThan(plan.appDir.length - 1);
    expect(plan.removes).not.toContain(home);
  }
});

test("the launcher entry names the executable, the theme icon and the window class the shell sets", async () => {
  const entry = desktopEntry("/home/someone/.local/share/biom/app/Biom");
  expect(entry.startsWith("[Desktop Entry]\n")).toBe(true);
  expect(entry).toContain("Exec=/home/someone/.local/share/biom/app/Biom");
  expect(entry).toContain(`Icon=${ICON_NAME}`);
  expect(entry).toContain("Type=Application");
  expect(entry).toContain("Categories=");
  // THE WAYLAND HALF. The compositor matches the window's app id against an
  // installed entry; Electron's app id on Linux is the application's name, so
  // this line is that name and the file is what `app/main.js` hands
  // `setDesktopName`. Both are held here rather than trusted.
  expect(entry).toContain(`StartupWMClass=${APP_NAME}`);
  const shell = await readFile(join(HERE, "app", "main.js"), "utf8");
  expect(shell).toContain(`const DESKTOP_FILE = "${DESKTOP_FILE}"`);
  expect(shell).toContain("app.setDesktopName(DESKTOP_FILE)");
});

test("a path with a space in it is quoted in the entry, and a quote is doubled for PowerShell", () => {
  expect(desktopEntry("/home/some one/app/Biom")).toContain('Exec="/home/some one/app/Biom"');
  expect(quotePs("C:\\it's\\here")).toBe("'C:\\it''s\\here'");
});

test("the application's name is one word, spelled where the launcher entry and the packager both read it", async () => {
  const build = await readFile(join(HERE, "tools", "app.ts"), "utf8");
  // `tools/app.ts` re-exports it rather than declaring a second one, so a build
  // that packaged `Biom` while the desktop looked for something else cannot
  // happen by editing one of two constants.
  expect(build).toContain('import { APP_NAME, hostPlatform, install, installPlan } from "./install.ts"');
  expect(build).toContain("export { APP_NAME }");
  expect(APP_NAME).toBe("Biom");
});

test("the plan the build makes on this machine lands beside this machine's Biom data", () => {
  // The install directory IS `dataHome()/app` — the one place the rule for where
  // this machine keeps its Biom data is written, read by the shell and by the
  // server, and read here rather than re-derived.
  const plan = installPlan({
    platform: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
    home: process.env.HOME ?? process.env.USERPROFILE ?? "/",
    data: dataHome(),
    env: process.env as Record<string, string | undefined>,
    bundle: null,
  });
  if (process.platform === "linux") expect(plan.appDir).toBe(join(dataHome(), "app"));
  expect(plan.appDir.length).toBeGreaterThan(0);
});

/* ── --no-install writes nothing outside dist/ ──────────────────────────── */

test("`--no-install` is what CI passes, and it stops the build at the bundle", async () => {
  const build = await readFile(join(HERE, "tools", "app.ts"), "utf8");
  expect(build).toContain('argv.includes("--no-install")');
  // The flag is checked BEFORE anything is installed and AFTER the packaging, so
  // what it leaves behind is exactly `dist/`.
  const flag = build.indexOf('argv.includes("--no-install")');
  expect(flag).toBeGreaterThan(build.indexOf("const made = await packager("));
  expect(flag).toBeLessThan(build.indexOf("await install(plan,"));

  const ci = await readFile(join(HERE, ".github", "workflows", "ci.yml"), "utf8");
  // Every leg of the matrix and the e2e job's build, because a runner has no
  // desktop and a build that wrote into one would be writing into a machine
  // that is deleted a minute later.
  // The lines that RUN it, not the ones that talk about it: `build:` in the
  // matrix and `run:` in the steps.
  const builds = ci
    .split("\n")
    .filter((line) => /^\s*(build|run):\s*(make app|bun run app)\b/.test(line));
  expect(builds.length).toBeGreaterThan(0);
  for (const line of builds) expect(line).toContain("--no-install");
});

test("a build for another system packages and stops, because there is no desktop here that could open it", async () => {
  const build = await readFile(join(HERE, "tools", "app.ts"), "utf8");
  expect(build).toContain("spec.platform !== hostPlatform()");
});

/* ── a real install, into a temporary home ──────────────────────────────── */

/** A bundle the shape the packager leaves: a directory with an executable in it
 *  and a file beside it, so a replacement can be told from a merge. */
async function fakeBundle(at: string, marker: string): Promise<string> {
  await mkdir(at, { recursive: true });
  await writeFile(join(at, APP_NAME), `#!/bin/sh\necho ${marker}\n`, { mode: 0o755 });
  await writeFile(join(at, "version.txt"), marker, "utf8");
  await writeFile(join(at, `${marker}.only`), "", "utf8");
  return at;
}

test("a real install writes the bundle, the entry and the icons, and a second one replaces all three", async () => {
  const root = await mkdtemp(join(tmpdir(), "biom-install-"));
  try {
    // EVERYTHING IS UNDER THIS DIRECTORY. The plan is handed a data directory
    // inside it, and the entry and the icons follow from that rather than from
    // the environment — so this test cannot reach the machine's own launcher
    // entries however it is run.
    const data = join(root, "share", "biom");
    const icon = new Uint8Array(await readFile(join(HERE, "app", "icon.png")));
    const said: string[] = [];

    const first = installPlan({
      platform: "linux",
      home: root,
      data,
      env: {},
      bundle: await fakeBundle(join(root, "out-1"), "one"),
    });
    await install(first, { iconSource: icon, say: (line) => said.push(line) });

    expect(existsSync(first.exec)).toBe(true);
    expect((await stat(first.exec)).mode & 0o111).toBeGreaterThan(0);
    expect(await readFile(join(first.appDir, "version.txt"), "utf8")).toBe("one");

    const entry = first.writes.find((w) => w.kind === "desktop-entry");
    expect(await readFile(entry.path, "utf8")).toContain(`Exec=${first.exec}`);

    for (const write of first.writes.filter((w) => w.kind === "icon")) {
      const png = decodePng(new Uint8Array(await readFile(write.path)));
      expect(png.width).toBe(write.size);
      expect(png.height).toBe(write.size);
    }

    // It says where it went and how to open it, which is the one line the person
    // running the build reads.
    expect(said.join("\n")).toContain(first.appDir);
    expect(said.join("\n")).toContain("applications menu");

    // THE RERUN, WHICH IS THE OWNER'S CASE. A developer rebuilds; the second
    // bundle REPLACES the first rather than being merged into it.
    const before = await stat(first.exec);
    const second = installPlan({
      platform: "linux",
      home: root,
      data,
      env: {},
      bundle: await fakeBundle(join(root, "out-2"), "two"),
    });
    await install(second, { iconSource: icon, say: () => {} });

    expect(await readFile(join(second.appDir, "version.txt"), "utf8")).toBe("two");
    // The file only the first bundle had is gone, which is the difference
    // between replacing a directory and copying over one.
    expect(existsSync(join(second.appDir, "one.only"))).toBe(false);
    expect(existsSync(join(second.appDir, "two.only"))).toBe(true);
    expect((await stat(second.exec)).ino).not.toBe(before.ino);
    // And nothing is left of the swap.
    expect(existsSync(second.incoming)).toBe(false);
    expect(existsSync(second.outgoing)).toBe(false);

    // The entry and the icons are still exactly one each, overwritten in place.
    expect(await readFile(entry.path, "utf8")).toContain(`Exec=${second.exec}`);

    // AND THE REVERSE TAKES IT ALL BACK, AND ONLY IT. A vault sitting beside the
    // install in the same data directory is untouched, which is the rule
    // `make uninstall` is under.
    const vault = join(data, "vaults", "mine.txt");
    await mkdir(join(data, "vaults"), { recursive: true });
    await writeFile(vault, "not yours", "utf8");

    const gone = await uninstall(second, () => {});
    expect(gone).toContain(second.appDir);
    expect(gone).toContain(entry.path);
    expect(existsSync(second.appDir)).toBe(false);
    for (const write of second.writes) expect(existsSync(write.path)).toBe(false);
    expect(existsSync(vault)).toBe(true);
    expect(existsSync(data)).toBe(true);

    // Twice is not an error: there is simply nothing left to remove.
    expect(await uninstall(second, () => {})).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
