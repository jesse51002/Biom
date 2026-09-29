// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — WHAT ACP SAYS: the messages Biom's server sends an agent and the
// ones it hears back, and the few places they are read into Biom's own shapes.
//
// THE PROTOCOL'S TYPES LIVE HERE AND NOWHERE ELSE. `acp.ts` beside it carries
// JSON-RPC and knows no method; this file knows the methods and carries
// nothing. Both the chats and the agents' probe speak through it, so the
// handshake both send and the pickers both fill are ONE reading of the
// protocol and not two that drift: a probe session's config options become
// the start screen's pickers through `toConfigOptions`, and a chat's own
// session's through the same function, so an option id kept from one is an
// option id the other knows.
//
// READ LOOSELY, WRITTEN EXACTLY. What an agent sends is checked field by field
// as it is read — an agent is a program somebody else wrote, several fields
// are optional in the schema, and older agents send older shapes — and a field
// that is missing or the wrong type reads as absent rather than failing the
// message. What Biom sends is the schema's shape exactly.
//
// The schema is `schema/schema.json` of agentclientprotocol/agent-client-
// protocol, protocol version 1.

import type { ConfigChoice, ConfigOption, ConfigValue, PlanEntry, SlashCommand, ToolKind, ToolStatus } from "../../contracts/types.ts";

/** The protocol major Biom speaks. An agent answering another is refused. */
export const ACP_PROTOCOL_VERSION = 1;

/** Who Biom says it is in `initialize`. */
export const BIOM_CLIENT = { name: "biom", title: "Biom", version: "0.1.0" } as const;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/* ── the handshake ────────────────────────────────────────────────────── */

/** `initialize`'s parameters. Biom reads and writes files for the agent and
 *  offers no terminal of ACP's; it offers terminal SIGN-IN both ways the
 *  protocol has spelled it — `auth.terminal`, and the older
 *  `_meta["terminal-auth"]` most agents still read alone (*Chat*,
 *  `credentials`). */
export function initializeParams(): Obj {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
      auth: { terminal: true },
      _meta: { "terminal-auth": true },
    },
    clientInfo: { ...BIOM_CLIENT },
  };
}

/** What an agent's `initialize` answer says about it. */
export interface AgentFacts {
  /** The major it answered, or null where it named none. */
  protocolVersion: number | null;
  /** `session/load`: the agent replays a session's history into a new
   *  connection. */
  loadSession: boolean;
  /** `session/resume`: the agent reopens a session without replaying it. */
  resume: boolean;
  /** `session/delete`: the agent deletes a session of its own, so a chat
   *  deleted in Biom is gone from the agent's own history too. */
  deleteSession: boolean;
  /** As the agent sent them — the agents module reads them. */
  authMethods: unknown[];
  agentInfo: { name: string; title: string | null; version: string | null } | null;
}

