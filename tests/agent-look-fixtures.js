// SPDX-License-Identifier: AGPL-3.0-only
// LookState fixtures for the Agent screen's look — INVENTED, every one of
// them. The chats, the replies, the diffs and the page names below are made
// up to exercise the look: a finished turn, a turn mid-flight, a turn that
// ended red, a held message, a handover, and a chat whose every field is an
// attempt to get markup into the box. Nothing here is anybody's real chat.
//
// Read by `tests/agent-look.test.js` (no browser) and
// `tests/e2e/agent-look.e2e.ts` (a real one), so both see the same states.

/** A chat id of the grammar the guards accept. @param {string} s */
export const cid = (s) => ("chat-" + s + "-0000000").slice(0, 16);

const MIN = 60000;

/** One update, stamped. @param {number} seq @param {number} turn @param {number} at @param {Record<string, any>} rest */
const up = (seq, turn, at, rest) => ({ seq, at, turn, ...rest });

/** The faces Jev picks from, as the server hands them: the emoji and the
 *  vendored art's path. */
export const FACES = {
  think: { emoji: "🤔", art: "/vendor/noto/1f914.webp" },
  read: { emoji: "🧐", art: "/vendor/noto/1f9d0.webp" },
  write: { emoji: "🤓", art: "/vendor/noto/1f913.webp" },
  done: { emoji: "😌", art: "/vendor/noto/1f60c.webp" },
  lost: { emoji: "😵‍💫", art: null },
  tidy: { emoji: "🧹", art: null },
  news: { emoji: "📰", art: null },
};

/** THE LIST, ONE CHAT IN EACH OF THE LOOK'S GROUPS WHATEVER THE HOUR. The look
 *  groups by this machine's calendar day (`groupOf` in the look's model), so a
 *  chat an hour or a day old is in another group just after midnight: the two
 *  of today are kept after today's midnight, and yesterday's is yesterday's
 *  noon. Midnight is the local one of the realm that builds the fixture, which
 *  is the realm the look reads it in — bun's for `tests/agent-look.test.js`, and
 *  for the box in a browser the end-to-end test sets the browser's time zone to
 *  the same one.
 *  @param {number} now */
export function chats(now) {
  const today = new Date(now).setHours(0, 0, 0, 0);
  const yesterday = today - 12 * 60 * MIN;
  return [
    { id: cid("live"), name: "Tidy the Boards page", face: FACES.tidy, agent: "claude-acp", harness: "Claude Code", agentId: "agent-live-0001", page: null, phase: "running", turn: 2, light: "working", stop: null, reason: null, created: now - 30 * MIN, updated: Math.max(now - 5000, today + 2000) },
    { id: cid("done"), name: "Summarise what the Socials run did today", face: FACES.news, agent: "claude-acp", harness: "Claude Code", agentId: null, page: null, phase: "idle", turn: 1, light: "done", stop: "end_turn", reason: null, created: now - 60 * MIN, updated: Math.max(now - 3 * MIN, today + 1000) },
    { id: cid("red"), name: "Weekly runs digest", face: { emoji: "🔎", art: null }, agent: "codex-acp", harness: "Codex", agentId: null, page: null, phase: "idle", turn: 1, light: "error", stop: "max_tokens", reason: null, created: yesterday - 60 * MIN, updated: yesterday },
    { id: cid("old"), name: "Why did the X Leads run stop early?", face: { emoji: "📊", art: null }, agent: "codex-acp", harness: "Codex", agentId: null, page: null, phase: "idle", turn: 1, light: "none", stop: "end_turn", reason: null, created: now - 3 * 24 * 60 * MIN, updated: now - 3 * 24 * 60 * MIN },
    { id: cid("older"), name: "Draft the pricing page", face: null, agent: "claude-acp", harness: "Claude Code", agentId: null, page: null, phase: "idle", turn: 1, light: "none", stop: "end_turn", reason: null, created: now - 20 * 24 * 60 * MIN, updated: now - 20 * 24 * 60 * MIN },
  ];
}

