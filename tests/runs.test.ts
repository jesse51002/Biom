// SPDX-License-Identifier: AGPL-3.0-only
// THE REGISTRY, against a real temporary vault and real processes. The folder
// reader over good and bad manifests, the run directory assembled from a
// folder and its page, the inputs settled and substituted, the row written and
// rewritten, the log read from an offset with a cut character held back, the
// kill that takes the group, the reconcile that marks a dead pid lost, and the
// files the two screens may open. Nothing here reaches a real vault: every
// folder is under a temporary directory and removed after.

import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, lstatSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDb } from "../server/platform/db.ts";
import { makeFiles } from "../server/platform/files.ts";
import { makeRunFs } from "../server/platform/rundir.ts";
import { makeProcessRunner } from "../server/platform/process.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { makePages, pageDir, pageFile } from "../server/domain/pages.ts";
import { makeRuns, manifestOf, settleInputs, substitute, completeUtf8, runAgentsMd, pageFileOk, vaultFileOk } from "../server/domain/runs.ts";
import type { Files, FileEntry, RunRow, ProcessRunner } from "../contracts/types.ts";

const POSIX = process.platform !== "win32";
const only = POSIX ? test : test.skip;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const scratch: string[] = [];
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A read-only Files over a map, for templates. */
function memFiles(entries: Record<string, string>): Files {
  return {
    async read(rel) { return entries[rel] ?? null; },
    async write() { throw new Error("read only"); },
    async remove() { throw new Error("read only"); },
    async list(rel) {
      const prefix = rel === "" || rel === "." ? "" : rel + "/";
      const seen = new Map<string, boolean>();
      for (const k of Object.keys(entries)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const cut = rest.indexOf("/");
        if (cut === -1) seen.set(rest, false); else seen.set(rest.slice(0, cut), true);
      }
      if (seen.size === 0 && prefix !== "") throw new Error("ENOENT");
      const out: FileEntry[] = [];
      for (const [name, dir] of seen) out.push({ name, dir });
      return out;
    },
    async commit() {},
  };
}

const TEMPLATES = memFiles({
  "sh/automation.yaml": "name: Shell\nagent: sh\ncommand: [sh, -c, \"echo hi\"]\n",
  "sh/kickoff.md": "Say {greeting}.\n",
  "sh/INSTRUCTIONS.md": "Be brief.\n",
});

interface World {
  root: string;
  files: Files;
  runs: ReturnType<typeof makeRuns>;
  changes: { what: string; id: string }[];
  process: ProcessRunner;
  env: Record<string, string | undefined>;
}

/** A vault on disk with one page holding one automation, and the module over it. */
async function world(opts: { manifest?: string; kickoff?: string; process?: ProcessRunner; env?: Record<string, string> } = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "biom-runs-"));
  scratch.push(root);
  const files = makeFiles(root);
  const yaml = { parse, parseAny, format, formatAny };
  const pages = makePages(files, yaml);
  const made = await pages.create({ name: "Socials" });
  const dir = pageDir(made.id);
  await files.write(`${dir}/INSTRUCTIONS.md`, "# Socials\nThe page's.\n");
  await files.write(`${dir}/automations/pull/automation.yaml`, opts.manifest ??
    "name: Pull\ndescription: Pull the week.\nagent: sh\nenv: [PULL_TOKEN]\ncommand: [sh, -c, \"echo start {window} {dry}; cat kickoff.md; echo $BIOM_RUN; echo err >&2\"]\ninputs:\n  - { name: window, type: number, default: 7 }\n  - { name: dry, type: boolean, default: false }\n  - { name: tag, type: text, required: true }\n");
  await files.write(`${dir}/automations/pull/kickoff.md`, opts.kickoff ?? "Pull {window} days tagged {tag}. {vault} and {not_a_thing}.\n");
  await files.write(`${dir}/automations/pull/INSTRUCTIONS.md`, "Unattended.\n");
  await files.write(`${dir}/automations/pull/skills/one/SKILL.md`, "# one\n");
  await files.write(`${dir}/automations/pull/code/main.sh`, "echo code\n");
  await files.write(`${dir}/automations/broken/automation.yaml`, "name: Broken\ncommand: not-a-list\n");
  await files.write(`${dir}/automations/notone/README.md`, "no manifest here\n");
  await files.write(".agents/skills/mine/SKILL.md", "# mine\n");
  await files.write(".agents/skills/seeded-one/SKILL.md", "# seeded\n");
  const changes: { what: string; id: string }[] = [];
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, PULL_TOKEN: "t-123", BIOM_SHELL: "1", SECRET: "no", ...(opts.env ?? {}) };
  const proc = opts.process ?? makeProcessRunner();
  const runs = makeRuns({
    db: makeDb(":memory:"),
    files,
    fs: makeRunFs(root),
    yaml,
    process: proc,
    dirOf: pageDir,
    refOf: async (id) => (await pages.list()).find((p) => p.id === id) ?? null,
    env: () => env,
    templates: TEMPLATES,
    api: () => ({ url: "http://127.0.0.1:4400/v/x/api/call", token: "tok" }),
    seededSkill: async (name) => name.startsWith("seeded-"),
    onChange: (what, row) => changes.push({ what, id: row.id }),
    grace: 300,
  });
  return { root, files, runs, changes, process: proc, env };
}

