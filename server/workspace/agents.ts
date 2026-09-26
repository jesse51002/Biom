// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — WHAT AGENTS THIS MACHINE HAS: finding them, probing them,
// installing one from the ACP Registry and signing one in.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track A2 builds it, and may reshape
// anything here nothing else has started to call.
//
// What it owes (*Chat*, `picker`, `install`, `credentials`, and the
// *Agent sign-in* research under it):
//
//   - FINDING is looking: the commands of the agents Biom knows on the login
//     shell's `PATH`, the agents Biom installed into a folder of its own, and
//     OpenClaw's command and whether its Gateway answers on this machine — a
//     Gateway on another machine is never offered, and **Start Gateway** is
//     `start`;
//   - an agent is ACTIVE when it starts, answers `initialize` and opens a
//     session, and INACTIVE with a reason otherwise; the probe session's
//     config options and commands fill the start screen before a chat has a
//     session of its own;
//   - `initialize` offers `fs` read and write, no terminal, and BOTH terminal
//     sign-in flags — `auth.terminal` and the older `_meta["terminal-auth"]` —
//     because most agents read only the older one;
//   - sign-in is asked for only when an agent refused a session or a message,
//     because `authenticate` on an agent already signed in can sign it out;
//     a `terminal` method answers what the pop-up runs, with a ticket the
//     terminal redeems for exactly that command;
//   - installing reads the registry at
//     `cdn.agentclientprotocol.com/registry/v1/latest/registry.json`, pins its
//     version, and says plainly when `npx` needs Node or `uvx` needs uv;
//   - nothing waits: a probe, an install or a sign-in answers the agent as it
//     stands and says the verdict to every subscriber when it lands.
//
// E2E FINDS ITS FAKE AGENT BY THIS MODULE'S REAL PATH, and nothing else: the
// test sandbox puts a scripted ACP agent on the `PATH` it hands the server,
// under a command name the known-agents table already lists. No environment
// variable changes how anything here loads.

import type { AgentInfo, AgentKey, AgentLaunch, RegistryAgent, SignIn } from "../../contracts/types.ts";
import type { AcpConnection } from "../platform/acp.ts";

/** EVERYTHING THE AGENTS ARE HANDED. The probe speaks ACP through `connect`,
 *  the same seam the chats use — `connectAcp` in the running server, and in a
 *  test a fake `AcpConnection` (`server/platform/acp.ts`) that answers
 *  `initialize` and `session/new` from a script, so no agent is ever run. */
export interface AgentsDeps {
  connect: (launch: AgentLaunch, cwd: string) => AcpConnection;
  /** The person's login environment, read once per server — `loginEnv`. */
  env: () => Promise<Record<string, string>>;
  /** Where a command is on that environment's `PATH`, or null. */
  which: (command: string, env: Record<string, string>) => Promise<string | null>;
  /** The network, for the registry and a binary's download. */
  fetch: typeof fetch;
  /** Biom's own folder of installed agents, under the per-user data
   *  directory and never in a vault. */
  home: string;
  /** Where a probe runs: a vault's root. */
  cwd: string;
  now: () => number;
}

export interface Agents {
  /** What is known now; probes still in flight are `checking`. */
  list(): AgentInfo[];
  /** Look again at one agent. Answers it as `checking`. */
  probe(key: AgentKey): AgentInfo;
  /** **Start Gateway**: OpenClaw's, on this machine. Answers it as `checking`. */
  start(key: AgentKey): AgentInfo;
  registry(): Promise<RegistryAgent[]>;
  /** Answers the agent as `installing`. */
  install(key: AgentKey): AgentInfo;
  signIn(key: AgentKey, method: string): Promise<SignIn>;
  /** The command a ticket stands for, once — what the sign-in pop-up runs. */
  redeem(ticket: string): AgentLaunch | null;
  /** How to start an agent for a chat, or null where it cannot be started. */
  launch(key: AgentKey): Promise<AgentLaunch | null>;
  /** A chat's agent refused a session or a message for want of a sign-in:
   *  mark it Inactive with `signin`, and say so. */
  refused(key: AgentKey): void;
  /** Hear the whole list whenever any of it changes. Answers the unsubscribe. */
  on(fn: (agents: AgentInfo[]) => void): () => void;
  /** End every probe process, now. */
  killAll(): void;
}

/** NOT BUILT: throws. */
export function makeAgents(_deps: AgentsDeps): Agents {
  throw new Error("server/workspace/agents.ts: finding agents is not built yet");
}