/** The page names the look's places resolve through, by uid. */
export const NAMES = {
  uid00000boards01: { id: "home/Boards", name: "Boards" },
  uid00000specs001: { id: "home/Specs/2026-09-24-Chat", name: "Chat" },
};

const BOARDS_OLD = [
  "name: Boards",
  "plugin: biom-doc",
  "contents:",
  "  - name: Backlog",
  "  - name: Someday",
  "  - name: Doing",
  "  - name: Done",
].join("\n") + "\n";
const BOARDS_NEW = [
  "name: Boards",
  "plugin: biom-doc",
  "contents:",
  "  - name: Later",
  "  - name: Doing",
  "  - name: Done",
].join("\n") + "\n";

/** A finished first turn and a second one mid-flight: the thinking still
 *  streaming, a tool running, no face yet on the second message.
 *  @param {number} now */
export function liveUpdates(now) {
  const t0 = now - 4 * MIN;
  const t1 = now - 30000;
  return [
    up(1, 0, t0 - 2000, { kind: "agent", agentId: "agent-live-0001", agent: "claude-acp", harness: "Claude Code" }),
    up(2, 0, t0 - 1000, { kind: "config", options: [{ id: "model", name: "Model", category: "model", type: "select", value: "opus", choices: [{ value: "opus", name: "Opus 5.5", description: null, group: null }] }] }),
    up(3, 1, t0, { kind: "prompt", text: "Tidy the Boards page. The columns have drifted." }),
    up(4, 1, t0 + 200, { kind: "turn", phase: "running", stop: null, reason: null }),
    up(5, 1, t0 + 1500, { kind: "thought", text: "Read the Boards page, merge the two backlog columns, " }),
    up(6, 1, t0 + 1900, { kind: "thought", text: "and keep every board on the same four." }),
    up(7, 1, t0 + 10000, { kind: "face", face: FACES.read }),
    up(8, 1, t0 + 11000, { kind: "tool", tool: { id: "tool-read-1", title: "Read pages/home/children/Boards/content.yaml", kind: "read", status: "completed", locations: [{ path: "pages/home/children/Boards/content.yaml", line: null }], diffs: [], output: "", truncated: false } }),
    up(9, 1, t0 + 14000, { kind: "tool", tool: { id: "tool-edit-1", title: "Edit pages/home/children/Boards/content.yaml", kind: "edit", status: "completed", locations: [{ path: "pages/home/children/Boards/content.yaml", line: 4 }], diffs: [{ path: "pages/home/children/Boards/content.yaml", old: BOARDS_OLD, new: BOARDS_NEW }], output: "", truncated: false } }),
    up(10, 1, t0 + 15000, { kind: "tool", tool: { id: "tool-run-1", title: "bun run .agents/skills/check.ts pages/home/children/Boards", kind: "execute", status: "completed", locations: [], diffs: [], output: "$ bun run .agents/skills/check.ts pages/home/children/Boards\n  14 rules checked\n  0 errors · 0 notes\n", truncated: false } }),
    up(11, 1, t0 + 16000, { kind: "reply", text: "Merged the two backlog columns and renamed **Someday** to " }),
    up(12, 1, t0 + 16300, { kind: "reply", text: "`Later`, so every board uses the same four columns.\n\n- Backlog and Someday are one column now\n- The checker came back clean\n" }),
    up(13, 1, t0 + 17000, { kind: "face", face: FACES.done }),
    up(14, 1, t0 + 21000, { kind: "turn", phase: "idle", stop: "end_turn", reason: null }),
    up(15, 1, t0 + 21000, { kind: "changed", edits: [{ path: "pages/home/children/Boards/content.yaml", place: { view: "page", uid: "uid00000boards01", screen: "page" }, op: "edited", added: 1, removed: 2 }] }),
    up(16, 2, t1, { kind: "prompt", text: "Now draw the four columns as a figure on the Specs page." }),
    up(17, 2, t1 + 300, { kind: "turn", phase: "running", stop: null, reason: null }),
    up(18, 2, t1 + 2000, { kind: "thought", text: "The Specs page wants a figure of the four columns. I will read" }),
    up(19, 2, t1 + 4000, { kind: "tool", tool: { id: "tool-read-2", title: "Read pages/home/children/Specs/content.yaml", kind: "read", status: "in_progress", locations: [{ path: "pages/home/children/Specs/content.yaml", line: null }], diffs: [], output: "", truncated: false } }),
  ];
}