export function readInitialize(result: unknown): AgentFacts {
  const r = isObj(result) ? result : {};
  const caps = isObj(r.agentCapabilities) ? r.agentCapabilities : {};
  const session = isObj(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
  const info = isObj(r.agentInfo) ? r.agentInfo : null;
  return {
    protocolVersion: typeof r.protocolVersion === "number" ? r.protocolVersion : null,
    loadSession: caps.loadSession === true,
    // `{}` is support; absent or null is none.
    resume: isObj(session.resume),
    deleteSession: isObj(session.delete),
    authMethods: arr(r.authMethods),
    agentInfo: info && typeof info.name === "string"
      ? { name: info.name, title: str(info.title), version: str(info.version) }
      : null,
  };
}

/** `session/new`: the vault as `cwd`, and NO MCP servers — the door that will
 *  hand one to every agent is not built, and until it is, an agent's edits
 *  reach the history only as the writes Biom sees (`edits.ts`). */
export function newSessionParams(cwd: string): Obj {
  return { cwd, mcpServers: [] };
}

/** `session/load` and `session/resume` take the same three. */
export function reopenParams(sessionId: string, cwd: string): Obj {
  return { sessionId, cwd, mcpServers: [] };
}

/** What `session/new`, `session/load` and `session/resume` answer: the
 *  session's id where it is new, and its config and modes. */
export interface SessionFacts {
  sessionId: string | null;
  configOptions: unknown;
  modes: unknown;
}

export function readSession(result: unknown): SessionFacts {
  const r = isObj(result) ? result : {};
  return { sessionId: str(r.sessionId), configOptions: r.configOptions, modes: r.modes };
}

/* ── a turn ───────────────────────────────────────────────────────────── */

/** ACP's stop reasons. */
export const STOP_REASONS = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** A prompt answer's stop reason, or null where it named none Biom knows. */
export function readStop(result: unknown): StopReason | null {
  const r = isObj(result) ? result.stopReason : null;
  return (STOP_REASONS as readonly unknown[]).includes(r) ? (r as StopReason) : null;
}

/** `session/prompt` in text blocks, the baseline every agent takes: the
 *  person's words first, and each block Biom adds after them as one of its
 *  own, so the words go exactly as they were typed. */
export function promptParams(sessionId: string, text: string, added: readonly string[] = []): Obj {
  return { sessionId, prompt: [text, ...added].map((t) => ({ type: "text", text: t })) };
}

/** ONE `session/update`: the session it is for, and its update — whose
 *  `sessionUpdate` field says which it is. Null for a notification of any
 *  other shape. */
export function readUpdate(params: unknown): { sessionId: string; update: Obj & { sessionUpdate: string } } | null {
  if (!isObj(params)) return null;
  const sessionId = str(params.sessionId);
  const update = params.update;
  if (sessionId === null || !isObj(update) || typeof update.sessionUpdate !== "string") return null;
  return { sessionId, update: update as Obj & { sessionUpdate: string } };
}

/** The words in a content block: a text block's text, a resource link's
 *  name. Null for an image, audio or an embedded resource, which Biom does
 *  not draw. */
export function textOf(block: unknown): string | null {
  if (!isObj(block)) return null;
  if (block.type === "text") return str(block.text);
  if (block.type === "resource_link") return str(block.name) ?? str(block.uri);
  return null;
}

/* ── config options ───────────────────────────────────────────────────── */

const CATEGORIES = new Set(["model", "mode", "thought_level"]);

/** WHAT A PICKER OR A MENU CAN HOLD, and no more is believed: the probe's
 *  lists ride every `agents` event to every window, and a chat's every
 *  `config` and `commands` update. An id or a value longer than its bound is
 *  not the agent's word cut short — it is left out; a name, a line or a hint
 *  is cut. */
export const WIRE_BOUNDS = { options: 64, choices: 1000, commands: 500, id: 256, name: 200, description: 1000, hint: 500 } as const;
const cut = (s: string | null, max: number): string | null => (s !== null && s.length > max ? s.slice(0, max) : s);
const idOf = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s !== "" && s.length <= WIRE_BOUNDS.id ? s : null;
};

/** THE AGENT'S SESSION CONFIG OPTIONS, as Biom's pickers read them — and an
 *  agent's older `modes` as one `mode` option all the same (*Chat*, `acp`),
 *  unless it already lists an option of that category. `legacyMode` is the id
 *  given to that synthesised option, so the setter knows it is `set_mode` and
 *  not `set_config_option`; null where there is none. A grouped select's
 *  choices are flattened in the agent's order, each carrying its group's
 *  display name. An option of a type Biom does not know is left out. */
export function toConfigOptions(configOptions: unknown, modes: unknown): { options: ConfigOption[]; legacyMode: string | null } {
  const options: ConfigOption[] = [];
  for (const raw of arr(configOptions)) {
    if (options.length >= WIRE_BOUNDS.options) break;
    if (!isObj(raw)) continue;
    const id = idOf(raw.id);
    const name = cut(str(raw.name), WIRE_BOUNDS.name);
    // An id the agent gave twice is its first: `chat.config` names one.
    if (id === null || name === null || options.some((o) => o.id === id)) continue;
    const category = typeof raw.category === "string" && CATEGORIES.has(raw.category) ? (raw.category as ConfigOption["category"]) : "other";
    if (raw.type === "boolean") {
      options.push({ id, name, category, type: "boolean", value: raw.currentValue === true, choices: [] });
      continue;
    }
    if (raw.type !== "select") continue;
    const choices: ConfigChoice[] = [];
    for (const item of arr(raw.options)) {
      if (choices.length >= WIRE_BOUNDS.choices) break;
      if (!isObj(item)) continue;
      if (Array.isArray(item.options)) {
        const group = cut(str(item.name) ?? str(item.group), WIRE_BOUNDS.name);
        for (const inner of item.options) {
          if (choices.length >= WIRE_BOUNDS.choices) break;
          const c = choiceOf(inner, group);
          if (c) choices.push(c);
        }
        continue;
      }
      const c = choiceOf(item, null);
      if (c) choices.push(c);
    }
    const current = raw.currentValue;
    options.push({ id, name, category, type: "select", value: typeof current === "string" ? current : String(current ?? ""), choices });
  }

  let legacyMode: string | null = null;
  if (isObj(modes) && !options.some((o) => o.category === "mode")) {
    const available = arr(modes.availableModes);
    const choices: ConfigChoice[] = [];
    for (const m of available) {
      if (choices.length >= WIRE_BOUNDS.choices) break;
      if (!isObj(m)) continue;
      const value = idOf(m.id);
      const name = cut(str(m.name), WIRE_BOUNDS.name);
      if (value === null || name === null) continue;
      choices.push({ value, name, description: cut(str(m.description), WIRE_BOUNDS.description), group: null });
    }
    if (choices.length > 0) {
      legacyMode = options.some((o) => o.id === "mode") ? "_mode" : "mode";
      options.push({ id: legacyMode, name: "Mode", category: "mode", type: "select", value: str(modes.currentModeId) ?? choices[0]!.value, choices });
    }
  }
  return { options, legacyMode };
}

