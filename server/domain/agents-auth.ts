// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE WAYS AN AGENT OFFERS TO SIGN IN, read out of what `initialize`
// answered, and what the sign-in pop-up would run for one. Pure.
//
// The rest of the protocol is read in ONE place, `server/platform/acp-wire.ts`,
// which the chats and the probe share: the handshake, `session/new`, the
// config options and the commands. `readInitialize` there hands the sign-in
// methods over as the agent sent them, because only the agents module reads
// them — and this is that reading. Everything here is untrusted input from a
// program Biom did not write: a field of the wrong type is skipped, a string
// is cut, a list is bounded. What comes out is `contracts/`'s `AuthMethodInfo`
// for the client, and one server-only shape, `AuthMethod`, which keeps what a
// pop-up would run and is never put on a wire.

import type { AgentLaunch, AuthMethodInfo } from "../../contracts/types.ts";

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

/** Every sign-in method `initialize` listed — `readInitialize(...).authMethods`
 *  — read. */
export function readAuthMethods(list: unknown): AuthMethod[] {
  if (!Array.isArray(list)) return [];
  const out: AuthMethod[] = [];
  for (const m of list) {
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