/** A finished chat: one turn, a face, the reply and the foot. @param {number} now */
export function doneUpdates(now) {
  const t0 = now - 4 * MIN;
  return [
    up(1, 0, t0 - 1000, { kind: "agent", agentId: "agent-done-0001", agent: "claude-acp", harness: "Claude Code" }),
    up(2, 1, t0, { kind: "prompt", text: "Summarise what the Socials run did today and what it wants me to look at." }),
    up(3, 1, t0 + 100, { kind: "turn", phase: "running", stop: null, reason: null }),
    up(4, 1, t0 + 3000, { kind: "tool", tool: { id: "tool-read-9", title: "Read pages/home/children/Automations/children/Socials", kind: "read", status: "completed", locations: [], diffs: [], output: "", truncated: false } }),
    up(5, 1, t0 + 5000, { kind: "reply", text: "It drafted three posts and scheduled none of them. Two want your eye:\n\n1. the one quoting the launch numbers, which is a week out of date\n2. a reply to a thread you already answered\n" }),
    up(6, 1, t0 + 6000, { kind: "face", face: FACES.done }),
    up(7, 1, t0 + 21000, { kind: "turn", phase: "idle", stop: "end_turn", reason: null }),
  ];
}

/** A turn that ended red, with a handover before it. @param {number} now */
export function redUpdates(now) {
  const t0 = now - 25 * 60 * MIN;
  return [
    up(1, 0, t0 - 1000, { kind: "agent", agentId: "agent-red-00001", agent: "claude-acp", harness: "Claude Code" }),
    up(2, 0, t0 - 500, { kind: "agent", agentId: "agent-red-00002", agent: "codex-acp", harness: "Codex" }),
    up(3, 1, t0, { kind: "prompt", text: "Write the weekly digest of every automation run." }),
    up(4, 1, t0 + 100, { kind: "turn", phase: "running", stop: null, reason: null }),
    up(5, 1, t0 + 4000, { kind: "tool", tool: { id: "tool-read-7", title: "Read home/Automations", kind: "read", status: "completed", locations: [], diffs: [], output: "", truncated: false } }),
    up(6, 1, t0 + 5000, { kind: "tool", tool: { id: "tool-run-7", title: "ls runs", kind: "execute", status: "failed", locations: [], diffs: [], output: "ls: cannot access 'runs': No such file or directory\n", truncated: false } }),
    up(7, 1, t0 + 6000, { kind: "face", face: FACES.lost }),
    up(8, 1, t0 + 9000, { kind: "turn", phase: "idle", stop: "max_tokens", reason: null }),
    up(9, 1, t0 + 9000, { kind: "error", message: "Codex stopped mid-reply; nothing after the last line above was written." }),
  ];
}

/** A first message held with no agent ready. @param {number} now */
export function heldUpdates(now) {
  return [
    up(1, 1, now - 2000, { kind: "prompt", text: "Find every page that still says sync is free." }),
    up(2, 1, now - 1900, { kind: "turn", phase: "held", stop: null, reason: null }),
  ];
}

/** EVERY FIELD AN ATTEMPT TO GET MARKUP INTO THE BOX: the reply, the
 *  thinking, a tool's title, output, diff and path, the chat's name, a page's
 *  name and a face's art. None of it may ever become an element, an
 *  attribute that runs, or a request. @param {number} now */