const PAGE = "home/Socials";

/* ── the manifest, the inputs, the words ──────────────────────────────── */

test("manifestOf narrows a manifest and refuses one that is not one, by sentence", () => {
  const m = manifestOf(parseAny("name: X\ncommand: [echo, 1]\ninputs:\n  - { name: a, type: number, default: 2, required: true }\n"), "x");
  expect(m).toEqual({ name: "X", description: "", agent: "", env: [], command: ["echo", "1"], inputs: [{ name: "a", type: "number", default: 2, required: true }] });
  // Thinnest defaults: a folder with only a command is an automation named for its folder.
  expect(manifestOf({ command: ["true"] }, "quiet").name).toBe("quiet");
  expect(() => manifestOf({ name: "X" }, "x")).toThrow(/command/);
  expect(() => manifestOf({ command: "sh -c" }, "x")).toThrow(/list/);
  expect(() => manifestOf({ command: ["x"], env: "A" }, "x")).toThrow(/env/);
  expect(() => manifestOf({ command: ["x"], inputs: [{ type: "text" }] }, "x")).toThrow(/name/);
  expect(() => manifestOf({ command: ["x"], inputs: [{ name: "a" }, { name: "a" }] }, "x")).toThrow(/twice/);
  expect(() => manifestOf({ command: ["x"], inputs: [{ name: "a", type: "date" }] }, "x")).toThrow(/type/);
  expect(() => manifestOf("nope", "x")).toThrow(/map/);
});

test("settleInputs applies defaults, coerces by type, and refuses by name", () => {
  const declared = manifestOf({ command: ["x"], inputs: [
    { name: "n", type: "number", default: 7 },
    { name: "b", type: "boolean", default: false },
    { name: "t", type: "text", required: true },
    { name: "opt", type: "text" },
  ] }, "x").inputs;
  expect(settleInputs(declared, { t: "pricing" })).toEqual({ n: 7, b: false, t: "pricing", opt: "" });
  expect(settleInputs(declared, { t: "x", n: "12", b: "yes" })).toEqual({ n: 12, b: true, t: "x", opt: "" });
  expect(() => settleInputs(declared, {})).toThrow(/required/);
  expect(() => settleInputs(declared, { t: "x", n: "seven" })).toThrow(/number/);
  expect(() => settleInputs(declared, { t: "x", nope: 1 })).toThrow(/no input called nope/);
});

test("substitute fills what it knows and leaves what it does not", () => {
  expect(substitute("a {b} {c} {d}", { b: "B", c: "" })).toBe("a B  {d}");
  expect(substitute("{vault}/x", { vault: "/v" })).toBe("/v/x");
});

test("completeUtf8 holds back a character cut by the read", () => {
  const e = new TextEncoder();
  const whole = e.encode("aé€😀");
  expect(completeUtf8(whole)).toBe(whole.length);
  expect(completeUtf8(whole.subarray(0, 2))).toBe(1); // a + half of é
  expect(completeUtf8(whole.subarray(0, 5))).toBe(3); // aé + two thirds of €
  expect(completeUtf8(whole.subarray(0, 8))).toBe(6); // aé€ + half of 😀
  expect(completeUtf8(new Uint8Array(0))).toBe(0);
});

