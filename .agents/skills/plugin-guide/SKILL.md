---
name: plugin-guide
description: >-
  The single source of truth for PLUGINS in the page box — the registry that
  stands in for an import graph, the `mount(node, content, ctx)` contract, and
  how a plugin reaches another one. Covers why every plugin is a CLASSIC script
  sharing a global rather than a module (a module script does not load at an
  opaque origin — measured, with a module-script negative control, and
  re-verified during this rewrite), `biom.plugins.register({ id, mount,
  edit })` and what a refusal looks like, the id grammar and why a slot's plugin
  is named by its part's kind, `ctx.use(id)` as the ENTIRE composition mechanism
  and `ctx.has(id)` as its optional half, `edit: true` as a declaration and never
  a capability, `plugin:` naming the ONE document that draws a page and `page:`
  being retired with it, `data-g-plugin` nodes configured by attributes alone,
  teardown, how a PART KIND is drawn by the one FOLDER the format names rather
  than by whichever file registers first, how the loader tells the registry
  which file and which root is running. EVERY PLUGIN IS A FOLDER OF ONE SHAPE —
  `plugins/<id>/` with its scripts directly inside, an optional `index.html`,
  `plugin.yaml` for the variables it declares, `extensions.yaml` for a rung over
  another's, and inner `plugins/` to any depth — the same under `guest/plugins/`,
  a vault's `plugins/` and a page's own; `server/domain/plugins.ts` is the one
  walk. THE FRAMEWORK'S PLUGINS ARE THE RUNG UNDER THE VAULT'S and a vault never
  shadows one by file: a vault folder wearing `biom-` holds `extensions.yaml`
  alone, and a plugin's variables come in THREE RUNGS — its `plugin.yaml`, the
  vault's `extensions.yaml`, the page's own — merged per key, nearest wins, on
  the page read as `Page.extensions` (the ninth contracts edit), read in the box
  through `biom.plugin.extensions()`, with `biom.plugin.list()` and `get()`
  beside it. THE `doc` DOCUMENT READS `head` AND `foot` AND MOUNTS WHAT EACH
  NAMES through `rt.page.mount`, and the board of children is `biom-holds`, a
  plugin inside `biom-doc/plugins/`. THE LOADER answers `GET /v/<enc>/plugin/`
  with every folder at every depth — framework, vault, then every page's — one
  script, each file wrapped and named by its path and root, and a loose
  `plugins/<id>.js` refused naming the folder; the client weaves ONE tag and
  carries no list of plugin ids; none of the loading is a `contracts/` edit.
  Load this whenever you touch `guest/runtime/registry.js`, `guest/plugins/*`,
  `server/domain/plugins.ts`, `server/workspace/framework.ts`, or the `/plugin/`
  route in `server/main.ts`.
  Trigger on
  "plugin", "register", "mount", "ctx.use", "ctx.has", "ctx.options",
  "data-g-plugin", "page plugin", "vault plugin", "plugin folder",
  "plugin.yaml", "extensions.yaml", "rung", "biom.plugin", "head", "foot",
  "biom-holds", "reserved id", "duplicate plugin id", "document.currentScript",
  "markdown plugin", "mermaid", "classic script", "docs/plugins", "no imports
  in the box", "/plugin/ route", or any change to what can fill a node.
---

# Plugins — a registry where an import graph cannot be

**A plugin fills one node.** That is the entire job, and everything a page draws
is one: the prose in a slot is the `markdown` plugin, a grid is `table`, a
child's row is `child`, a diagram is `mermaid`. **There is no privileged path
underneath any of them** — one shape, one code path, all the way down, which is
what makes the built-in drawing replaceable rather than special.

```js
biom.plugins.register({
  id: "markdown",
  mount(node, content, ctx) { /* fill this one node */ },
  edit: true,
});
```

This skill owns the registry and the plugin contract. It does **not** own:

- **Where a plugin is mounted from** — drawing a section, slots, scripts,
  teardown bookkeeping → `section-runtime-guide`.
- **The box the plugins run in** — the sandbox, the ports, what may be sent →
  `boundary-guide`.
- **What a `Part` is before it reaches `mount`** → `page-format-guide`.
- **How to WRITE a plugin as a vault author** — that is the vault's own
  `.agents/skills/biom-plugins/SKILL.md`, shipped inside the workspace. This skill is for
  whoever changes the registry; that one is for whoever uses it.

---

## 1. Classic scripts sharing a global, because there is no import graph to be had

The page lives in one box with `sandbox="allow-scripts"` and no
`allow-same-origin`, so its origin is opaque. **A classic `<script src>` loads
there. A MODULE script is CORS-gated and blocked, and `fetch` is blocked too.**

That is measured, not assumed. `vendor/README.md` records the headless-Chrome
run: an iframe with exactly that sandbox, a classic `<script src>` at the
markdown-it UMD build, `location.origin` reading `"null"`, `typeof
window.markdownit` reading `"function"` — **and the negative control in the same
frame**, a module `<script src>` at `markdown-it.mjs`, failing with *blocked by
CORS policy: … from origin 'null'*. `tests/vendor.test.ts` pins the build choices
that follow. **It was re-verified during this rewrite**, with the module-script
control run again.

