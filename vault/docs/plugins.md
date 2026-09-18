# Where does a plugin come from?

**A plugin fills one node, or draws one page.** Everything on screen is one: the
prose in a slot is the `markdown` plugin, a grid is `table`, a child's row is
`child`, and the document itself is `doc`. There is no privileged path underneath
any of them.

## The framework's plugins draw your pages until you put a file at the same path in `plugins/`

**Every plugin the framework ships is called `biom-<name>`, file and id alike,
and you keep saying the bare name.** `plugin: doc` in a page, `data-g-plugin="reveal"`
in a section and a `markdown` slot all resolve nearest-first: a plugin of yours
under that name if you wrote one, the framework's `biom-doc`, `biom-reveal` or
`biom-markdown` otherwise. So a plugin you write can never share a name with one
the framework ships later — under bare names it would have been refused as the
framework's duplicate on every page, the day the framework shipped it, with
nothing saying so.

**Your `plugins/` folder holds only what you wrote or overrode.** Nothing is
copied into it. The framework's own plugin set is the rung underneath: when a
page names a plugin, the server looks in your folder first and in the
framework's set second, so a fresh workspace has no `plugins/` at all and every
page still draws, and every workspace follows a framework release the moment it
is installed. The filename alone says which kind a plugin is:

```
plugins/callout.js            <- a SLOT plugin: a classic script that registers an id
plugins/timeline/index.html   <- a PAGE plugin: the document a page names with `plugin: timeline`
```

**To read one, open `docs/plugins/`.** The server writes the framework's whole
plugin set there every time the workspace opens — the same bytes that draw your
page. It is a mirror, not a source: nothing reads it to draw, a file edited
there is gone on the next open, and it is kept out of the workspace's history.

**To change one, override it: put a file in `plugins/` at the same PREFIXED
path.** The paved way is a copy of the whole plugin out of the mirror —
`plugins/biom-kanban/` from `docs/plugins/biom-kanban/`, `plugins/biom-markdown.js`
from `docs/plugins/biom-markdown.js` — and from that moment your copy draws, the
framework's is ignored, and your copy no longer follows framework updates. That
is the deal every override has, and you take it one plugin at a time. A file
under the BARE name is not an override but a plugin of your own, which the bare
name reaches first; both work, and the first is the one that says what it is.
**Copy a plugin whole**: resolution is per file, so a `plugins/biom-kanban/index.html`
on its own still gets the framework's `biom-kanban/kanban.js` underneath it,
which is right for a partial override and surprising for somebody who wanted
isolation.

**Deleting an override is how you go back.** Nothing writes the file again, and
the framework's own draws on the next read.

**A copy nobody edited is removed on open.** Workspaces made before this existed
were seeded with a copy of every plugin, and those copies went stale. So on
every open, in the background, the server checks each file in `plugins/` that
the framework also has: one that is byte for byte a version the framework ever
shipped was never edited by anybody, and it is deleted — committed first, so it
is one revert away — and the framework's current one draws instead. One changed
byte keeps a file. What this costs: a person who kept an old version on purpose,
unedited, loses it. This is a bridge for the workspaces that were seeded, and it
is sunset once they have all been opened.

## How a slot plugin gets loaded

`GET /v/<vault>/plugin/` — the route with nothing appended — answers **one
script: the framework's slot plugins minus every name your `plugins/` also has,
then your own, each set in id order.** A `plugins/markdown.js` of yours means the
framework's `markdown.js` never enters the script, so a name is drawn by one file.
The framework's go first, so a plugin of yours that uses one finds it registered.
Each file is preceded by a comment naming it and its root, and wrapped in its own
function, so **one broken plugin is one broken plugin** rather than a workspace
whose every page draws nothing. The failure reads `plugins/<file> did not load: …`
or `framework/<file> did not load: …`, naming the file and which copy, rather than
a slot somewhere saying *no plugin named "…" is registered* — which reads as the
page author's bug and is the plugin's.

A source that does not **parse** is the case a `try` cannot catch, so each one is
compiled on the server first and a file that fails is replaced by the sentence
saying so.

**The client weaves one script tag for that route and carries no list of plugin
ids at all.** What answers *which plugins does this workspace have* is your
folder union the framework's set, and this route is the only thing that computes
the union. An absent or empty `plugins/` answers the framework's set alone.

## How a page plugin is resolved

A page says `plugin: <id>`, and the host looks in three places, **in order**:

1. **the page's own `index.html`**, beside its `content.yaml`;
2. **`plugins/<id>/index.html`** in this workspace — an override, if you made one;
3. **the framework's own `<id>/index.html`**, which is never the winner.

