// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — JEV: the agent's status on each message, and one emoji per chat's
// name. It only classifies.
//
// What it owes (*Chat*, `status`): the state is the agent's thinking as ACP
// streams it, or its reply and tool titles where it streams none; the question
// is one `choice` from a fixed list of at most 255 emoji with an `other` that
// keeps the current face; asked 10 seconds into a turn, then every 30 seconds,
// then once when the turn ends; the face flips only when the answer changes and
// the last one stays; the name's emoji is one call on the name alone.
//
// THREE PIECES, EACH TESTABLE WITHOUT THE OTHER TWO, AND ALL IN ONE FILE because
// a second file in `server/domain/` would be a sibling import:
//
//   · `makeJev` speaks the Jev API — `POST <endpoint>`, `Authorization: Bearer
//     <key>`, a body of `state`, `questions` and `model` — and answers a Face.
//     It never throws: a failure is logged in a sentence of its own and answers
//     "keep the face you have".
//   · `makeJevTurn` is one chat's SCHEDULE: it hears a turn's signals and says
//     when to ask and over what state. Timer-driven on an injected clock.
//   · `makeJevStatus` is the loop between them, which is the part that is easy
//     to get subtly wrong: answers arrive out of order, `other` must not flip,
//     a closed chat must not be written to, and nothing may outlive it.
//
// THE KEY comes out of the login environment and is NEVER logged, sent to a
// client, written to a file or put in an error. No line this file logs is built
// from a response body or an error message — a status code, a host and a
// sentence of our own are the whole of what reaches the log — and every line is
// scrubbed of the key besides. No key, no call: Jev is off, the loader stays and
// no face appears.
//
// THE FACES are Google's animated Noto emoji, CC BY 4.0, vendored for these two
// lists only under `vendor/noto/` and credited there and in `NOTICE`; nothing is
// fetched while the server runs. A `Face`'s `art` names the vendored file, which
// the server serves at `/vendor/noto/<code>.webp`.

import type { ChatId, Face } from "../../contracts/types.ts";

/* ── the fixed lists ────────────────────────────────────────────────────── */

/** One entry Jev may choose: the label it answers with, the Noto code the art
 *  is filed under (`1f914`, `1f635_200d_1f4ab` — Google's own spelling, hex
 *  code points joined by `_`), and the one line Jev chooses on. */
export interface FaceEntry {
  label: string;
  code: string;
  criterion: string;
}

/** Where the vendored art is served. `vendor/` is a static route of the server
 *  and a carried directory of the compiled app, so both reach it. */
export const NOTO_ROUTE = "/vendor/noto/";

/** Jev's limit on the labels of one `choice`, `other` included. */
export const JEV_LABEL_LIMIT = 255;

/** WHAT THE AGENT MAKES OF THE REQUEST, as it goes — the status on each message.
 *
 *  WHY THESE AND NOT MORE. A face is read at 26 px in the corner of a message,
 *  so every entry has to be a state a person would want to KNOW about and could
 *  tell apart at a glance; two faces that mean the same thing are one wasted
 *  label and a flip that says nothing. So the list walks a turn in order —
 *  understanding the request, working, checking, trouble, discovery, the end —
 *  with the states each stage actually has and no more. The mockup's ten are
 *  all here, under the same faces. What was left out is out on purpose: moods
 *  with no work in them (😍, 🤗), a second face for a state already covered
 *  (😣 beside 😤, 😟 beside 😰, 🥱 beside 😴), and anything the animated Noto
 *  set does not have, because every entry must ship with its art. Twenty-six,
 *  which is a tenth of Jev's limit and plenty. */
