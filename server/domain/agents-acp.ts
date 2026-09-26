// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — WHAT AN AGENT SAYS OVER ACP, READ INTO BIOM'S OWN SHAPES. Pure.
//
// Everything an agent answers is untrusted input from a program Biom did not
// write: a field of the wrong type is skipped rather than believed, a string is
// cut to a length a screen can hold, and a list to a count one can draw. What
// comes out is `contracts/`'s — `AuthMethodInfo`, `ConfigOption`,
// `SlashCommand` — plus one server-only shape, `AuthMethod`, which keeps what a
// sign-in pop-up would run and is never put on a wire.
//
// THE CLIENT'S HALF OF `initialize` IS HERE TOO, because the probe and a chat
// must offer an agent exactly the same thing: an agent's sign-in methods depend
// on what the client said it can do. Biom reads and writes files for the agent,
// offers no terminal, and says it can show a sign-in terminal BOTH ways — ACP's
// `auth.terminal` and the older `_meta["terminal-auth"]` — because most agents
// read only the older one (*Chat*, `credentials`; *Agent sign-in*).

import type { AgentLaunch, AuthMethodInfo, ConfigCategory, ConfigChoice, ConfigOption, SlashCommand } from "../../contracts/types.ts";

/** ACP's one version. */
export const ACP_PROTOCOL_VERSION = 1;
/** ACP's *authentication required*. */
export const AUTH_REQUIRED = -32000;

/** What Biom offers in `initialize`, for the probe and every chat alike. */
export function initializeParams(version: string): Record<string, unknown> {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
      auth: { terminal: true },
      _meta: { "terminal-auth": true },
    },
    clientInfo: { name: "biom", title: "Biom", version },
  };
}

/* ── reading untrusted values ─────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v !== "" ? (v.length > max ? v.slice(0, max) : v) : null);
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A list of strings, or empty; anything that is not a string is dropped. */
function strings(v: unknown, count: number, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const s of v) {
    if (out.length >= count) break;
    if (typeof s === "string" && s.length <= max) out.push(s);
  }
  return out;
}

/** An environment an agent named: portable names, string values, bounded. */
function envOf(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [k, value] of Object.entries(v)) {
    if (n >= 64) break;
    if (!NAME.test(k) || typeof value !== "string" || value.length > 8192) continue;
    out[k] = value;
    n++;
  }
  return out;
}

/* ── sign-in methods ──────────────────────────────────────────────────── */

/** ONE SIGN-IN METHOD AS THE SERVER KEEPS IT. `native` is a method of ACP's
 *  own `terminal` type, whose `args` and `env` go on the agent's own launch;
 *  `legacy` is the older `_meta["terminal-auth"]`, which names a command of
 *  its own. Either makes the method a terminal one. Server-side only: the
 *  client is handed `authInfo` of it. */
export interface AuthMethod {
  id: string;
  name: string;
  description: string | null;
  type: "agent" | "terminal" | "env_var";
  vars: string[];
  native: { args: string[]; env: Record<string, string> } | null;
  legacy: { command: string; args: string[]; env: Record<string, string> } | null;
}

/** The variable names an `env_var` method asks for, in any of the spellings
 *  agents use: `vars: [{name}]`, `vars: ["NAME"]`, `varName: "NAME"`. */
function varsOf(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (typeof v === "string" && NAME.test(v) && !out.includes(v) && out.length < 16) out.push(v);
  };
  if (Array.isArray(m.vars)) for (const v of m.vars) add(isObj(v) ? v.name : v);
  add(m.varName);
  return out;
}

/** Every sign-in method `initialize` listed, read. */
export function readAuthMethods(init: unknown): AuthMethod[] {
  if (!isObj(init) || !Array.isArray(init.authMethods)) return [];
  const out: AuthMethod[] = [];
  for (const m of init.authMethods) {
    if (out.length >= 32) break;
    if (!isObj(m)) continue;
    const id = text(m.id, 256);
    if (id === null || out.some((o) => o.id === id)) continue;
    const meta = isObj(m._meta) ? m._meta : null;
    const ta = meta !== null && isObj(meta["terminal-auth"]) ? meta["terminal-auth"] : null;
    const legacyCommand = ta !== null ? text(ta.command, 4096) : null;
    const legacy = ta !== null && legacyCommand !== null
      ? { command: legacyCommand, args: strings(ta.args, 64, 4096), env: envOf(ta.env) }
      : null;
    const native = m.type === "terminal" ? { args: strings(m.args, 64, 4096), env: envOf(m.env) } : null;
    const type: AuthMethod["type"] = native !== null || legacy !== null ? "terminal" : m.type === "env_var" ? "env_var" : "agent";
    out.push({
      id,
      name: text(m.name, 200) ?? id,
      description: text(m.description, 1000),
      type,
      vars: type === "env_var" ? varsOf(m) : [],
      native,
      legacy,
    });
  }
  return out;
}

/** What the client is told of a method: never a command, never a value. */
export function authInfo(m: AuthMethod): AuthMethodInfo {
  return { id: m.id, name: m.name, description: m.description, type: m.type, vars: [...m.vars] };
}

/** WHAT THE SIGN-IN POP-UP RUNS for a terminal method: the agent's own
 *  launch with the method's arguments, or the older form's own command; and
 *  the METHOD's environment, which is what the person is shown. Null for a
 *  method that is not a terminal one. */
