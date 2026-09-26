// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE AGENTS BIOM KNOWS BY NAME, and how each is found on a machine
// that did not install it through Biom. Pure data and nothing that runs.
//
// KNOWN IS NOT THE SAME AS LISTED. What `server/workspace/agents.ts` lists is
// what THIS machine has: a command below on the login shell's `PATH`, an agent
// Biom installed into its own folder from the ACP Registry, or both. The table
// is how the first of those is looked for, and nothing else — every agent in
// the registry can still be installed, found or not.
//
// A COMMAND IS LISTED HERE ONLY WHERE ITS NAME IS THE AGENT'S OWN. Finding a
// command means starting it with the ACP arguments beside it, so a name another
// program also answers to would start that program: `goose` is also a database
// migration tool, and `grok`, `droid`, `pool`, `nova` and `cortex` are each
// somebody else's word too. Those agents are found once Biom installed them,
// and not on the `PATH`. The arguments are the registry's own for the same
// release, read from its snapshot of 2026-09-25.
//
// TWO AGENTS ARE MORE THAN A COMMAND. Claude Code's own CLI does not speak ACP:
// its adapter does, `@agentclientprotocol/claude-agent-acp`, which runs on Node
// through `npx`, pinned — so Claude Code is found as the `claude` CLI plus a way
// to run the adapter, and said plainly to be missing Node where there is none.
// Codex is found the same way through its own adapter. OpenClaw is not in the
// registry at all: it is found by its command, and it runs through a Gateway
// that has to answer on THIS machine — the ACP bridge is always pointed at the
// local Gateway by address, so one configured on another machine, whose file
// writes would land there, is never what a chat reaches.

import type { AgentKey } from "../../contracts/types.ts";

/** One way an agent speaking ACP is started from the `PATH`. */
export interface LocalCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** An agent whose own CLI does not speak ACP, run through an adapter npx
 *  fetches at a pinned version once the CLI is found. */
export interface Adapter {
  /** The agent's own CLI, whose presence is what "this machine has it" means. */
  cli: string;
  /** The npm package, without a version. */
  package: string;
  /** Pinned: the registry's version when this table was written. A registry
   *  read since, listing another, is what runs instead. */
  version: string;
  args: string[];
}

/** OpenClaw's Gateway, which has to answer on this machine. */
export interface Gateway {
  host: "127.0.0.1";
  port: number;
  /** What Start Gateway runs, after the command. */
  start: string[];
}

export interface KnownAgent {
  key: AgentKey;
  /** What the picker calls it: the harness, never its model. */
  name: string;
  line: string;
  /** The agent speaking ACP on the `PATH`, tried in order. */
  local: LocalCommand[];
  adapter: Adapter | null;
  gateway: Gateway | null;
}

/** Where OpenClaw's Gateway listens unless it was told otherwise. The only
 *  place asked: a Gateway anywhere else is not this machine's to offer. */
export const OPENCLAW_PORT = 18789;
export const OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${OPENCLAW_PORT}`;

const cmd = (command: string, args: string[] = [], env: Record<string, string> = {}): LocalCommand => ({ command, args, env });

const agent = (key: string, name: string, line: string, local: LocalCommand[], extra: Partial<Pick<KnownAgent, "adapter" | "gateway">> = {}): KnownAgent => ({
  key,
  name,
  line,
  local,
  adapter: extra.adapter ?? null,
  gateway: extra.gateway ?? null,
});

/** THE TABLE, in the order the picker lists what it finds. */
export const KNOWN_AGENTS: readonly KnownAgent[] = [
  agent("claude-acp", "Claude Code", "Anthropic's coding agent, through its ACP adapter", [cmd("claude-agent-acp")], {
    adapter: { cli: "claude", package: "@agentclientprotocol/claude-agent-acp", version: "0.81.2", args: [] },
  }),
  agent("codex-acp", "Codex", "OpenAI's coding agent, through its ACP adapter", [cmd("codex-acp")], {
    adapter: { cli: "codex", package: "@agentclientprotocol/codex-acp", version: "1.13.1", args: [] },
  }),
  agent("openclaw", "OpenClaw", "Your own agent, through its Gateway on this machine", [cmd("openclaw", ["acp", "--url", OPENCLAW_GATEWAY_URL])], {
    gateway: { host: "127.0.0.1", port: OPENCLAW_PORT, start: ["gateway", "--port", String(OPENCLAW_PORT)] },
  }),
  agent("gemini", "Gemini CLI", "Google's official CLI for Gemini", [cmd("gemini", ["--acp"])]),
  agent("opencode", "OpenCode", "The open source coding agent", [cmd("opencode", ["acp"])]),
  agent("github-copilot-cli", "GitHub Copilot", "GitHub's AI pair programmer", [cmd("copilot", ["--acp"])]),
  agent("cursor", "Cursor", "Cursor's coding agent", [cmd("cursor-agent", ["acp"])]),
  agent("qwen-code", "Qwen Code", "Alibaba's Qwen coding assistant", [cmd("qwen", ["--acp", "--experimental-skills"])]),
  agent("auggie", "Auggie CLI", "Augment Code's software agent", [cmd("auggie", ["--acp"], { AUGMENT_DISABLE_AUTO_UPDATE: "1" })]),
  agent("cline", "Cline", "Autonomous coding agent CLI", [cmd("cline", ["--acp"])]),
  agent("kilo", "Kilo", "The open source coding agent", [cmd("kilo", ["acp"])]),
  agent("kimi", "Kimi CLI", "Moonshot AI's coding assistant", [cmd("kimi", ["acp"])]),
  agent("kimchi", "Kimchi", "Coding agent powered by multi-model orchestration", [cmd("kimchi", ["--mode", "acp"])]),
  agent("mistral-vibe", "Mistral Vibe", "Mistral's open-source coding assistant", [cmd("vibe-acp")]),
  agent("amp-acp", "Amp", "Amp, the frontier coding agent", [cmd("amp-acp")]),
  agent("devin", "Devin", "Devin CLI coding agent by Cognition", [cmd("devin", ["acp"])]),
  agent("junie", "Junie", "AI coding agent by JetBrains", [cmd("junie", ["--acp=true"])]),
  agent("codebuddy-code", "Codebuddy Code", "Tencent Cloud's coding tool", [cmd("codebuddy", ["--acp"])]),
  agent("qoder", "Qoder CLI", "AI coding assistant with agentic capabilities", [cmd("qodercli", ["--acp"])]),
  agent("stakpak", "Stakpak", "Open-source DevOps agent in Rust", [cmd("stakpak", ["acp"])]),
  agent("vtcode", "VT Code", "An open-source coding agent", [cmd("vtcode", ["acp"], { VT_ACP_ENABLED: "1", VT_ACP_ZED_ENABLED: "1" })]),
  agent("crow-cli", "crow-cli", "Minimal ACP native coding agent", [cmd("crow-cli", ["acp"])]),
  agent("corust-agent", "Corust Agent", "Co-building with a Rust partner", [cmd("corust-agent-acp")]),
];

/** One known agent by its key, or null. */
export function knownAgent(key: AgentKey): KnownAgent | null {
  return KNOWN_AGENTS.find((a) => a.key === key) ?? null;
}