export const STATUS_FACES: readonly FaceEntry[] = [
  // understanding the request
  { label: "starting", code: "1fae1", criterion: "It has understood the request and is getting started: restating it, making a plan, taking a first step." },
  { label: "weighing", code: "1f914", criterion: "It is weighing the request up: considering approaches, trade-offs, or what exactly to do." },
  { label: "doubting", code: "1f928", criterion: "It doubts something: a premise of the request looks wrong, or what it found does not add up." },
  { label: "unsure", code: "1f615", criterion: "It is unsure what the person means: the request is ambiguous and it is guessing at the intent." },
  { label: "asking", code: "1f97a", criterion: "It needs something from the person: a question, a choice or an answer it cannot make itself." },
  // working
  { label: "reading", code: "1f9d0", criterion: "It is reading to understand: opening files, searching code or docs, gathering context." },
  { label: "making", code: "1f913", criterion: "It is making the thing: writing code, a page or an edit, deep in the detail." },
  { label: "confident", code: "1f60e", criterion: "It knows exactly what to do and is doing it briskly, with no doubt in its thinking." },
  { label: "pushing", code: "1f624", criterion: "It is pushing through something stubborn: retrying, working around an obstacle, not giving up." },
  { label: "busy", code: "1f975", criterion: "It is in the middle of a big job: many files, a long change, a lot still to get through." },
  { label: "waiting", code: "1f634", criterion: "It is waiting on something slow: an install, a build, a download or a long-running command." },
  // checking
  { label: "checking", code: "1f62c", criterion: "It is checking its own work, running tests or re-reading a change, and is not yet sure it holds." },
  { label: "careful", code: "1fae3", criterion: "It is about to do something risky or hard to undo, and is going carefully." },
  { label: "snag", code: "1f605", criterion: "It hit a small snag, such as a failing test, a typo or a wrong path, and is fixing it." },
  // trouble
  { label: "alarmed", code: "1f630", criterion: "Something went wrong that worries it: an unexpected error, a broken build, work at risk." },
  { label: "stuck", code: "1f616", criterion: "It is stuck: the same failure again and again, with no way forward it can see." },
  { label: "lost", code: "1f635_200d_1f4ab", criterion: "It has lost the thread: going in circles, contradicting itself, confused by what it sees." },
  { label: "overwhelmed", code: "1f92f", criterion: "The problem turned out far bigger or more tangled than the request made it look." },
  { label: "cannot", code: "1fae0", criterion: "It cannot do what was asked: out of options, blocked, or saying it is not possible." },
  // discovery
  { label: "surprised", code: "1f62e", criterion: "It found something unexpected: not what the request assumed, or not what it expected to see." },
  { label: "found", code: "1f929", criterion: "It found what it was looking for: the answer, the cause, the missing piece." },
  // the end
  { label: "done", code: "1f60c", criterion: "It has finished and is calm about it: the work is done and it is summing up." },
  { label: "success", code: "1f973", criterion: "It finished and it worked: tests pass, the thing runs, a clear success." },
  { label: "partial", code: "1f972", criterion: "It finished only in part: some of it is done, and something is left or not quite right." },
  { label: "answering", code: "1f642", criterion: "It is simply answering: a plain reply or a quick explanation, with nothing to change." },
  { label: "stopped", code: "1f636", criterion: "It has stopped partway, or has nothing to say." },
];

/** WHAT A CHAT IS ABOUT — the emoji on its name, picked once on the name alone.
 *
 *  A DIFFERENT LIST FROM THE STATUS, because a name is a topic and not a mood:
 *  the mockup draws the name with a topic emoji (🧹 for *Tidy the Boards page*)
 *  and the spec's own figure does the same. The topics are the work this
 *  workspace is for — pages, strategy, prospects, runs, video — each with
 *  animated Noto art; where the obvious emoji has none (📝, 🎨, 🧲, 📰, ⚙️ is
 *  there but four times the weight of any other) the nearest one that does
 *  stands in (✍️, 🌈, 🤝, 📚, 🤖). Nineteen, and `other` falls back to 💬,
 *  the mockup's own fallback: every name Jev answers for wears a face, and a
 *  name with none is a name Jev never answered for. */
