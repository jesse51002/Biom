// SPDX-License-Identifier: AGPL-3.0-only
// A PAGE THAT ARRIVES WHILE THE SERVER RUNS GETS AN IDENTITY, AND KEEPS IT —
// `makeIdentities` in `server/domain/pages.ts`, and the composition root that
// asks it from the history and from the watcher's structural settle.
//
// Mount gives every page without a `uid` one; before this, a page made while
// the server ran — by an agent, which the vault's rules tell never to type a
// `uid` — had none until the next mount, so the history placed every edit,
// open and view of it nowhere and the switcher could never bring it up. What
// is held here:
//
//   - a page with no `uid` is given one the first time it is asked for, and
//     it is written into the file behind a commit — as ONE LINE under
//     `name:`, every other byte the agent wrote kept, and the way mount
//     writes a document only where that line cannot go in;
//   - it is STABLE for the session: asked twice at once it is one `uid`, and
//     an agent writing the document whole without it gets the same one back —
//     a page that was there at mount included;
//   - it is DECIDED FROM MEMORY: a known page that lost its `uid` reads its own
//     document and walks no tree, because this is on the history's path;
//   - a page that moved away takes its `uid` with it, and a new page made at
//     its old id is not handed it — only the page holding it is read to say so;
//   - a document that is not there or will not parse is never rewritten;
//   - through the composition root, with the scripted agent: the agent's new
//     page is one history edit PLACED by its `uid`, the real switcher follows
//     that edit once the window's tree lists the page, and the agent
//     rewriting it without the `uid` changes nothing;
//   - a page made from outside with a stream open is given one on the
//     watcher's structural settle, with no history involved.
//
// Every page, word and id here is invented.

import { test, expect, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makeIdentities, makePages, pageDir, PAGE_DOC, withUidLine } from "../server/domain/pages.ts";
import { makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { makeHost } from "../server/main.ts";
import type { Host } from "../server/main.ts";
import { handle } from "../server/api/routes.ts";
import { installFakeAgent } from "./fake-acp-agent.ts";
import { PROTOCOL } from "../contracts/wire.js";
import { makeSwitcher, TIMING } from "../client/store/switcher.js";
import { makeUi } from "../client/store/ui.js";
import { makeHistoryStore } from "../client/store/history.js";
import type { AgentInfo, ApiRequest, ApiResponse, ChatSummary, HistoryEntry, HistoryRead, PageRef } from "../contracts/types.ts";

const yaml = { parse, parseAny, format, formatAny };
const FRAMEWORK = join(import.meta.dir, "..");
const unix = process.platform !== "win32";
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function scratch(label: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `biom-identity-${label}-`)));
  made.push(dir);
  return dir;
}

