# What draws my page?

A page names the plugin that draws it, and that plugin decides what the rest of
`content.yaml` means.

```yaml
name: Q3 review
plugin: doc
```

| `plugin:` | What draws the page |
|---|---|
| `doc` | **the document.** Sections, slots, markdown, a type scale. For a page whose words are the point |
| absent — which means `html` | **the page's own `index.html`**, drawn exactly as written. For a page whose shape is the point |
| anything else | a document in this workspace's `plugins/<id>/index.html`. See [`plugins.md`](./plugins.md) |

**Sections exist only on a doc page.** A board has none; an html page has none.
Everything below this line is about `plugin: doc`.

## The document, key by key

```yaml
name: Q3 review                 # what a reader sees. Optional; the directory's
                                # last segment stands in, but that is an id
uid: qm4vxbco4bt2xruw           # the framework's, written in the first time the
                                # page is opened. Leave it alone; never type one
plugin: doc
variables:                      # this page's own values. See variables.md
  quarter: Q3
contents:                       # SECTIONS. Nothing else. Ever.
  - name: intro                 # no data: -> the shipped default section file
    parts:
      body: |
        We shipped {{quarter}} on time.
  - name: hero
    data: hero.html             # its own markup, its own layout
    variables:
      standfirst: Three months, four releases
    parts:
      headline: "# Ship faster"              # a string is markdown
      blurb: "{{standfirst}}"                # reading the section's own variable
      figures: { type: table, data: jobs }   # a map is a full part
      cards:                                 # a LIST: one entry per item
        - "### Alpha\n\nFirst."
        - "### Bravo\n\nSecond."
```

**A page carries `name`, `plugin`, `variables`, `input` and `contents`, and the
reader refuses anything else rather than dropping it.** `input` is the
configuration of whatever plugin the page named — see [`plugins.md`](./plugins.md). A section carries
`name`, `data`, `parts` and `variables`; a part written the long way carries
`type`, `data` and `variables`. An unknown key does not open the page at all.
That is the loud failure on purpose: a key silently dropped is a page that
half-draws and never says why. A page that will not open still has its raw YAML
available for repair.

**`contents` IS the order.** The list, top to bottom, is what a reader sees.
There is no `order:` key and no `type:` on an entry, because a section is the only
thing `contents` can hold. A table on a page is a section whose slot holds a
table — not a different kind of entry with a parser path of its own.

**A section with nothing in it draws empty and keeps its place**, which is what
makes emptying one recoverable and deleting one the act that takes its words.
**Two sections cannot share a name**: the reader keeps the first and drops the
second.

### The keys that are gone

They are refused **by name**, so a page written for an older format says so on the
first read instead of coming up half empty.

| At the top level | It used to mean | What replaced it |
|---|---|---|
| `kind:` | a page was one of a closed set the host understood | **not `plugin:`.** That key named a thing the host had a branch for; `plugin:` names a document the host has no opinion about, and the set is open |
| `render:` | one reader owned the whole sheet | a section owns its own markup |
| `order:` | it named the sections | the `contents` array is the order |
| `parent:` | a page stated its parent | the folder is the hierarchy |
| `sections:` | the same list, earlier name | `contents` |
| `page:` | a list of plugins mounted *over* the page | `plugin:` — one plugin, and it draws the page rather than being drawn on top of it. **There are no page-level plugins**; a script that is about the whole stack is a section script marked `data-g-scope="page"` ([`code.md`](./code.md)) |

| On a `contents` entry | | |
|---|---|---|
| `type:` | an entry was a content | an entry is a **section**; the types moved down into `parts` |
| `order:` `kind:` `render:` | — | gone with the render, one level up |

**There is no converter.** A machine cannot guess which sections the old page
wanted or what markup they should have had. Take the keys out and write the
sections.

## A section

**A section is a div.** It is full width of the canvas, it owns its layout
entirely, and it holds any number of plugins wherever its own HTML puts them. So
three columns of prose is **one** section with three markdown slots. Nothing in
the runtime privileges prose, a column or a reading measure.

**`data:` names an HTML file beside `content.yaml`** (or one inside `_assets/`).
HTML is code rather than prose, it is long, and it is the one thing nobody edits
in a field — so it stays a file. **Every string that file shows still belongs in
the document**: in `parts` if a person edits it, in `variables` if the markup
reads it.

**A section that names no file draws with the shipped default section** — one
centred slot called `body` at a reading measure. The default is a *file*, not a
branch in the runtime, which is load-bearing: a default living in code would be
the one shape nothing else could reach. As a file it uses the same mechanism every
other section uses.

