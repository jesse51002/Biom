// SPDX-License-Identifier: AGPL-3.0-only
// Layer 1 — THE PERSON'S LOGIN-SHELL ENVIRONMENT, read once and handed down.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the agents track builds it.
//
// An agent finds its own tools and its own login in the environment the
// person's shell gives it — `PATH` above all, and a key in the environment
// where that is how the agent signs in. A desktop launcher hands the server
// none of that, so the server asks the person's own login shell for it: the
// shell named by `$SHELL` (or the account's, where that is unset), started as
// a login shell, printing its environment NUL-separated, bounded in time, with
// no terminal and no input. It is what the terminal gave its shell, and what
// every agent a chat starts is started with.
//
// Nothing here is ever logged, sent to a client or written to a file: it holds
// the person's keys. A shell that fails or times out answers the server's own
// environment, which is the environment the agent would have had anyway.

/** Read the login shell's environment. NOT BUILT: throws. */
export function loginEnv(_opts?: { shell?: string; timeoutMs?: number }): Promise<Record<string, string>> {
  throw new Error("server/platform/loginenv.ts: the login-shell environment is not read yet");
}