test("the run's AGENTS.md names the three instruction files in reading order and the inputs", () => {
  const text = runAgentsMd({ automation: "write", page: "home/YC", runDir: "/v/.biom/runs/r1", vault: "/v", pageDir: "pages/home/children/YC", inputs: { tag: "pricing", dry: false }, kickoff: true });
  const lines = text.split("\n");
  expect(lines[0]).toBe("# This run");
  expect(text).toContain("vault/INSTRUCTIONS.md");
  expect(text).toContain("./page/INSTRUCTIONS.md");
  expect(text).toContain("./INSTRUCTIONS.md");
  expect(text.indexOf("vault/INSTRUCTIONS.md")).toBeLessThan(text.indexOf("./page/INSTRUCTIONS.md"));
  expect(text.indexOf("./page/INSTRUCTIONS.md")).toBeLessThan(text.indexOf("./INSTRUCTIONS.md "));
  expect(text).toContain("Inputs: tag = pricing, dry = false. The prompt is ./kickoff.md.");
  expect(text).toContain("$BIOM_API");
});

test("the files a screen may open are named, and nothing that walks — and pages.ts lets the same ones be written", () => {
  // Two spellings of one grammar, because `pages.ts` and `runs.ts` are
  // siblings: `page.writeFile` writes what `page.readFile` reads.
  for (const path of [
    "INSTRUCTIONS.md", "automations/pull/kickoff.md", "automations/pull/automation.yaml",
    "automations/pull/INSTRUCTIONS.md", "automations/pull/skills/one/SKILL.md", "automations/pull/code/main.py",
    "automations/pull/code/deep/er/file.ts", "automations/Pull/kickoff.md", "automations/pull/other.md",
    "automations/pull/../../content.yaml", "automations/pull/skills/../x", "AGENTS.md", "content.yaml",
  ]) {
    expect([path, pageFileOk(path)]).toEqual([path, pageFile(path) !== null && (path.startsWith("automations/") || path === "INSTRUCTIONS.md")]);
  }
  expect(pageFileOk("INSTRUCTIONS.md")).toBe(true);
  expect(pageFileOk("automations/pull/kickoff.md")).toBe(true);
  expect(pageFileOk("automations/pull/skills/one/SKILL.md")).toBe(true);
  expect(pageFileOk("automations/pull/code/main.py")).toBe(true);
  expect(pageFileOk("content.yaml")).toBe(false);
  expect(pageFileOk("automations/pull/../../content.yaml")).toBe(false);
  expect(pageFileOk("AGENTS.md")).toBe(false);
  expect(vaultFileOk("INSTRUCTIONS.md")).toBe(true);
  expect(vaultFileOk(".agents/skills/mine/SKILL.md")).toBe(true);
  expect(vaultFileOk("AGENTS.md")).toBe(false);
  expect(vaultFileOk(".agents/skills/")).toBe(false);
  expect(vaultFileOk(".agents/skills/../../x")).toBe(false);
});

/* ── the folder reader ───────────────────────────────────────────────── */

test("automations lists every folder holding a manifest, a bad one with its sentence, across the workspace or under one page", async () => {
  const w = await world();
  const all = await w.runs.automations();
  expect(all.map((a) => a.folder)).toEqual(["broken", "pull"]);
  const pull = all.find((a) => a.folder === "pull")!;
  expect(pull.page).toBe(PAGE);
  expect(pull.uid).toMatch(/^[a-z0-9]{16}$/);
  expect(pull.manifest?.name).toBe("Pull");
  expect(pull.manifest?.inputs.length).toBe(3);
  expect(pull.trouble).toBeNull();
  const broken = all.find((a) => a.folder === "broken")!;
  expect(broken.manifest).toBeNull();
  expect(broken.trouble).toMatch(/command/);
  expect(await w.runs.automations(PAGE)).toEqual(all);
  await expect(w.runs.automations("home/Nope")).rejects.toThrow(/no such page/);
  // A page with none is an empty list, not an error.
  expect(await w.runs.automations("home")).toEqual([]);
});

