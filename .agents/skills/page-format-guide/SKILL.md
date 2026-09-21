---
name: page-format-guide
description: >-
  The single source of truth for THE VAULT FORMAT and its server-side
  implementation — what a page is on disk, and the code in `server/` that reads,
  resolves and writes it. Covers `content.yaml` as the whole page and the fact
  that it is REQUIRED, `contents` as `Section[]` and nothing else (no `type`
  key, no `kind:`, no `render:`, no `order:` — the array IS the order), a
  section's `data` naming its html file and omitting it resolving to the shipped
  default section FILE, `parts` as slot-id → what goes in it with a bare string
  meaning markdown and a map meaning a full `Content`, each part type and what
  `data` means for it, page ids as paths with the folder as the
  hierarchy, child keys as ONE SEGMENT never a path, additive-only child
  reconciliation, the parent-vs-child drawing precedence, why resolution into
  `DrawnSection[]` is mandatory and server-side, the three-deep nearest-wins
  variable scope and why interpolation happens at draw time, the write paths and
  their commit policy, a page as the unit of a fault, the retired keys refused
  by name and why there is no converter, and THE FOUR INDEPENDENT READERS of
  `content.yaml` that must agree. Load this whenever you touch
  `contracts/types.ts` (`Section` / `Content` / `Part` / `DrawnSection` /
  `Page`), `server/domain/pages.ts`, `server/platform/yaml.ts`,
  `server/domain/docs.ts`, `server/domain/design.ts` or `skill/check.ts`.
  Trigger on "content.yaml", "the vault format", "contents", "parts", "sections",
  "DrawnSection", "page.read", "section.write", "section.order",
  "section.remove", "childKey", "@page-", "child.html", "pageDir", "docOf",
  "checkDoc", "contentOf", "drawSection", "FlatnessError", "vault format 3",
  "migrate", "the raw fallback", or any change to what a page is on disk.
---

# The vault format — a page is a directory, and one file is the page

The agent-legibility test for this format is the paragraph at the top of
`server/domain/pages.ts`: everything a coding agent that has never seen the
layout needs, in one paragraph. Read it first. This skill is the rationale around
it — why each rule is the way it is, and which failure it is protecting against.

This skill owns the format and its server implementation. It does **not** own:

- **What the runtime does with the resolved page** — drawing, `@scope`, slots,
  scripts, teardown → `section-runtime-guide`.
- **What fills a slot** — `register`, `mount`, `ctx` → `plugin-guide`.
- **How a page reaches the box at all** — the sandbox, the ports, the three rings
  → `boundary-guide`.
- **How to AUTHOR a page as a vault user** — that is the vault's own
  `.agents/skills/biom-pages/SKILL.md`, shipped inside the workspace. This skill is for
  whoever changes the reader; that one is for whoever writes the file.

---

## 1. A page is a directory, and `content.yaml` is required

`pages/` holds the root page; every other page lives inside somebody's
`children/`. **A directory is a page if and only if it contains `content.yaml`**,
and a page's id is the path of the segments that reach it —
`pages/home/children/clients/children/ashgrove/` is `home/clients/ashgrove`.

**A page directory without a `content.yaml` is not a page, and `page.read`
answers `not_found`.** That is a deliberate tightening: a silently empty page is
a page somebody spends an afternoon looking for the missing half of.

**THE FOLDER IS THE HIERARCHY.** There is no `parent:` key, because a second
statement of a fact is a chance for the two to disagree. `parentOf` and
`segmentOf` in `contracts/types.ts` derive a page's parent from its id, so it can
never disagree with where the page actually is. Moving a page is therefore a real
filesystem move, the page's id **changes**, and **every id beneath it changes
too** — a cascade paid rather than hidden, which is why `page.move` answers the
NEW id and nothing in the vault forwards an old one.

**ONE FILE HOLDS EVERYTHING A PAGE SAYS, and no `.md` file is ever read.** An
agent asked to change what a page says opens one document rather than a sidecar
for the shape and a file per section for the words. **What that costs is stated
rather than hidden**: a `content.yaml` that will not parse now loses the page's
prose as well as its shape. The answer is that the vault is a git repo, the server
commits ahead of every agent write, and the raw fallback (`doc.raw` /
`doc.writeRaw`) still hands the text back for repair by hand.

