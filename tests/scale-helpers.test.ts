// SPDX-License-Identifier: AGPL-3.0-only
// The scale instruments hold what they say, so a track's budget that passes
// passes because the code is cheap and not because the counter is broken. And
// one pin that already holds at the barrier: the page kinds are not whole-tree
// reads. Every page here is invented.

import { test, expect } from "bun:test";

import { countingYaml, spyTransport, wholeTreeReads, WHOLE_TREE_KINDS } from "./scale-helpers.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { PROTOCOL } from "../contracts/wire.js";
import type { ApiRequest } from "../contracts/types.ts";

test("the counting codec counts every parse and is otherwise the real one", () => {
  const { yaml, parses, reset } = countingYaml({ parse, parseAny, format, formatAny } as never);
  const doc = yaml.parse("name: Notes\nplugin: biom-doc\ncontents: []\n");
  expect(doc.name).toBe("Notes");
  yaml.parseAny("a: 1\n");
  expect(parses()).toBe(2);
  yaml.format(doc);
  expect(parses()).toBe(2);
  reset();
  expect(parses()).toBe(0);
  expect(typeof (yaml as unknown as { formatAny: unknown }).formatAny).toBe("function");
});

test("the spy transport records every request, answers what it is told, and picks out the whole-tree reads", async () => {
  const spy = spyTransport((req) => (req.kind === "children" ? [] : null));
  const ask = (kind: string, rest: Record<string, unknown> = {}) =>
    spy.call({ id: "c" + spy.calls.length, g: PROTOCOL, kind, ...rest } as unknown as ApiRequest);
  expect((await ask("children", { page: "home" })).ok).toBe(true);
  await ask("page.list");
  await ask("children.all");
  await ask("page.locate", { ids: ["home"] });
  await ask("page.search", { query: "notes" });
  expect(spy.kinds()).toEqual(["children", "page.list", "children.all", "page.locate", "page.search"]);
  expect(wholeTreeReads(spy.calls).map((c) => c.kind)).toEqual(["page.list", "children.all"]);
  expect(WHOLE_TREE_KINDS).toEqual(["page.list", "children.all"]);
  spy.clear();
  expect(spy.calls).toEqual([]);
});