**So there is no import graph to be had inside the box, and the registry is what
stands in its place: a plugin is reached by NAME through a lookup, never by a
specifier through a resolver.** Every file in `guest/` — the shim, each runtime
file, each plugin — is a classic script that builds up one shared namespace
(`window.__gRuntime`, plus `biom.plugins` as the public name). Each of them
builds the namespace if it is not there yet, because classic scripts have no
order to rely on beyond the one the document gives them and a file that assumed
it was first would break the day somebody moved a tag.

The same rule is why `mermaid.min.js` is the IIFE build and why `markdown-it` is
vendored twice: the host uses the ESM build through an import map, and an
artifact uses the UMD build from inside its frame. They must stay the same
upstream version, because host and guest render the same prose and may not
disagree about it.

**A `<script type="module">` written inside a section is removed and reported by
name** rather than run as a classic script, because running it would turn its
`import` line into a syntax error and report *that* instead of the real cause.

---

## 2. `register` — take it, or refuse it out loud

`register(def)` returns a boolean saying which. **A vault file registering three
plugins keeps the two that were fine** — a refusal is about one plugin, not about
the file. Every refusal is reported through `rt.report` (falling back to the
console, since the registry has to be usable on its own — that is how it is
verified), **because a plugin that silently did not load is a page that silently
draws the wrong thing**, which is the hardest of all failures to attribute.

| field | meaning |
| --- | --- |
| `id` | lowercase letters, digits and dashes: `^[a-z][a-z0-9-]*$` |
| `mount(node, content, ctx)` | fill this one node. Return nothing, or a teardown function |
| `edit` | optional. `true` **declares** that this plugin's content is editable in place |
| `blocks(source)` | optional, and only meaningful with `edit`. Answers `{start, end, tag}` character ranges saying where one editable block ends and the next begins, and what element the renderer would draw it as. Omit it and the whole part is one block |
| `from` | set by the registry, never by the caller: the file that registered this plugin — see §5 |

**`blocks` is what lets a heading show at heading size.** The whole slot opens as
raw markdown, and the editor draws each block as an element of that block's own
`tag` — so an `h1` block is sized by the page's type scale and by whatever the
section's CSS says about `h1`, with no computed style copied from anywhere.
`markdown.js` reads the ranges and the tags off markdown-it's token map rather
than off blank lines, because a fence containing a blank line is one block. The
ranges deliberately do not cover the string: what lies between them is spacing,
which the editor draws as gaps of its own, so a person's blank lines come back as
they left them. It is re-read on every keystroke, which is how typing `# ` in
front of a paragraph makes it a heading as you type.

**`markdown`, `html`, `table`, `child` and `grid` are spoken for by the format
itself**, because a slot's plugin is named by its part's `kind`. That is not a special case
in the runtime: `fillSlots` looks up `rt.plugins.get(content.kind)` exactly as it
looks up a `data-g-plugin` node's id, and a part kind nothing draws fails inside
that node with a sentence saying so.

**One file per id, and the second one is refused by name.** A part kind is
narrower still: only `plugins/<kind>.js` may draw it, whichever file got there
first. Both refusals name the files involved, because a vault author who called
their plugin `table` needs to know the name is the format's and what claiming it
would have done, not merely that something clashed. §5 is the whole of that.

**`edit: true` declares, and grants nothing.** The runtime holds the only port
that can call `section.write`, and nothing on `ctx` can write a file. A plugin
that wants its text edited says so and the runtime does the writing. `get(id)` is
public precisely so a plugin composing on another can ask whether it declares
`edit` before offering to edit it.

---

## 3. `ctx.use(id)` is the whole of composition

There are no imports in here, so **one plugin reaching another is a lookup by
name and nothing else**:

```js
const md = ctx.use("markdown");
md.mount(cell, { kind: "markdown", md: text, vars: {} });
```

**`use` THROWS on a name nothing registered**, rather than returning null, and
the message lists what is registered. A plugin composing on a plugin that is not
there is a bug its author has to see; a silent null draws a blank cell and looks
like missing data. **`ctx.has(id)` is the optional half** — ask first when the
dependency may legitimately be absent.

The child context `use` builds inherits the parent's **teardown bucket**, so a
section coming down takes everything mounted underneath it with it.