**`<vault>/_markdown/` is the exception that proves it: markdown the host WRITES
and never reads.** Every page renders itself as markdown into a file there,
derived and read-only, so a tool that reads markdown files can read this
workspace — a brain, Obsidian, a grep. Nothing is ever authored by editing one;
the next projection overwrites it. `server/domain/mirror.ts` owns the folder,
`contracts/projection.ts` the rule for a doc page, and the box computes its own
for every other kind and reports it over `page.projection`.

Names starting with `_` or `.` belong to the host — one rule, true everywhere
including the database, and `_markdown/` is under it. `_assets/` is per-page host
bookkeeping; a page's own `plugins/` is the other reserved subdirectory — its
plugins and its rung over any plugin's variables, never a page, walked by
`pageDirs` for the loader and read by `extensionsFor` for the page's read;
`children/` is the tree; the root-level `assets/` beside `pages/` is the
shared, served, never-parsed one; `plugins/<id>/index.html` is a plugin this
workspace wrote, reached exactly as the framework's own is.

**`markdown.yaml` beside it is the page's type scale**, and it is the one other
file the reader looks for by name. See §12.

---

## 2. `plugin:` names what draws a page, and `contents` is the DOC plugin's input

```yaml
name: Q3 review
plugin: biom-doc
variables:
  quarter: Q3
contents:
  - name: intro
    parts:
      body: |
        We shipped {{quarter}} on time.
  - name: hero
    data: hero.html
    parts:
      headline: "# Ship faster"
      figures: { type: table, data: jobs }
```

**A PAGE NAMES ONE PLUGIN AND THAT DECIDES HOW THE REST IS READ.** `plugin: html`
is the default and means the page's own `index.html`; `plugin: biom-doc` is the section
runtime and reads `contents`; a `biom-` id is a document the framework ships, a bare
id is a document in this workspace's own `plugins/<id>/`, and either reads whatever
the page put under `input:`. The name is the folder — `frameworkPlugin` in
`server/domain/pages.ts` puts nothing on and takes nothing off, and vault format 5 in
`server/workspace/migrate.ts` refuses a workspace still saying the bare `doc`. A plugin's configuration goes UNDER `input:`
so the host's keys and the plugin's cannot collide — a board names the column its
cards are titled by, and the obvious key for that is `name`, which the page has
already spent.

**This is not `kind:` returning.** That key claimed a page was one of a closed set
the host understood, and each of them was a branch in the host. This one names a
DOCUMENT, the host has no opinion about what it does, and the set is open: the
framework's own plugins are the rung UNDER the workspace's `plugins/`, resolved
by the same lookup, so the framework's own and one a workspace wrote are the same
shape of thing — and what a workspace changes about the framework's is its
VARIABLES, in `plugins/biom-<id>/extensions.yaml`, never a file at its path:
`plugin-guide` §7 carries the three rungs and `Page.extensions` carries the
merge.

**SECTIONS ARE THE DOC PLUGIN'S CONCEPT.** A board has none; an html page has
none; child reconciliation, `section.order` and the whole section runtime belong
to `doc` alone. **There is no `type` key on a section**, because a section is the
only thing `contents` can hold and *a key that distinguishes nothing is a key that
can be written wrong*. A table on a page is a section whose one slot holds a table — not
a different kind of entry with its own parser path. **One shape, one code path,
all the way down.**

**There is no `kind:`, no `render:` and no `order:`.** `contents` **IS** the
order: no `index:`, no second statement of position that could disagree with the
first. `kind:` went because a page whose whole reason to exist is the surface it
draws is one section whose `data` names the file that draws it, so there was
nothing left for it to distinguish. `render:` went with the render layer — one
render owned the whole sheet, so a page had exactly one treatment and prose was
one column at one measure. **A section is a div**: full width, its own layout,
any number of slots wherever its own html puts them. Three columns of prose is
ONE section with three markdown slots, which the shape before this could not
express at all.

**Every retired key is refused BY NAME, with the sentence that says what replaced
it.** `yaml.ts` carries that map, so a file written for an older format is told
which format it was written for rather than "unknown key". An unknown key is
refused rather than dropped: a page that is not a page is a broken page, not a
quiet one.

**A workspace still carrying one of them is vault format 1 or 2, and
`server/workspace/migrate.ts` refuses it by name — before a single module that
could read a page is constructed.** **There is no converter and there will not be
one**: a section IS its markup, and the markup lived in the render layer rather
than in the vault, so a conversion could only flatten every page into the default
section and call it migrated.

---

## 3. A section: its name, its html, its slots, its values