A page that names a plugin nobody has draws a stand-in saying so. A plugin's
other files — the `kanban.js` its document names — resolve the same way, per
file.

The host resolves the document server-side for the reason it resolves everything
else: the box has an opaque origin and cannot fetch.

**`plugin: doc` is the document** and `plugin: html` — which is what leaving
`plugin:` out means — is the page's own `index.html`. Both go through exactly the
same lookup as a plugin you wrote.

**Never name a section file `index.html`.** That name is the html plugin's page
document, so a file called `index.html` beside a `content.yaml` wins over the
plugin the page named: it is injected into the body as well as drawn as a section,
its script runs once unwrapped, and the console carries an error nothing on screen
explains. Name a section file for what it is — `masthead.html`, `@page-notes.html`.

### Two files in a workspace cannot name a path into the install

A plugin's document was written to disk long before anybody knew which folder it
would land in, and the box is a `srcdoc` frame with no base to resolve a relative
`src` against. So the host spells both: a `<script data-g-src="biom-kanban/kanban.js">`
inside a plugin's own document becomes a real `src` under that workspace's own
`/plugin/` route. **No file in a workspace may name a path into the application's
own directory** — that is wrong the first time somebody moves the application.

## Four names are spoken for

`markdown`, `html`, `table` and `child` are the **part kinds** — a slot's plugin
is named by its part's type — so a second file registering one of them does not
add a plugin: it replaces the drawing of every slot of that kind in the workspace,
on every page, including pages somebody else wrote. Nothing in `content.yaml`
would say it had happened.

**`plugins/<kind>.js` is the one file that may draw `<kind>`, and
`biom-<kind>.js` the one file that may draw `biom-<kind>`.** The framework's
markdown plugin is `biom-markdown.js` registering `biom-markdown`; a `markdown`
slot reaches it because a bare name falls back to the framework's `biom-` one
when this workspace registered none of its own. Write `plugins/markdown.js`
registering `markdown` and every markdown slot draws with yours — it is nearer. It is not whoever registers first: the loader hands the page every
`plugins/*.js` in name order, so first-past-the-post would have let a file called
`0-notes.js` take `table` by sorting ahead of `table.js`. Any other file claiming
a part kind is refused in a sentence naming the kind and the file that owns it.
The set of four is the format's own, read off the part types and held equal to
them by a test, rather than a list somebody has to re-count.

**Two files claiming any other id: the first one stands and the second is refused,
naming both** — `two plugins registered as "reveal": plugins/reveal.js has it and
plugins/aaa-reveal.js is refused — rename one of them`. There is no shipped-versus-
yours: your edit of `plugins/reveal.js` *is* the reveal plugin, because nothing
is served from anywhere else. What is refused is a second file taking an id the
folder already draws.

**A `parts` entry can therefore never name a plugin of yours.** A slot's type is
markdown, html, table or child and nothing else. Yours is reached by a
`data-g-plugin` node, and it is handed `null` for its content: it is chrome,
ornament and behaviour, not a new kind of stored content. Anything with words in it
is a markdown part beside it.

## The second door: `data-g-plugin`

**A node in a section's markup can mount a plugin with no stored content at all.**

```html
<div data-g-plugin="table" data-g-table="jobs" data-g-max-rows="20"></div>
<div data-g-part="steps"></div>
<span data-g-plugin="items" data-g-for="steps"></span>
```

It is configured entirely by its own `data-g-*` attributes, which arrive as
`ctx.options` with the leading `g` taken off and the rest camel-cased:
`data-g-max-rows` reads as `options.maxRows`. **`part`, `plugin`, `scope`,
`section`, `empty`, `default` and `failed` belong to the runtime and never reach
`options`.**

That is what lets a section place a rule, a progress bar, an ambient wash, a
diagram or a list's add-and-delete **without inventing a slot in `content.yaml`
for something nobody will ever edit.**

## There are no page-level plugins

`page:` is a retired key and the reader refuses it by name. A drawing that is
about the whole stack rather than about one div is a section script marked
`data-g-scope="page"` — see [`code.md`](./code.md).

## Registering one

**A classic script, an IIFE, no imports, and registration at the top level**, so
`document.currentScript` is that file while it runs. The worked file is in
[`../.agents/skills/biom-plugins/SKILL.md`](../.agents/skills/biom-plugins/SKILL.md); this
is what `register` takes.