export const NAME_FACES: readonly FaceEntry[] = [
  { label: "tidy", code: "1f9f9", criterion: "Tidying up, cleaning, reorganising, or removing what is not needed." },
  { label: "bug", code: "1f41b", criterion: "Fixing a bug, an error or something broken." },
  { label: "investigate", code: "1f50e", criterion: "Finding out why: investigating, or looking into a question." },
  { label: "writing", code: "270d_fe0f", criterion: "Writing or editing words: a doc, a spec, a page, copy or notes." },
  { label: "design", code: "1f308", criterion: "Design: the look of something, colours, a layout, a figure or a drawing." },
  { label: "announce", code: "1f4e3", criterion: "Marketing, social posts, a launch announcement or outreach to many people." },
  { label: "people", code: "1f91d", criterion: "Leads, customers, a partner, a hire, sales, or a meeting with someone." },
  { label: "numbers", code: "1f4ca", criterion: "Numbers: metrics, a report, a table or a chart." },
  { label: "money", code: "1f4b8", criterion: "Money: pricing, costs, invoices or spending." },
  { label: "idea", code: "1f4a1", criterion: "An idea, a brainstorm, a proposal or a plan." },
  { label: "goal", code: "1f3af", criterion: "Goals, strategy, priorities or a decision to make." },
  { label: "digest", code: "1f4da", criterion: "A summary, a digest, a brief, or reading through material." },
  { label: "ship", code: "1f680", criterion: "Shipping: deploying, releasing or launching a build." },
  { label: "automation", code: "1f916", criterion: "Automations, agents, runs, scripts or setup." },
  { label: "build", code: "1f6e0_fe0f", criterion: "Building or changing something: a feature, a tool, code or a page." },
  { label: "polish", code: "2728", criterion: "Improving or polishing something that already works." },
  { label: "urgent", code: "1f6a8", criterion: "Something urgent: an incident, an outage, a fire to put out." },
  { label: "video", code: "1f3ac", criterion: "Video: footage, a recording, editing or other media." },
  { label: "schedule", code: "23f0", criterion: "Time: a schedule, a deadline, a reminder or a timeline." },
];

/** The name's face when Jev answers `other`: talk, which is what a chat is. */
export const NAME_FALLBACK: FaceEntry = { label: "talk", code: "1f4ac", criterion: "A conversation that fits no other topic." };

/** The emoji a Noto code spells: `1f635_200d_1f4ab` is 😵‍💫. Derived rather than
 *  written beside the code, so the character drawn as text and the art drawn
 *  as a picture can never be two different emoji. */
export function emojiOf(code: string): string {
  return String.fromCodePoint(...code.split("_").map((hex) => parseInt(hex, 16)));
}

/** An entry as the contract carries it. */
export function faceOf(entry: FaceEntry): Face {
  return { emoji: emojiOf(entry.code), art: `${NOTO_ROUTE}${entry.code}.webp` };
}

/* ── the engine ─────────────────────────────────────────────────────────── */

/** TypeSafe's Jev, for now. The endpoint can be changed — Kev, the open model
 *  that speaks the same API, on this machine or on an endpoint we host. */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
/** The login-environment variable the key is read from — TypeSafe's SDK's own
 *  name, and the reference client's (`scripts/lib/typesafe.py`). */
export const JEV_KEY_VAR = "TYPESAFE_API_KEY";

/** Retries on a 429, a 5xx or a dropped connection, as the reference client
 *  does: four, backing off from half a second, or the `Retry-After` if longer. */
export const JEV_RETRIES = 4;
const BACKOFF_MS = 500;
/** A `Retry-After` is honoured up to here and no further: the next ask is
 *  thirty seconds away, and an answer later than that is an answer to a
 *  question nobody is asking any more. */
const RETRY_AFTER_CAP_MS = 30_000;
/** One attempt's patience. Jev answers in a few hundred milliseconds. */
const ATTEMPT_MS = 20_000;
/** After the retries are spent, every chat stops asking for this long, so an
 *  outage is one log line and not one per chat every thirty seconds. */
export const JEV_PAUSE_MS = 60_000;
/** The state as sent, at most. Jev takes 32k tokens for the state and the
 *  longest question together; this is well inside that for any text. */
export const JEV_STATE_MAX = 60_000;
const STATE_HEAD = 2_000;

/** What Jev is handed. The network and the clock are injected so no test
 *  reaches either. */
export interface JevDeps {
  fetch: typeof fetch;
  /** The key, read from the login environment each time it is needed; null or
   *  empty turns Jev off. */
  key: () => string | null;
  /** `https:`, or `http:` on this machine only — a bearer key is never sent in
   *  the clear to another host. Anything else turns Jev off. */
  endpoint: string;
  now: () => number;
  /** Where a failure is said, in a sentence of our own. `console.warn`. */
  log?: (line: string) => void;
  /** Wait before a retry, ending early when the signal aborts. A real timer,
   *  cleared on abort. */
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** One attempt's patience, in ms. */
  attemptMs?: number;
}