| key | meaning |
| --- | --- |
| `name` | unique within the page. `^[a-z][a-z0-9_-]*$`, or a child key like `@page-notes` |
| `data` | a FILENAME beside `content.yaml`, holding this section's own html. **Omitted resolves to the shipped default section** |
| `parts` | slot id → what goes in it, one entry per `data-g-part` the html declares |
| `variables` | this section's own values, in scope for every slot in it |

**`data:` omitted resolves to `guest/sections/default.html`**, and
`DrawnSection.fallback` says so. **The default is a FILE and not a branch** — a
default living in the runtime would be the one shape nothing else could reach,
and "the document" would be privileged again. `section-runtime-guide` §3 carries
the full argument; the format's half of it is that a defaulting section is
spelled by an *absence*, so nothing has to be written to get the floor.

**A file NAMED in `data` that is not on disk also takes the default**, and
`fallback` is true either way. The slots still draw, so the words are still on
screen and the fault reads as a section that lost its layout rather than a page
that lost a section.

**HTML stays a file rather than going inline** because html is code rather than
prose, it is long, and it is the one thing a person is not editing in a field.
**Every string it *shows* still belongs in the document** — in `parts` when a
person reads it as prose, in `variables` when the markup reads it. See §4.

---

## 4. A slot: a string is markdown, a map is a `Content`, an array is a LIST

**A slot's id is its key in `parts`.** A `Content` has **no `name` of its own** —
the map already states it, and a second statement is a chance for the two to
disagree. That is why `section.write` names a page, a section **and** a part.

**A bare string is markdown**, because prose is most of what a slot holds and
`body: "..."` should not need a wrapper. A map is a full `Content` with a `type`
and a `data`, so a slot takes a table or a child just as easily — or a `grid`,
whose value is `rows` rather than `data`. A bare number or
boolean is prose YAML read as a value (`body: 2026`) and reads back as its own
text rather than being refused over a missing quote.

**AN ARRAY IS A LIST**, and it is how a repeating thing is written:

```yaml
parts:
  items:
    - |-
      ### Alpha

      First.
    - |-
      ### Bravo

      Second.
```

`PartValue` is `string | Content | (string | Content)[]`, and a list resolves to
`{ kind: "list", items: Part[] }` — each entry a `Part` in its own right, drawn
as one element into the one slot, tagged `data-g-item="<i>"`, and edited as its
own region. `items` never holds a list itself.

**It exists because the alternative was a format inside a format.** A repeating
thing used to be one markdown string that a section cut up at each `###`, and
that fails in both directions: a heading typed by hand either becomes an item or
silently does not, and a section changing its mind about the separator silently
re-reads every page written against the old one. The person typing and the code
parsing had to agree about something neither could see. An item is an element
now, so there is nothing to agree about.

**A list is written WHOLE.** `section.write` carries `string | string[] |
string[][]`, and for a list the whole array goes back with the edited entry in it — a wire carrying
one item plus an index would have to be right about the index at a moment when
another edit may have moved it. Each entry keeps its own spelling where the
lengths line up, so a plain list stays plain and a `variables` on one item is not
lost because its neighbour was typed in.

**An empty list is a real answer** and survives every reader: it is what a slot
holds before the first item is added, and dropping it would leave nowhere for the
first write to land.

| `type` | what `data` is |
| --- | --- |
| `markdown` | the markdown itself, RAW, `{{name}}` and all |
| `html` | a filename beside `content.yaml` (optionally one level down in `_assets/`) |
| `table` | the table's name |
| `child` | the direct child's **segment** — `notes`, never a path. Placed by reconciliation, not written by hand |
| `grid` | **nothing, and never written**. A grid carries `rows` — a list of lists of markdown strings — and `head`, whether the first row is the header (absent is true). The one type whose value is not a string, because a cell is a cell and never a string somebody splits |

**A GRID IS THE DOCUMENT'S OWN TABLE**, and the fifth kind was added at its own
barrier (2026-09-17). Its `Content` carries `rows` and `head` beside the three
keys every other part has; the codec reads rows square — a short row padded on
the right — refuses `data` on a grid and `rows` on anything else by name, and
writes the rows back one per line in flow style, `- [Piece, Where]`, quoting a
cell that holds a comma, a pipe or a line break. It resolves to
`{ kind: "grid", rows, head, vars }` with the cells RAW for the reason `md` is.
`writeSlot` takes `string[][]` for a grid slot and replaces `rows` alone —
`head` and the part's variables are not on the wire and stay as they were —
and refuses rows on any other slot as it refuses prose on a grid. The
projection writes it into the mirror as a markdown table again, pipes escaped
and line breaks as `<br>`; `guest/runtime/project.js` carries the same arm.
The conversion that makes one out of a markdown table in a prose part is the
doc plugin's, in `guest/plugins/biom-doc/index.html`, and goes through
`section.write` and `section.order` — `section-runtime-guide` §10.

