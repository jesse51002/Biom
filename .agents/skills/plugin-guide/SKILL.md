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
  being retired with it,
  `data-g-plugin` nodes configured by attributes alone, teardown, how a PART KIND
  is drawn by the one file the format names (`plugins/<kind>.js`) rather than by
  whichever file registers first, how the loader tells the registry which file is
  running and why `shipped` is gone, that THE FRAMEWORK'S PLUGINS ARE THE RUNG
  UNDER THE VAULT'S — a page's document and a slot plugin are resolved from
  `<vault>/plugins/` first and `guest/plugins/` second, nothing is copied into a
  vault unasked, a vault file at the framework's path is an OVERRIDE, the
  framework's set is mirrored into `docs/plugins/` on every open for a person to
  read, and a copy nobody edited is swept on open against the framework's git
  history as a bridge — `guest/plugins/` is not served as a root of its own, and
  no file in a vault may name `/guest/` — and THE LOADER: the server answers
  `GET /v/<enc>/plugin/` with the framework's `*.js` minus every name the vault
  also has, then the vault's `plugins/*.js`, each in id order, each wrapped and
  named by its file and root, the client weaves ONE tag for it and carries no
  list of plugin ids at all, and none of it is a `contracts/` edit — so a
  vault's own slot plugin (`plugins/<id>.js`) loads exactly as its own page
  plugin (`plugins/<id>/index.html`) does. Load this whenever you touch
  `guest/runtime/registry.js`, `guest/plugins/*`, `server/workspace/framework.ts`,
  `server/platform/shipped.ts`, or the `/plugin/` route in `server/main.ts`.
  Trigger on
  "plugin", "register", "mount", "ctx.use", "ctx.has", "ctx.options",
  "data-g-plugin", "page plugin", "shipped plugin", "vault plugin", "reserved
  id", "duplicate plugin id", "document.currentScript", "markdown plugin",
  "mermaid", "classic script", "override", "docs/plugins", "sweep", "stale
  plugin", "no imports in the box", "/plugin/ route", or any change to what can
  fill a node.
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

**`markdown`, `html`, `table` and `child` are spoken for by the format itself**,
because a slot's plugin is named by its part's `kind`. That is not a special case
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