test("the manifest is read and written as a structure, and a hand-edited file is the same file", async () => {
  const w = await world();
  const m = await w.runs.manifest(PAGE, "pull");
  expect(m.env).toEqual(["PULL_TOKEN"]);
  m.description = "Pull the month.";
  m.env = ["PULL_TOKEN", "OTHER"];
  await w.runs.setManifest(PAGE, "pull", m);
  const text = await w.files.read("pages/home/children/Socials/automations/pull/automation.yaml");
  expect(text).toContain("description: Pull the month.");
  expect(text).toContain("- OTHER");
  expect((await w.runs.manifest(PAGE, "pull")).env).toEqual(["PULL_TOKEN", "OTHER"]);
  await expect(w.runs.manifest(PAGE, "broken")).rejects.toThrow(/will not read/);
  await expect(w.runs.manifest(PAGE, "nothere")).rejects.toThrow(/no such automation/);
  await expect(w.runs.setManifest(PAGE, "pull", { ...m, command: [] })).rejects.toThrow(/command/);
});

test("templates are listed from the framework's folder and create copies one under the page, named as asked", async () => {
  const w = await world();
  expect(await w.runs.templates()).toEqual([{ id: "sh", name: "Shell", agent: "sh" }]);
  const made = await w.runs.create(PAGE, "Daily digest", "sh");
  expect(made.folder).toBe("daily-digest");
  expect(made.manifest?.name).toBe("Daily digest");
  expect(made.manifest?.command).toEqual(["sh", "-c", "echo hi"]);
  expect(await w.files.read("pages/home/children/Socials/automations/daily-digest/kickoff.md")).toBe("Say {greeting}.\n");
  expect(await w.files.read("pages/home/children/Socials/automations/daily-digest/INSTRUCTIONS.md")).toBe("Be brief.\n");
  await expect(w.runs.create(PAGE, "Daily digest", "sh")).rejects.toThrow(/already an automation/);
  await expect(w.runs.create(PAGE, "x", "nope")).rejects.toThrow(/no such template/);
  await expect(w.runs.create(PAGE, "!!!", "sh")).rejects.toThrow(/name/);
  await expect(w.runs.create("home/Nope", "x", "sh")).rejects.toThrow(/no such page/);
});

/* ── a run ───────────────────────────────────────────────────────────── */

only("start assembles the run directory, substitutes, spawns in it with the named environment, writes the row, and ends it", async () => {
  const w = await world();
  const row = await w.runs.start(PAGE, "pull", { tag: "pricing", window: "3" }, "starter-uid");
  expect(row.status).toBe("running");
  expect(row.page).toBe(PAGE);
  expect(row.automation).toBe("pull");
  expect(row.by).toBe("starter-uid");
  expect(row.uid).toMatch(/^[a-z0-9]{16}$/);
  expect(row.inputs).toEqual({ window: 3, dry: false, tag: "pricing" });
  expect(row.command).toEqual(["sh", "-c", "echo start 3 false; cat kickoff.md; echo $BIOM_RUN; echo err >&2"]);
  expect(row.pid).toBeGreaterThan(0);
  expect(w.changes).toEqual([{ what: "start", id: row.id }]);

  const dir = join(w.root, ".biom", "runs", row.id);
  // The copies: the record of what ran.
  expect(readFileSync(join(dir, "automation.yaml"), "utf8")).toContain("name: Pull");
  expect(readFileSync(join(dir, "kickoff.md"), "utf8")).toBe(`Pull 3 days tagged pricing. ${w.root} and {not_a_thing}.\n`);
  expect(readFileSync(join(dir, "INSTRUCTIONS.md"), "utf8")).toBe("Unattended.\n");
  // The links: skills and code to the automation's, the page's instructions
  // under page/, the vault root, and every harness's name for the guide.
  const link = (rel: string) => readlinkSync(join(dir, rel));
  expect(lstatSync(join(dir, "skills")).isSymbolicLink()).toBe(true);
  expect(link("skills")).toBe(join(w.root, "pages/home/children/Socials/automations/pull/skills"));
  expect(link("code")).toBe(join(w.root, "pages/home/children/Socials/automations/pull/code"));
  expect(link("page/INSTRUCTIONS.md")).toBe(join(w.root, "pages/home/children/Socials/INSTRUCTIONS.md"));
  expect(link("vault")).toBe(w.root);
  expect(link("CLAUDE.md")).toBe("AGENTS.md");
  expect(link(".agents/skills")).toBe("../skills");
  expect(link(".claude/skills")).toBe("../skills");
  expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("automation `pull` of the page `home/Socials`");
  expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("Inputs: window = 3, dry = false, tag = pricing.");
  // The harness files, granting the real path.
  expect(JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"))).toEqual({ permissions: { additionalDirectories: [w.root] } });
  expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).toContain(JSON.stringify(w.root));
  expect(existsSync(join(dir, "opencode.json"))).toBe(true);
  expect(existsSync(join(dir, ".gemini/settings.json"))).toBe(true);
  expect(existsSync(join(dir, ".cursor/cli.json"))).toBe(true);

  // It ends, and the row says so, and the change is announced.
  for (let i = 0; i < 100 && w.runs.get(row.id)?.status === "running"; i++) await wait(50);
  const done = w.runs.get(row.id)!;
  expect(done.status).toBe("exited");
  expect(done.exit).toBe(0);
  expect(done.ended).not.toBeNull();
  expect(done.endedBy).toBeNull();
  expect(w.changes.map((c) => c.what)).toEqual(["start", "end"]);
  // The process ran in the run directory with the environment the run was
  // given: the kickoff it read is the substituted copy, and $BIOM_RUN is the
  // directory.
  const out = readFileSync(join(dir, "stdout.log"), "utf8");
  expect(out).toBe(`start 3 false\nPull 3 days tagged pricing. ${w.root} and {not_a_thing}.\n${dir}\n`);
  expect(readFileSync(join(dir, "stderr.log"), "utf8")).toBe("err\n");
  // Listed newest first, and narrowed only when asked.
  expect(w.runs.list().map((r) => r.id)).toEqual([row.id]);
  expect(w.runs.list({ page: PAGE, automation: "pull" }).length).toBe(1);
  expect(w.runs.list({ automation: "other" }).length).toBe(0);
  expect(w.runs.live()).toBe(0);
});

