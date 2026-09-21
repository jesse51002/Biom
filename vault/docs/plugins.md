# Where does a plugin come from?

**A plugin fills one node, or draws one page.** Everything on screen is one: the
prose in a slot is the `markdown` plugin, a grid is `table`, a child's row is
`child`, and the document itself is `doc`. There is no privileged path underneath
any of them.

## Every plugin is a folder, and the folder has one shape

**`plugins/<id>/` is a plugin, and there is no other shape.** Directly inside
it:

```
plugins/timeline/
  timeline.js         <- every .js directly inside is the plugin's own script, loaded in name order
  index.html          <- if present, the document a page names with `plugin: timeline`
  plugin.yaml         <- its variables, each with its default — flat, a key and a value, nothing around them
  plugins/            <- inner plugins, each a folder of this same shape, to any depth
    marks/
      marks.js
```

**The shape is the same in the three places a plugin folder can sit** — the
framework's own set, this workspace's `plugins/`, and a page's own `plugins/`
beside its `content.yaml` — and the loader refuses anything else by name. A
loose `plugins/reveal.js` is the old shape, and the page tells you where to
move it: `mkdir plugins/reveal && mv plugins/reveal.js plugins/reveal/` is the
whole migration. A folder whose name is not an id — `My Plugin/` — is refused
the same way. Anything else loose in `plugins/` — a README, a note — is left
alone.

**The folder is the id.** `plugins/timeline/` is `timeline`, whatever its
scripts are called. Inner ids are free: a script under `plugins/timeline/plugins/marks/`
registers whatever it registers, and the folder is organisation rather than a
namespace. A page's `plugins/` sits beside `content.yaml` and `children/`,
never inside `children/`, so a page may still be called `plugins`.

## The framework's plugins are the rung underneath yours

**Every plugin the framework ships is called `biom-<name>`, folder and id
alike, and you keep saying the bare name.** `plugin: doc` in a page,
`data-g-plugin="reveal"` in a section and a `markdown` slot all resolve
nearest-first: a plugin of yours under that name if you wrote one, the
framework's `biom-doc`, `biom-reveal` or `biom-markdown` otherwise. So a plugin
you write can never share a name with one the framework ships later — under
bare names it would have been refused as the framework's duplicate on every
page, the day the framework shipped it, with nothing saying so. **And a script
of yours may not register a `biom-` id**: the prefix is the framework's, and
the registry refuses one by name.

**Your `plugins/` folder holds only what you wrote, and what you changed about
the framework's.** Nothing is copied into it. When a page names a plugin, the
server looks in your folder first and in the framework's set second, so a
fresh workspace has no `plugins/` at all and every page still draws, and every
workspace follows a framework release the moment it is installed.

**To read one, open `docs/plugins/`.** The server writes the framework's whole
plugin set there every time the workspace opens — the same folders, the same
bytes that draw your page, `plugin.yaml` included. It is a mirror, not a
source: nothing reads it to draw, a file edited there is gone on the next
open, and it is kept out of the workspace's history.

## A plugin's variables come in three rungs, and that is how you change one

**A plugin declares the variables it reads, each with a default, in its own
`plugin.yaml`.** The framework's document, for instance:

```yaml
head:               # the plugin mounted before the stack — nothing, by default
foot: biom-holds    # the plugin mounted after it — the framework's board of children
rows: false         # whether the bare child rows are drawn as well
convert: true       # whether a markdown table in a prose part is cut out into a grid section
```

**You change a variable in `plugins/biom-<id>/extensions.yaml`**, and a page
changes it again for itself in the same file beside its own `content.yaml`:

```
plugins/biom-doc/extensions.yaml                       <- this workspace's rung
pages/home/children/Specs/plugins/biom-doc/extensions.yaml   <- that page's rung, reaching that page only
```

**Nearest wins, one key at a time.** The plugin's own defaults, then the
workspace's file, then the page's: a rung naming one variable changes that one
and every other keeps the rung beneath. A variable is a scalar or a list of
scalars, never a map, so there is nothing deeper to merge. **Empty is a value**:
`foot:` with nothing after it wins over the rung beneath and mounts nothing.
Deleting a rung's file is the whole undo.

**A value is typed by its default's own type.** `true` makes a boolean, `3` a
number, a list a list of scalars, a word a string — and a null default, like
`head:` above, accepts anything. What is refused, in a sentence naming the file,
the plugin and the key, with the page drawing on the rung beneath: a map where
a scalar goes; a key the plugin does not declare, which is a typo; a value of
the wrong type; and a file that will not parse, which is skipped whole. The
sentence reaches the page's console and the status strip, once, and the checker
says it too.