| | |
|---|---|
| `id` | lowercase, `^[a-z][a-z0-9-]*$` |
| `mount(node, content, ctx)` | fill this one node. Return nothing, or a teardown function |
| `edit` | optional. `true` declares this plugin's content is editable in place. It is read where the editor takes a slot over, which is where a part's type names the plugin — so it is about the part-kind plugins |
| `blocks(source)` | optional, and only meaningful beside `edit`. Answer `{start, end, tag}` for each of this content's editable blocks, so that when the slot opens as raw markdown each block is still drawn at its own size. **Omitting it is not a degraded version of it**: the content is edited as one block, which is right for content with no inner structure |

**`register` takes a plugin or refuses it out loud, and returns which.** A file
registering three plugins keeps the two that were fine — a refusal is about one
plugin, not about the file.

**`node` is the element to fill**, and nothing outside it is the plugin's
business. **`content` is the resolved part the server sent** — `{ kind, md, vars }`
for markdown, `{ kind, file, html, vars }` for an html part, `{ kind, table }`, or
`{ kind: "child", child, draw? }` — and it is **`null` for a `data-g-plugin`
node**. Both cases go through the same `mount`, because a plugin with two entry
points would be two plugins wearing one name.

**`plugins.has(id)`, `plugins.get(id)` and `plugins.ids()` are public.** `ids()` is
how an error message says what actually exists.

## `ctx.use(id)` is the entire composition mechanism

**There are no imports, and there cannot be.** The box has an opaque origin, so a
module script never loads there — it is CORS-gated and refused, while a classic
`<script src>` loads fine. That was measured rather than reasoned from the spec.
**There is no import graph to be had in here, so the registry stands in its
place**, and a plugin that wants markdown inside its cells asks for it by name:

```js
const md = ctx.use("markdown");
md.mount(cell, { kind: "markdown", md: text, vars: {} });
```

A third argument sets the mounted plugin's `ctx.options`, for the case where there
is no node with `data-g-*` attributes to read them off.

**It throws on a name nothing registered**, rather than returning null: a silent
null draws a blank cell and reads as missing data. **Ask `ctx.has(id)` first when
the dependency is genuinely optional** — that is how markdown hands a fence to the
plugin its info string names where this workspace has one, and draws an ordinary
code block where it does not.

**Everything mounted through `use` shares the parent's teardown bucket.**

## What a plugin cannot do

**`edit: true` is a declaration, not a capability.** It says *this plugin's
content is editable in place*, and the runtime does the writing. A plugin does not
save anything by writing a file, and there is no path from `ctx.call` to one: it
carries the guest port, while `section.write`, `section.order` and `section.remove`
travel a second, privileged port that never leaves the bootstrap.

What a plugin **can** change is the stored words of the section it is mounted in,
through `ctx.write` — which grants nothing a person clicking into the page could
not already type.

**Inside the box that split is a closure, not a browser guarantee**: plugin code
shares a realm with the runtime. The browser-enforced wall is between the box and
the app — no fetch, no cookies, no host DOM — and that is the boundary protecting
your files, the server and every other page. **Nothing in the box is a security
boundary.**

## A fence can be handed to a plugin

**A fenced block whose info string names a plugin this workspace carries is handed
to that plugin, in place of being drawn as code.** The markdown plugin looks the
name up and mounts it with the fence's source as an option — so a ` ```flow ` block
is drawn by your `plugins/flow.js`, with nothing else to wire up.

- **The framework names no language there.** Your `plugins/` folder is the whole of
  the list, which is what makes a drawing language this workspace's own choice
  rather than one picked for everybody.
- **The four part kinds can never be handed a fence.** ` ```html ` is an ordinary
  thing to write and means a code sample, so `markdown`, `html`, `table` and
  `child` are excluded by name.
- **A fence naming something you have no plugin for stays an ordinary code
  block** — which is the right failure, because the source is still on the page.
- **The source travels as an option rather than as content**, because a fence has
  no stored Part of its own: it lives inside somebody else's prose. That is the
  same bargain a `data-g-plugin` node makes.

**Nothing ships that draws a diagram from a fence.** A diagram here is HTML a
section draws for itself, which is what
[`.agents/skills/biom-diagrams/`](../.agents/skills/biom-diagrams/SKILL.md) is about; the
hand-off above is for a workspace that genuinely wants a diagram language and
brings its own.

---

**When to write a plugin rather than a section script, and the four things a
plugin owes every page in the workspace**, are
[`../.agents/skills/biom-plugins/SKILL.md`](../.agents/skills/biom-plugins/SKILL.md).
**Whether a drawing earns being made at all** is
[`../.agents/skills/biom-diagrams/SKILL.md`](../.agents/skills/biom-diagrams/SKILL.md).