**A file named in `data:` that is not on disk falls back to the default too.** The
slots still draw, so the words are still on screen: it reads as a section that
lost its layout rather than as a page that lost a section.

## Slots

**`data-g-part="id"` in the markup is a slot, and it is filled from that section's
`parts`. The key in `parts` is the slot's id** — there is no second statement of
it anywhere to disagree.

```html
<div class="band">
  <div class="kicker"     data-g-part="kicker"></div>
  <div class="headline"   data-g-part="headline"></div>
  <div class="cards"      data-g-part="cards"></div>
</div>
```

```yaml
parts:
  kicker: Q3 review
  headline: "# We shipped on time"
  cards:
    - "### Alpha\n\nFirst."
    - "### Bravo\n\nSecond."
```

Four things follow from how a slot is filled:

- **A plugin fills the node, and whatever the markup put inside it is replaced.**
  Write a slot as an empty element. Anything a section wants *beside* an empty
  slot — a rule, an icon, a shape — goes next to it in the markup.
- **A part naming a slot the markup does not declare never draws**, and nothing on
  screen says the words are there.
- **A slot the markup declares and the document has not filled is not a failure.**
  The editor takes it over as an empty editable region with its own prompt, so it
  is somewhere a person can click and type from the very first draw.
- **One element per slot id.** The runtime fills one node per part, so a second
  element carrying the same id is either drawn stale or not drawn at all.

**A slot id and a section name are lowercase** — `^[a-z][a-z0-9_-]*$`, no dots.
A section the server cannot name is skipped and never draws, because the name is
how the editor reorders it, how the runtime redraws it and how every finding about
it is addressed. The one other shape a section name takes is a child key,
`@page-<segment>` — see [`pages.md`](./pages.md).

## The five part types

**A bare string is markdown. A map is a full part. A list is a list of items.**

```yaml
parts:
  body:    "The base rate is {{rate}} an hour."   # markdown, the short way
  figures: { type: table, data: jobs }            # the grid for the jobs table
  calc:    { type: html,  data: calc.html }       # markup inside one slot
  sizes:                                          # the document's own table
    type: grid
    rows:
      - [Size, Width, Note]
      - [Small, 12mm, "the one most people want"]
      - [Large, 20mm, ""]
```

| `type` | what `data` is |
|---|---|
| `markdown` | **the prose itself**, inline. A fenced block naming a plugin this workspace carries is handed to it — see [`plugins.md`](./plugins.md) |
| `html` | a **filename** beside `content.yaml`, or one inside `_assets/`. Markup for one slot, where a whole section would be too much |
| `table` | a **table's name**, drawn inline as a grid |
| `child` | a **direct child**. You do not write one — see below |
| `grid` | **nothing** — a grid carries `rows` instead, the document's own table. See below |

**A `child` part is not a part you write.** It appears only inside a section whose
*name* is a child's key — `@page-notes`, `@table-jobs` — and the server puts it
there itself. The child it draws is found by matching that **section name**
against the page's children; **the part's own `data` is not consulted at all**, so
the two sides cannot drift. A `child` part written into an ordinary section finds
no child and the slot simply does not draw. See [`pages.md`](./pages.md).

The long spelling carries `type`, `data` and the part's own `variables`, and
nothing else. There is **no `name`**, because the key it sits under already stated
the id.

### A grid

**A `grid` part is a table that belongs to the document.** Its value is `rows`,
a list of lists of markdown strings, one list per row and one string per cell;
`head` says whether the first row is the header and is true when left out,
because every markdown table has one and that is where a grid comes from. It
carries no `data` — the parser refuses one — and `rows` on any other type is
refused the same way. A row shorter than the widest is padded with empty cells
on the right when the page is read, so a column is a column all the way down;
write every row the same length and the file says what the page shows.

It is drawn as a board by the framework's `biom-grid` — or by a `plugins/grid/`
of this workspace's own, which wins by existing — and **edited a cell at a time**:
click a cell and it opens as its raw markdown, Enter or leaving it writes the
rows back, Escape puts it back. A row or a column is added or removed from the
gutter outside the board — *Delete row* beside each row, *Delete column* over
each column, *Add row* under the last row, *Add column* beside the last — and
the header stays when the last row under it goes; the last column is refused
in words. A pipe typed into a cell is kept as a character; nothing splits a
cell on anything. A write from the board does not redraw the page, because the
board drew what it changed before it asked.

**It is not a `table` part.** A `table` names rows the server holds in
`workspace.db`, shared by every page that names it and edited in the app's own
grid; a grid holds its own rows in the document, so they travel with the page,
are edited on it, and are projected into the mirror as a markdown table. Which
to reach for is [`tables.md`](./tables.md).