only("the environment is the floor, what this run is, and the names the manifest asked for — and nothing else of the server's", async () => {
  const w = await world({ manifest: "name: Env\nenv: [PULL_TOKEN]\ncommand: [sh, -c, \"env | sort\"]\n" });
  const row = await w.runs.start(PAGE, "pull", {}, null);
  for (let i = 0; i < 100 && w.runs.get(row.id)?.status === "running"; i++) await wait(50);
  const out = readFileSync(join(w.root, ".biom", "runs", row.id, "stdout.log"), "utf8");
  expect(out).toContain("PULL_TOKEN=t-123");
  expect(out).toContain(`BIOM_VAULT=${w.root}`);
  expect(out).toContain(`BIOM_RUN=${join(w.root, ".biom", "runs", row.id)}`);
  expect(out).toContain("BIOM_API=http://127.0.0.1:4400/v/x/api/call?token=tok");
  expect(out).toContain("PATH=");
  expect(out).not.toContain("SECRET=");
  expect(out).not.toContain("BIOM_SHELL=");
  expect(row.by).toBeNull();
});

test("start refuses by name: an unknown automation, a required input missing, an env name the server has not got, a broken manifest", async () => {
  const w = await world();
  await expect(w.runs.start(PAGE, "nothere", {}, null)).rejects.toThrow(/no such automation/);
  await expect(w.runs.start(PAGE, "broken", {}, null)).rejects.toThrow(/will not read/);
  await expect(w.runs.start(PAGE, "pull", {}, null)).rejects.toThrow(/tag is required/);
  delete w.env.PULL_TOKEN;
  await expect(w.runs.start(PAGE, "pull", { tag: "x" }, null)).rejects.toThrow(/environment has no PULL_TOKEN/);
  await expect(w.runs.start("home/Nope", "pull", {}, null)).rejects.toThrow(/no such page/);
  // Nothing was written for any of them.
  expect(existsSync(join(w.root, ".biom", "runs"))).toBe(false);
  expect(w.runs.list()).toEqual([]);
});

