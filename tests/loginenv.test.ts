// SPDX-License-Identifier: AGPL-3.0-only
// The person's login environment, read out of a shell that is a small script
// written here — so what an rc file does is decided by the test and no real
// profile on the machine running it is read. Every shell below is invented.
//
// What is held: a profile that prints junk around the environment is read
// between the markers and nothing else; a shell that hangs is killed with its
// group when the bound runs out and the server's own environment answers with
// a reason; a shell that exits leaving a job holding its output open is not
// waited on; the reading is taken once per server; the server's markers never
// reach an agent while the person's keys do; and Windows says it has no login
// shell rather than trying.

import { test, expect, afterAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executable, makeLoginEnv, mergePath, parseEnvBlock, readLoginEnv, whichIn } from "../server/platform/loginenv.ts";

const dir = mkdtempSync(join(tmpdir(), "biom-loginenv-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A "login shell": whatever `body` does as its profile, then — unless the
 *  body exits first — the `-c` script it was handed, run by /bin/sh. */
function shell(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\nwhile [ "$#" -gt 0 ] && [ "$1" != "-c" ]; do shift; done\nexec /bin/sh -c "$2"\n`);
  chmodSync(path, 0o755);
  return path;
}

// What the composition root hands: the terminal's environment, `scrubEnv`'s —
// which has already dropped `VAULT` — with a stray marker to prove none leaks.
const base = { PATH: "/usr/bin:/bin", HOME: dir, SECRET_TOKEN: "s3cr3t-value", BIOM_SHELL: "1" };

test("a profile that prints junk, NULs included, is read between the markers", async () => {
  const sh = shell("noisy", [
    `echo "Welcome back! Today's fortune: = = ="`,
    `printf 'JUNK=1\\000NOT_A_VAR\\000'`,
    `export FROM_PROFILE=yes`,
    `export PATH="/opt/tool/bin:$PATH"`,
  ].join("\n"));
  const r = await readLoginEnv({ shell: sh, base, cwd: dir });
  expect(r.from).toBe("shell");
  expect(r.reason).toBeNull();
  expect(r.env.FROM_PROFILE).toBe("yes");
  expect(r.env.JUNK).toBeUndefined();
  expect(r.env.NOT_A_VAR).toBeUndefined();
  // The person's keys are carried: the agent reads its login out of them.
  expect(r.env.SECRET_TOKEN).toBe("s3cr3t-value");
  // The server's own plumbing is not.
  expect(r.env.BIOM_SHELL).toBeUndefined();
  // Nor the capturing shell's own folder and level.
  expect(r.env.PWD).toBeUndefined();
  expect(r.env.SHLVL).toBeUndefined();
  expect(r.env.PATH?.split(":")[0]).toBe("/opt/tool/bin");
});

test("a profile that RESETS PATH gets the server's entries back after its own", async () => {
  const sh = shell("reset", `export PATH=/usr/bin:/bin`);
  const r = await readLoginEnv({ shell: sh, base: { ...base, PATH: "/fake/agents:/usr/bin:/bin" }, cwd: dir });
  expect(r.env.PATH).toBe("/usr/bin:/bin:/fake/agents");
});

test("a shell that hangs is killed with its group, and the server's own environment answers", async () => {
  const pidFile = join(dir, "hang.pid");
  const sh = shell("hang", `echo $$ > "${pidFile}"\nexec sleep 30`);
  const t0 = Date.now();
  const r = await readLoginEnv({ shell: sh, base, cwd: dir, timeoutMs: 400 });
  expect(Date.now() - t0).toBeLessThan(5000);
  expect(r.from).toBe("server");
  expect(r.reason).toContain("did not answer");
  expect(r.env.SECRET_TOKEN).toBe("s3cr3t-value");
  expect(r.env.BIOM_SHELL).toBeUndefined();
  // The shell — exec'd into `sleep`, the same pid — is gone.
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) {
    try {
      process.kill(pid, 0);
      await Bun.sleep(25);
    } catch {
      gone = true;
    }
  }
  expect(gone).toBe(true);
});

test("a shell that exits leaving a job holding its output is not waited on", async () => {
  // The profile starts a job that inherits stdout and then exits before the
  // script runs, so no end marker is ever printed and the pipe never closes.
  const sh = shell("holder", `sleep 30 &\nexit 0`);
  const t0 = Date.now();
  const r = await readLoginEnv({ shell: sh, base, cwd: dir, timeoutMs: 8000 });
  expect(Date.now() - t0).toBeLessThan(4000);
  expect(r.from).toBe("server");
  expect(r.reason).toContain("no environment");
});

test("the reading is taken once per server, however many ask", async () => {
  const count = join(dir, "count");
  const sh = shell("counted", `echo x >> "${count}"`);
  const login = makeLoginEnv({ shell: sh, base, cwd: dir });
  expect(existsSync(count)).toBe(false); // nothing is asked at construction
  const [a, b] = await Promise.all([login.read(), login.read()]);
  const c = await login.read();
  expect(a).toBe(b);
  expect(c).toBe(a);
  expect(readFileSync(count, "utf8").trim().split("\n").length).toBe(1);
  expect(login.reason()).toBeNull();
});

test("A READING DROPPED IS TAKEN AGAIN on the next read — once, however many ask — and holds what the profile says now", async () => {
  const count = join(dir, "count-forget");
  const later = join(dir, "later-key");
  // The profile exports a key once the person has put it there. Invented.
  const sh = shell("forgets", `echo x >> "${count}"\n[ -f "${later}" ] && export INVENTED_AGENT_KEY="$(cat "${later}")"`);
  const login = makeLoginEnv({ shell: sh, base, cwd: dir });
  const first = await login.read();
  expect(first.INVENTED_AGENT_KEY).toBeUndefined();
  writeFileSync(later, "invented-value");
  // Kept until it is dropped.
  expect((await login.read()).INVENTED_AGENT_KEY).toBeUndefined();
  login.forget();
  const [a, b] = await Promise.all([login.read(), login.read()]);
  expect(a).toBe(b);
  expect(a.INVENTED_AGENT_KEY).toBe("invented-value");
  expect(await login.read()).toBe(a);
  expect(readFileSync(count, "utf8").trim().split("\n").length).toBe(2);
});

test("A RE-READ THAT FAILS KEEPS THE GOOD READING: a shell that hangs after forget leaves the person's environment and its reason as they were, and a later good one replaces it", async () => {
  const hang = join(dir, "hang-now");
  const key = join(dir, "key-now");
  writeFileSync(key, "invented-one");
  // Exports the key the file holds, on a PATH of the profile's own — and
  // hangs past the bound while `hang` exists. Invented.
  const sh = shell("hangs-later", `[ -f "${hang}" ] && sleep 30\nexport PATH="/login/only/bin:$PATH"\nexport INVENTED_AGENT_KEY="$(cat "${key}")"`);
  const login = makeLoginEnv({ shell: sh, base, cwd: dir, timeoutMs: 400 });
  const good = await login.read();
  expect(good.INVENTED_AGENT_KEY).toBe("invented-one");
  expect(good.PATH?.startsWith("/login/only/bin:")).toBe(true);

  writeFileSync(hang, "");
  login.forget();
  const kept = await login.read();
  expect(kept).toBe(good);
  expect(login.reason()).toBeNull();

  rmSync(hang);
  writeFileSync(key, "invented-two");
  login.forget();
  const next = await login.read();
  expect(next.INVENTED_AGENT_KEY).toBe("invented-two");
  expect(login.reason()).toBeNull();
}, 10_000);

test("a missing shell, and Windows, answer the server's environment with a reason that names no value", async () => {
  const missing = await readLoginEnv({ shell: join(dir, "no-such-shell"), base, cwd: dir });
  expect(missing.from).toBe("server");
  expect(missing.reason).toContain("no login shell");
  const none = await readLoginEnv({ shell: null, base, cwd: dir });
  expect(none.reason).toContain("no login shell");
  const win = await readLoginEnv({ shell: "/bin/sh", base, platform: "win32" });
  expect(win.from).toBe("server");
  expect(win.reason).toContain("Windows");
  for (const r of [missing, none, win]) {
    expect(r.reason).not.toContain("s3cr3t");
    expect(r.env.SECRET_TOKEN).toBe("s3cr3t-value");
    expect(r.env.BIOM_SHELL).toBeUndefined();
  }
});

test("the pure halves", () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  expect(parseEnvBlock(enc("junk S A=1\u0000B=x=y\u0000\u0000bad name=1\u0000E junk"), "S ", "E")).toEqual({ A: "1", B: "x=y" });
  expect(parseEnvBlock(enc("no markers"), "S", "E")).toBeNull();
  expect(parseEnvBlock(enc("E before S"), "S", "E")).toBeNull();
  expect(parseEnvBlock(enc("S E"), "S", "E")).toBeNull();
  expect(mergePath("/a:/b", "/b:/c::/a:/d", "linux")).toBe("/a:/b:/c:/d");
  expect(mergePath(undefined, "/x", "linux")).toBe("/x");
  expect(mergePath("C:\\a", "C:\\a;C:\\b", "win32")).toBe("C:\\a;C:\\b");
  expect(whichIn("sh", { PATH: "/bin:/usr/bin" })).not.toBeNull();
  expect(whichIn("../sh", { PATH: "/bin" })).toBeNull();
  expect(whichIn("definitely-not-a-command-here", { PATH: "/bin" })).toBeNull();
  expect(executable("/bin/sh")).toBe(true);
  expect(executable(dir)).toBe(false);
});