**The two readings of `data` are the one wart in this shape, and they are worth
it**: inlining an html file would put a program inside a document, and pointing at
a markdown file would give back the second read this format exists to remove.
A grid's `rows` beside an empty `data` is the second wart, and it is worth it
for the same reason a list slot is: a two-dimensional array is the shape of the
thing, and a string somebody splits is a format inside a format.

**There is no `diagram` type.** A diagram is a ` ```mermaid ` fence inside
markdown, upgraded in place by the mermaid plugin — the file type was a mechanism
invented for a case that already had one.

**The short spelling survives a save.** `contentOf` canonicalises for reading,
but `sectionOf` and `writeSlot` keep whichever spelling the document actually
used, so an edit to a plain paragraph does not rewrite `body: hello` into a
three-line map.

**A markdown part is the ONLY editable region on a page**, which turns this
section into an authoring standard rather than a menu: **all text is markdown,
in `content.yaml`, behind a slot; a section's html file carries the visuals and
the structure and none of the words**, because a word baked into an html file is
a word nobody can ever edit. Text inside an `<svg>` is the one exception — it is
part of a drawing. `section-runtime-guide` §11 carries the mechanism this is a
consequence of, `vault/.agents/skills/biom-sections/SKILL.md` carries the rule for
whoever writes a page, and `skill/check.ts` WARNs on it as **R56**.

---

## 5. Variables nest three deep, and the NEAREST one wins

Page, then section, then part. `{{rate}}` inside a part resolves against that
part's own `variables` first, its section's second, and the page's third — so a
bare name is always the closest one and never a surprise.

**Reaching further than the page is a CALL and never a template.** `{{name}}`
stays inside one page so prose can be read without chasing it, and a page that
depends on a page somebody else may rename fails visibly at the `variables` call
rather than leaving a blank in a paragraph.

**Interpolation happens where the part is DRAWN, not where it is read.** The
markdown comes back over the wire raw, with its braces still in it. **Prose is
editable in place and writes back**, so resolving on the server would round-trip
`62` over the top of `{{rate}}` and destroy the variable the first time somebody
touched the paragraph it sits in. `Part.vars` is what to resolve against, already
merged nearest-first by the server.

**A variable is a scalar or a list of scalars, and nothing else.** Flatness is
what makes one key map onto one editable region. Anything nested is refused at the
door by `yaml.ts` and dropped by the tolerant reader in `pages.ts` — and refused
on the wire by `isVarValue` in `contracts/guards.js`.

**The wire addresses a section and stops there.** `variables.patch` carries a
page and a section; `data.set` carries a mount and lands on the page. A slot's own
`variables` are the innermost scope and nothing on the wire names one — a value a
slot alone should hold is written into that slot's `Content` by hand. That is a
deliberate narrowing, not a gap: `mergeVariables` refuses a section that has gone
rather than landing the value one scope out, where it would silently change what
every other section on the page says.

---

## 6. There is no folder; a page that draws its children is what a folder was

Two layers, and keeping them apart is the point.

**Layer one, the data.** `children(id)` reads the **filesystem** — the
directories under `<dir>/children/` that hold a `content.yaml`, plus every table
whose registry parent is this page — normalised into `Child`. Nothing reads a
claim about who a parent is, and nothing has to read every page in the vault to
find out who claims this one. It is available to every page through
`biom.children()` **whether or not the page draws any of them**, which is
what makes the built-in drawing replaceable rather than privileged: a replacement
reads the same data through the same call.

**Layer two, the drawing.** On every read, each child is guaranteed a **section**
whose name is `childKey(child)`, holding one part of type `child` in the slot the
shipped default section declares.

**Reconciliation is ADDITIVE ONLY.** A section already in `contents` is left
exactly where it is, because the order of a page is somebody's decision and
reconciliation is not entitled to revisit it. A missing one is appended
at the bottom, which is what happens when you add something to a folder. A section
whose child has gone **does not draw and keeps its place**, so a child that comes
back returns to where it was. The reconciled additions are persisted — otherwise
the position would not survive the next read — but **only when something was
actually added**, or a rewrite on every read would put a commit in the vault every
time a page was opened.

**A CHILD KEY IS ONE SEGMENT, NEVER A PATH.** `childKey` is
`@<kind>-<segmentOf(id)>` for a page and `@table-<name>` for a table. A page's
`contents` only ever names its **direct** children, so the key is scoped to the
file it appears in, two parents may each hold a "notes" without colliding, and it
stays a legal filename — because customising an entry means writing
`@page-notes.html` beside the document. **The hand-copy of this rule in
`guest/biom.js` was wrong for a long time and drew every nested page's child
row blank; `boundary-guide` §7 tells that story.**

One character decides whether a name is a child key, and the section-name pattern
excludes that character, so no name is ever both. The rest of the key is never
re-parsed: the child is found by matching `childKey`, so the two sides cannot
drift.

**Drawing is replaceable from EITHER end, and the two do not compete.**

- **The PARENT decides for one arrangement** — `@page-ashgrove.html` beside its
  own `content.yaml` becomes that section's markup. **It wins**, because a parent
  is looking at this particular arrangement and the child is not. When it wins,
  the child's own file is not sent: it would be markup nothing asked for.
- **The CHILD decides for everywhere else** — `child.html` in its **own**
  directory, read from there and carried on the part as `draw`. A page knows how
  it wants to be summarised better than every page that might hold it, and one
  file travels with it instead of one per parent going stale behind it.
- **Absent both, the child plugin draws its built-in row.** Deleting `child.html`
  is therefore a supported act rather than a broken page, which is why nothing on
  the read path ever puts it back. A table has no directory, so it has nowhere for
  a `child.html` to be and none is looked for.

**A child key is not deletable through `section.remove`**, and the server says so
rather than pretending: the entry would only reappend at the bottom on the next
read, so the user would click delete and watch it come back. Deleting the child is
what removes it; deleting its `.html` is what reverts the section to the default
drawing. `section.order` applies the same rule from the other side — a stored
child section the caller left out is **put back at the index it had**, and a child
key the caller **invented** is refused.

---

## 7. Resolution is mandatory and server-side

**`page.read` answers `DrawnSection[]`, not the stored `Section[]`.** Every
section's html is loaded, every part is resolved, and every variable scope is
gathered before the answer leaves the server.

**That is not an optimisation.** The runtime that draws the page lives in an
opaque-origin frame and **cannot fetch** — so a part that named a file and
expected the guest to load it would simply never draw. The one thing that does
arrive by URL is **code**, as a classic `<script src>` from `/guest/`, `/vendor/`
or the vault's own `/plugin/`, which is the one subresource an opaque origin may
still load. `boundary-guide` §1 has the measurement.

Keeping `Content` (stored) and `Part` (resolved) apart is what confines a format
change to the server. `drawSection` is exported and shared, because `pages/` is
not the only page-shaped directory in the vault: `design/` is read the same way.
**They each had their own copy of the resolver once, and when a file form arrived
it reached exactly one of them — a diagram in the design doc read as an empty
markdown block, silently.** Two copies of a rule is two chances to have a
different one.

---

## 8. The write paths, and which of them commits

| operation | what it writes | commits first? |
| --- | --- | --- |
| `writeSlot` (`section.write`) | ONE part's `data`, in place | **no** |
| `setSections` (`section.order`) | the whole `contents` list | yes |
| `removeSection` (`section.remove`) | the entry, plus every file it named | yes |
| `merge` (`data.set` / `variables.patch`) | one scope's variables | **no** |
| `writeRaw` (`doc.writeRaw`) | the user's own bytes, after checking them | yes |
| `writeFile` (`page.writeFile`) | one file in the page directory | yes |
| child reconciliation, on read | the appended child sections | no (and only when something was added) |

**`writeSlot` and `merge` do not commit because they are keystroke paths.** A
commit per debounce would bury the agent writes the vault's history exists to make
undoable. `writeSlot` touches **one slot and nothing else** for the same reason:
the file is read, one part's `data` is replaced, the file is written back — so a
value that arrived from somewhere else between two keystrokes survives, where a
write carrying the whole document would put the screen's idea of the page over the
top of it. **Only a markdown part holds its own text**; writing prose into an
`html`, `table` or `child` part would not be an edit, it would be the destruction
of the pointer, and it is refused.

**`setSections` matches entries BY NAME.** A name already in the document keeps
its own section — its markup, its slots and its variables — and takes only its
new position, so a reorder built from what is on screen can never write a stale
paragraph back over a newer one. It does **not** delete a file; `section.remove`
is the operation that owns a section and everything on disk behind it, in one
request and one commit for one thing the user did.

**`docs.ts` serialises writes per page.** Every write there is a read-modify-write
over a whole file, and two overlapping patches — an artifact saving a slot while
the user edits the prose two sections down, an entirely ordinary pair of things to
be happening at once — would both read the same text, both write a whole document
back, and the first one's value would be gone with **nothing thrown and both
callers told they succeeded**. That is what makes it worth serialising rather than
detecting. It is keyed by page because the unit of the file is the page; it is a
promise chain rather than a lock file because the server is one process.

**`writeRaw` writes the user's own bytes, not a reformat.** They typed it, it
parsed, it is theirs — and it holds their prose now, so a reflow is not cosmetic.
It checks strictly **before** writing, because the surface that exists to repair
the file must not be able to corrupt it.

**Nothing on a write path ever rewrites a file it could not read.** Opening a
broken page, saving a paragraph through it, or removing a section from it would
otherwise be the act that emptied it.

---

## 9. A page is the unit of a fault

A `content.yaml` that will not parse loses **one page and never the tree**. The
broken page still lists and still opens — with no sections and its own directory
segment for a name — which is exactly enough to reach the raw fallback and repair
it. Every other page is untouched. One unreadable file used to fail the entire
tree, so a single pasted character emptied the rail and made every good page
unreachable.

A page whose document will not parse **still has children**: they are in its
`children/` directory, which is not the file that broke. It just has no say in
the order they come back in.

---

## 10. THE FOUR INDEPENDENT READERS OF `content.yaml`

This is the sharpest maintenance hazard in the format, and it must be named.
**Four separate pieces of code read this file, on purpose, and they must agree.**

| reader | what it is | what it does with a bad document |
| --- | --- | --- |
| `server/platform/yaml.ts` | the codec over the vendored `yaml` parser — the door into the format | **throws** `YamlError` / `FlatnessError`, refusing unknown and retired keys by name |
| `server/domain/pages.ts` — `docOf` / `sectionOf` / `contentOf` / `varsOf` | the tolerant twin on the read path | **repairs**: drops what it cannot read so a page that half-parses still opens |
| `server/domain/docs.ts` — `checkDoc` | the strict re-check guarding the raw fallback | **throws**, because a fallback that silently dropped half the sections it was handed would be a worse liar than the file it was fixing |
| `skill/check.ts` | the checker's **own** YAML subset reader | reports findings by rule id |

**Why each one exists rather than being folded into another:**

- The codec is strict because a file carrying a key this reader does not have was
  written against a format this reader does not have, and reading it silently
  would drop whatever that format put there.
- `docOf` is tolerant because a page is the unit of a fault (§9) and a page whose
  `contents` is a string should be a page with no sections, not a crash.
- `checkDoc` is strict *again*, separately, because it guards the surface that
  repairs a broken file. It deliberately does **not** re-check what the parser
  already refuses, and deliberately does **not** check whether a `data` file
  exists, whether a table is real, or whether a child key matches a child — all
  three change under the document's feet, and refusing them would make the
  fallback a source of failures rather than the cure for them.
- `skill/check.ts` has its own reader because **it has to run inside a vault**,
  where there is no `contracts/`, no `vendor/` and no `node_modules/`. It used to
  reach through `_lib/` at the server's parser, which reaches a vendored package
  by a bare specifier — so `bun run .agents/skills/check.ts` in a vault tried to install
  an unpinned package off npm and died with no network.

> **What holds the four together is a test, not a promise.** `tests/skill.test.ts`
> runs the checker's reader and `server/platform/yaml.ts` over every
> `content.yaml` in the repo and demands the same answer. **A second
> implementation is a second opinion only if something holds the two together.**
> When you change what the format accepts, change all four in the same edit and
> run that test — a change in one alone is a page that opens in the server and
> fails the checker, or the reverse.

`server/domain/design.ts` reads the same document shape out of `design/`, but it
is **not** a fifth reader: it goes through `docOf` and `drawSection` deliberately,
so the design doc cannot drift from a page.

---

## 11. Two properties of the writer, both load-bearing and both tested

```
parse(format(d))  equals d      nothing a page says is lost on a save
format(parse(t))  is t          for any t this module wrote — so a slot edit is
                                a one-line diff and not a reflow