only("read follows a live log from an offset, holds back a cut character, and says when it has ended", async () => {
  const w = await world({ manifest: "name: Log\ncommand: [sh, -c, \"printf 'aé€😀'; sleep 0.3; printf ' more'\"]\n" });
  const row = await w.runs.start(PAGE, "pull", {}, null);
  await wait(120);
  // Four bytes of `aé€😀` is `a`, `é`, and the first byte of `€`.
  const first = await w.runs.read(row.id, "stdout", 0, 4);
  expect(first.text).toBe("aé");
  expect(first.next).toBe(3);
  expect(first.ended).toBe(false);
  const second = await w.runs.read(row.id, "stdout", first.next, 1000);
  expect(second.text).toBe("€😀");
  expect(second.next).toBe(10);
  // Nothing more yet: an empty read at the same offset.
  const again = await w.runs.read(row.id, "stdout", second.next);
  expect(again.text).toBe("");
  expect(again.next).toBe(10);
  for (let i = 0; i < 100 && w.runs.get(row.id)?.status === "running"; i++) await wait(50);
  const last = await w.runs.read(row.id, "stdout", second.next);
  expect(last.text).toBe(" more");
  expect(last.ended).toBe(true);
  expect(last.next).toBe(15);
  // stderr is its own stream, and a run nothing has is refused.
  expect((await w.runs.read(row.id, "stderr")).text).toBe("");
  await expect(w.runs.read("nope", "stdout")).rejects.toThrow(/no such run/);
});

only("kill ends the whole group after the grace, and the row says killed and by whom", async () => {
  const w = await world({ manifest: "name: Sleeper\ncommand: [sh, -c, \"trap '' TERM; sleep 30 & wait\"]\n" });
  const row = await w.runs.start(PAGE, "pull", {}, null);
  await wait(200);
  expect(w.runs.live()).toBe(1);
  const killed = await w.runs.kill(row.id, "screen");
  expect(killed.status).toBe("killed");
  expect(killed.endedBy).toBe("screen");
  expect(killed.ended).not.toBeNull();
  await wait(100);
  expect(w.process.alive(row.pid!)).toBe(false);
  const pg = Bun.spawn(["pgrep", "-g", String(row.pgid)], { stdout: "pipe", stderr: "ignore" });
  expect((await new Response(pg.stdout).text()).trim()).toBe("");
  expect(w.runs.live()).toBe(0);
  // Killing a run that has ended is not an error and changes nothing.
  expect((await w.runs.kill(row.id, "page")).endedBy).toBe("screen");
  await expect(w.runs.kill("nope", "page")).rejects.toThrow(/no such run/);
  expect(w.changes.map((c) => c.what)).toEqual(["start", "end"]);
});

only("endAll on the way out ends every live run as shutdown", async () => {
  const w = await world({ manifest: "name: Sleeper\ncommand: [sleep, \"30\"]\n" });
  const a = await w.runs.start(PAGE, "pull", {}, null);
  const b = await w.runs.start(PAGE, "pull", {}, null);
  expect(w.runs.live()).toBe(2);
  await w.runs.endAll("shutdown");
  expect(w.runs.get(a.id)?.status).toBe("killed");
  expect(w.runs.get(b.id)?.endedBy).toBe("shutdown");
  expect(w.runs.live()).toBe(0);
});

only("killAll is synchronous: every live group is killed outright and every row marked, for the process's exit handler", async () => {
  const w = await world({ manifest: "name: Sleeper\ncommand: [sh, -c, \"trap '' TERM; sleep 30 & wait\"]\n" });
  const a = await w.runs.start(PAGE, "pull", {}, null);
  const b = await w.runs.start(PAGE, "pull", {}, null);
  await wait(200);
  expect(w.runs.live()).toBe(2);
  // No await: this is what an `exit` handler can do, and all it can do.
  w.runs.killAll("shutdown");
  expect(w.runs.live()).toBe(0);
  for (const r of [a, b]) {
    const row = w.runs.get(r.id)!;
    expect([row.status, row.endedBy, row.signal]).toEqual(["killed", "shutdown", "SIGKILL"]);
    expect(row.ended).not.toBeNull();
  }
  await wait(150);
  const pg = Bun.spawn(["pgrep", "-g", String(a.pgid)], { stdout: "pipe", stderr: "ignore" });
  expect((await new Response(pg.stdout).text()).trim()).toBe("");
});