**The worked example is in `guest/plugins/biom-markdown/markdown.js`.** A ` ```mermaid ` fence
inside prose stops being a code block and becomes a diagram — and because the
diagram plugin is an OPTIONAL dependency (the vendored library behind it is
3.6MB and is appended only where a page actually has a diagram), it is **asked
about with `ctx.has` before it is taken with `ctx.use`**. Where it is absent the
fence stays an ordinary code block, which is a correct reading of it.
The fence's source travels as an **option** rather than as content, because
`content` means "the stored `Part` for this slot" and a fence has no `Part` of its
own — it lives inside somebody else's prose. That is the same bargain a
`data-g-plugin` node makes.

`markdown.js` also carries the rule that **a missing library draws the words
anyway**: a page whose text vanished because a 200KB script did not arrive is
worse than a page with visible asterisks in it, and the difference is one branch.

---

## 4. The context, and what a plugin can never do

`makeCtx` in `sections.js` builds **one shape** for a named plugin, a page plugin
and a section script alike, because the three differ in what they are *given* and
not in what they may *do* — and a script with a smaller context than a plugin
would be a second API to learn for no reason.

| on `ctx` | what it is |
| --- | --- |
| `page`, `section`, `part`, `plugin` | where this mount is. `section` is null for a page plugin; `part` is null for a `data-g-plugin` node and a section script; `plugin` is null inside a section script |
| `root` | the section's own element, or the page root for a page-scoped mount |
| `vars` | the three scopes already merged, nearest last |
| `text(s)` | resolve `{{name}}` in a string against those scopes |
| `options` | this node's `data-g-*` attributes, minus the runtime's own reserved names. `data-g-max-rows` reads as `options.maxRows` |
| `call(kind, params)` | one request over the GUEST port |
| `has(id)` / `use(id)` | §3 |
| `onTeardown(fn)` | §6 |

> **NOTHING ON `ctx` CAN WRITE A FILE.** `ctx.call` speaks over the guest port,
> which carries `HostRequest` and nothing wider. `section.write`, `section.order`,
> `section.remove` and `variables.patch` travel the runtime's own port, which
> never leaves `boot.js`. There is no path from a plugin to any of them.

**A `data-g-plugin` node is handed `null` content, deliberately.** It is
configured entirely by its `data-g-*` attributes and has no stored content at
all, which is what lets a section place a chrome element — a rule, a progress
bar, a spacer — without inventing a slot in `content.yaml` for something nobody
edits.

**THERE IS NO LONGER A PAGE-LEVEL PLUGIN, and `page:` is retired.** A page used
to be able to mount a list of them over the top of its sections — a progress bar,
an ambient background — and now a page names ONE plugin, which is the thing that
draws it rather than a thing drawn over it. The key is refused by name, and
nothing ever shipped one, so nothing was lost when it went.

**What replaced it is bigger.** `plugin: <id>` names the document the box loads,
and everything under `input:` is **that plugin's own configuration, passed through
untouched**: a host that validated a plugin's options would have to know every
plugin. A page that wants a progress bar over a document is an html page that
draws one; a page that wants a board is `plugin: kanban`.

---

## 4b. The framework's plugins wear `biom-`, and a bare name resolves nearest-first

**Every plugin the framework ships is `biom-<name>`, folder and id alike.**
`guest/plugins/biom-markdown/markdown.js` registers `biom-markdown`; `biom-doc/index.html`
is what a page saying `plugin: doc` falls back to. The reason is the one the
skills have: a plugin a workspace wrote must never share a name with one the
framework ships later. Under bare names, the day the framework shipped a
`flow.js` a workspace's `flow` — in a file of any other name — loaded second and
was refused as the framework's duplicate, on every page, with nothing saying so.

**Nothing a page or a section says changes, because a bare name is resolved
nearest-first on both sides of the wall.** `resolve` in `guest/runtime/registry.js`
answers `get("reveal")` and `has("reveal")` with the workspace's own `reveal` if
one registered and the framework's `biom-reveal` otherwise — for
`data-g-plugin`, for `ctx.use`, and for a slot's part kind, because every one of
them goes through `get`. `frameworkPlugin` in `server/domain/pages.ts` does the
same for a page's document: the vault's `plugins/doc/index.html`, then the
framework's `biom-doc/index.html`; `idOf` in `server/domain/plugins.ts` does
the same for a folder's id. `OURS` is the one spelling in each file, and
`tests/plugins-without-copies.test.ts` holds the three equal. A prefixed id is
exactly what it says, so a page can pin the framework's by saying `biom-reveal`.

**A part kind is reserved to its file under either name.** `markdown` to
`plugins/markdown/`, `biom-markdown` to the framework's `biom-markdown/` — `isKind` in the
registry is `PART_KINDS` with the prefix taken off, so a `biom-markdown`
registered by some other file is the same theft a `markdown` would be. And a
```biom-html fence is a code sample exactly as a ```html one is: the markdown
plugin strips the prefix before it asks whether a fence names a part kind.

**One way a workspace has its own `markdown`, and it is a plugin of its own.**
`plugins/markdown/markdown.js` registering `markdown` loads beside the
framework's `biom-markdown`, a bare `markdown` reaches it first, and no
framework release can refuse it. There is no override by file: a vault folder
wearing `biom-` is an EXTENSION — it holds `extensions.yaml` and nothing else,
the loader refuses a script or a document in it by name, `pluginFile` never
answers a file under it, and the registry refuses a `biom-` id from any root
but the framework's. What a workspace changes about the framework's plugin is
its variables, in §7.

---

## 5. A part kind is drawn by the file the format names

**Nothing is shipped in the old sense — served from `/guest/` ahead of the
vault — and nothing is copied into the vault either.** The framework's plugins
are the rung under `<vault>/plugins/`, served on the same `/v/<enc>/plugin/…`
route behind the vault's own files, so the question *"is this ours"* is answered
by which root a file was read from and never by a url. That took the old
first-past-the-post rule's teeth with it, and this section is what replaced them.

**What it must not take is the case the rule was written for.** `markdown`,
`html`, `table`, `child` and `grid` are not plugins the framework happens to
ship: they are the **part kinds**, and a slot's plugin is named by its part's `kind`. A
second file registering `markdown` does not add a plugin — it replaces the
drawing of every markdown slot in the workspace, on every page, including pages
its author never opened.

**`PART_KINDS` in `registry.js` is `PartKind` in `contracts/types.ts`**, said
again because the box has no import graph to reach it through;
`tests/new-vault.test.ts` holds the two equal by reading both files and
`tests/guest.test.js` holds them equal by behaviour — the same arrangement that
holds `project.js` equal to `contracts/projection.ts`. **It is still not a roster
somebody has to re-count**: a kind added to the format without being added there
fails those tests.

**The reservation is bound to a FILE NAME, and that is what makes it a rule
rather than a race.** It used to be first-past-the-post, which was only ever safe
while the part kinds were served from `/guest/` ahead of everything else. Once
every plugin became a vault file the loader concatenates `plugins/*.js` in name
order, so **`plugins/0-notes.js` sorted ahead of `plugins/table.js` and took
`table`** — every table in the workspace drawn by a file that had no idea, with
nothing anywhere saying so.

- **`plugins/<kind>/` is the one folder that may draw `<kind>`, and the
  framework's `biom-<kind>/` the one that may draw `biom-<kind>`.** A folder at
  the top of its root — never an inner plugin, and never a page's `plugins/`,
  because one bundle serves every page and a part kind is every page's.
  `mayReserve` in the registry reads the root and the path the loader set. The
  runtime's own code, served from `/guest/`, may also register one; nothing
  there currently does.
- **Any other file is refused**, before or after, with the file it came from in
  the sentence: *"`table` is a part kind and only plugins/table/ draws it —
  plugins/a-notes/a-notes.js must register under an id of its own"*.
- **A `biom-` id from a vault or a page script is refused first**, in a sentence
  naming the file: the prefix is the framework's, and a workspace that could
  wear it would have file-based overrides back by another route.

**WHICH FILE IS REGISTERING IS A FACT THE LOADER HANDS OVER.** The whole bundle
is one `<script>`, so `document.currentScript` says *"the bundle"* for every
plugin in a vault and cannot tell two of them apart. `file(name, root, run)` in
the bundle's preamble sets `rt.pluginFile` — the path under its root,
`biom-doc/plugins/holds/holds.js` — and `rt.pluginRoot` — `framework`,
`plugins`, or a page's `pages/…/plugins` — around each file's own function, and
`whereFrom()` in the registry reads them; `rootNow()` reads the same for
`biom.plugin.list()`. It falls back to `document.currentScript` for the
runtime's own scripts, and to `an unnamed script` for a registration that came
from neither.

**`shipped` is gone, and dropping it was the point of the vault owning every
plugin.** It tested for `/guest/`, which is now the runtime and nothing else, so
after the move it answered `false` for every plugin in existence and protected
nothing. A vault's `mermaid.js` **is** the mermaid plugin — the person's edit of
it is the shipped one, and there is nothing left to shadow. What the registry
refuses is a **second file** taking an id that is already drawn, part kind or not,
in a sentence naming both: *"two plugins registered as 'mermaid':
plugins/aaa-mermaid.js has it and plugins/mermaid.js is refused — rename one of
them"*. The registry keeps `from` on each record for exactly that sentence.

---

## 6. Teardown

A plugin may return a teardown from `mount`, or call `ctx.onTeardown(fn)`.
**Both are honoured** — a plugin with one observer finds the return easier, a
plugin that mounts several children finds the callback easier, and being made to
pick would only make one of them write a wrapper.

Without teardown, an `IntersectionObserver` outlives the nodes it was watching and
**the page gets measurably slower every time somebody edits it**.
`section-runtime-guide` §6 owns the bookkeeping — buckets, ordering, the
throw-safety, and `effects.outstanding()` as the way to see the leak at all.

**A plugin that throws is contained.** `mountWith` catches it, marks the node
`data-g-failed` and puts the message inside it. Letting it escape would stop the
section, and every section under it, from drawing.

---

## 7. Where a plugin comes from — a folder of one shape, in three places

**`plugins/<id>/` is a plugin, and there is no other shape.** Directly inside
it: every `.js` is the plugin's own script, loaded in name order; `index.html`,
if present, is the document a page names with `plugin: <id>`; `plugin.yaml` is
its variables with their defaults — flat, a key and a default, nothing around
them; `extensions.yaml` is a rung over a plugin of that id; and `plugins/` holds
inner plugins, each a folder of the same shape, to any depth. **The shape is
the same in the three places a plugin folder can sit** — the framework's
`guest/plugins/`, the vault's `plugins/`, and a page's own `plugins/` beside its
`content.yaml` — and `walkPlugins` in `server/domain/plugins.ts` is the one
walk that reads it. A loose `plugins/reveal.js` comes out of it as a sentence
naming the folder to move it into; so does a folder whose name is not an id,
and a stray file in an extension folder. **The folder is the id**: under the
framework's root a folder is its name with `biom-` put on where it is missing
— `idOf`, the same rule `frameworkPlugin` applies to a document — so
`biom-doc/plugins/holds/` is the contract of `biom-holds`; a vault's or a
page's folder is its name as written. Inner ids are otherwise free.

**Two roots and the framework's is the rung underneath, and a vault never
shadows it by file.** A page naming `plugin: timeline` is handed a document by
`htmlOf` in `server/domain/pages.ts` in this order: the page's own
`index.html`; then `<vault>/plugins/timeline/index.html` under the BARE name,
which is a plugin of the vault's own; then the FRAMEWORK'S `biom-timeline/index.html`,
read through the read-only `Files` the composition root hands `makePages`.
`MISSING_DOCUMENT` is what is left underneath. **A vault folder wearing
`biom-` is an extension and holds `extensions.yaml` alone**: the loader refuses
a script or a document in it by name, `pluginDocument` never reads a document
under it, and `pluginFile` never answers a file under it. There are no
file-based overrides; a workspace that wants the whole document writes one
under a bare name and keeps it current from that day. The prefixed copy was the
paved override once, and the resolver never read it — a copy served and never
drawn — which is the finding that took it out.

**A plugin's variables come in three rungs, and that is how a workspace
changes a plugin.** The plugin's own `plugin.yaml` declares every variable it
reads with its default; the vault writes over any of them in
`plugins/<id>/extensions.yaml`; a page writes over those in the same file in its
own `plugins/`, reaching that page only. `makePlugins(...).extensionsFor(pageDir)`
merges them ONE KEY AT A TIME, nearest wins — `readRung` reads one file,
`mergeRungs` folds them — and the composition root hands that function to
`makePages`, because the two are siblings in `server/domain/` and may not reach
each other. A value is typed by its default's own JS type (string, number,
boolean, list of scalars; a null default accepts anything); a map where a
scalar goes, a key the contract does not declare, a value of the wrong type
and a file that will not parse are each refused in a sentence naming the file,
the plugin and the key, and the rung beneath stands. **The framework carries the
values and reads none of them** — nothing here knows what `head` means — and
nothing enforces the contract at run time, by decision: ports, where a wrapper
and a boundary would live, are another sheet.

**`Page.extensions` carries the merge, and it was the NINTH contracts edit**:
`Record<pluginId, { values, from, faults }>` — the merged variables, the rung
each key came from (`plugin`, `vault`, `page`), and the refusal sentences.
`boot.js` holds it off the last read, says each fault once through `report`,
and answers `rt.page.extensions()`; the registry publishes **`biom.plugin`**, the
reading side beside `biom.plugins` the registration side: `list()` — every
registered plugin with its `root` and `file` — `get(id)` as `ctx.use` finds it,
and `extensions(id?)` — the merged values, synchronously, the drawing plugin's
when the id is left out, resolved nearest-first like every other bare name.
`tests/plugin-folders.test.ts` walks the shape and every refusal;
`tests/plugins-without-copies.test.ts` holds `biom.plugin.get` to `biom.plugins.get`.

**A variable can name a plugin, and that is how a piece is swapped or added.**
`rt.page.mount(node, id)` in `boot.js` mounts a registered plugin into a node
of the document's own with the ordinary context — `makeCtx` with no section,
`mountWith` for the containment, so a plugin that throws fails in its node in
words — in a bucket prefixed `effects.DOCUMENT`, which `disposeAll(false)` on
a stack redraw leaves alone and `disposeAll(true)` on `pagehide` takes down. The
`doc` document is its first caller: it draws `header#g-head` before the stack
and `footer#g-foot` after, and on the runtime's first `onDraw` reads
`biom.plugin.extensions()` and mounts what `head` and `foot` name, once per box;
its `plugin.yaml` says `head:` with no default, `foot: biom-holds` and
`rows: false` and `convert: true`; `rows: true` puts `g-rows` on the root,
which the hide rule for bare reconciled child sections reads, and
`convert: false` keeps the table-to-grid conversion off a page whose sections
hold tables as specimens — the seeded design doc ships that line in
`design/plugins/biom-doc/extensions.yaml`, because the first open of a fresh
vault's design doc otherwise cut eight of them out. **That is the document reading two of
its own variables and not a framework feature**: the runtime has no notion of a
point. A plugin mounted from a document's variable may append a `<style>`,
because the document asked for it; a plugin a section mounts still inks nothing.

**The board of children is `biom-holds`**, `guest/plugins/biom-doc/plugins/holds/holds.js`
— markup, sort, tally, rows, the `holds`/`holdWords` reading off `biom.children()`
and `biom.data()`, `onRefresh` and a teardown — registered from inside the
document's folder and named by the document's own default. Its look stays in
the document's head in `@layer biom.holds`, keyed on the `.g-holds` root the
plugin draws, so a section that places it with `data-g-plugin="biom-holds"`
gets the same board. `tests/holds.test.ts` is the board; `tests/doc-document.test.ts`
is the document, its two nodes and the mounting script.

**Nothing is copied into `plugins/` unasked.** The set used to be seeded into
every vault by `presets.ts`, on the argument that a copy in the person's hands
was the whole promise; the cost, named at the time, was that a framework fix
never reached a copy already made, and it was measured: this project's own
workspace carried fourteen framework plugins a licence header to 283 lines
behind, none of them edited on purpose. So a fresh vault has no `plugins/` at
all, every page in it draws, and every vault follows a framework release the
moment it is installed. `tests/new-vault.test.ts` holds the shape.

**WHAT A PERSON CAN READ IS `docs/plugins/`, and it is rewritten whole on every
open.** `mirrorPlugins` in `server/workspace/framework.ts` empties the folder and
writes the framework's set into it — every folder at every depth, `plugin.yaml`
included — out of the same `Files` the rung reads, so what they open is byte for
byte what draws their page, and what declares the variables their rung may
write. Whole every time rather than filled, which is the one-word difference
from the seeder: `fill` skipped a file that was there, and that is exactly what
let a copy drift. Nothing serves it, nothing resolves a page against it, a
file edited there is gone on the next open, and the folder is added to the
vault's `.gitignore`. The checker reads it for R67 and R68.

**AND A COPY THAT IS ALREADY THERE IS LEFT THERE.** A vault seeded before the
rung holds the old set under `plugins/` as loose files, and every one of them
is refused in words now — the loader names the folder each goes into — while a
document copied under a bare name, `plugins/doc/index.html`, goes on drawing as
a plugin of the vault's own and the checker warns as R68 that an extension
would do. Nothing on open touches them. Telling a copy nobody edited from one
somebody did would mean carrying every version the framework ever shipped —
that was done once and taken out again. **This is a breaking change, and it is
said as one**: whoever owns the folder moves the scripts into folders and
deletes the copies they did not mean to keep.

**Neither job is on the mount path.** `afterMount` in `server/main.ts` starts
the skills rewrite and the mirror once `hold` has the mount, a page draws from
the rung the instant the vault is open, and each failure is a sentence in the
log rather than a mount that did not happen. `Host.settled(path)` is the promise
a test waits on.

**THE LOADER ANSWERS THE DIRECTORY ON THE ROUTE IT ALREADY SERVES THE FILES
ON.** `GET /v/<enc>/plugin/` — the same string `client/platform/document.js`
builds to reach one file, with nothing appended — is `pluginBundle` in
`server/main.ts`.

> **ONE BUNDLE PER VAULT, EVERY FOLDER AT EVERY DEPTH IN IT**: the framework's
> `guest/plugins/`, then the vault's `plugins/`, then every page's own
> `plugins/` in page-id order — `pageDirs` in `pages.ts` walks positions, not
> documents — and within a folder its own scripts in name order, then its inner
> plugins. Each segment is preceded by a comment naming its path and its root
> and wrapped in a FUNCTION of its own. The client weaves **one** tag for it,
> and there is no list of plugin ids anywhere in the client.
>
> **A page-level plugin's script loads on every page**, and only that page's
> rung names it — the cost of one tag that is byte-identical per vault, and
> cheaper than a document that differs per page, which is a frame rebuilt on
> every navigation. **A page plugin's own script is in the bundle too** —
> `biom-kanban/kanban.js`, `biom-mindmap/mindmap.js` — and guards on its root
> node being on the page, so on every other page it runs nothing; their
> documents name no `data-g-src`, because naming it as well would run it twice.
>
> **No `contracts/` edit and therefore no barrier** for the loading. The route
> exists, `vaultBase` is read rather than changed, and nothing new crosses the
> wire as a kind for it; the one contracts edit in this subject is
> `Page.extensions`, above.
>
> **Concatenated rather than a tag per plugin**: N tags is N round trips and an
> execution order that depends on which arrives first. One file is one request,
> one stated order, and one place to report a failure from.
>
> **A FUNCTION PER FILE AND NOT A `try` BLOCK**, because a block is a scope for
> neither `var` nor a function declaration. The wrapper is also what tells the
> registry **which file and which root is running** — §5 is what that decides.
>
> **THE BUNDLE IS MEMOISED PER VAULT**, keyed on every segment's path and a hash
> of its text, so editing `guest/plugins/biom-markdown/markdown.js` in a
> checkout and pressing reload is live, and so is a new folder under a page.
> `no-store` stays on the response, and the memo is what makes that affordable.
> The bundle reads the vault through a `Files` with NO baseline, so serving a
> plugin never moves the watcher's memory of the file. **A single script over
> 512KB is refused by name** rather than held in that string.
>
> **A FAILURE IS NAMED BY ITS FILE AND ITS ROOT.** `plugins/<folder>/<file> did
> not load: …`, `framework/…`, or `pages/…/plugins/…` through `rt.report`, so a
> reader knows which copy broke. A file that does not PARSE is the case a `try`
> cannot catch, so each source is compiled on the server with `new Function`
> (which runs none of it) and a file that fails is replaced by the sentence
> saying so. A refusal the walk made — a loose script, a stray file in an
> extension folder, a folder that is not an id — arrives as a `fail` whose
> sentence is already whole and is said as it is.
>
> **An absent or empty `plugins/` answers the framework's set alone and never a
> 404.** Every box in the vault carries that tag.
>
> **`pluginFile`, the per-file route**, answers `/v/<enc>/plugin/<rel>` from
> the vault's `plugins/<rel>` under a bare name and the framework's `<rel>`
> otherwise — never a vault file under a `biom-` folder. It is what a vault
> page plugin's `data-g-src` reaches for a file the walk does not bundle — a
> library in a subfolder of the plugin's own, `timeline/lib/vendor.js`, never
> a `.js` beside the plugin's script, which is in the bundle already and would
> run twice; `/guest/plugins/` itself is refused by `locate()`, so there is one
> url per plugin.
>
> **§5 is what happens when one of them claims a part kind**, and the order the
> folder happens to sort in decides nothing: only `plugins/<kind>/` may draw
> `<kind>`, so a folder named to sort first cannot take one.

## 8. Drawing another page: `biom.embed` and `biom.embedInto`

A page plugin — or a section — can draw ANOTHER page inside itself, as it is,
with its own runtime: `biom.embedInto(iframe, pageId)` asks the host for that
page's document and two ports, puts the document in the iframe and relays the
handshake, and resolves to a handle with `close()`. The nested page edits
through its own ports and hears its own refreshes; nothing is re-rendered from
prose. `biom.embed(pageId)` is the raw half — `{ page, embed, html, ports }` —
for a caller that wants to do the relay itself, and it must install its `hello`
listener BEFORE assigning `srcdoc`. Why this is not a hole in the sandbox, and
what caps it, is `boundary-guide` §9.

The handle also carries `onScroll(fn)` and `scrollTo(at)`, both as a FRACTION of the nested page's run — an embedded realm reports where it is scrolled to and goes where it is put, over `window`, and a position it was put at is not reported back, so two pages following each other cannot chase. That is how a compare page keeps two pages level by proportion.

**Call `close()` in `onTeardown` from a section script**: a doc page's runtime
empties the section stack on every redraw, and an iframe inside a section goes
with it. A plugin page's own markup is never cleared, so an iframe there lives
as long as the box does.

---

## 9. Gotchas

- **`biom.plugins` registers and `biom.plugin` reads**, and a test holds the
  two `get`s equal. The shim owns `window.biom`
  and is inlined ahead of every runtime file, so the ordinary case is attaching to
  an object that is already there. The other case is real and is **not** a
  fallback for a bug: the runtime is verified in a bare frame with no shim at all,
  because a verification that needed the shim would be testing two files and
  telling you about one. A stand-in carrying nothing but `plugins` keeps that
  frame honest.
- **`say()` looks `rt.report` up late rather than capturing it**, because
  `report` belongs to `boot.js` and a plugin script can sit ahead of `boot.js` in
  the document.
- **Registration order is the document's order**, and `ids()` returns it — which
  is what a section menu and a "nothing draws a … part" message read.
- **The reserved `data-g-*` names are the runtime's** and are stripped out of
  `ctx.options`, so a plugin can never read `part`, `plugin`, `scope`, `section`,
  `empty`, `default` or `failed` as configuration.
- **`edit: true` is not a permission.** Say it again in review whenever somebody
  reaches for a write from inside a plugin: the answer is a declaration plus the
  runtime, never a widened port.

---

## Key files (where plugins actually live)

- **The registry, and the whole of composition:**
  `guest/runtime/registry.js` — its header is the argument for classic
  scripts; `register` / `has` / `get` / `ids`, the `GPlugin` typedef (with
  `root`), the id pattern, `whereFrom()` and `rootNow()` (which file and root
  is registering), `mayReserve()` (a part kind's folder), the `biom-` refusal,
  `say()`, the `biom.plugins` publication with its bare-frame stand-in, and
  **`biom.plugin`** — `list`, `get`, `extensions` — the reading side.
- **The document's own mounts:** `rt.page.mount` and `rt.page.extensions` in
  `guest/runtime/boot.js`; `effects.DOCUMENT` and `disposeAll(everything)` in
  `guest/runtime/effects.js`, which is what lets a mount outlive a stack redraw.
- **The context and the mounting:** `guest/runtime/sections.js` —
  `makeCtx` (documented field by field), `mountWith`, `fail`, `optionsOf` and the
  reserved names, `fillSlots` (slots then `data-g-plugin` nodes). Owned by
  `section-runtime-guide`; a plugin's whole world is built here.
- **Page-level plugins:** `mountPagePlugins` in `guest/runtime/boot.js`,
  reading the `PagePlugin[]` the server puts on `Page.page`.
- **Teardown bookkeeping:** `guest/runtime/effects.js`.
- **The folder shape and the rungs:** `server/domain/plugins.ts` —
  `walkPlugins` (one root, folders in load order, faults as sentences),
  `idOf` (the framework's prefix rule for a folder), `readRung` (one
  `plugin.yaml` or `extensions.yaml`, typed by the defaults), `mergeRungs`
  (nearest wins per key), and `makePlugins(...).extensionsFor(pageDir)`, which
  the composition root hands to `makePages`. `tests/plugin-folders.test.ts`.
- **The plugins, as the FALLBACK RUNG rather than a served root:**
  `guest/plugins/` — every entry a folder wearing `biom-` — read second by
  `pluginDocument` in `server/domain/pages.ts` and by `pluginFile` and
  `pluginBundle` in `server/main.ts`, through the read-only `Files` `makeHost`
  builds once as `pluginRoot`; `/guest/plugins/` is refused by `locate()` so
  there are never two urls for one plugin. **List that directory rather than
  trusting a roster here.**
- **The mirror on open:** `server/workspace/framework.ts` — `mirrorPlugins`
  writes `docs/plugins/` whole, every folder at every depth; `afterMount` in
  `server/main.ts` runs it off the mount path, after the skills rewrite.
  Nothing under `plugins/` is touched.
  `biom-markdown/markdown.js` is the reference implementation and the worked
  example of `ctx.has` + `ctx.use` (fence → diagram), the UMD-not-module rule,
  and "a missing library draws the words anyway". `biom-items/`, `biom-open-list/`,
  `biom-checklist/` and `biom-reveal/` are the GENERAL slot plugins — one
  concern each, refusing in words where their node is misplaced, inking
  nothing, each with a worked section under `vault/base/`; `open-list` is also
  the worked example of one plugin composing on another through `ctx.use`, and
  `tests/vault-plugins.test.js` holds every one of them to the refusal.
  The PAGE plugins each carry an `index.html`: `biom-doc/` (the FIGURE FRAME as
  a layered document stylesheet, the two nodes that take what `head` and
  `foot` name, the board's look in `@layer biom.holds`, the `plugin.yaml`
  declaring `head`, `foot` and `rows`, and `plugins/holds/holds.js` inside it
  registering `biom-holds`, the board of children — `tests/doc-document.test.ts`
  and `tests/holds.test.ts`), `biom-kanban/` (a table as lanes) and
  `biom-mindmap/` (the workspace as a sky — every page a light sized by what
  links to it, orbital physics, the hand a black hole) and
  `biom-automations-runs/` (a page's children one at a time, newest first,
  between two strips, the bar naming each by its H1 — reading `home`,
  `progress` and `skip` off its flat `plugin.yaml` through the three rungs and
  mounting what the first two name into slides of its own through
  `rt.page.mount`, the progress slide first while its plugin takes `hidden`
  off the node it was handed; it sorts on `Child.created`, the tenth contracts
  edit, and on the date a name leads with where the host answers none —
  `tests/automations-runs.test.js`); their scripts are in the bundle and guard
  on their root node. `mindmap` is also what the rail's
  own Map row draws, mounted on `MAP_PAGE` (`@map`), which `server/domain/pages.ts`
  answers as a bare plugin page with no directory and the shell reads through
  the store like any page, so `client/views/page.js` carries no copy of the
  document any more. The Map row and its route are in EVERY build — it was
  withheld from the built application because a one-page vault maps to one
  light, and the owner decided on 2026-09-17 that one light is what a one-page
  workspace looks like — and a page saying `plugin: mindmap` draws everywhere
  too.
- **The vault-plugin route:** `inVault()` and the `STATIC` table in
  `server/main.ts` — `/v/<enc>/plugin/<rel>` → `<vault>/plugins/<rel>`,
  `/guest/` → `guest/`, `/vendor/` → `vendor/`, and `under()`
  which refuses any path that escapes its root.
- **The box's document:** `client/platform/document.js` — the `VENDOR`
  and `RUNTIME` lists it turns into `<script src>` tags, `pluginBase` (now the
  loader's own url as well as a file's prefix), `resolveSiblings` (the
  `data-g-src` rewrite) and `weaveRuntime`, **which takes the vault** because the
  plugin tag names it; layer 6 because the page view and the bridge
  (`page.embed`) both build one. **There is no list of plugin ids in it**, and
  putting one back is the regression to watch for. Where a page plugin's document
  is resolved instead is `htmlOf` in `server/domain/pages.ts`.
- **The loader:** `pluginBundle` and `PLUGIN_DIR_ROUTE` in
  `server/main.ts`, routed ahead of the single-file resolution in
  `fetch` because `under()` resolves `/plugin/` to the folder itself and
  `deliver` cannot read a directory. `tests/plugin-loader.test.ts` is
  the whole behaviour: folder order to any depth, page folders, the loose
  script, the extension folder, the `biom-` refusal, the per-file refusal, the
  unparseable file, the absent folder, and the part-kind reservation surviving
  all of it.
- **Drawing another page:** `embed` / `embedInto` in `guest/biom.js`;
  the session they talk to is `grant` in `client/frame/frame.js`.
- **The measurement:** `vendor/README.md` (the browser run and its
  module-script negative control) and `tests/vendor.test.ts`.
- **The author-facing counterpart, shipped inside a vault:**
  `vault/.agents/skills/biom-plugins/SKILL.md` — how to WRITE a plugin. When the
  registry or `ctx` changes, check whether it needs the same edit.
- **Siblings:** where a plugin is mounted from → `section-runtime-guide`; what
  the box may say → `boundary-guide`; what a `Part` is → `page-format-guide`.

---

## This is a living document

This skill is the single source of truth for the plugin registry and the plugin
contract. Whenever either genuinely changes — a field added to a plugin
definition, a field added to `ctx`, a change to how a reserved id is decided, a
plugin added to or removed from the framework's set, a change to which root
wins — **update this skill in the same change** so it never goes stale, and check whether
`vault/.agents/skills/biom-plugins/SKILL.md` and `vault/docs/plugins.md` need the same
edit for their own audience. If a rule here is what diverged, fix the rule; if
the divergence is a mistake, fix the code. Either way they agree when you are
done.