export function hostileUpdates(now) {
  const t0 = now - MIN;
  const x = "<img src=x onerror=\"window.__pwned=1\">";
  return [
    up(1, 0, t0 - 100, { kind: "agent", agentId: "agent-evil-0001", agent: "claude-acp", harness: "Claude <b>Code</b>" }),
    up(2, 1, t0, { kind: "prompt", text: "Say " + x + " <script>window.__pwned=2</script>" }),
    up(3, 1, t0 + 100, { kind: "thought", text: "<svg onload=\"window.__pwned=3\"></svg> thinking" }),
    up(4, 1, t0 + 200, { kind: "tool", tool: { id: "tool-evil-1", title: "Edit " + x, kind: "edit", status: "completed", locations: [{ path: "<iframe src=javascript:window.__pwned=4>", line: 1 }], diffs: [{ path: "a/" + x, old: "<b>old</b>\n", new: "<script>window.__pwned=5</script>\n" }], output: "<img src=y onerror=\"window.__pwned=6\">", truncated: true } }),
    up(5, 1, t0 + 300, { kind: "reply", text: "Here " + x + " and <script>window.__pwned=7</script>\n\n[click me](javascript:window.__pwned=8) ![pic](https://example.invalid/t.png)\n\n<div onclick=\"window.__pwned=9\">raw html block</div>\n\n```html\n<script>window.__pwned=10</script>\n```\n" }),
    up(6, 1, t0 + 400, { kind: "face", face: { emoji: "<img src=z onerror=window.__pwned=11>", art: "javascript:window.__pwned=12" } }),
    up(7, 1, t0 + 500, { kind: "turn", phase: "idle", stop: "refusal", reason: "<b onmouseover=window.__pwned=13>because</b>" }),
    up(8, 1, t0 + 500, { kind: "changed", edits: [
      { path: "pages/" + x, place: { view: "page", uid: "uidhostile000001", screen: "page" }, op: "created", added: 3 },
      { path: "workspace.db", place: { view: "table", id: "<b>rows</b>" }, op: "edited" },
      { path: "plugins/" + x + "/x.js", place: null, op: "deleted" },
    ] }),
  ];
}

export const HOSTILE_NAMES = {
  uidhostile000001: { id: "home/<img src=q onerror=window.__pwned=14>", name: "<img src=q onerror=window.__pwned=15>" },
};

/** @param {number} now */
export function hostileChat(now) {
  return { id: cid("evil"), name: "<img src=n onerror=\"window.__pwned=16\">", face: { emoji: "<b>x</b>", art: "/vendor/noto/../../etc/passwd" }, agent: "claude-acp", harness: "<i>Claude</i>", agentId: null, page: null, phase: "idle", turn: 1, light: "error", stop: "refusal", reason: null, created: now - MIN, updated: now - 1000 };
}

/**
 * A whole LookState. @param {Record<string, any>} over
 * @returns {any}
 */
export function lookState(over) {
  const now = typeof over.now === "number" ? over.now : Date.now();
  const base = {
    mode: "screen",
    chat: null,
    list: false,
    chats: chats(now),
    updates: [],
    names: NAMES,
    input: { at: "center", height: 118 },
    beside: { id: "home/Boards", name: "Boards" },
  };
  const out = { ...base, ...over };
  delete out.now;
  return out;
}

/** The state for a chat by its fixture name. @param {"live" | "done" | "red" | "held" | "evil"} which @param {Record<string, any>} [over] */
export function chatState(which, over = {}) {
  const now = typeof over.now === "number" ? over.now : Date.now();
  const updates = which === "live" ? liveUpdates(now) : which === "done" ? doneUpdates(now) : which === "red" ? redUpdates(now) : which === "held" ? heldUpdates(now) : hostileUpdates(now);
  const list = chats(now);
  if (which === "held") list.unshift({ id: cid("held"), name: "", face: null, agent: null, harness: null, agentId: null, page: null, phase: "held", turn: 1, light: "none", stop: null, reason: null, created: now - 2000, updated: now - 2000 });
  if (which === "evil") list.unshift(hostileChat(now));
  return lookState({ now, chat: cid(which), chats: list, updates, input: { at: "bottom", height: 132 }, names: which === "evil" ? { ...NAMES, ...HOSTILE_NAMES } : NAMES, ...over });
}
