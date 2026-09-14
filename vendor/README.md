Third-party code, served as it sits and never edited.

| | version | which upstream build, and why that one |
|---|---|---|
| `markdown-it.mjs` | 15.0.0 | `dist/browser/markdown-it.esm.min.mjs` — SELF-CONTAINED |
| `markdown-it.min.js` | 15.0.0 | `dist/browser/markdown-it.umd.min.js` — the UMD build, for a frame |
| `markdown-it.d.mts` | — | ours, hand-written, deliberately partial |
| `mermaid.min.js` | 11.16.1 | `dist/mermaid.min.js` — the IIFE build |
| `three.min.js` | 0.180.0 | BUILT here — upstream ships no classic build any more |
| `yaml.mjs` | 2.9.0 | `browser/` — a TREE upstream, bundled here into one file |
| `yaml.d.ts` | — | ours, hand-written, deliberately partial. `.d.ts`, NOT `.d.mts` |

**`three` ships no classic build at all, so this one was built rather than copied.**
Upstream dropped its UMD bundle years ago and now publishes ESM and CJS only —
and **a module script does not load at an opaque origin**, which is the one thing
a page box is. So the ES module was wrapped in three lines that put it on the
global and bundled as an IIFE, with nothing patched:

```
npm pack three@0.180.0 && tar xzf three-0.180.0.tgz
printf 'import * as THREE from "./package/build/three.module.js";\nglobalThis.THREE = THREE;\n' > entry.js
bun build entry.js --format=iife --target=browser --minify --outfile=vendor/three.min.js
```

706KB, one file, no dependencies, `window.THREE` when it has run.

**IT WAS VERIFIED IN A BROWSER, INSIDE THE BOX, and the measurement is the whole
reason to trust it.** From a section's own realm on a real page: `location.origin`
is `"null"`, `fetch("/vendor/three.min.js")` is REFUSED, a classic
`<script src="/vendor/three.min.js">` LOADS, `THREE.REVISION` reads `180`, a
`WebGLRenderer` constructs and `render()` puts real pixels on a canvas. That is
the asymmetry the boundary is built on — the box may RUN host-served code and may
not READ anything back — and it is checked rather than assumed, because `tsc` and
`bun` resolve through `paths` and a browser resolves through the import map, and
only one of those is the product.

**It is 706KB, so it is loaded ON DEMAND and never otherwise.** A page with no WebGL on it must not pay for this file, and a page that has one
must still draw its words if the load fails or the machine has no GPU.

**`yaml` ships no single file, so this one was built rather than copied.**
Upstream's package is 74 ES modules under `browser/` and 74 more under `dist/`;
there is no `yaml.min.mjs` to take. The `browser/` half is the one with no node
built-ins in it — checked, not assumed — so it is the half that was bundled,
entry point and all, with nothing patched:

```
npm pack yaml@2.9.0 && tar xzf yaml-2.9.0.tgz
bun build package/browser/index.js --format=esm --target=browser --minify --outfile=vendor/yaml.mjs
```

106KB, one file, no dependencies. **A bundle is not a patch** — every byte in it
is upstream's, and the command above reproduces it — but it is the one file here
that is not a straight copy, so it says so rather than looking like one.

**`yaml` is reached through `tsconfig` `paths` and nothing else.** Only the
SERVER parses: the client is handed `Page` as JSON and never sees YAML. So
unlike `markdown-it` there is no import map entry in `client/index.html` and no
browser to verify it in — bun resolves it at runtime and tsc resolves it to
typecheck, and those are the only two readers there are.

**The declaration is `yaml.d.ts` and the extension is load-bearing.** An
extensionless specifier gives TypeScript five candidates — `.ts`, `.tsx`,
`.d.ts`, `.js`, `.jsx` — and **`.d.mts` is not one of them**, so a `.d.mts`
beside the bundle is never found and the import simply does not resolve. From a
`.js` importer that failure is SILENT; from a `.ts` importer it is `TS2307`.
**`markdown-it.d.mts` has this bug right now** and gets away with it only
because its one importer is `client/platform/markdown.js`, so `markdown-it` is
an implicit `any` rather than the typed surface that file was written against.
The two extensions have to disagree, and they do: bun's own candidate list has
`.mjs` and not `.d.ts`, so bun reaches the bundle by the same bare name that
tsc uses to reach the declaration.

**What it is used for, and what it is not.** `server/platform/yaml.ts` reads and
writes `content.yaml`, which holds a whole page including its prose. Markdown
comes back out as a block scalar rather than a quoted line, because a person
opens that file. The one upstream behaviour worth knowing is that this version
writes U+2028 and U+2029 raw; the codec's header says why that is recorded
rather than worked around, and a test pins it so a version bump is visible.

**Take the browser build, not the Node one.** `dist/markdown-it.mjs` looks right
and is not: its first five lines import `mdurl`, `uc.micro`, `entities`,
`linkify-it` and `punycode.js`, so no browser can load it and vendoring it would
mean vendoring a dependency tree. This mistake was made once here, and it passed
`tsc` and `bun test` while being unloadable in a browser — because those two
resolve through `tsconfig` `paths` and the browser resolves through the import
map. **Different mechanisms. Only one of them is the product.** Check a vendored
file in a browser, not in a test runner.