**A folder wearing `biom-` holds `extensions.yaml` and nothing else.** It is an
extension of the framework's plugin, not a copy of it: a script or a document
dropped into it is refused by name and never draws. There are no file-based
overrides. A workspace that wants a document of its own writes a plugin of its
own under a bare name — `plugins/doc/index.html` — and every page saying
`plugin: doc` draws with it; from that day it is yours to keep current.

**A plugin reads its variables in the box through `biom.plugin.extensions()`** —
its own when the id is left out, any plugin's by id — merged by the server and
carried on the page read, so the answer is there synchronously and current on
every draw. The framework carries the values and reads none of them: what
`head` means is the document's business, and its `plugin.yaml` is where it
says so. Nothing enforces the file at run time; it is read to merge, by the
checker to catch a typo, and by you to know what a plugin can be told.

## A variable can name a plugin, and that is how a piece is swapped or added

**The `doc` document draws one node before the stack and one after, reads
`head` and `foot`, and mounts the plugin each names** — exactly as a section
mounts a `data-g-plugin` node, with the same context and the same containment,
so a plugin that throws fails in its node in words and the stack draws. That is
the document reading two of its own variables, not a framework feature: the
runtime has no notion of a point, and a plugin that wants extending draws a
node and reads a variable.

So the board of children under every document is `foot: biom-holds`, one line
in the framework's own `plugin.yaml`. Another board is `foot: my-board` in a
rung and a plugin of yours called `my-board`. No board is `foot:` with nothing
after it. A look for the board is a plugin of yours named at `head` that
appends a `<style>` — a plugin mounted from a document's variable may carry a
look, because the document asked for it. And the board is an ordinary plugin,
so a section may place it where it likes with `<div data-g-plugin="biom-holds">`
and the page's rung empties `foot`.

**The order to try things in**: change a variable where the plugin declares
one; name a plugin of your own in a variable where the plugin reads one; write a
plugin of your own under a bare name where you want the whole thing. The first
two follow every framework release. The third is yours to keep current, and
that is the whole of what it costs.

## How the plugins get loaded

`GET /v/<vault>/plugin/` — the route with nothing appended — answers **one
script: every plugin folder in the framework's set, then in your `plugins/`,
then in every page's own `plugins/` in page order; within a folder its own
scripts in name order, then its inner plugins.** A page-level plugin's script
loads on every page and only that page's rung names it — the cost of one tag
that is the same for every page, and cheaper than a document that differs per
page, which is a box rebuilt on every navigation. A page plugin's own script —
the board's, the map's — is in the bundle like any other, and draws only where
its root node is on the page.

Each file is preceded by a comment naming it and its root, and wrapped in its
own function, so **one broken plugin is one broken plugin** rather than a
workspace whose every page draws nothing. The failure reads
`plugins/<folder>/<file> did not load: …` or `framework/<folder>/<file> did not
load: …`, naming the file and which copy, rather than a slot somewhere saying
*no plugin named "…" is registered* — which reads as the page author's bug and
is the plugin's. A loose script, a stray file in a `biom-` folder and a folder
that is not an id come out of the same walk as sentences and are said the same
way.

A source that does not **parse** is the case a `try` cannot catch, so each one is
compiled on the server first and a file that fails is replaced by the sentence
saying so.

**The client weaves one script tag for that route and carries no list of plugin
ids at all.** What answers *which plugins does this workspace have* is the
folders, and this route is the only thing that reads them. An absent or empty
`plugins/` answers the framework's set alone. In the box, `biom.plugin.list()`
answers every registered plugin and where it came from — framework, vault or
page — and `biom.plugin.get(id)` answers one, as `ctx.use` finds it.

## How a page plugin is resolved

A page says `plugin: <id>`, and the host looks in three places, **in order**:

1. **the page's own `index.html`**, beside its `content.yaml`;
2. **`plugins/<id>/index.html`** in this workspace, under the bare name — a plugin of your own;
3. **the framework's own `biom-<id>/index.html`**, which a workspace never shadows.

A page that names a plugin nobody has draws a stand-in saying so. A document
under a `biom-` folder in your workspace is not read: that folder is an
extension and holds a rung alone.

The host resolves the document server-side for the reason it resolves everything
else: the box has an opaque origin and cannot fetch.

