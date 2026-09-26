// SPDX-License-Identifier: AGPL-3.0-only
// THE PERSON'S WRITES ARE STAMPED AS THEIRS — the API route's half of the
// history, for the workspace's *History and View Switcher* spec. A write a
// window makes through the app is ONE edit, `you` by `app`, recorded by
// `handle` once the answer is `ok`; a write with no window is nobody's; the
// markdown mirror and the editors' one commit are the framework writing for
// itself and nobody's change; typing is one edit per burst; a table's rows are
// an edit of the table. The vault underneath is real, because a page's `uid`
// is read off its document. Page names and window ids are invented.

import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handle, route, writeOf } from "../server/api/routes.ts";
import { makeHistory } from "../server/domain/history.ts";
import type { History } from "../server/domain/history.ts";
import { initVault, makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format } from "../server/platform/yaml.ts";
import { makeDesign } from "../server/domain/design.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { makeMirror } from "../server/domain/mirror.ts";
import { makePages, pageDir } from "../server/domain/pages.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest, ApiResponse, PageRef, TableName } from "../contracts/types.ts";

const WINDOW = "window-invented-01";
const OTHER = "window-invented-02";

/** The tables as this layer sees them: rows in memory, enough for a write. */
function fakeTables() {
  const rows = new Map<TableName, unknown[]>([["jobs", []]]);
  return {
    list: () => [...rows.keys()].map((name) => ({ name, kind: "basic" as const, rows: rows.get(name)!.length, parent: null })),
    insert(name: TableName, row: unknown) {
      const at = rows.get(name);
      if (at === undefined) throw Object.assign(new Error("no such table"), { code: "not_found" });
      at.push(row);
      return at.length;
    },
  };
}

async function world(over: { history?: History | null } = {}) {
  const root = await mkdtemp(join(tmpdir(), "biom-history-route-"));
  await initVault(root);
  const files = makeFiles(root);
  const yaml = { parse, parseAny, format };
  const tables = fakeTables();
  const pages = makePages(files, yaml, tables.list);
  const docs = makeDocs(files, yaml);
  // THE UID IS READ OFF A `Files` WITH NO BASELINE, as the composition root
  // must: the vault's own would make an agent's new page known before the
  // watcher had seen it arrive.
  const quiet = makeDocs(makeFiles(root), yaml);
  let clock = 5_000_000;
  const history = over.history === undefined
    ? makeHistory({
      now: () => clock,
      uidOf: async (id) => {
        try {
          return (await quiet.read(id)).uid ?? null;
        } catch {
          return null;
        }
      },
      agentOfChat: () => null,
    })
    : over.history;
  const commits: string[] = [];
  const deps = {
    pages, docs, tables,
    design: makeDesign(makeFiles(join(root, "design")), yaml),
    mirror: makeMirror(files, pages),
    runs: { commit: async (m: string) => { commits.push(m); } },
    ...(history === null ? {} : { history }),
  } as unknown as Parameters<typeof handle>[1];
  let seq = 0;
  const call = (o: Record<string, unknown>): Promise<ApiResponse> => handle({ id: `r${++seq}`, g: PROTOCOL, ...o } as ApiRequest, deps);
  /** The same, over HTTP, with `own` answering whether the caller is this machine's window. */
  const post = async (o: Record<string, unknown>, own?: () => boolean): Promise<ApiResponse> => {
    const request = new Request("http://127.0.0.1:4400/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `r${++seq}`, g: PROTOCOL, ...o }),
    });
    return (await (await route(request, deps, undefined, own)).json()) as ApiResponse;
  };
  return {
    root, history: history as History, commits, call, post,
    tick: (ms: number) => { clock += ms; },
    edits: () => (history as History).read().entries.filter((e) => e.kind === "edit"),
    async drop() { await rm(root, { recursive: true, force: true }); },
  };
}

const value = (res: ApiResponse): unknown => {
  if (!res.ok) throw new Error(`expected ok, got ${res.error.code}: ${res.error.message}`);
  return res.value;
};

/** A page with one section holding one slot, made without a window. */
async function pageWithASlot(w: Awaited<ReturnType<typeof world>>, name: string): Promise<PageRef> {
  const made = value(await w.call({ kind: "page.create", init: { name } })) as PageRef;
  value(await w.call({ kind: "section.order", page: made.id, sections: [{ name: "intro", parts: { body: "Hello.\n" } }] }));
  return made;
}