export interface Jev {
  /** One `choice` question over a turn's state: a face off the list, `other`
   *  (keep the face there is), or null where Jev is off. Never throws; a
   *  failure is logged and answers `other`. An aborted signal answers `other`
   *  at once and stops any retry. */
  classifyTurn(state: string, signal?: AbortSignal): Promise<Face | "other" | null>;
  /** One question on a chat's name alone, asked once when it is named: a face
   *  off the topics, the fallback for `other`, or null where Jev is off or
   *  failed. */
  nameFace(name: string, signal?: AbortSignal): Promise<Face | null>;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The endpoint, if a bearer key may be sent to it. */
function usableEndpoint(endpoint: string): URL | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return url;
  return null;
}

/** A question's criteria: every label with its line, and `other`. */
function criteria(list: readonly FaceEntry[], other: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of list) out[entry.label] = entry.criterion;
  out.other = other;
  return out;
}

const STATUS_QUESTION = {
  type: "choice",
  instructions:
    "An AI agent is working on a person's request. The state is what they asked, then the agent's own words so far, most recent last. " +
    "Pick the face that best shows what the agent makes of the request right now, judging by the most recent part. Answer other if none fits.",
  criteria: criteria(STATUS_FACES, "None of these fits what the agent is doing now."),
};

const NAME_QUESTION = {
  type: "choice",
  instructions: "The state is the name of a chat between a person and an AI agent. Pick the topic the chat is about. Answer other if none fits.",
  criteria: criteria(NAME_FACES, "None of these topics fits the name."),
};

const STATUS_BY_LABEL = new Map(STATUS_FACES.map((entry) => [entry.label, entry]));
const NAME_BY_LABEL = new Map(NAME_FACES.map((entry) => [entry.label, entry]));

/** The state inside Jev's limit: its head, which holds the request, and as
 *  much of its tail, which is the latest, as fits. */
function bounded(state: string): string {
  if (state.length <= JEV_STATE_MAX) return state;
  return `${state.slice(0, STATE_HEAD)}\n…\n${state.slice(state.length - (JEV_STATE_MAX - STATE_HEAD - 3))}`;
}

/** The wait between retries: a real timer, cleared the moment the ask is
 *  abandoned, so a closed chat leaves nothing ticking. */
function realWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done();
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      done();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A `Retry-After` in seconds, as the reference client reads it; a date or
 *  anything else is no advice. */
function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  const secs = raw === null ? NaN : Number(raw);
  return Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, RETRY_AFTER_CAP_MS) : 0;
}

/** One ask's outcome: Jev's label, or no answer — `off` where no call was made
 *  or the key was refused, so the caller knows Jev is off rather than failed. */
type Asked = { ok: true; choice: string | null } | { ok: false; off: boolean };