**`plugin: doc` is the document** and `plugin: html` — which is what leaving
`plugin:` out means — is the page's own `index.html`. Both go through exactly the
same lookup as a plugin you wrote, and so does every other document the
framework ships — `docs/plugins/` lists them, each folder's `index.html` the
document and its `plugin.yaml` what a rung can tell it. **`plugin:
automations-runs` shows a page's children one at a time, newest first**, each
filling the frame between a strip to the newer and a strip to the older, the
bar naming the child by its H1; it reads three variables — `home`, a plugin
drawn as the slide the page opens on when nothing is running; `progress`, a
plugin drawn first while its node is shown, handed over hidden and shown by
the plugin itself; `skip`, child names never shown — and knows nothing about
runs beyond its name. `biom.plugin.extensions()` on a page drawn by
its own `index.html` answers the `html` plugin's rungs — nothing, unless you
wrote some.

**Never name a section file `index.html`.** That name is the html plugin's page
document, so a file called `index.html` beside a `content.yaml` wins over the
plugin the page named: it is injected into the body as well as drawn as a section,
its script runs once unwrapped, and the console carries an error nothing on screen
explains. Name a section file for what it is — `masthead.html`, `@page-notes.html`.

### A file in a workspace cannot name a path into the install

A plugin's document was written to disk long before anybody knew which folder it
would land in, and the box is a `srcdoc` frame with no base to resolve a relative
`src` against. So the host spells it: a `<script data-g-src="timeline/lib/vendor.js">`
inside a plugin's own document becomes a real `src` under that workspace's own
`/plugin/` route. Every `.js` directly inside a plugin folder is already in the
bundle every page carries, so a file named this way must be one the walk does
not take — a library in a subfolder of its own, `plugins/timeline/lib/`, and
never one beside the plugin's script, which would run twice.
**No file in a workspace may name a path into the application's own directory**
— that is wrong the first time somebody moves the application.

## Five names are spoken for

`markdown`, `html`, `table`, `child` and `grid` are the **part kinds** — a slot's plugin
is named by its part's type — so a second plugin registering one of them does not
add a plugin: it replaces the drawing of every slot of that kind in the workspace,
on every page, including pages somebody else wrote. Nothing in `content.yaml`
would say it had happened.

**`plugins/<kind>/` is the one folder that may draw `<kind>`, and the
framework's `biom-<kind>/` the one that may draw `biom-<kind>`.** The framework's
markdown plugin is `biom-markdown/markdown.js` registering `biom-markdown`; a
`markdown` slot reaches it because a bare name falls back to the framework's
`biom-` one when this workspace registered none of its own. Write
`plugins/markdown/markdown.js` registering `markdown` and every markdown slot
draws with yours — it is nearer. It is not whoever registers first: the loader
hands the page every folder in name order, so first-past-the-post would have let
a folder called `a-notes/` take `table` by sorting ahead of `table/`. Only a
folder at the top of this workspace's `plugins/` may: not an inner one, and not
a page's, because one script serves every page and a part kind is every page's.
Any other file claiming a part kind is refused in a sentence naming the kind and
the folder that owns it. The set of five is the format's own, read off the part
types and held equal to them by a test, rather than a list somebody has to
re-count.

**Two files claiming any other id: the first one stands and the second is refused,
naming both** — `two plugins registered as "reveal": plugins/reveal/reveal.js has
it and plugins/aaa-reveal/aaa-reveal.js is refused — rename one of them`. There is
no shipped-versus-yours: your `plugins/reveal/` *is* the reveal plugin, because
nothing is served from anywhere else. What is refused is a second file taking an
id the folder already draws, at any depth and from any root.

**A `parts` entry can therefore never name a plugin of yours.** A slot's type is
markdown, html, table, child or grid and nothing else. Yours is reached by a
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
how an error message says what actually exists. **`biom.plugins` is the
registration side and `biom.plugin` the reading side**: `biom.plugin.list()`,
`biom.plugin.get(id)` and `biom.plugin.extensions(id?)`, and a test holds the two
`get`s equal.

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
is drawn by your `plugins/flow/`, with nothing else to wire up.

- **The framework names no language there.** Your `plugins/` folder is the whole of
  the list, which is what makes a drawing language this workspace's own choice
  rather than one picked for everybody.
- **The five part kinds can never be handed a fence.** ` ```html ` is an ordinary
  thing to write and means a code sample, so `markdown`, `html`, `table`,
  `child` and `grid` are excluded by name.
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