function choiceOf(item: unknown, group: string | null): ConfigChoice | null {
  if (!isObj(item)) return null;
  const value = idOf(item.value);
  const name = cut(str(item.name), WIRE_BOUNDS.name);
  if (value === null || name === null) return null;
  return { value, name, description: cut(str(item.description), WIRE_BOUNDS.description), group };
}

/** How to set one option: `session/set_mode` for the synthesised mode option,
 *  `session/set_config_option` otherwise — with `type: "boolean"` for a
 *  boolean, as the schema's two shapes say. */
export function setConfigRequest(sessionId: string, optionId: string, value: ConfigValue, legacyMode: string | null): { method: string; params: Obj } {
  if (legacyMode !== null && optionId === legacyMode) {
    return { method: "session/set_mode", params: { sessionId, modeId: String(value) } };
  }
  if (typeof value === "boolean") {
    return { method: "session/set_config_option", params: { sessionId, configId: optionId, type: "boolean", value } };
  }
  return { method: "session/set_config_option", params: { sessionId, configId: optionId, value } };
}

/* ── commands ─────────────────────────────────────────────────────────── */

/** `available_commands_update`'s list as the / menu's agent half. */
export function toSlashCommands(list: unknown): SlashCommand[] {
  const out: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const raw of arr(list)) {
    if (out.length >= WIRE_BOUNDS.commands) break;
    if (!isObj(raw)) continue;
    const name = str(raw.name)?.replace(/^\//, "") ?? null;
    if (name === null || name === "" || name.length > WIRE_BOUNDS.name || seen.has(name)) continue;
    seen.add(name);
    const input = isObj(raw.input) ? raw.input : null;
    out.push({ name, description: cut(str(raw.description), WIRE_BOUNDS.description) ?? "", hint: input ? cut(str(input.hint), WIRE_BOUNDS.hint) : null, source: "agent", skill: null });
  }
  return out;
}

/* ── permission ───────────────────────────────────────────────────────── */

/** THE ANSWER TO `session/request_permission`, which Biom gives and never
 *  shows: the agent's `allow_always` option, else `allow_once` (*Chat*,
 *  `acp`). An agent that offers neither is answered `cancelled` — there is
 *  nothing to allow, and no person to ask. */
export function choosePermission(params: unknown): { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } } {
  const options = isObj(params) ? arr(params.options) : [];
  for (const kind of ["allow_always", "allow_once"]) {
    for (const o of options) {
      if (isObj(o) && o.kind === kind && typeof o.optionId === "string") {
        return { outcome: { outcome: "selected", optionId: o.optionId } };
      }
    }
  }
  return { outcome: { outcome: "cancelled" } };
}

/* ── tool calls ───────────────────────────────────────────────────────── */

const TOOL_KINDS: readonly ToolKind[] = ["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"];
const TOOL_STATUSES: readonly ToolStatus[] = ["pending", "in_progress", "completed", "failed"];

/** ONE TOOL CALL AS THE AGENT HAS DESCRIBED IT SO FAR. ACP sends a `tool_call`
 *  and then `tool_call_update`s carrying only what changed — a field absent is
 *  unchanged, `content` and `locations` replace the whole collection — so this
 *  is the merge, whole, unbounded: what the line shows is bounded where it is
 *  drawn, and what the history reads is the whole of it. */
export interface ToolState {
  id: string;
  title: string;
  kind: ToolKind;
  status: ToolStatus;
  content: unknown[];
  locations: { path: string; line: number | null }[];
  rawInput: unknown;
  rawOutput: unknown;
}

/** Merge one `tool_call` or `tool_call_update` into what was known. Null for
 *  one with no id. */