export function makeJev(deps: JevDeps): Jev {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const wait = deps.wait ?? realWait;
  const attemptMs = deps.attemptMs ?? ATTEMPT_MS;
  const url = usableEndpoint(deps.endpoint);
  let saidEndpoint = false;
  /** The key the API refused, held so the same key is not sent again. It is
   *  compared and never printed. */
  let refusedKey: string | null = null;
  let pausedUntil = 0;

  /** Every line leaves through here. Nothing passed in is built from a body
   *  or an error message, and the key is scrubbed besides. */
  const say = (line: string, key: string | null) => {
    log(key ? line.split(key).join("[key]") : line);
  };

  async function ask(state: string, question: object, signal: AbortSignal | undefined): Promise<Asked> {
    const raw = deps.key();
    const key = raw ? raw.trim() : "";
    if (!key) return { ok: false, off: true };
    if (url === null) {
      if (!saidEndpoint) {
        saidEndpoint = true;
        say("jev: the endpoint is not https (or http on this machine), so Jev is off", key);
      }
      return { ok: false, off: true };
    }
    if (key === refusedKey) return { ok: false, off: true };
    if (deps.now() < pausedUntil) return { ok: false, off: true };
    const stop = signal ?? new AbortController().signal;
    if (stop.aborted) return { ok: false, off: false };

    const body = JSON.stringify({ state: bounded(state), questions: { answer: question }, model: JEV_MODEL });
    let last = "";
    for (let attempt = 0; attempt <= JEV_RETRIES; attempt++) {
      const give = new AbortController();
      const cancel = () => give.abort();
      stop.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(cancel, attemptMs);
      let res: Response | null = null;
      try {
        res = await deps.fetch(url.href, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body,
          // A redirect is refused rather than followed: following one is how a
          // bearer key reaches a host nobody configured.
          redirect: "error",
          signal: give.signal,
        });
      } catch (err) {
        // The message is not read: an error may quote the request. Its name —
        // `TypeError`, `AbortError`, `TimeoutError` — is ours to print.
        last = `unreachable, ${err instanceof Error ? err.name : "error"}`;
      } finally {
        clearTimeout(timer);
        stop.removeEventListener("abort", cancel);
      }
      if (stop.aborted) {
        await res?.body?.cancel().catch(() => {});
        return { ok: false, off: false };
      }

      let delay = BACKOFF_MS * 2 ** attempt;
      if (res !== null) {
        if (res.ok) {
          let got: unknown;
          try {
            got = await res.json();
          } catch {
            say(`jev: ${url.host} answered ${res.status} with something that is not JSON`, key);
            return { ok: false, off: false };
          }
          const answer = (got as { answers?: { answer?: { choice?: unknown } } } | null)?.answers?.answer;
          return { ok: true, choice: typeof answer?.choice === "string" ? answer.choice : null };
        }
        // The body is drained and never read: it may echo the request, and a
        // refusal's words are the API's to say, not ours to log.
        await res.body?.cancel().catch(() => {});
        if (res.status === 401 || res.status === 403) {
          refusedKey = key;
          say(`jev: ${url.host} refused the key (${res.status}), so Jev is off until the key changes`, key);
          return { ok: false, off: true };
        }
        if (res.status !== 429 && res.status < 500) {
          say(`jev: ${url.host} refused the question (${res.status})`, key);
          return { ok: false, off: false };
        }
        last = String(res.status);
        delay = Math.max(delay, retryAfterMs(res));
      }
      if (attempt < JEV_RETRIES) {
        await wait(delay, stop);
        if (stop.aborted) return { ok: false, off: false };
      }
    }
    pausedUntil = deps.now() + JEV_PAUSE_MS;
    say(`jev: ${url.host} did not answer after ${JEV_RETRIES} retries (${last}); asking again in ${JEV_PAUSE_MS / 1000} s`, key);
    return { ok: false, off: false };
  }

  return {
    async classifyTurn(state, signal) {
      if (!state.trim()) return "other";
      const got = await ask(state, STATUS_QUESTION, signal);
      if (!got.ok) return got.off ? null : "other";
      if (got.choice === "other") return "other";
      const entry = got.choice === null ? undefined : STATUS_BY_LABEL.get(got.choice);
      if (!entry) {
        say("jev: an answer off the list, kept as other", null);
        return "other";
      }
      return faceOf(entry);
    },

    async nameFace(name, signal) {
      const words = name.trim();
      if (!words) return null;
      const got = await ask(words, NAME_QUESTION, signal);
      if (!got.ok) return null;
      const entry = got.choice === null ? undefined : NAME_BY_LABEL.get(got.choice);
      if (entry) return faceOf(entry);
      if (got.choice !== "other") say("jev: a topic off the list, named as talk", null);
      return faceOf(NAME_FALLBACK);
    },
  };
}

/* ── the schedule ───────────────────────────────────────────────────────── */

/** WHAT A TURN SAYS, as the chats module emits it: its start with the person's
 *  message, each chunk of thinking and reply, each tool call's title — once per
 *  call, not per update — and its end. */
export type TurnSignal =
  | { kind: "start"; chat: ChatId; turn: number; text: string }
  | { kind: "thought"; chat: ChatId; turn: number; text: string }
  | { kind: "reply"; chat: ChatId; turn: number; text: string }
  | { kind: "tool"; chat: ChatId; turn: number; text: string }
  | { kind: "end"; chat: ChatId; turn: number };

/** The schedule's clock, injected so a ninety-second turn runs in none. */
export interface JevClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** The clock the running server hands the schedule. */
export const SYSTEM_CLOCK: JevClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A MOMENT TO ASK: the schedule has reached 10 s, the next 30 s, or the
 *  turn's end, and this is the state gathered so far. Whoever listens asks
 *  `classifyTurn` and flips the face only when the answer changed —
 *  `makeJevStatus` is that listener. */
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
  /** Cancel every timer — the chat closed. Nothing is heard after. */
  stop(): void;
}