**The worked example is in `guest/plugins/markdown.js`.** A ` ```mermaid ` fence
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

## 5. A part kind is drawn by the file the format names

**Nothing is shipped in the old sense — served from `/guest/` ahead of the
vault — and nothing is copied into the vault either.** The framework's plugins
are the rung under `<vault>/plugins/`, served on the same `/v/<enc>/plugin/…`
route behind the vault's own files, so the question *"is this ours"* is answered
by which root a file was read from and never by a url. That took the old
first-past-the-post rule's teeth with it, and this section is what replaced them.

**What it must not take is the case the rule was written for.** `markdown`,
`html`, `table` and `child` are not plugins the framework happens to ship: they
are the **part kinds**, and a slot's plugin is named by its part's `kind`. A
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

- **`<kind>.js` is the one file that may draw `<kind>`.** That is the
  framework's `markdown.js`, or the person's override of it at
  `plugins/markdown.js` — the loader hands the registry the bare file name
  whichever root it came from, and the union means only one of the two is ever
  in the script. The runtime's own
  code, served from `/guest/`, may also register one; nothing there currently
  does.
- **Any other file is refused**, before or after, with the file it came from in
  the sentence: *"`table` is a part kind and only plugins/table.js draws it —
  plugins/0-notes.js must register under an id of its own"*.

**WHICH FILE IS REGISTERING IS A FACT THE LOADER HANDS OVER.** The whole bundle
is one `<script>`, so `document.currentScript` says *"the bundle"* for every
plugin in a vault and cannot tell two of them apart. `file(name, run)` in the
bundle's preamble sets `rt.pluginFile` around each file's own function, and
`whereFrom()` in the registry reads it — falling back to `document.currentScript`
for the runtime's own scripts, and to `an unnamed script` for a registration that
came from neither.

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

## 7. Where a plugin comes from — the vault's own, then the framework's

**Two roots, nearest wins, and the framework's is never the winner.** A page
naming `plugin: timeline` is handed a document by `htmlOf` in
`server/domain/pages.ts` in this order: the page's own `index.html`; then
`<vault>/plugins/timeline/index.html`, which is the person's — written by them,
or copied in to be changed; then the FRAMEWORK'S own `guest/plugins/timeline/index.html`,
read through the read-only `Files` the composition root hands `makePages`
(`guest/plugins/` on disk in a checkout, the embedded map in a build). `MISSING_DOCUMENT`
is what is left underneath, for a page naming a plugin nobody has. **A vault file
at the framework's path is an OVERRIDE**: it wins by being there, and deleting it
is how the framework's takes over again — nothing writes it back.

**Nothing is copied into `plugins/` unasked.** The set used to be seeded into
every vault by `presets.ts`, on the argument that a copy in the person's hands
was the whole promise; the cost, named at the time, was that a framework fix
never reached a copy already made, and it was measured: this project's own
workspace carried fourteen framework plugins a licence header to 283 lines
behind, none of them edited on purpose. So a fresh vault has no `plugins/` at
all, every page in it draws, and every vault follows a framework release the
moment it is installed. `tests/new-vault.test.ts` holds the shape.

**Resolution is per FILE, and that is why an override is copied whole.** The
same walk the document takes, the route takes for a plugin's other files:
`pluginFile` in `server/main.ts` answers `/v/<enc>/plugin/<rel>` from the
vault's `plugins/<rel>` if it is there and the framework's `<rel>` if not — so a
`plugins/kanban/index.html` alone still gets the framework's `kanban/kanban.js`
underneath it. That is right for a partial override and surprising for somebody
who wanted isolation, which is why the paved way to override is the whole
directory. **A file in a vault may not name `/guest/`**, and a plugin document
naming its own sibling is the case that needed solving: `plugins/kanban/index.html`
has to load `plugins/kanban/kanban.js`, cannot name the install directory,
cannot use a relative `src` (the box is a `srcdoc` frame at an opaque origin with
no base), and cannot name the vault route (the file was written before anybody
knew which folder it would be read against). So it writes
`<script data-g-src="kanban/kanban.js">` — a path under `plugins/`, marked — and
`weaveRuntime` in `client/platform/document.js` turns the mark into a real `src`
under the vault's route, where the per-file walk answers it. `/guest/plugins/`
itself is refused by `locate()`, so there is one url per plugin.

**WHAT A PERSON CAN READ IS `docs/plugins/`, and it is rewritten whole on every
open.** `mirrorPlugins` in `server/workspace/framework.ts` empties the folder and
writes the framework's set into it out of the same `Files` the rung reads, so
what they open is byte for byte what draws their page. Whole every time rather
than filled, which is the one-word difference from the seeder: `fill` skipped a
file that was there, and that is exactly what let a copy drift. Nothing serves
it, nothing resolves a page against it, a file edited there is gone on the next
open, and the folder is added to the vault's `.gitignore` (appended, never
rewritten) so a framework release is not a diff in every vault's history.
`docs/` is not a watched directory, so writing it redraws nothing.

**WHAT THEY CAN CHANGE IS AN OVERRIDE, and the paved way is a copy out of that
mirror**: `docs/plugins/kanban/` to `plugins/kanban/`. An agent opened in the
folder can do that with no route at all, which is why the mirror answers *how
does a person see the original* and *how does an agent override one* in the same
stroke. From then on the copy is theirs and pinned by choice — the framework's
version is shadowed until the copy is deleted. **A route and a Config row for
the same copy are not built**: a write has to go through the guarded API, which
is a wire kind and a `contracts/` edit, and `contracts/` waits for a barrier.

**AND A COPY NOBODY EDITED GOES ON OPEN — a bridge, and it says so.**
`sweepShipped` in the same module walks `plugins/` and, for every file the
framework also has, asks whether it is byte for byte a version the framework
EVER shipped: `server/platform/shipped.ts` computes git's own blob hash of the
file and checks it against every hash that path has had in `guest/plugins/`'s
history — read out of the checkout's `.git` in a source run, carried as
`SHIPPED` in `dist/embedded.ts` by `tools/app.ts` in a build, which has no
`.git` beside it. A match was never edited by anybody, and it goes: committed
first, exactly as every agent write is, so the deletion is one readable diff and
one `git revert` away, and a page plugin's directory goes with its last file.
One changed byte keeps a file. **What it costs is named rather than solved**: a
person who kept an OLD version on purpose, unedited, has a file that matches and
loses it — the stale-copy cost taken away when it was silent. It exists so that
no vault seeded before this, and no vault whose owner never reads about it, goes
on carrying stale copies; once every vault on this side of the change has been
opened once, it is sunset and the rung and the mirror are the whole mechanism.
**A vault seeded from a version that is not in this repository's history is not
matched** — the history is the public repository's, and this project's own
workspace predates it, so that one is migrated by hand.

**Neither job is on the mount path.** `afterMount` in `server/main.ts` starts
both once `hold` has the mount, a page draws from the rung the instant the vault
is open, and each failure is a sentence in the log rather than a mount that did
not happen. `Host.settled(path)` is the promise a test waits on.

**A PLUGIN THAT FILLS A SLOT LOADS THROUGH THE SAME ROUTE, AND THE ROUTE IS THE
FOLDER UNION THE FRAMEWORK'S SET.** This section said for a long time that the
loader needed a wire kind. It needed none.

> **The server answers the DIRECTORY on the route it already serves the files
> on.** `GET /v/<enc>/plugin/` — the same string `client/platform/document.js`
> builds to reach one file, with nothing appended — is `pluginBundle` in
> `server/main.ts`: the framework's `*.js` MINUS every name the vault's
> `plugins/` also has, then the vault's `plugins/*.js`, each set in id order,
> each preceded by a comment naming its file and its root and wrapped in a
> FUNCTION of its own. The client weaves **one** tag for it, and there is no
> list of plugin ids anywhere in the client.
>
> **The union is computed here by filename and nowhere else.** A vault
> `markdown.js` means the framework's `markdown.js` never enters the script, so
> the registry never sees two registrations of one id and its refusal never
> fires for this reason. The framework's go FIRST, so a vault plugin that
> `ctx.use`s a framework one finds it registered.
>
> **No `contracts/` edit and therefore no barrier.** The route exists,
> `vaultBase` is read rather than changed, and nothing new crosses the wire as a
> kind. A `plugin.list` on `ApiRequest`, or a field on `VaultInfo`, were the
> alternatives; both are `contracts/` edits and both were rejected for it.
>
> **Concatenated rather than a tag per plugin**: N tags is N round trips and an
> execution order that depends on which arrives first. One file is one request,
> one stated order, and one place to report a failure from.
>
> **A FUNCTION PER FILE AND NOT A `try` BLOCK**, because a block is a scope for
> neither `var` nor a function declaration. The wrapper is also what tells the
> registry **which file is running** — it sets `rt.pluginFile` to the BARE file
> name around the call, the same name whichever root the file came from, and §5
> is what that decides.
>
> **THE BUNDLE IS MEMOISED PER VAULT**, keyed on the vault folder's listing plus
> each file's mtime and size, and on a hash of the framework sources read — so
> editing `guest/plugins/markdown.js` in a checkout and pressing reload is live.
> `no-store` stays on the response, and the memo is what makes that affordable.
> **A single vault file over 512KB is refused by name** rather than held in that
> string.
>
> **A FAILURE IS NAMED BY ITS FILE AND ITS ROOT.** `plugins/<file> did not load: …`
> or `framework/<file> did not load: …` through `rt.report`, so a reader knows
> which copy broke. A file that does not PARSE is the case a `try` cannot catch,
> so each source is compiled on the server with `new Function` (which runs none
> of it) and a file that fails is replaced by the sentence saying so.
>
> **An absent or empty `plugins/` answers the framework's set alone and never a
> 404.** Every box in the vault carries that tag.
>
> **A page plugin still needs none of this.** It IS the document, so the server
> naming its file is the whole of the loading. `plugins/<id>.js` is a slot
> plugin and `plugins/<id>/index.html` is a page plugin, and the filename alone
> says which. **What the loader does with a directory holding both is
> undecided**: the `.js` would be bundled and the `index.html` resolved, and
> nothing refuses the combination.
>
> **§5 is what happens when one of them claims a part kind**, and the order the
> folder happens to sort in decides nothing: only `<kind>.js` may draw `<kind>`,
> so a file named to sort first cannot take one.

---

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

- **`biom.plugins` is the public name.** The shim owns `window.biom`
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
  scripts; `register` / `has` / `get` / `ids`, the `GPlugin` typedef, the id
  pattern, `whereFrom()` (which file is registering) and `mayReserve()`, `say()`,
  and the `biom.plugins` publication with its bare-frame stand-in.
- **The context and the mounting:** `guest/runtime/sections.js` —
  `makeCtx` (documented field by field), `mountWith`, `fail`, `optionsOf` and the
  reserved names, `fillSlots` (slots then `data-g-plugin` nodes). Owned by
  `section-runtime-guide`; a plugin's whole world is built here.
- **Page-level plugins:** `mountPagePlugins` in `guest/runtime/boot.js`,
  reading the `PagePlugin[]` the server puts on `Page.page`.
- **Teardown bookkeeping:** `guest/runtime/effects.js`.
- **The plugins, as the FALLBACK RUNG rather than a served root:**
  `guest/plugins/` — read second by `pluginDocument` in `server/domain/pages.ts`
  and by `pluginFile` and `pluginBundle` in `server/main.ts`, through the
  read-only `Files` `makeHost` builds once as `pluginRoot`; `/guest/plugins/`
  is refused by `locate()` so there are never two urls for one plugin.
  **List that directory rather than trusting a roster here.**
- **The mirror and the sweep on open:** `server/workspace/framework.ts` —
  `mirrorPlugins` writes `docs/plugins/` whole, `sweepShipped` deletes unedited
  shipped copies; `afterMount` in `server/main.ts` runs both off the mount path.
- **What counts as shipped:** `server/platform/shipped.ts` — git's blob hash,
  and every hash a path has had in `guest/plugins/`'s history; `tools/app.ts`
  carries the list as `SHIPPED` in `dist/embedded.ts`.
  `markdown.js` is the
  reference implementation and the worked example of `ctx.has` + `ctx.use`
  (fence → diagram), the UMD-not-module rule, and "a missing library draws the
  words anyway". `items.js`, `open-list.js`, `checklist.js` and `reveal.js` are
  the GENERAL slot plugins — one concern each, refusing in words where their node
  is misplaced, inking nothing, each with a worked section under
  `vault/base/`; `open-list` is also the worked example of one plugin
  composing on another through `ctx.use`, and
  `tests/vault-plugins.test.js` holds every one of them to the refusal.
  The PAGE plugins each sit in a directory with an `index.html`:
  `doc/` (which also carries the FIGURE FRAME as a layered document stylesheet
  and the BOARD OF CHILDREN, so a page that holds pages draws them with no file
  written for it — `tests/doc-document.test.ts` is the whole of it),
  `kanban/` (a table as lanes) and `mindmap/` (the workspace as a sky —
  every page a light sized by what links to it, orbital physics, the hand a
  black hole). `mindmap` is also what the rail's own Map row draws, mounted on
  `MAP_PAGE` (`@map`), which `server/domain/pages.ts` answers as a bare plugin
  page with no directory; `client/views/page.js` carries the plugin's document
  again as `MAP_DOCUMENT` and `tests/mindmap.test.js` holds the two equal. The
  Map ROW is not in a production build and `#/map` does not route there either —
  a whole-workspace map is a drawing of a tree a stranger's vault does not have
  yet — but the plugin itself ships in both, so a page saying `plugin: mindmap`
  draws everywhere.
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
  the whole behaviour: id order, the per-file refusal, the unparseable file, the
  absent folder, and the part-kind reservation surviving all of it.
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
wins, and above all **the day the sweep in §7 is sunset** —
**update this skill in the same change** so it never goes stale, and check whether
`vault/.agents/skills/biom-plugins/SKILL.md` and `vault/docs/plugins.md` need the same
edit for their own audience. If a rule here is what diverged, fix the rule; if
the divergence is a mistake, fix the code. Either way they agree when you are
done.