test("A WRITE WITH A WINDOW IS EXACTLY ONE EDIT, stamped you by app, naming the page by its uid", async () => {
  const w = await world();
  try {
    const made = await pageWithASlot(w, "Invented Notes");
    expect(w.edits()).toEqual([]);

    const res = await w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: "Typed.\n", window: WINDOW });
    expect(value(res)).toBeNull();
    // The answer came back, so the edit is in the history already.
    expect(w.edits()).toEqual([{
      kind: "edit", seq: 1, at: 5_000_000,
      place: { view: "page", uid: made.uid!, screen: "page" },
      path: `${pageDir(made.id)}/content.yaml`,
      writer: { kind: "you", window: WINDOW }, via: "app", snapshot: null,
    }]);
  } finally {
    await w.drop();
  }
});

test("a write with no window makes no edit, and neither does one that failed", async () => {
  const w = await world();
  // The route logs the two refusals below; that is expected and not shown.
  const error = console.error;
  console.error = () => {};
  try {
    const made = await pageWithASlot(w, "Invented Plans");
    value(await w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: "Nobody's.\n" }));
    const failed = await w.call({ kind: "section.write", page: "home/Nowhere", section: "intro", part: "body", data: "x\n", window: WINDOW });
    expect(failed.ok).toBe(false);
    const refused = await w.call({ kind: "section.write", page: made.id, section: "nope", part: "body", data: "x\n", window: WINDOW });
    expect(refused.ok).toBe(false);
    expect(w.edits()).toEqual([]);
  } finally {
    console.error = error;
    await w.drop();
  }
});

test("a malformed window is refused before anything is written", async () => {
  const w = await world();
  try {
    const made = await pageWithASlot(w, "Invented Draft");
    const before = await readFile(join(w.root, pageDir(made.id), "content.yaml"), "utf8");
    for (const window of ["short", "has space in it", 42, null, "x".repeat(65)]) {
      const res = await w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: "Nope.\n", window });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("bad_request");
    }
    expect(await readFile(join(w.root, pageDir(made.id), "content.yaml"), "utf8")).toBe(before);
    expect(w.edits()).toEqual([]);
    // A read carrying a good window is answered as ever, and is no edit.
    expect((await w.call({ kind: "page.read", page: made.id, window: WINDOW })).ok).toBe(true);
    expect(w.history.read().head).toBe(0);
  } finally {
    await w.drop();
  }
});

test("THE MIRROR AND THE EDITORS' COMMIT ARE NOBODY'S CHANGE: page.projection and vault.commit record nothing", async () => {
  const w = await world();
  try {
    const made = await pageWithASlot(w, "Invented Board");
    value(await w.call({ kind: "page.projection", page: made.id, markdown: "# Invented Board\n", window: WINDOW }));
    value(await w.call({ kind: "vault.commit", message: "Before the editor opened", window: WINDOW }));
    expect(w.commits).toEqual(["Before the editor opened"]);
    expect(w.history.read().head).toBe(0);
  } finally {
    await w.drop();
  }
});

test("TYPING IS ONE EDIT PER BURST through the route too, and another window is another writer", async () => {
  const w = await world();
  try {
    const made = await pageWithASlot(w, "Invented Letter");
    const type = (text: string, window = WINDOW) =>
      w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: text, window });
    for (const text of ["D", "De", "Dear", "Dear r", "Dear reader"]) {
      value(await type(`${text}\n`));
      w.tick(350);
    }
    expect(w.edits()).toHaveLength(1);
    value(await type("Dear reader,\n", OTHER));
    expect(w.edits().map((e) => e.writer)).toEqual([{ kind: "you", window: WINDOW }, { kind: "you", window: OTHER }]);
    w.tick(2500);
    value(await type("Dear reader, hello.\n"));
    expect(w.edits()).toHaveLength(3);
  } finally {
    await w.drop();
  }
});

test("a page made, and a page removed, are edits of that page — the removed one names no place any more", async () => {
  const w = await world();
  try {
    const made = value(await w.call({ kind: "page.create", init: { name: "Invented Temp" }, window: WINDOW })) as PageRef;
    const removed = await w.call({ kind: "page.remove", page: made.id, window: WINDOW });
    expect(removed.ok).toBe(true);
    const [create, remove] = w.edits();
    expect(create).toMatchObject({ path: pageDir(made.id), place: { view: "page", uid: made.uid!, screen: "page" }, via: "app" });
    expect(remove).toMatchObject({ path: pageDir(made.id), place: null, via: "app", writer: { kind: "you", window: WINDOW } });
  } finally {
    await w.drop();
  }
});