export const JEV_FIRST_MS = 10_000;
export const JEV_EVERY_MS = 30_000;
/** How much of the person's message leads the state, and how much of the
 *  agent's latest words follow it. The tail is what is judged; the rest of a
 *  long turn is let go rather than held for its whole length. */
const REQUEST_KEEP = 2_000;
export const JEV_STREAM_KEEP = 24_000;

/** The last `keep` characters of a stream, held in amortised constant space. */
class Tail {
  private text = "";
  constructor(private readonly keep: number) {}
  push(more: string): void {
    this.text += more;
    if (this.text.length > this.keep * 2) this.text = this.text.slice(-this.keep);
  }
  get value(): string {
    return this.text.length > this.keep ? this.text.slice(-this.keep) : this.text;
  }
  get empty(): boolean {
    return this.text.trim() === "";
  }
}

export function makeJevTurn(
  listener: (moment: JevMoment) => void,
  clock: JevClock,
  log: (line: string) => void = (line) => console.warn(line),
): JevTurn {
  let stopped = false;
  let chat: ChatId | null = null;
  let turn: number | null = null;
  let startedAt = 0;
  let asks = 0;
  let timer: unknown = null;
  let request = "";
  let thought = new Tail(JEV_STREAM_KEEP);
  let said = new Tail(JEV_STREAM_KEEP);
  let lastTool = "";
  let lastAsked = "";

  const disarm = () => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  };

  /** THE STATE: what the person asked, then the agent's thinking — or, for an
   *  agent that streams none, its reply and its tool calls. Null while the
   *  agent has said nothing, which keeps the loader up rather than asking Jev
   *  to guess from the request alone. */
  const state = (): string | null => {
    if (!thought.empty) return `What the person asked:\n${request}\n\nThe agent's thinking so far, most recent last:\n${thought.value}`;
    if (!said.empty) return `What the person asked:\n${request}\n\nThe agent's reply and the tools it called so far, most recent last:\n${said.value}`;
    return null;
  };

  /** Ask, unless the agent has said nothing, or nothing since the last ask —
   *  the same state is the same answer, and the face would not move. */
  const ask = (final: boolean) => {
    if (chat === null || turn === null) return;
    const now = state();
    if (now === null || now === lastAsked) return;
    lastAsked = now;
    // A throw from the listener is said here and goes no further: this runs
    // in a timer's callback, or in the chats module's own emit, and a fault in
    // the listener must stop neither.
    try {
      listener({ chat, turn, state: now, final });
    } catch (err) {
      log(`jev: asking about a turn failed (${err instanceof Error ? err.name : "error"})`);
    }
  };

  const tick = () => {
    timer = null;
    if (stopped || turn === null) return;
    asks++;
    // Re-armed before asking, and from the turn's start rather than from now,
    // so a slow listener does not drift the schedule.
    timer = clock.setTimer(tick, Math.max(0, startedAt + JEV_FIRST_MS + asks * JEV_EVERY_MS - clock.now()));
    ask(false);
  };

  const forget = () => {
    turn = null;
    request = "";
    thought = new Tail(JEV_STREAM_KEEP);
    said = new Tail(JEV_STREAM_KEEP);
    lastTool = "";
    lastAsked = "";
  };

  return {
    signal(s) {
      if (stopped) return;
      if (s.kind === "start") {
        // One chat's schedule: another chat's start is not this one's.
        if (chat !== null && s.chat !== chat) return;
        disarm();
        forget();
        chat = s.chat;
        turn = s.turn;
        request = s.text.length > REQUEST_KEEP ? `${s.text.slice(0, REQUEST_KEEP)}…` : s.text;
        startedAt = clock.now();
        asks = 0;
        timer = clock.setTimer(tick, JEV_FIRST_MS);
        return;
      }
      if (s.chat !== chat || s.turn !== turn) return;
      switch (s.kind) {
        case "thought":
          thought.push(s.text);
          return;
        case "reply":
          said.push(s.text);
          lastTool = "";
          return;
        case "tool": {
          const title = s.text.trim();
          if (!title || title === lastTool) return;
          lastTool = title;
          said.push(`\n[${title}]\n`);
          return;
        }
        case "end":
          disarm();
          ask(true);
          forget();
          return;
      }
    },
    stop() {
      stopped = true;
      disarm();
      forget();
    },
  };
}

/* ── the loop ───────────────────────────────────────────────────────────── */

