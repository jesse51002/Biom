// SPDX-License-Identifier: AGPL-3.0-only
// THE FORMAT 5 CONVERTER, run as the command it is. It names the framework's
// plugins by their folders across a whole workspace — `plugin: doc` on a page,
// `data-g-plugin="reveal"` in a section, in a page's own document, in a plugin
// document of the vault's own — leaves every bare word the workspace owns
// exactly alone, reports a `ctx.use("items")` in code rather than editing it,
// and is idempotent. What it wrote is what the format gate then opens.

import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkVaultFormat } from "../server/workspace/migrate.ts";
import { walkPlugins } from "../server/domain/plugins.ts";
import { makeFiles } from "../server/platform/files.ts";

const HERE = join(import.meta.dir, "..");

const put = (root: string, rel: string, text: string): void => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text, "utf8");
};

/** The tool, as a person runs it. */
async function convert(root: string): Promise<string> {
  const ps = Bun.spawn(["bun", "run", join(HERE, "tools", "migrate-format-5.ts"), root], {
    cwd: HERE, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, BIOM_NO_UPDATE_CHECK: "1" },
  });
  const out = await new Response(ps.stdout).text();
  const err = await new Response(ps.stderr).text();
  expect([await ps.exited, err]).toEqual([0, ""]);
  return out;
}

test("the converter rewrites every bare framework name, leaves the workspace's own alone, names code, and the gate then opens the vault", async () => {
  const root = mkdtempSync(join(tmpdir(), "biom-format5-"));
  try {
    put(root, "theme.json", "{}");
    put(root, "pages/home/content.yaml", "name: Home\nuid: abcdefgh\nplugin: doc\nvariables:\n  x: 1\ncontents: []\n");
    put(root, "pages/home/children/Notes/content.yaml", "name: Notes\nplugin: doc\ncontents:\n  - name: hero\n    data: hero.html\n    parts:\n      body: words\n");
    put(root, "pages/home/children/Notes/hero.html",
      '<section data-g-part="body"></section>\n<span data-g-plugin="reveal"></span>\n<span data-g-plugin="items" data-g-for="body"></span>\n<span data-g-plugin="cards"></span>\n');
    put(root, "pages/home/children/Notes/child.html", '<div data-g-plugin="inview"></div>\n');
    put(root, "pages/home/children/Board/content.yaml", "name: Board\nplugin: kanban\ninput:\n  table: jobs\n");
    put(root, "pages/home/children/Own/content.yaml", "name: Own\nplugin: html\n");
    put(root, "pages/home/children/Own/index.html", '<div data-g-part="body"></div><span data-g-plugin="checklist" data-g-for="body"></span>\n');
    // The workspace's own `digest`, and its own `reveal` beside one page.
    put(root, "pages/home/children/Digest/content.yaml", "name: Digest\nplugin: digest\n");
    put(root, "plugins/digest/index.html", '<main><span data-g-plugin="open-list" data-g-for="q"></span><span data-g-plugin="digest"></span></main>');
    put(root, "plugins/digest/digest.js", 'biom.plugins.register({ id: "digest", mount(node, c, ctx) { ctx.use("items"); ctx.use("digest"); } });\n');
    put(root, "pages/home/children/Mine/content.yaml", "name: Mine\nplugin: doc\ncontents:\n  - name: a\n    data: a.html\n    parts:\n      body: x\n");
    put(root, "pages/home/children/Mine/a.html", '<span data-g-plugin="reveal"></span>\n');
    put(root, "pages/home/children/Mine/plugins/reveal/reveal.js", "");
    put(root, "design/content.yaml", "name: Design\nplugin: doc\ncontents: []\n");
    put(root, "base/figure/content.yaml", "name: Figure\nplugin: doc\ncontents: []\n");
    put(root, "base/figure/index.html", '<span data-g-plugin="reveal"></span>\n');

    const shipped = new Map((await walkPlugins(makeFiles(join(HERE, "guest", "plugins")), "", "framework")).folders.map((f) => [f.id, f.document]));
    await expect(checkVaultFormat(root, shipped)).rejects.toThrow(/vault format 4/);

    const out = await convert(root);

    // Every word, one line each, and nothing else on the file moved.
    expect(readFileSync(join(root, "pages/home/content.yaml"), "utf8")).toBe("name: Home\nuid: abcdefgh\nplugin: biom-doc\nvariables:\n  x: 1\ncontents: []\n");
    expect(readFileSync(join(root, "pages/home/children/Notes/hero.html"), "utf8")).toBe(
      '<section data-g-part="body"></section>\n<span data-g-plugin="biom-reveal"></span>\n<span data-g-plugin="biom-items" data-g-for="body"></span>\n<span data-g-plugin="cards"></span>\n');
    expect(readFileSync(join(root, "pages/home/children/Notes/child.html"), "utf8")).toBe('<div data-g-plugin="biom-inview"></div>\n');
    expect(readFileSync(join(root, "pages/home/children/Board/content.yaml"), "utf8")).toContain("plugin: biom-kanban\n");
    // The page's own document is the page's markup too.
    expect(readFileSync(join(root, "pages/home/children/Own/index.html"), "utf8")).toContain('data-g-plugin="biom-checklist"');
    // `html` is the page's own document and stays.
    expect(readFileSync(join(root, "pages/home/children/Own/content.yaml"), "utf8")).toBe("name: Own\nplugin: html\n");
    // The workspace's own stays its own, on the page and in its document; the
    // framework's slot plugin in that document is still rewritten.
    expect(readFileSync(join(root, "pages/home/children/Digest/content.yaml"), "utf8")).toBe("name: Digest\nplugin: digest\n");
    expect(readFileSync(join(root, "plugins/digest/index.html"), "utf8")).toBe('<main><span data-g-plugin="biom-open-list" data-g-for="q"></span><span data-g-plugin="digest"></span></main>');
    // A page's own plugin folder makes the word that page's.
    expect(readFileSync(join(root, "pages/home/children/Mine/a.html"), "utf8")).toBe('<span data-g-plugin="reveal"></span>\n');
    // The design doc and the bundled blocks are pages for this too.
    expect(readFileSync(join(root, "design/content.yaml"), "utf8")).toContain("plugin: biom-doc\n");
    expect(readFileSync(join(root, "base/figure/index.html"), "utf8")).toBe('<span data-g-plugin="biom-reveal"></span>\n');
    // Code is named, never edited.
    expect(readFileSync(join(root, "plugins/digest/digest.js"), "utf8")).toContain('ctx.use("items")');
    expect(out).toContain('plugins/digest/digest.js:1 reaches "items" from code');
    expect(out).not.toContain('reaches "digest"');

    // The vault opens now — and the tool has nothing left to do.
    await expect(checkVaultFormat(root, shipped)).resolves.toBeUndefined();
    const again = await convert(root);
    expect(again).toContain("0 words in 0 files");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