test("A WINDOW IS NAMED ONLY BY A WINDOW THAT COULD REPORT FOR IT: anybody else's write is answered and is nobody's", async () => {
  const w = await world();
  try {
    const made = await pageWithASlot(w, "Invented Forgery");
    const write = { kind: "section.write", page: made.id, section: "intro", part: "body", window: WINDOW };
    // A caller on the token alone — a run's script — naming the person's window.
    expect((await w.post({ ...write, data: "Not theirs.\n" }, () => false)).ok).toBe(true);
    expect(await readFile(join(w.root, pageDir(made.id), "content.yaml"), "utf8")).toContain("Not theirs.");
    expect(w.edits()).toEqual([]);
    // The window itself.
    expect((await w.post({ ...write, data: "Theirs.\n" }, () => true)).ok).toBe(true);
    expect(w.edits().map((e) => e.writer)).toEqual([{ kind: "you", window: WINDOW }]);
    // With no answer to ask, the window is taken as sent — every caller from before it.
    w.tick(5000);
    expect((await w.post({ ...write, data: "As sent.\n" })).ok).toBe(true);
    expect(w.edits()).toHaveLength(2);
    // The question is asked only of a request that names a window.
    let asked = 0;
    expect((await w.post({ kind: "page.read", page: made.id }, () => { asked++; return false; })).ok).toBe(true);
    expect(asked).toBe(0);
  } finally {
    await w.drop();
  }
});

test("a table's rows are an edit with no file and the table's place", async () => {
  const w = await world();
  try {
    value(await w.call({ kind: "row.insert", name: "jobs", row: { title: "Invented job" }, window: WINDOW }));
    expect(w.edits()).toEqual([{
      kind: "edit", seq: 1, at: 5_000_000, place: { view: "table", id: "jobs" }, path: null,
      writer: { kind: "you", window: WINDOW }, via: "app", snapshot: null,
    }]);
  } finally {
    await w.drop();
  }
});

test("a history that fails never fails the write, which has already happened", async () => {
  const broken = {
    edit: async () => { throw new Error("the history fell over"); },
  } as unknown as History;
  const w = await world({ history: broken });
  const warn = console.warn;
  const said: unknown[] = [];
  console.warn = (...args: unknown[]) => { said.push(args[0]); };
  try {
    const made = await pageWithASlot(w, "Invented Diary");
    const res = await w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: "Still saved.\n", window: WINDOW });
    expect(res.ok).toBe(true);
    expect(await readFile(join(w.root, pageDir(made.id), "content.yaml"), "utf8")).toContain("Still saved.");
    expect(said).toEqual(["the history"]);
  } finally {
    console.warn = warn;
    await w.drop();
  }
});

test("with no history in the dependencies, every write goes through as it always did", async () => {
  const w = await world({ history: null });
  try {
    const made = await pageWithASlot(w, "Invented Plain");
    expect((await w.call({ kind: "section.write", page: made.id, section: "intro", part: "body", data: "x\n", window: WINDOW })).ok).toBe(true);
  } finally {
    await w.drop();
  }
});

/* ── what each write kind names ─────────────────────────────────────────── */