test("reconcile marks a running row whose process is gone as lost, and leaves a live one alone", async () => {
  // A fake runner: `alive` says what the test says, and nothing is spawned.
  // It asks by pid AND birth, so a reused pid with another birth reads dead.
  const alivePids = new Set<number>([4242]);
  let bornNow = "b1";
  const fake: ProcessRunner = {
    start: () => ({ pid: 4242, pgid: 4242, born: "b1", done: new Promise(() => {}) }),
    end: async () => {},
    killNow: (pgid) => { alivePids.delete(pgid); },
    alive: (pid, born) => alivePids.has(pid) && (born === undefined || born === null || born === bornNow),
  };
  const w = await world({ manifest: "name: Fake\ncommand: [whatever]\n", process: fake });
  const row = await w.runs.start(PAGE, "pull", {}, null);
  expect(w.runs.get(row.id)?.born).toBe("b1");
  expect(w.runs.reconcile()).toBe(0);
  expect(w.runs.get(row.id)?.status).toBe("running");
  // The pid is still taken — by a process born later. That is not our run.
  bornNow = "b2";
  expect(w.runs.reconcile()).toBe(1);
  alivePids.clear();
  const lost = w.runs.get(row.id)!;
  expect(lost.status).toBe("lost");
  expect(lost.ended).not.toBeNull();
  // A lost row is ended: a read says so, and a kill changes nothing.
  expect((await w.runs.read(row.id, "stdout")).ended).toBe(true);
  expect((await w.runs.kill(row.id, "page")).status).toBe("lost");
});

test("relocate re-points rows by prefix, and relocateAll by identity against the page list", async () => {
  const fake: ProcessRunner = {
    start: () => ({ pid: 7, pgid: 7, born: "b7", done: new Promise(() => {}) }),
    end: async () => {},
    killNow: () => {},
    alive: () => true,
  };
  const w = await world({ manifest: "name: Fake\ncommand: [x]\n", process: fake });
  const a = await w.runs.start(PAGE, "pull", {}, null);
  // A move the route performs: every row under the old id, by prefix, and
  // nothing else.
  expect(w.runs.relocate(PAGE, "home/Boards/Socials")).toBe(1);
  expect(w.runs.get(a.id)?.page).toBe("home/Boards/Socials");
  expect(w.runs.list({ page: "home/Boards/Socials" }).length).toBe(1);
  expect(w.runs.list({ page: PAGE }).length).toBe(0);
  expect(w.runs.relocate("home/Nope", "home/Else")).toBe(0);
  // A move from outside: the row's identity finds the page wherever it is now.
  expect(w.runs.relocateAll([{ id: "home/Moved/Again", name: "Socials", uid: a.uid ?? "" }])).toBe(1);
  expect(w.runs.get(a.id)?.page).toBe("home/Moved/Again");
  // Already there: nothing moves. A page list without the identity: nothing moves.
  expect(w.runs.relocateAll([{ id: "home/Moved/Again", name: "Socials", uid: a.uid ?? "" }])).toBe(0);
  expect(w.runs.relocateAll([{ id: "home/Other", name: "Other", uid: "someoneelse1234" }])).toBe(0);
});

test("setManifest refuses a manifest that is not a map, and one that will not read, in a sentence", async () => {
  const w = await world();
  await expect(w.runs.setManifest(PAGE, "pull", /** @type {any} */ (null))).rejects.toThrow(/not a map/);
  await expect(w.runs.setManifest(PAGE, "pull", /** @type {any} */ ({ name: "X" }))).rejects.toThrow(/will not read/);
  // Quiet writes no commit; a loud one does.
  const before = (await w.files.read("pages/home/children/Socials/automations/pull/automation.yaml")) ?? "";
  const m = await w.runs.manifest(PAGE, "pull");
  await w.runs.setManifest(PAGE, "pull", { ...m, description: "quiet" }, true);
  expect(await w.files.read("pages/home/children/Socials/automations/pull/automation.yaml")).not.toBe(before);
});

test("a kill on a row this server never held a process for finishes the row itself", async () => {
  const fake: ProcessRunner = {
    start: () => ({ pid: 999999, pgid: 999999, born: null, done: new Promise(() => {}) }),
    end: async () => {},
    killNow: () => {},
    alive: () => false,
  };
  const w = await world({ manifest: "name: Fake\ncommand: [whatever]\n", process: fake });
  const row = await w.runs.start(PAGE, "pull", {}, null);
  const killed = await w.runs.kill(row.id, "page");
  expect(killed.status).toBe("killed");
  expect(killed.endedBy).toBe("page");
});

