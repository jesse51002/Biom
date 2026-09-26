// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — JEV: the agent's status on each message, and one emoji per chat's
// name. It only classifies.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; the Jev track builds it.
//
// What it owes (*Chat*, `status`): the state is the agent's thinking as ACP
// streams it, or its reply and tool titles where it streams none; the question
// is one choice from a fixed list of at most 255 emoji with an `other` that
// keeps the current face; asked 10 seconds into a turn, then every 30 seconds,
// then once when the turn ends; the name's emoji one call on the name alone.
// The engine speaks the Jev API to one endpoint that can be changed —
// `POST <endpoint>` with `Authorization: Bearer <key>`, a body of `state`,
// `questions` and `model` — and the key comes out of the login environment
// and is NEVER logged, sent to a client, written to a file or put in an error
// message. The animated faces are Google's Noto emoji, vendored for the list
// only and credited, and never fetched while the server runs; a `Face`'s
// `art` names the vendored file.

import type { ChatId, Face } from "../../contracts/types.ts";

/** WHAT A TURN SAYS, as the chats module hears it: the moment a turn starts,
 *  each chunk of thinking and reply, each tool call's title, and its end. */
export type TurnSignal =
  | { kind: "start"; chat: ChatId; turn: number; text: string }
  | { kind: "thought"; chat: ChatId; turn: number; text: string }
  | { kind: "reply"; chat: ChatId; turn: number; text: string }
  | { kind: "tool"; chat: ChatId; turn: number; text: string }
  | { kind: "end"; chat: ChatId; turn: number };

/** What Jev is handed. Timers and the network are injected so a test can run
 *  a turn of ninety seconds in none. */
export interface JevDeps {
  fetch: typeof fetch;
  /** The key, read from the login environment; null turns Jev off quietly. */
  key: () => string | null;
  endpoint: string;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface Jev {
  /** Hear a turn. */
  observe(signal: TurnSignal): void;
  /** A chat was named: pick its emoji. */
  name(chat: ChatId, name: string): void;
  /** Hear a face: a turn's (`turn` a number) or the name's (`turn` null). */
  on(fn: (chat: ChatId, turn: number | null, face: Face) => void): () => void;
  /** Forget a chat and cancel its timers. */
  drop(chat: ChatId): void;
}

/** NOT BUILT: throws. */
export function makeJev(_deps: JevDeps): Jev {
  throw new Error("server/domain/jev.ts: Jev is not built yet");
}