test("writeOf: the file every write kind wrote, or the table it changed", () => {
  const r = (o: Record<string, unknown>) => ({ id: "x", g: PROTOCOL, ...o }) as ApiRequest;
  const doc = "pages/home/children/Invented/content.yaml";
  const dir = "pages/home/children/Invented";
  const rows: [ApiRequest, unknown, ReturnType<typeof writeOf>][] = [
    [r({ kind: "section.write", page: "home/Invented", section: "a", part: "b", data: "x" }), null, { path: doc, burst: true }],
    [r({ kind: "section.order", page: "home/Invented", sections: [] }), [], { path: doc }],
    [r({ kind: "section.remove", page: "home/Invented", section: "a" }), [], { path: doc }],
    [r({ kind: "variables.patch", page: "home/Invented", section: null, patch: {} }), {}, { path: doc, burst: true }],
    [r({ kind: "doc.writeRaw", page: "home/Invented", text: "name: x\n" }), {}, { path: doc }],
    [r({ kind: "page.writeFile", page: "home/Invented", file: "INSTRUCTIONS.md", text: "" }), null, { path: `${dir}/INSTRUCTIONS.md` }],
    [r({ kind: "page.writeFile", page: "home/Invented", file: "automations/daily/kickoff.md", text: "", quiet: true }), null, { path: `${dir}/automations/daily/kickoff.md`, burst: true }],
    [r({ kind: "page.create", init: { name: "Invented" } }), { id: "home/Invented", name: "Invented", uid: "abcdefgh" }, { path: dir }],
    [r({ kind: "page.remove", page: "home/Invented" }), null, { path: dir }],
    [r({ kind: "page.move", page: "home/Old", parent: "home" }), "home/Invented", { path: dir }],
    [r({ kind: "page.rename", page: "home/Old", name: "Invented" }), "home/Invented", { path: dir }],
    [r({ kind: "design.patch", section: null, patch: {} }), {}, { path: "design/content.yaml" }],
    [r({ kind: "design.writeFile", file: "worlds/dusk.html", text: "" }), null, { path: "design/worlds/dusk.html" }],
    [r({ kind: "automation.set", page: "home/Invented", automation: "daily", manifest: {} }), null, { path: `${dir}/automations/daily/automation.yaml` }],
    [r({ kind: "automation.set", page: "home/Invented", automation: "daily", manifest: {}, quiet: true }), null, { path: `${dir}/automations/daily/automation.yaml`, burst: true }],
    [r({ kind: "automation.create", page: "home/Invented", name: "Daily Brief", template: "t" }), { folder: "daily-brief" }, { path: `${dir}/automations/daily-brief` }],
    [r({ kind: "vault.writeFile", file: ".agents/skills/mine/SKILL.md", text: "" }), null, { path: ".agents/skills/mine/SKILL.md" }],
    [r({ kind: "vault.writeFile", file: "INSTRUCTIONS.md", text: "", quiet: true }), null, { path: "INSTRUCTIONS.md", burst: true }],
    [r({ kind: "row.insert", name: "jobs", row: {} }), 1, { path: null, place: { view: "table", id: "jobs" }, burst: true }],
    [r({ kind: "row.update", name: "jobs", row: 1, patch: {} }), null, { path: null, place: { view: "table", id: "jobs" }, burst: true }],
    [r({ kind: "row.remove", name: "jobs", row: 1 }), null, { path: null, place: { view: "table", id: "jobs" }, burst: true }],
    [r({ kind: "table.create", schema: { name: "jobs", kind: "basic", columns: [] } }), null, { path: null, place: { view: "table", id: "jobs" } }],
    [r({ kind: "table.alter", name: "jobs", schema: { name: "work", kind: "basic", columns: [] } }), null, { path: null, place: { view: "table", id: "work" } }],
    [r({ kind: "table.setParent", name: "jobs", parent: "home" }), null, { path: null, place: { view: "table", id: "jobs" } }],
    [r({ kind: "table.remove", name: "jobs" }), null, { path: null, place: { view: "table", id: "jobs" } }],
    [r({ kind: "table.importCsv", name: "jobs", csv: "a\n1\n" }), { added: 1 }, { path: null, place: { view: "table", id: "jobs" } }],
  ];
  for (const [req, answer, want] of rows) expect([req.kind, writeOf(req, answer)]).toEqual([req.kind, want]);
});

test("writeOf: what is not a write, what is nobody's, and what cannot be named", () => {
  const r = (o: Record<string, unknown>) => ({ id: "x", g: PROTOCOL, ...o }) as ApiRequest;
  const none = [
    r({ kind: "page.projection", page: "home", markdown: "# x" }),
    r({ kind: "vault.commit", message: "m" }),
    r({ kind: "sql", query: "insert into jobs values (1)" }),
    r({ kind: "run.start", page: "home", automation: "a" }),
    r({ kind: "run.kill", run: "r" }),
    r({ kind: "theme.set", theme: {} }),
    r({ kind: "page.read", page: "home" }),
    r({ kind: "table.get", name: "jobs" }),
    r({ kind: "page.share", page: "home" }),
    r({ kind: "vault.open", path: "/x" }),
  ];
  for (const req of none) expect([req.kind, writeOf(req, null)]).toEqual([req.kind, null]);
  // An answer that does not say where a made or moved page is now names nothing.
  expect(writeOf(r({ kind: "page.create", init: { name: "x" } }), null)).toBeNull();
  expect(writeOf(r({ kind: "page.move", page: "home/a", parent: "home" }), null)).toBeNull();
  expect(writeOf(r({ kind: "automation.create", page: "home", name: "x", template: "t" }), {})).toBeNull();
});