/* ── the files the screens open ──────────────────────────────────────── */

test("pageFiles lists the page's instructions and everything under its automations; readPageFile opens one", async () => {
  const w = await world();
  const listed = (await w.runs.pageFiles(PAGE)).map((f) => f.path);
  expect(listed).toEqual([
    "INSTRUCTIONS.md",
    "automations/broken/automation.yaml",
    "automations/notone/README.md",
    "automations/pull/INSTRUCTIONS.md",
    "automations/pull/automation.yaml",
    "automations/pull/code/main.sh",
    "automations/pull/kickoff.md",
    "automations/pull/skills/one/SKILL.md",
  ]);
  expect(await w.runs.readPageFile(PAGE, "automations/pull/kickoff.md")).toContain("Pull {window}");
  expect(await w.runs.readPageFile(PAGE, "INSTRUCTIONS.md")).toBe("# Socials\nThe page's.\n");
  await expect(w.runs.readPageFile(PAGE, "content.yaml")).rejects.toThrow(/not a file/);
  await expect(w.runs.pageFiles("home/Nope")).rejects.toThrow(/no such page/);
});

test("vaultFiles is the vault's instructions and its skills, the seeded ones marked; write goes through a commit", async () => {
  const w = await world();
  expect(await w.runs.vaultFiles()).toEqual([
    { path: "INSTRUCTIONS.md", seeded: false },
    { path: ".agents/skills/mine/SKILL.md", seeded: false },
    { path: ".agents/skills/seeded-one/SKILL.md", seeded: true },
  ]);
  expect(await w.runs.readVaultFile("INSTRUCTIONS.md")).toBeNull();
  await w.runs.writeVaultFile("INSTRUCTIONS.md", "# Ours\n");
  expect(await w.runs.readVaultFile("INSTRUCTIONS.md")).toBe("# Ours\n");
  await w.runs.writeVaultFile(".agents/skills/mine/SKILL.md", "# mine, edited\n");
  expect(await w.files.read(".agents/skills/mine/SKILL.md")).toBe("# mine, edited\n");
  await expect(w.runs.writeVaultFile("AGENTS.md", "x")).rejects.toThrow(/not a file/);
  await expect(w.runs.readVaultFile("pages/home/content.yaml")).rejects.toThrow(/not a file/);
});

test("a row round-trips every column", async () => {
  const fake: ProcessRunner = {
    start: () => ({ pid: 7, pgid: 7, born: "b7", done: Promise.resolve({ exit: 2, signal: null }) }),
    end: async () => {},
    killNow: () => {},
    alive: () => false,
  };
  const w = await world({ manifest: "name: Fake\ncommand: [x, \"{tag}\"]\ninputs:\n  - { name: tag, type: text, required: true }\n", process: fake });
  const row = await w.runs.start(PAGE, "pull", { tag: "t" }, "by-uid");
  await wait(20);
  const got: RunRow = w.runs.get(row.id)!;
  expect(got.command).toEqual(["x", "t"]);
  expect(got.inputs).toEqual({ tag: "t" });
  expect(got.pid).toBe(7);
  expect(got.pgid).toBe(7);
  expect(got.status).toBe("exited");
  expect(got.exit).toBe(2);
  expect(got.signal).toBeNull();
  expect(got.by).toBe("by-uid");
  expect(typeof got.started).toBe("number");
  expect(typeof got.ended).toBe("number");
});

// A hand-written file in the run directory, to be sure `slice` reads bytes and
// not lines.
test("rundir slice reads bytes from an offset and reports the size", async () => {
  const w = await world();
  const { makeRunFs } = await import("../server/platform/rundir.ts");
  const fs = makeRunFs(w.root);
  writeFileSync(join(w.root, "probe.bin"), "0123456789");
  expect(fs.slice(join(w.root, "probe.bin"), 3, 4)).toEqual({ bytes: new TextEncoder().encode("3456"), size: 10 });
  expect(fs.slice(join(w.root, "probe.bin"), 20, 4)).toEqual({ bytes: new Uint8Array(0), size: 10 });
  expect(fs.slice(join(w.root, "nothere"), 0, 4)).toEqual({ bytes: new Uint8Array(0), size: 0 });
  expect(() => fs.slice("/etc/passwd", 0, 4)).toThrow(/not inside/);
});