const docPath = (root: string, id: string) => join(root, pageDir(id), PAGE_DOC);
const put = (root: string, id: string, text: string) => {
  mkdirSync(dirname(docPath(root, id)), { recursive: true });
  writeFileSync(docPath(root, id), text);
};
const uidOnDisk = (root: string, id: string): string | null => {
  const m = /^uid:\s*(\S+)\s*$/m.exec(readFileSync(docPath(root, id), "utf8"));
  return m === null ? null : m[1]!.replace(/^["']|["']$/g, "");
};
/** What an agent writes, following the vault's rule never to type a `uid`. */
const AGENT_DOC = (name: string) => `name: ${name}\nplugin: biom-doc\ncontents:\n  - name: title\n    parts:\n      text: "# ${name}"\n`;

/** A vault of two pages as mount left them: each with its own `uid`. */
function vaultOf(): string {
  const root = scratch("vault");
  put(root, "home", "name: Home\nuid: h0meinvented0001\nplugin: biom-doc\ncontents: []\n");
  put(root, "home/Notes", "name: Notes\nuid: n0tesinvented001\nplugin: biom-doc\ncontents: []\n");
  return root;
}

/* ── makeIdentities, alone ─────────────────────────────────────────────── */

test("A PAGE WITH NO UID IS GIVEN ONE when first asked, and it is written into the file", async () => {
  const root = vaultOf();
  put(root, "home/Fresh", AGENT_DOC("Fresh"));
  const ids = makeIdentities(makeFiles(root), yaml);
  const uid = await ids.of("home/Fresh");
  expect(typeof uid).toBe("string");
  expect(uid).toMatch(/^[a-z0-9]{16}$/);
  await ids.written();
  expect(uidOnDisk(root, "home/Fresh")).toBe(uid);
  // The page's words are still its words.
  expect((await makePages(makeFiles(root), yaml).read("home/Fresh"))?.name).toBe("Fresh");
  // Asked again, the file answers, and it is the same one.
  expect(await ids.of("home/Fresh")).toBe(uid);
  // A page that had one keeps it, untouched.
  expect(await ids.of("home/Notes")).toBe("n0tesinvented001");
});

test("THE UID GOES IN AS ONE LINE UNDER name: — the agent's comments, quoting, order and a plugin's own keys kept byte for byte", async () => {
  const root = vaultOf();
  // Written the way an agent writes, and nothing like the way mount would:
  // comments, a quoted name, the plugin first, and keys under `input:` that
  // are the plugin's own and that the host never reads.
  const written =
    "# A page made in a chat — invented.\n" +
    "plugin: html   # drawn by its own index.html\n" +
    "name: 'Fresh, by hand'\n" +
    "input:\n" +
    "  # the plugin's own configuration\n" +
    "  tone: {level: 3, words: [calm, plain]}\n" +
    "  somethingNoHostKnows: yes please\n";
  put(root, "home/Fresh", written);
  const ids = makeIdentities(makeFiles(root), yaml);
  const uid = await ids.of("home/Fresh");
  await ids.written();
  const lines = written.split("\n");
  lines.splice(3, 0, `uid: ${uid}`);
  expect(readFileSync(docPath(root, "home/Fresh"), "utf8")).toBe(lines.join("\n"));

  // A file with Windows line endings takes the line in its own ending.
  put(root, "home/Crlf", "name: Crlf\r\nplugin: biom-doc # made on Windows\r\ncontents: []\r\n");
  const crlf = await ids.of("home/Crlf");
  await ids.written();
  expect(readFileSync(docPath(root, "home/Crlf"), "utf8")).toBe(`name: Crlf\r\nuid: ${crlf}\r\nplugin: biom-doc # made on Windows\r\ncontents: []\r\n`);

  // A top-level key the format does not have is a page that will not open —
  // the top level is closed by name — so it is given no identity and not
  // one byte of it is written.
  const unknown = "name: Odd\nplugin: biom-doc\nmood: invented\ncontents: []\n";
  put(root, "home/Odd", unknown);
  expect(await ids.of("home/Odd")).toBeNull();
  await ids.written();
  expect(readFileSync(docPath(root, "home/Odd"), "utf8")).toBe(unknown);
});

test("A LAYOUT THE LINE CANNOT GO INTO falls back to the way mount writes a document, and the page still gets its uid", async () => {
  const root = vaultOf();
  const ids = makeIdentities(makeFiles(root), yaml);
  for (const [id, text, name] of [
    // A name folded over lines: under its first line the uid would cut it.
    ["home/Folded", "name: >-\n  Fresh\n  page\nplugin: biom-doc\ncontents: []\n", "Fresh page"],
    // An empty `uid:` already there: a second would be a duplicate key.
    ["home/Emptyuid", "name: Empty uid\nuid:\nplugin: biom-doc\ncontents: []\n", "Empty uid"],
    // No `name:` line at all.
    ["home/Nameless", "plugin: biom-doc\ncontents: []\n", "Nameless"],
  ] as const) {
    put(root, id, text);
    const uid = await ids.of(id);
    expect([id, typeof uid]).toEqual([id, "string"]);
    await ids.written();
    const back = parse(readFileSync(docPath(root, id), "utf8"));
    expect([id, back.uid, back.name]).toEqual([id, uid, name]);
  }
  // And the insert alone, for the record: none of these is taken as it is.
  expect(withUidLine("plugin: biom-doc\n", "u1nventedidentity")).toBeNull();
  expect(withUidLine("name: Last", "u1nventedidentity")).toBe("name: Last\nuid: u1nventedidentity");
});

test("ASKED TWICE AT ONCE, one page is ONE uid — the history and the watcher never mint it two", async () => {
  const root = vaultOf();
  put(root, "home/Fresh", AGENT_DOC("Fresh"));
  const ids = makeIdentities(makeFiles(root), yaml);
  const [a, b, c] = await Promise.all([ids.of("home/Fresh"), ids.of("home/Fresh"), ids.of("home/Fresh")]);
  expect(a).not.toBeNull();
  expect([b, c]).toEqual([a, a]);
  await ids.written();
  expect(uidOnDisk(root, "home/Fresh")).toBe(a);
});

test("STABLE FOR THE SESSION: an agent writing the document whole without its uid gets the same one back — a page made now, or one that was there at mount", async () => {
  const root = vaultOf();
  put(root, "home/Fresh", AGENT_DOC("Fresh"));
  const ids = makeIdentities(makeFiles(root), yaml);
  // What mount saw.
  ids.saw(await makePages(makeFiles(root), yaml).list());
  const fresh = await ids.of("home/Fresh");
  await ids.written();

  // The agent rewrites both documents whole, dropping the uid each had.
  put(root, "home/Fresh", AGENT_DOC("Fresh, rewritten"));
  put(root, "home/Notes", AGENT_DOC("Notes, rewritten"));
  expect(uidOnDisk(root, "home/Fresh")).toBeNull();
  expect(await ids.of("home/Fresh")).toBe(fresh);
  expect(await ids.of("home/Notes")).toBe("n0tesinvented001");
  await ids.written();
  expect(uidOnDisk(root, "home/Fresh")).toBe(fresh);
  expect(uidOnDisk(root, "home/Notes")).toBe("n0tesinvented001");
  // And what the agent wrote is what carries it.
  expect(readFileSync(docPath(root, "home/Notes"), "utf8")).toContain("Notes, rewritten");
});

/** A `Files` that counts what it is asked: every directory listed — a walk of
 *  the tree lists every page's — and every file read. */
function spied(root: string) {
  const inner = makeFiles(root);
  const reads: string[] = [];
  let lists = 0;
  const files = {
    ...inner,
    read: (rel: string) => { reads.push(rel); return inner.read(rel); },
    list: (rel: string) => { lists++; return inner.list(rel); },
  } as typeof inner;
  return { files, reads, lists: () => lists, clear: () => { reads.length = 0; lists = 0; } };
}

test("DECIDED FROM MEMORY: a known page that lost its uid walks no tree — it reads its own document and nothing else", async () => {
  const root = vaultOf();
  // Enough pages that a walk would show.
  for (let i = 0; i < 30; i++) put(root, `home/Filler${i}`, `name: Filler ${i}\nuid: f1ller${String(i).padStart(10, "0")}\nplugin: biom-doc\ncontents: []\n`);
  const spy = spied(root);
  const ids = makeIdentities(spy.files, yaml);
  ids.saw(await makePages(makeFiles(root), yaml).list());

  // An agent writes Notes whole, without the uid it had.
  put(root, "home/Notes", AGENT_DOC("Notes, rewritten"));
  spy.clear();
  expect(await ids.of("home/Notes")).toBe("n0tesinvented001");
  await ids.written();
  expect(spy.lists()).toBe(0);
  expect([...new Set(spy.reads)]).toEqual([docPath("", "home/Notes").replace(/^\//, "")]);
  expect(uidOnDisk(root, "home/Notes")).toBe("n0tesinvented001");
});

test("A PAGE THAT MOVED TAKES ITS UID WITH IT: a new page at its old id is not handed it, and only the page that holds it is read to say so", async () => {
  const root = vaultOf();
  const spy = spied(root);
  const ids = makeIdentities(spy.files, yaml);
  ids.saw(await makePages(makeFiles(root), yaml).list());
  // Notes moves to Archive, uid and all — and the move is seen, as the
  // watcher's structural settle sees every move and hands `arrived` the list.
  put(root, "home/Archive", readFileSync(docPath(root, "home/Notes"), "utf8"));
  rmSync(join(root, pageDir("home/Notes")), { recursive: true, force: true });
  await ids.arrived(await makePages(makeFiles(root), yaml).list());
  // A new page is made where Notes was.
  put(root, "home/Notes", AGENT_DOC("Notes again"));
  spy.clear();
  const uid = await ids.of("home/Notes");
  expect(uid).not.toBeNull();
  expect(uid).not.toBe("n0tesinvented001");
  expect(spy.lists()).toBe(0);
  expect([...new Set(spy.reads)].sort()).toEqual([docPath("", "home/Archive"), docPath("", "home/Notes")].map((p) => p.replace(/^\//, "")).sort());
  // The moved page keeps its own — and gets it back when written whole without it.
  expect(await ids.of("home/Archive")).toBe("n0tesinvented001");
  await ids.written();
  put(root, "home/Archive", AGENT_DOC("Archive, rewritten"));
  expect(await ids.of("home/Archive")).toBe("n0tesinvented001");
  await ids.written();
  expect(uidOnDisk(root, "home/Archive")).toBe("n0tesinvented001");
  expect(uidOnDisk(root, "home/Notes")).toBe(uid);
});

test("a page that is not there is no identity, and one that will not parse — or the design doc, which is in no tree — is never written", async () => {
  const root = vaultOf();
  const ids = makeIdentities(makeFiles(root), yaml);
  expect(await ids.of("home/Nowhere")).toBeNull();
  put(root, "home/Broken", "name: [unclosed\n");
  expect(await ids.of("home/Broken")).toBeNull();
  mkdirSync(join(root, "design"), { recursive: true });
  writeFileSync(join(root, "design", PAGE_DOC), "name: Design\nplugin: biom-doc\ncontents: []\n");
  expect(await ids.of("@design")).toBeNull();
  await ids.written();
  expect(readFileSync(docPath(root, "home/Broken"), "utf8")).toBe("name: [unclosed\n");
  expect(readFileSync(join(root, "design", PAGE_DOC), "utf8")).toBe("name: Design\nplugin: biom-doc\ncontents: []\n");
});

test("arrived: every page in a list without a uid is given one, and every one with a uid is remembered", async () => {
  const root = vaultOf();
  put(root, "home/Fresh", AGENT_DOC("Fresh"));
  put(root, "home/Fresh/Deeper", AGENT_DOC("Deeper"));
  const ids = makeIdentities(makeFiles(root), yaml);
  const refs: PageRef[] = await makePages(makeFiles(root), yaml).list();
  expect(await ids.arrived(refs)).toBe(2);
  await ids.written();
  const after = await makePages(makeFiles(root), yaml).list();
  const uids = after.map((r) => r.uid);
  expect(uids.every((u) => typeof u === "string")).toBe(true);
  expect(new Set(uids).size).toBe(uids.length);
});

/* ── through the composition root ──────────────────────────────────────── */

function agentEnv(bin: string, home: string): () => Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("BIOM_")) env[k] = v;
  delete env.TYPESAFE_API_KEY;
  env.HOME = home;
  env.PATH = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  return async () => ({ ...env });
}

async function stand(bin: string): Promise<{ host: Host; vault: string }> {
  const root = scratch("root");
  const vault = join(root, "vault");
  const host = await makeHost({
    vault,
    memory: join(root, "vaults.json"),
    presets: join(FRAMEWORK, "presets"),
    agentsHome: join(root, "agents"),
    agentEnv: agentEnv(bin, join(root, "home")),
  });
  return { host, vault };
}

let n = 0;
const call = async (host: Host, vault: string, o: Record<string, unknown>): Promise<ApiResponse> =>
  await handle({ id: `r${++n}`, g: PROTOCOL, ...o } as ApiRequest, await host.deps(vault));
const value = (r: ApiResponse): unknown => {
  if (!r.ok) throw new Error(`refused: ${r.error.code} ${r.error.message}`);
  return r.value;
};

async function until(ok: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (await ok()) return true;
    await Bun.sleep(25);
  }
  return await ok();
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pidsIn = (log: string): number[] =>
  existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((l) => l.includes('"started"')).map((l) => (JSON.parse(l) as { pid: number }).pid)
    : [];

async function turnEnded(host: Host, vault: string, chat: string, turn: number): Promise<void> {
  expect(await until(async () => {
    const list = value(await call(host, vault, { kind: "chat.list" })) as ChatSummary[];
    const now = list.find((c) => c.id === chat);
    return now !== undefined && now.turn === turn && now.phase === "idle" && now.stop !== null;
  }, 20000)).toBe(true);
}

const FRESH = "pages/home/children/Fresh/content.yaml";

test.if(unix)("AN AGENT'S NEW PAGE IS PLACED BY ITS UID AND FOLLOWED BY THE SWITCHER once the tree lists it, and rewriting it without the uid changes nothing", async () => {
  const bin = scratch("bin");
  const log = join(scratch("log"), "fake.log");
  installFakeAgent(bin, {
    scenario: {
      log,
      turns: [
        [{ write: { path: FRESH, content: AGENT_DOC("Fresh") } }, { reply: "Made the page." }],
        [{ write: { path: FRESH, content: AGENT_DOC("Fresh, rewritten") } }, { reply: "Rewrote it." }],
      ],
    },
  });
  const { host, vault } = await stand(bin);
  try {
    expect(await until(async () => {
      const list = value(await call(host, vault, { kind: "agents.list" })) as AgentInfo[];
      return list.some((a) => a.key === "claude-acp" && a.state === "active");
    }, 20000)).toBe(true);

    // A WINDOW, as the client builds one: the real ui store, the real history
    // store and the real switcher over them, started before the agent writes.
    // What the server's history appends is gathered as the stream would carry
    // it. `tree` is the window's copy of the page list.
    let tree = value(await call(host, vault, { kind: "page.list" })) as PageRef[];
    const ui = makeUi({ route: { view: "page", id: "home", screen: "page" }, panel: true, chat: null });
    const transport = { call: async (req: ApiRequest) => await handle(req, await host.deps(vault)) };
    const history = makeHistoryStore({ transport, now: Date.now });
    const switcher = makeSwitcher({ ui, history, window: "window-invented-fresh-01", pages: () => tree, now: Date.now, timing: TIMING });
    await switcher.start();
    const live: HistoryEntry[] = [];
    const off = (await host.deps(vault)).history!.on((more) => { live.push(...more); });

    const chat = value(await call(host, vault, { kind: "chat.new", agent: "claude-acp", text: "Make me a page called Fresh." })) as ChatSummary;
    ui.set({ chat: chat.id });
    await turnEnded(host, vault, chat.id, 1);

    // THE EDIT IS PLACED, by the uid the page was given — and that uid is in
    // the file and in the tree.
    const first = (value(await call(host, vault, { kind: "history.read" })) as HistoryRead).entries
      .filter((e): e is Extract<HistoryEntry, { kind: "edit" }> => e.kind === "edit" && e.path === FRESH);
    expect(first.length).toBe(1);
    const place = first[0]!.place;
    expect(place).not.toBeNull();
    expect(place).toMatchObject({ view: "page", screen: "page" });
    const uid = (place as { uid: string }).uid;
    expect(await until(() => uidOnDisk(vault, "home/Fresh") === uid, 5000)).toBe(true);
    tree = value(await call(host, vault, { kind: "page.list" })) as PageRef[];
    expect(tree.find((p) => p.id === "home/Fresh")?.uid).toBe(uid);

    // THE REAL SWITCHER FOLLOWS IT, heard live once the window's tree lists
    // the page: the screen moves to Fresh, with the chat beside it.
    off();
    expect(live.some((e) => e.kind === "edit" && e.path === FRESH)).toBe(true);
    history.take(live, true);
    expect(ui.get().route).toEqual({ view: "page", id: "home/Fresh", screen: "page" });
    expect(ui.get().panel).toBe(true);

    // THE AGENT WRITES THE PAGE WHOLE AGAIN, without the uid: the same uid,
    // in the edit and back in the file, and no second one anywhere.
    value(await call(host, vault, { kind: "chat.send", chat: chat.id, text: "Rewrite it." }));
    await turnEnded(host, vault, chat.id, 2);
    const edits = (value(await call(host, vault, { kind: "history.read" })) as HistoryRead).entries
      .filter((e): e is Extract<HistoryEntry, { kind: "edit" }> => e.kind === "edit" && e.path === FRESH);
    expect(edits.length).toBe(2);
    expect(edits[1]!.place).toEqual(place);
    expect(await until(() => uidOnDisk(vault, "home/Fresh") === uid && readFileSync(docPath(vault, "home/Fresh"), "utf8").includes("rewritten"), 5000)).toBe(true);
  } finally {
    host.close();
    for (const pid of pidsIn(log)) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
}, 60000);

test.if(unix)("A PAGE MADE FROM OUTSIDE, with a stream open, is given its uid on the watcher's structural settle — no history involved", async () => {
  const bin = scratch("watch-bin");
  const { host, vault } = await stand(bin);
  let heard = 0;
  const off = await host.watch(vault, () => { heard++; });
  try {
    put(vault, "home/Outside", AGENT_DOC("Outside"));
    expect(await until(() => existsSync(docPath(vault, "home/Outside")) && uidOnDisk(vault, "home/Outside") !== null, 10000)).toBe(true);
    const uid = uidOnDisk(vault, "home/Outside");
    // The page's arrival was still heard as one: the rail learns of it.
    expect(heard).toBeGreaterThan(0);
    const tree = value(await call(host, vault, { kind: "page.list" })) as PageRef[];
    expect(tree.find((p) => p.id === "home/Outside")?.uid).toBe(uid);
    // And the history, asked now, names it by the same uid.
    const history = (await host.deps(vault)).history!;
    expect(await history.placeOf("pages/home/children/Outside/content.yaml")).toEqual({ view: "page", uid: uid!, screen: "page" });
  } finally {
    off();
    host.close();
  }
}, 30000);
