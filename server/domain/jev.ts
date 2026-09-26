// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — JEV: the agent's status on each message, and one emoji per chat's
// name. It only classifies.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track E builds it, and its brief's API
// is this one.
//
// What it owes (*Chat*, `status`): the state is the agent's thinking as ACP
// streams it, or its reply and tool titles where it streams none; the question
// is one `choice` from a fixed list of at most 255 emoji with an `other` that
// keeps the current face; asked 10 seconds into a turn, then every 30 seconds,
// then once when the turn ends; the face flips only when the answer changes and
// the last one stays; the name's emoji is one call on the name alone. The
// engine speaks the Jev API to one endpoint that can be changed — `POST
// <endpoint>` with `Authorization: Bearer <key>`, a body of `state`,
// `questions` and `model` — and the key comes out of the login environment
// and is NEVER logged, sent to a client, written to a file or put in an error.
// No key, no call: Jev is off, the loader stays and no face appears. The
// animated faces are Google's Noto emoji, vendored for the list only and
// credited, never fetched while the server runs; a `Face`'s `art` names the
// vendored file.

import type { ChatId, Face } from "../../contracts/types.ts";

/** WHAT A TURN SAYS, as the chats module emits it: its start, each chunk of
 *  thinking and reply, each tool call's title, and its end. */
export type TurnSignal =
  | { kind: "start"; chat: ChatId; turn: number; text: string }
  | { kind: "thought"; chat: ChatId; turn: number; text: string }
  | { kind: "reply"; chat: ChatId; turn: number; text: string }
  | { kind: "tool"; chat: ChatId; turn: number; text: string }
  | { kind: "end"; chat: ChatId; turn: number };

/** What Jev is handed. The network is injected so no test reaches it. */
export interface JevDeps {
  fetch: typeof fetch;
  /** The key, read from the login environment; null turns Jev off. */
  key: () => string | null;
  endpoint: string;
  now: () => number;
}

export interface Jev {
  /** One `choice` question over a turn's state: a face off the list, `other`
   *  (keep the face there is), or null where Jev is off. */
  classifyTurn(state: string): Promise<Face | "other" | null>;
  /** One question on a chat's name alone, asked once when it is named. */
  nameFace(name: string): Promise<Face | null>;
}

/** NOT BUILT: throws. */
export function makeJev(_deps: JevDeps): Jev {
  throw new Error("server/domain/jev.ts: Jev is not built yet");
}

/** The schedule's clock, injected so a ninety-second turn runs in none. */
export interface JevClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** A MOMENT TO ASK: the schedule has reached 10 s, the next 30 s, or the
 *  turn's end, and this is the state gathered so far. Whoever listens asks
 *  `classifyTurn` and flips the face only when the answer changed. */
export interface JevMoment {
  chat: ChatId;
  turn: number;
  state: string;
  final: boolean;
}

/** One chat's schedule. */
export interface JevTurn {
  /** Hear a turn's signal. */
  signal(signal: TurnSignal): void;
  /** Cancel every timer — the chat closed. */
  stop(): void;
}

/** NOT BUILT: throws. */
export function makeJevTurn(_listener: (moment: JevMoment) => void, _clock: JevClock): JevTurn {
  throw new Error("server/domain/jev.ts: Jev's schedule is not built yet");
}
