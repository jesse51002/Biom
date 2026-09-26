// SPDX-License-Identifier: AGPL-3.0-only
// THE FRAMEWORK'S SCREENS ARE NOT PAGES — `server/domain/pages.ts` and
// `server/domain/docs.ts`, for the eleventh contracts edit's `@agent`.
//
// `@agent` is the Agent screen, answered as a bare plugin page with no
// directory, beside `@map`. Nothing may be written to either: not a slot
// (`section.write`), the order (`section.order`), a section's removal
// (`section.remove`), a file (`page.writeFile`), the variables
// (`variables.patch`), the raw document (`doc.writeRaw`) — and neither may be
// created under, removed, moved, moved under or renamed. Each wire kind is
// walked here at the domain call it becomes. The reserved ids are checked
// against the server's own page-segment grammar, never a copy of it. The vault
// is a temporary folder and its one page is invented.

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeFiles } from "../server/platform/files.ts";
import { parse, parseAny, format, formatAny } from "../server/platform/yaml.ts";
import { SEGMENT, makePages, pageDir } from "../server/domain/pages.ts";
import { makeDocs } from "../server/domain/docs.ts";
import { AGENT_PAGE, DESIGN_PAGE, MAP_PAGE } from "../contracts/wire.js";

const yaml = { parse, parseAny, format, formatAny };
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "biom-reserved-"));
  await mkdir(join(root, "pages/home"), { recursive: true });
  await writeFile(join(root, "pages/home/content.yaml"), "name: Home\nuid: h0meinvented01\nplugin: biom-doc\ncontents: []\n");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

/** Whether a call was refused as a request, not as a missing page. */
async function refused(what: () => Promise<unknown>): Promise<string> {
  try {
    await what();
  } catch (e) {
    return (e as { code?: string }).code ?? "thrown";
  }
  return "answered";
}

test("no framework screen can be a page a person makes: `@` is outside the server's own segment grammar", () => {
  for (const id of [AGENT_PAGE, MAP_PAGE, DESIGN_PAGE]) expect([id, SEGMENT.test(id)]).toEqual([id, false]);
  // And the address of one is no directory, except the design doc, which is
  // a page that lives somewhere else.
  expect(() => pageDir(AGENT_PAGE)).toThrow(/framework's screens/);
  expect(() => pageDir(MAP_PAGE)).toThrow(/framework's screens/);
  expect(pageDir(DESIGN_PAGE)).toBe("design");
});

test("EVERY WRITE TO THE AGENT SCREEN IS REFUSED, whichever kind asks", async () => {
  const files = makeFiles(root);
  const pages = makePages(files, yaml);
  const docs = makeDocs(files, yaml);
  for (const id of [AGENT_PAGE, MAP_PAGE]) {
    const cases: [string, () => Promise<unknown>][] = [
      ["section.write", () => pages.writeSlot(id, null, "body", "words")],
      ["section.order", () => pages.setSections(id, [])],
      ["section.remove", () => pages.removeSection(id, "intro")],
      ["page.writeFile", () => pages.writeFile(id, "index.html", "<main></main>")],
      ["variables.patch", () => docs.merge(id, null, { title: "x" })],
      ["doc.writeRaw", () => docs.writeRaw(id, "name: Agent\nplugin: biom-agent\n")],
      ["page.create under it", () => pages.create({ name: "Inside", parent: id })],
      ["page.remove", () => pages.remove(id)],
      ["page.move it", () => pages.move(id, "home")],
      ["page.move under it", () => pages.move("home/nothing", id)],
      ["page.rename", () => pages.rename(id, "Chats")],
    ];
    for (const [kind, call] of cases) expect([id, kind, await refused(call)]).toEqual([id, kind, "bad_request"]);
  }
});
