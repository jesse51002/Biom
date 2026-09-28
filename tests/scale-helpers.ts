// SPDX-License-Identifier: AGPL-3.0-only
// THE TWO INSTRUMENTS THE SCALE WORK IS HELD WITH — not a test file, a helper
// the tracks' tests import (named without `.test.` so `bun test` walks past it).
//
// The twelfth contracts edit's rule is that nothing on the path to what is on
// screen reads or parses every page. Two instruments make that checkable
// without timing anything:
//
//   - A PARSE BUDGET: `countingYaml` wraps the real codec and counts every
//     `parse` — hand it to `makePages`, the index or a mount, do one thing, and
//     assert the count. A level is one parse (its parent), a head is none, and
//     nothing is proportional to the workspace.
//   - A SPY TRANSPORT: `spyTransport` records every `ApiRequest` a store or a
//     view sends, answering from a function the test gives it, and
//     `wholeTreeReads` picks out the kinds no screen of the framework's may
//     ask any more — `page.list` and `children.all`.

import type { ApiRequest, ApiResponse, Transport, YamlCodec } from "../contracts/types.ts";

/** A codec that counts its parses and otherwise is the one it wraps. */
export function countingYaml(base: YamlCodec): { yaml: YamlCodec; parses: () => number; reset: () => void } {
  let n = 0;
  const yaml: YamlCodec = {
    parse(text) {
      n++;
      return base.parse(text);
    },
    parseAny(text) {
      n++;
      return base.parseAny(text);
    },
    format: (doc) => base.format(doc),
  };
  // The codec in `server/platform/yaml.ts` carries `formatAny` beside the
  // contract's three; keep it where it is there.
  const extra = base as YamlCodec & { formatAny?: (v: unknown) => string };
  if (typeof extra.formatAny === "function") Object.assign(yaml, { formatAny: extra.formatAny });
  return { yaml, parses: () => n, reset: () => { n = 0; } };
}

/** THE KINDS NO SCREEN OF THE FRAMEWORK'S MAY ASK SINCE THE TWELFTH EDIT: each
 *  answers every page in the workspace. They stay on the wire for agents, runs
 *  and a box that asks for everything. */
export const WHOLE_TREE_KINDS: readonly string[] = Object.freeze(["page.list", "children.all"]);

/** The requests in `calls` that ask for the whole tree. */
export const wholeTreeReads = (calls: readonly ApiRequest[]): ApiRequest[] =>
  calls.filter((c) => WHOLE_TREE_KINDS.includes(c.kind));

/**
 * A transport that records what it is asked and answers with `answer` — a
 * value, which is wrapped as a success, or a whole `ApiResponse`. The default
 * answers `null` to everything.
 */
export function spyTransport(
  answer: (req: ApiRequest) => unknown | Promise<unknown> = () => null,
): Transport & { calls: ApiRequest[]; kinds: () => string[]; clear: () => void } {
  const calls: ApiRequest[] = [];
  return {
    calls,
    kinds: () => calls.map((c) => c.kind),
    clear: () => { calls.length = 0; },
    async call(req) {
      calls.push(req);
      const out = await answer(req);
      if (typeof out === "object" && out !== null && "ok" in out && "id" in out) return out as ApiResponse;
      return { id: req.id, g: req.g, ok: true, value: out };
    },
  };
}