```

The first is equality **of meaning**, not of spelling: `body: hello` and
`body: {type: markdown, data: hello}` are the same part, so `format` writes the
short spelling and the check compares both sides canonicalised. Anything stricter
would refuse to write a document it had just read.

**`format` re-reads what it just wrote and refuses to hand back text that would
not come back as the same page**, falling back to the quoted form when a block
scalar cannot hold a value exactly — so **nothing here ever writes a file it could
not read**.

`lineWidth: 0` disables folding. A folded line reads back identically, so this is
not about correctness: it is that folding turns one edited sentence into a
reflowed paragraph, and **the diff is the thing somebody reads to see what an
agent did**. Key order is fixed and nothing is sorted, because `contents` is the
page's order and sorting a document whose order is its meaning would reflow the
file on every save.

One upstream behaviour is recorded rather than worked around: this parser writes
U+2028 and U+2029 **raw**. YAML 1.2 does not treat them as breaks, so it reads
back exactly what it wrote — but an editor does, and so does a `.`-based pattern,
so a page carrying one looks like it has an extra line in it. Word emits U+2028
for a soft line break, so it arrives the first time somebody pastes a sentence in.
A test pins the behaviour so a version bump that changes it is visible.

---

## 12. `markdown.yaml`, the type scale

A second file the reader looks for by name: **`markdown.yaml` at the vault root
is the house scale, and one in a page's own directory is that page's, merged over
the house ONE PROPERTY AT A TIME.** So a page that wants bigger headings says
`h1` and keeps the workspace's body text — and keeps it when the workspace
changes its mind, instead of holding a copy that drifts.

```yaml
measure: 34rem
h1: { size: 2.5rem, weight: 400, leading: 1.04, tracking: -0.02em }
p:  { size: 1rem, leading: 1.6, below: 1rem }
code: { face: gauge }
```

**Why it exists.** Once almost every visible word on a page is a markdown part —
which is what makes a page editable — *how big is a heading* stops being one
section's business and becomes the page's, and there was nowhere to say it except
inside each section's own CSS. Sixteen sections, sixteen answers, and no way to
change your mind once.

**What it SETS and what it merely OFFERS, which is the part that took two
attempts to get right.**

- **Body size, leading and face land on the markdown REGION**, and every block
  inside inherits them. They are deliberately not set on `p`: markdown wraps its
  content in a block, so a section writing `.kicker { font-size: .74rem }` sizes
  the *slot* and not the paragraph its words end up in — and a scale that set
  `font-size` on `p` would reach those words while the section could not. The
  cascade layer does not save it, because an unlayered rule beats a layered one
  only where the two target the same element. Measured: every small label on a
  converted page came out at body size.
- **Headings, code, quotes and rules keep their own explicit sizes**, with a
  `revert` fallback. They are deliberately unlike body text, and inheriting would
  flatten every heading on a workspace with no scale at all.
- **`measure` is offered and never imposed.** It is declared on the page root and
  applied to nothing: `guest/sections/default.html` reads it, because a reading
  column is that section's whole job, and any other section that wants it writes
  `max-width: var(--md-measure)`. A scale that capped every markdown region would
  put the page-wide measure back by the side door — and a one-word label in a
  grid cell does not want a reading measure. Measured too: it moved a heading
  slot's computed width by 32px for no reason its author asked for.

**Why it is a format and not a stylesheet.** Three things a stylesheet would
lose: nothing could validate it, a colour could get into it, and no control in
the app could ever drive it — a slider cannot write arbitrary CSS back. What a
scale can say is deliberately knowable, which is also what lets the checker
report a line it does not understand.

**What it cannot say, on purpose:**

- **No colour.** Colour resolves to a palette token and belongs to the workspace,
  not to a page. `theme.json` owns it, and there is no property here for it — an
  absence rather than a filter that could be got wrong.
- **No font name.** `face:` takes a ROLE — `sheet`, `furniture`, `gauge` — which
  resolves through the palette, so a scale cannot pin a page to a family this
  workspace does not use.
- **No selectors.** Anything it cannot express, a section's own `<style>` still
  can.

**A section always wins**, and by construction rather than by counting
specificity: `guest/runtime/scale.js` puts its rules in a cascade layer, and an
unlayered author rule beats every layered one whatever its specificity. The scale
is the default a markdown region starts from, never a ceiling on it. Its
fallbacks are `revert`, so a workspace that has never written the file looks
exactly as it did before the file existed.

**Anything unknown is dropped, never fatal.** A page is the unit of a fault, and
a typo in a type scale must not be the thing that stops a document opening. That
is only defensible because the checker collects the same faults and prints them —
`scaleOf(value, faults)` is the one walk both use, so a second validator that
disagrees with the reader cannot exist.

**It is resolved server-side into custom properties**, like everything else the
box gets, for the same reason: the runtime cannot fetch. What crosses the wire is
a flat `Record<string, string>` — `{"--md-h1-size": "2.5rem"}` — already narrowed,
because it is declared straight onto an element's style on the other side.

---

## Key files (where the format actually lives)

- **The types, frozen:** `contracts/types.ts` — `Section` (name, data,
  parts, variables), `Content` (type, data, variables) and `ContentType`,
  `Part` / `PartKind` (the resolved form), `DrawnSection` (name, html, fallback,
  parts, vars), `Page` / `PageRef` / `PageInit` / `PageDoc`, `PagePlugin`,
  `Child`, `childKey`, `ROOT_PAGE`, `parentOf`, `segmentOf`, `Variables` /
  `VarValue` / `VarScalar`.
- **The format, and the only place it lives:** `server/domain/pages.ts` —
  the agent-legibility paragraph at the top; `makePages(files, yaml, tableList,
  defaultSection)`; `pageDir` / `pageDocPath` (the one place a page becomes a
  directory) and the id grammar; `pageFile`; `isSectionName` / `isPartName` /
  `isChildKey`; `contentOf`; `docOf` / `sectionOf` / `varsOf` / `pluginsOf`;
  `drawSection` / `partOf` (shared with `design.ts`); `read` (the tolerant
  `readDoc`, the additive child reconciliation, the parent-vs-child drawing
  precedence); `writeSlot`; `setSections`; `removeSection`; `create` / `remove` /
  `move` / `writeFile`; and the constants `DEFAULT_SECTION_FILE`,
  `DEFAULT_SECTION`, `DEFAULT_SLOT`, `CHILD_DEFAULT`.
- **The codec:** `server/platform/yaml.ts` — `parse` / `format`,
  `YamlError` / `FlatnessError`, the allowed-key sets, the RETIRED map that names
  what replaced each old key, `asContents` / `asParts` / `asPart` /
  `asVariables`, the `WRITE` options and the fixed key orders, and the
  verify-before-answer in `format`. Layer 1: no I/O.
- **The document write paths and the raw fallback:**
  `server/domain/docs.ts` — `makeDocs(files, yaml)` (`read`, `readRaw`,
  `merge`, `writeRaw`), the per-page promise chain, `mergeVariables` (exported,
  shared with `design.ts`), `checkDoc` / `checkParts` / `checkVariables`.
- **The format gate:** `server/workspace/migrate.ts` — refuses vault
  format 1 and 2 by name, before any module that could read a page is
  constructed. There is no converter.
- **The page-shaped root beside `pages/`:** `server/domain/design.ts` —
  reads `design/` through the same `docOf` / `drawSection` / `mergeVariables`.
- **The fourth reader:** `skill/check.ts` — its own YAML subset parser,
  its key sets, and the rules it reports. Pinned to the codec by
  `tests/skill.test.ts`.
- **The shipped default section:** `guest/sections/default.html`, read by
  `server/main.ts` and handed to `makePages` and `makeDesign` as a
  string, because nothing may import `guest/`.
- **The author-facing counterpart, shipped inside a vault:**
  `vault/.agents/skills/biom-pages/SKILL.md` — how to WRITE a page. When the format
  changes, check whether it needs the same edit.
- **Siblings:** what draws the resolved page → `section-runtime-guide`; what
  fills a slot → `plugin-guide`; why resolution has to be server-side →
  `boundary-guide`.

---

## This is a living document

This skill is the single source of truth for the vault format and its server
implementation. Whenever the format genuinely changes — a new part type, a new
key on a section, a change to reconciliation or to a write path's commit policy, a
change to the id grammar, a retired key — **update this skill in the same
change**, update all four readers named in §10 in that same change, run
`tests/skill.test.ts`, and check whether `vault/.agents/skills/biom-pages/SKILL.md`
needs the same edit for its own audience. If a rule here is what diverged, fix the
rule; if the divergence is a mistake, fix the code. Either way they agree when you
are done.