/** What the loop is handed: Jev, the clock, and where a face goes —
 *  `Chats.face`, which pushes it to every window. */
export interface JevStatusDeps {
  jev: Jev;
  clock: JevClock;
  face: (chat: ChatId, turn: number | null, face: Face) => void;
  /** Where a face that could not be set is said. `console.warn`. */
  log?: (line: string) => void;
}

/** EVERY CHAT'S STATUS AND NAME, for one vault. */
export interface JevStatus {
  /** Hear a turn's signal — `ChatsDeps.onTurn`. */
  signal(signal: TurnSignal): void;
  /** A chat was named: ask once for its face. Later calls for the same chat
   *  are ignored, so a `name` update that carries the face back is harmless. */
  named(chat: ChatId, name: string): void;
  /** The chat closed: its timers are cancelled, any ask in flight abandoned,
   *  and a late answer is dropped. */
  close(chat: ChatId): void;
  /** Every chat — the vault closed or the server is exiting. */
  stop(): void;
}

/** One turn's face as the loop last set it, and how many asks were issued and
 *  which was the latest answered. */
interface TurnFace {
  emoji: string | null;
  issued: number;
  settled: number;
}

interface ChatStatus {
  schedule: JevTurn;
  abort: AbortController;
  turns: Map<number, TurnFace>;
  named: boolean;
}

export function makeJevStatus(deps: JevStatusDeps): JevStatus {
  const log = deps.log ?? ((line: string) => console.warn(line));
  const chats = new Map<ChatId, ChatStatus>();

  /** A face handed on, and a throw from the receiver kept here: this runs in
   *  a promise's callback, where an uncaught throw is an unhandled rejection. */
  const put = (chat: ChatId, turn: number | null, face: Face) => {
    try {
      deps.face(chat, turn, face);
    } catch (err) {
      log(`jev: a face could not be set on a chat (${err instanceof Error ? err.name : "error"})`);
    }
  };

  const hear = (moment: JevMoment) => {
    const rec = chats.get(moment.chat);
    if (!rec) return;
    let face = rec.turns.get(moment.turn);
    if (!face) rec.turns.set(moment.turn, (face = { emoji: null, issued: 0, settled: 0 }));
    const t = face;
    const seq = ++t.issued;
    deps.jev.classifyTurn(moment.state, rec.abort.signal).then(
      (answer) => {
        // A closed chat — or one closed and opened again since — is not
        // written to.
        if (chats.get(moment.chat) !== rec) return;
        // An answer to an earlier question, arriving after a later one was
        // answered, is stale whatever it says; the later one, `other`
        // included, is the newer judgement.
        if (seq <= t.settled) return;
        t.settled = seq;
        if (answer === null || answer === "other" || answer.emoji === t.emoji) return;
        t.emoji = answer.emoji;
        put(moment.chat, moment.turn, answer);
      },
      () => {},
    );
  };

  const open = (chat: ChatId): ChatStatus => {
    let rec = chats.get(chat);
    if (!rec) {
      rec = { schedule: makeJevTurn(hear, deps.clock, log), abort: new AbortController(), turns: new Map(), named: false };
      chats.set(chat, rec);
    }
    return rec;
  };

  const close = (chat: ChatId) => {
    const rec = chats.get(chat);
    if (!rec) return;
    chats.delete(chat);
    rec.schedule.stop();
    rec.abort.abort();
  };

  return {
    signal(s) {
      // Only a start opens a chat: a stray signal after a close must not bring
      // one back.
      const rec = s.kind === "start" ? open(s.chat) : chats.get(s.chat);
      if (!rec) return;
      if (s.kind === "start") {
        rec.turns.set(s.turn, { emoji: null, issued: 0, settled: 0 });
        // A turn's late answers still land on its own message, and the one
        // before it may still be answering its end; older turns are let go.
        for (const n of rec.turns.keys()) if (n < s.turn - 1) rec.turns.delete(n);
      }
      rec.schedule.signal(s);
    },
    named(chat, name) {
      const rec = open(chat);
      if (rec.named) return;
      rec.named = true;
      deps.jev.nameFace(name, rec.abort.signal).then(
        (face) => {
          if (face !== null && chats.get(chat) === rec) put(chat, null, face);
        },
        () => {},
      );
    },
    close,
    stop() {
      for (const chat of [...chats.keys()]) close(chat);
    },
  };
}