export function terminalCommand(m: AuthMethod, launch: AgentLaunch): { command: string; args: string[]; env: Record<string, string> } | null {
  if (m.native !== null) return { command: launch.command, args: [...launch.args, ...m.native.args], env: { ...m.native.env } };
  if (m.legacy !== null) return { command: m.legacy.command, args: [...m.legacy.args], env: { ...m.legacy.env } };
  return null;
}

/** The agent's own version, as `initialize` said it. */
export function readAgentVersion(init: unknown): string | null {
  if (!isObj(init) || !isObj(init.agentInfo)) return null;
  return text(init.agentInfo.version, 64);
}

/* ── the session's config options ─────────────────────────────────────── */

function categoryOf(v: unknown): ConfigCategory {
  return v === "model" || v === "mode" || v === "thought_level" ? v : "other";
}

function choiceOf(v: unknown, group: string | null): ConfigChoice | null {
  if (!isObj(v)) return null;
  const value = text(v.value, 256);
  if (value === null) return null;
  return { value, name: text(v.name, 200) ?? value, description: text(v.description, 1000), group };
}

/** One of the session's config options, as `session/new` or a
 *  `config_option_update` carries it; null where it is not one. A select's
 *  groups become each choice's `group`, by the group's display name, in the
 *  agent's own order. */
export function readConfigOption(v: unknown): ConfigOption | null {
  if (!isObj(v)) return null;
  const id = text(v.id, 256);
  if (id === null) return null;
  const name = text(v.name, 200) ?? id;
  const category = categoryOf(v.category);
  if (v.type === "boolean") {
    if (typeof v.currentValue !== "boolean") return null;
    return { id, name, category, type: "boolean", value: v.currentValue, choices: [] };
  }
  if (v.type !== "select" || typeof v.currentValue !== "string" || !Array.isArray(v.options)) return null;
  const choices: ConfigChoice[] = [];
  for (const o of v.options) {
    if (choices.length >= 1000) break;
    if (isObj(o) && Array.isArray(o.options)) {
      const group = text(o.name, 200) ?? text(o.group, 200);
      for (const inner of o.options) {
        if (choices.length >= 1000) break;
        const c = choiceOf(inner, group);
        if (c !== null) choices.push(c);
      }
    } else {
      const c = choiceOf(o, null);
      if (c !== null) choices.push(c);
    }
  }
  return { id, name, category, type: "select", value: v.currentValue, choices };
}

/** The older ways an agent offers a mode or a model — `modes` and the
 *  unstable `models` — as the one option each would have been. */
function olderSelect(state: unknown, idKey: string, listKey: string, currentKey: string, id: string, name: string, category: ConfigCategory): ConfigOption | null {
  if (!isObj(state) || !Array.isArray(state[listKey])) return null;
  const current = text(state[currentKey], 256);
  if (current === null) return null;
  const choices: ConfigChoice[] = [];
  for (const m of state[listKey] as unknown[]) {
    if (choices.length >= 1000) break;
    if (!isObj(m)) continue;
    const value = text(m[idKey], 256);
    if (value === null) continue;
    choices.push({ value, name: text(m.name, 200) ?? value, description: text(m.description, 1000), group: null });
  }
  return { id, name, category, type: "select", value: current, choices };
}

/** THE SESSION'S PICKERS, from what `session/new` answered: its config
 *  options, or — for an agent that offers them the older way — its modes and
 *  models as a `mode` and a `model` option all the same. */
export function readConfigOptions(session: unknown): ConfigOption[] {
  if (!isObj(session)) return [];
  const out: ConfigOption[] = [];
  if (Array.isArray(session.configOptions)) {
    for (const o of session.configOptions) {
      if (out.length >= 64) break;
      const opt = readConfigOption(o);
      if (opt !== null && !out.some((x) => x.id === opt.id)) out.push(opt);
    }
  }
  if (out.length > 0) return out;
  const mode = olderSelect(session.modes, "id", "availableModes", "currentModeId", "mode", "Mode", "mode");
  const model = olderSelect(session.models, "modelId", "availableModels", "currentModelId", "model", "Model", "model");
  if (model !== null) out.push(model);
  if (mode !== null) out.push(mode);
  return out;
}

/* ── the agent's commands ─────────────────────────────────────────────── */

/** The agent's half of the / menu, from `available_commands_update`. */
export function readCommands(list: unknown): SlashCommand[] {
  if (!Array.isArray(list)) return [];
  const out: SlashCommand[] = [];
  for (const c of list) {
    if (out.length >= 500) break;
    if (!isObj(c)) continue;
    const raw = text(c.name, 200);
    const name = raw === null ? null : raw.replace(/^\/+/, "");
    if (name === null || name === "" || out.some((o) => o.name === name)) continue;
    const hint = isObj(c.input) ? text(c.input.hint, 500) : null;
    out.push({ name, description: text(c.description, 1000) ?? "", hint, source: "agent", skill: null });
  }
  return out;
}

/** The commands a `session/update` notification carries for `session`, or
 *  null where it is not an `available_commands_update` for that session. */
export function commandsFromUpdate(params: unknown, session: string): SlashCommand[] | null {
  if (!isObj(params) || params.sessionId !== session || !isObj(params.update)) return null;
  if (params.update.sessionUpdate !== "available_commands_update") return null;
  return readCommands(params.update.availableCommands);
}

/** The session id `session/new` answered, or null. */
export function readSessionId(session: unknown): string | null {
  return isObj(session) ? text(session.sessionId, 256) : null;
}