export function mergeTool(prev: ToolState | null, update: Obj): ToolState | null {
  const id = str(update.toolCallId);
  if (id === null || id === "") return null;
  const base: ToolState = prev ?? { id, title: "", kind: "other", status: "pending", content: [], locations: [], rawInput: undefined, rawOutput: undefined };
  const next: ToolState = { ...base };
  const title = str(update.title);
  if (title !== null) next.title = title;
  if (typeof update.kind === "string" && (TOOL_KINDS as readonly string[]).includes(update.kind)) next.kind = update.kind as ToolKind;
  if (typeof update.status === "string" && (TOOL_STATUSES as readonly string[]).includes(update.status)) next.status = update.status as ToolStatus;
  if (Array.isArray(update.content)) next.content = update.content;
  if (Array.isArray(update.locations)) {
    next.locations = [];
    for (const l of update.locations) {
      if (!isObj(l) || typeof l.path !== "string" || l.path === "") continue;
      next.locations.push({ path: l.path, line: typeof l.line === "number" && Number.isInteger(l.line) ? l.line : null });
    }
  }
  if ("rawInput" in update && update.rawInput !== undefined) next.rawInput = update.rawInput;
  if ("rawOutput" in update && update.rawOutput !== undefined) next.rawOutput = update.rawOutput;
  return next;
}

/** A tool call's `diff` content items, as the agent gave them. */
export function toolDiffs(state: ToolState): { path: string; oldText: string | null; newText: string }[] {
  const out: { path: string; oldText: string | null; newText: string }[] = [];
  for (const c of state.content) {
    if (!isObj(c) || c.type !== "diff" || typeof c.path !== "string" || c.path === "") continue;
    out.push({ path: c.path, oldText: typeof c.oldText === "string" ? c.oldText : null, newText: typeof c.newText === "string" ? c.newText : "" });
  }
  return out;
}

/** The words of a tool call's `content` items — its output, as the line shows
 *  it. A terminal item is Biom's to embed, and Biom offers no terminal. */
export function toolText(state: ToolState): string {
  const parts: string[] = [];
  for (const c of state.content) {
    if (!isObj(c) || c.type !== "content") continue;
    const t = textOf(c.content);
    if (t !== null && t !== "") parts.push(t);
  }
  return parts.join("\n");
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

/** THE COMMAND LINE AN `execute` TOOL CALL RAN, and where, as its raw input
 *  says — never its title, which is prose for most agents and would read
 *  *touch up the readme* as a write to three files. A string is the line; an
 *  argument vector is a shell's `-c` script where it is one, and otherwise
 *  the words quoted back into a line. Null where the input names none. */
export function toolCommand(state: ToolState): { command: string; cwd: string | null } | null {
  const input = state.rawInput;
  if (!isObj(input)) return null;
  const cwd = str(input.cwd) ?? str(input.workdir) ?? str(input.working_directory);
  const c = input.command;
  if (typeof c === "string") return c.trim() === "" ? null : { command: c, cwd };
  if (Array.isArray(c) && c.length > 0 && c.every((w) => typeof w === "string")) {
    const words = c as string[];
    const shell = (words[0] as string).split("/").pop() ?? "";
    if (SHELLS.has(shell) && words.length === 3 && /^-[a-z]*c[a-z]*$/.test(words[1] as string)) {
      return { command: words[2] as string, cwd };
    }
    return { command: words.map(quoteWord).join(" "), cwd };
  }
  return null;
}

/** One word as a POSIX shell would read it back unchanged. */
export function quoteWord(w: string): string {
  if (w !== "" && /^[A-Za-z0-9_\/.,:=@%+-]+$/.test(w)) return w;
  return `'${w.replace(/'/g, `'\\''`)}'`;
}

/* ── the rest of a turn ───────────────────────────────────────────────── */

const PRIORITIES = new Set(["high", "medium", "low"]);
const PLAN_STATUSES = new Set(["pending", "in_progress", "completed"]);

/** A `plan` update's entries. */
export function toPlan(entries: unknown): PlanEntry[] {
  const out: PlanEntry[] = [];
  for (const e of arr(entries)) {
    if (!isObj(e) || typeof e.content !== "string") continue;
    out.push({
      content: e.content,
      priority: typeof e.priority === "string" && PRIORITIES.has(e.priority) ? (e.priority as PlanEntry["priority"]) : "medium",
      status: typeof e.status === "string" && PLAN_STATUSES.has(e.status) ? (e.status as PlanEntry["status"]) : "pending",
    });
  }
  return out;
}

/** A `usage_update`: the context used and its size, and the cost so far. */
export function toUsage(u: Obj): { used: number; size: number; cost: { amount: number; currency: string } | null } | null {
  if (typeof u.used !== "number" || typeof u.size !== "number") return null;
  const c = isObj(u.cost) && typeof u.cost.amount === "number" && typeof u.cost.currency === "string" ? { amount: u.cost.amount, currency: u.cost.currency } : null;
  return { used: u.used, size: u.size, cost: c };
}