**markdown-it is vendored TWICE, and the second copy is not a duplicate.**
`markdown-it.mjs` is the ESM build the HOST uses through the import map;
`markdown-it.min.js` is the UMD build an ARTIFACT uses from inside its frame.
The frame has an opaque origin, so the same rule that forces `mermaid.min.js` to
be the IIFE build forces this: a CLASSIC `<script src>` loads there, a MODULE one
is CORS-gated and blocked, and `fetch` is blocked too — so the `.mjs` cannot be
reached from in there at all. Both are the same upstream 15.0.0 and must stay
that way, because host and guest render the same markdown and may not disagree
about it. **Update them together or not at all.**

**The UMD build carries no version banner, so the record is its hash.** The
`.mjs` says `markdown-it 15.0.0` on its first line and a test reads it back;
`dist/browser/markdown-it.umd.min.js` starts straight in on the wrapper and says
nothing about itself. What was checked instead, at vendoring time, is that the
`.mjs` beside it is byte-identical to the one already here — same tarball, same
version — and the copy's own hash was written down:

```
npm pack markdown-it@15.0.0 && tar xzf markdown-it-15.0.0.tgz
sha256  dist/browser/markdown-it.esm.min.mjs  eb0a6cb2beb08326ea4d3e0e3b25ac72c1e6f119a619d9bbe061e72000ffa118  (== markdown-it.mjs on disk)
sha256  dist/browser/markdown-it.umd.min.js   8d0f6aca8f4de3321b6d07e03286176c59ec19b7b84abb6eb31f0fa795e83abc  (== markdown-it.min.js on disk)
```

**And it was checked in a browser, which is the only check that counts here.**
Headless Chrome, an iframe with `sandbox="allow-scripts"` and no
`allow-same-origin`, a classic `<script src>` at the file and the result posted
back out: `location.origin` was `"null"`, `typeof window.markdownit` was
`"function"`, and `markdownit().render("# hi")` came back `"<h1>hi</h1>\n"`. The
control ran in the same frame — a MODULE `<script src>` at `markdown-it.mjs`
failed with *blocked by CORS policy: ... from origin 'null'*, which is the whole
reason the UMD copy exists.

**The UMD copy is reached by absolute URL, not by the import map.** It is
`/vendor/markdown-it.min.js` written out in full by whoever builds the frame's
HTML — an artifact's document is `srcdoc` in an opaque origin and has no import
map of its own, and adding an entry to the host's would do nothing for it. So
there is no second line in `client/index.html`, and the bare-specifier story
below is unchanged.

**The `.d.mts` is ours and covers only what we call.** Upstream's own
declarations import those same three packages, so they are no more usable than
the Node bundle. Reaching for a markdown-it method that is not declared is the
signal to add it deliberately — not to widen the file to `any`.

**One `markdown-it.LICENSE` covers both markdown-it files.** It is upstream's
`LICENSE` verbatim — one MIT notice for the whole package, not a per-build one —
so a second copy beside the UMD file would be the same bytes under a different
name. Verified against the 15.0.0 tarball: identical.

**Nothing here is modified, ever.** A patched vendor file is a fork nobody
remembers making. If one needs changing, wrap it in `client/` instead.

**`markdown-it` is reached through an import map**, declared in
`client/index.html`. That keeps `import MarkdownIt from "markdown-it"` a BARE
specifier, which `tools/layers.mjs` already skips as a package — so vendoring
cost the layering rule nothing and there is no new edge in the graph. `bun` and
`tsc` resolve the same specifier through `paths` in `tsconfig.json`, pointed at
`./vendor/markdown-it` **without an extension**: naming the `.mjs` exactly makes
TypeScript typecheck 800 lines of minified bundle instead of reading the
declaration beside it.

**`mermaid.min.js` is SERVED BUT NOT SHIPPED, and that distinction is the whole
of its place here now.** No plugin in `guest/plugins/` draws a mermaid diagram
any more and a fresh vault gets none: the whole point of this format is a custom
drawing, so a figure is an inline `<svg>` a section writes and a diagram is that
same drawing of relationships — `vault/.agents/skills/diagrams/SKILL.md`. What
stays is the route. A workspace that carries its own `plugins/mermaid.js` — a
vault owns every plugin it draws with, and a copy of a retired one is still a
copy it owns — reaches this file exactly as any section reaches `three`, and
nothing in the framework has to know. Deleting it would break those vaults
silently, which is the one thing `/vendor/` exists to avoid.

**It is the IIFE build, and it has to be.** A sandboxed frame has an opaque
origin: a MODULE `<script src>` is CORS-gated and blocked, while a CLASSIC one
loads. Measured, not assumed — see `tests/vendor.test.ts`. The ESM builds
shipped alongside it (`mermaid.esm.mjs`, `mermaid.core.mjs`) cannot be loaded
from an artifact and are deliberately not vendored.

**Why serving beats bundling here.** `client/` is plain JavaScript a browser
loads directly, and a transpile step between *Claude Code writes the file* and
*you press reload* breaks the loop this instrument exists to demonstrate. A
served file keeps that true. It also means only the pages that want a diagram
pay for one, and the browser caches it across every frame on the page.

To update one: `npm pack <name>@<version>`, copy the same dist file out, update
the version above, and run the tests. Do not add a dependency to
`package.json` — the framework has no runtime dependencies, and what that file declares is build and test tooling.