**A markdown table in a prose part becomes one.** When the doc plugin draws a
page and finds a markdown table inside a `markdown` part — the run of pipes
that draws as a thin strip of wrapped sentences — it cuts the table out and
rewrites the document, once, in place: the prose before keeps the section's
name and its file, the table becomes a section of its own with no file whose
`body` is a `grid`, and the prose after gets a section of its own. So write a
table as a grid from the start, or write the pipes and let the next draw
convert them; what is never worth doing is styling the pipes. The rewrite
happens only when that page is drawn, so a document nobody opens is never
touched, and a document with no table in any prose part is left exactly as it
was.

**There is no diagram type and no diagram file.** A diagram is a drawing the
section makes — HTML over boxes and edges held in the section's own
`variables` — which is
[`.agents/skills/biom-diagrams/`](../.agents/skills/biom-diagrams/SKILL.md).

### A list slot

**A repeating thing is one slot holding a list** — cards, columns, panels, the
rows of a ledger. The document holds an array, one entry per item, and the runtime
draws one element per entry into that one slot, in order. The section's CSS lays
them out with `.cards > *` and **nothing anywhere names a number.**

An entry in a list is any of the five types, read exactly the same way, so a list
of markdown is the ordinary case and a list of anything else needs no second
spelling. Each entry is its own editable region: clicking one opens exactly that
entry's markdown, and the runtime numbers them with `data-g-item`.

**A list is written whole.** What the document holds is the array, so code that
adds, removes or reorders sends the array back with the change in it — see
[`code.md`](./code.md). An item plus an index on the wire would have to be right
about the index at a moment when another edit may have moved it.

**A slot with nothing in it answers `""`, not `[]`** — and writing `cards: []`
keeps an empty list that draws no items, so there is no region for a control to
write through. Leave the slot out of `parts` until there is something in it.

**There is no separator convention.** A repeating thing used to be one markdown
string that a section cut at each `###`. That was a format inside a format: a
heading somebody typed either became an item or silently did not, and the person
typing and the code parsing had to agree about something neither could see. An
item is an entry now.

## How a section is drawn

Four things happen to a section file between disk and screen.

**Its `<style>` is wrapped in `@scope (#sec-<name>)` before the section is
inserted.** So a section styles `h2`, `.wrap` or `:scope` as freely as if it were
the only thing on the page. Without that, a `<style>` element would apply to the
whole document wherever it sat, a section that styled a bare tag would restyle
every section under it, and the page would depend on the order its sections happen
to be in. **`:scope` inside those rules is the section element itself**, which is
how a section sets its own outermost layout. Where the browser has no `@scope` the
runtime uses CSS nesting, which scopes descendants the same way.

**`@keyframes` and its family are hoisted back out of the wrapper.** A
`@keyframes` block nested inside `@scope` is not a valid nested rule: the browser
drops it and the animation silently does nothing. Since a scroll-driven section is
`animation-timeline: view()` plus a `@keyframes` block, that would have broken the
headline capability of the format on the quietest possible failure. `@font-face`,
`@property`, `@counter-style`, `@import`, `@charset`, `@namespace`,
`@font-feature-values` and `@font-palette-values` are hoisted with it, for the same
reason: each names something for the whole document and has no meaning scoped to a
subtree. A name is therefore shared by every section on the page: two sections that both declare `@keyframes cap-1` are declaring one animation, and the one drawn last wins for both. **Write them where they read best.**

**The markup is interpolated as text, before it is parsed.** That is the only way
`<img alt="{{caption}}">` can work at all — an attribute value is not a node and
cannot be filled after the fact. Said plainly rather than left to be discovered:
**a variable holding a `<` will be read as markup.** The values are scalars
somebody typed into a field and the markup is the page author's own code, in a box
with an opaque origin and no credentials to steal, so nothing is escaped on the
way in.

**An `id` is document-wide, and `@scope` does not help.** One box holds the whole
page, so every section shares one document and therefore one id space. `@scope`
scopes your CSS and nothing else: two sections that each define
`<linearGradient id="fade">` collide silently and the second one drawn wins for
both. **Prefix every id in a section with the section's own name.**

## Deleting a section deletes its words

A section's entry in `contents` carries its own text, and there is no copy
anywhere else. To hide something, move it or empty it and keep the entry — which
is also what makes it come back where it was rather than at the bottom.

---

**Writing a section well** — what earns a section its own file, how many slots a
thing wants, the add and delete every section owes its reader, and the numbered
rules — is
[`../.agents/skills/biom-sections/SKILL.md`](../.agents/skills/biom-sections/SKILL.md).
Values inside `{{…}}` are [`variables.md`](./variables.md); a section's `<script>`
is [`code.md`](./code.md).
