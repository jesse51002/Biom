---
name: section-runtime-guide
description: >-
  The single source of truth for the SECTION RUNTIME in `guest/runtime/`
  — the classic scripts that live inside the page box, take the two ports, read
  the page and draw the stack of sections. Covers the boot contract (what the
  document must load and in what order, why nothing draws until both the ports
  have arrived AND the document has finished parsing), taking `window.__g` once
  and deleting it, the per-port correlators and the shared guest port, drawing a
  section (`@scope` around its `<style>` and the at-rules that must be hoisted,
  `{{name}}` resolved at draw time against part-then-section-then-page,
  `data-g-part` slots, `data-g-plugin` nodes, scripts cloned into fresh nodes
  with `section` / `ctx` / `onTeardown` bound), why the shipped default section
  is a FILE and not a branch, the scroll toolkit the one filling box buys,
  `data-g-scope="page"` and what a reorder must and must not re-run, teardown and
  the slow-page failure it prevents, the `ready` notice, and why the slots are
  claimed from the shim with `biom.claimSlots()`, and that THERE IS NO EDIT
  MODE AND NOTHING IS DRAWN OVER THE PAGE — the words take a caret the moment a
  page is drawn, clicking one opens the WHOLE SLOT as raw markdown, a block is
  whatever the plugin's `blocks(source)` says it is, each block is drawn as its
  own tag so the type scale sizes it and it re-sizes live as you type, and the
  section menu, the grips, the seam `+` and every drag are gone. Load this whenever you touch
  `guest/runtime/boot.js`, `sections.js`, `registry.js`, `effects.js` or
  `guest/sections/default.html`. Trigger on "the runtime", "boot.js",
  "window.__g", "drawPage", "DrawnSection", "@scope", "scopeCss", "splitCss",
  "hoist keyframes", "data-g-part", "data-g-plugin", "data-g-scope",
  "data-g-section", "section script", "onTeardown", "effects.replay",
  "reorder", "claimSlots", "blocks(source)", "ready", "default section",
  "scroll timeline", "IntersectionObserver", or any change to what the box draws.
---

# The section runtime — what happens inside the box

`guest/runtime/` is the code that turns a `page.read` answer into a page. It runs
inside the sandboxed box described by `boundary-guide`, which means it lives
under that boundary's constraints rather than beside them: it cannot import, it
cannot fetch, and everything it draws had to arrive inline.

**The header of `guest/runtime/boot.js` is the spec.** This skill is the prose
rationale around it — what each mechanism is for and which failure it prevents.
When the two disagree, the file wins and this skill is what gets fixed.

This skill owns the runtime's mechanics. It does **not** own:

- **The boundary itself** — the sandbox, the handshake, the ports, the three
  rings → `boundary-guide`.
- **The plugin contract** — `register`, `mount`, `ctx.use`, shipped-vs-vault ids
  → `plugin-guide`.
- **The stored format** — `content.yaml`, `Section`, `Content`, resolution →
  `page-format-guide`.
- **How to WRITE a section as a vault author** — that is the vault's own
  `.agents/skills/sections/SKILL.md`, which ships inside the workspace. This skill is for
  whoever changes the runtime; that one is for whoever uses it.

---

## 1. What the runtime does, end to end

In order, once per draw:

1. **Takes the two ports** from `window.__g`, reads that object once and deletes
   it.
2. **Reads the page** — `page.read` over the privileged port, answering a `Page`
   whose `sections` are `DrawnSection`s with their html already loaded and their
   parts already resolved.
3. **Tears down everything mounted before it** (`effects.disposeAll()`), then
   empties the page root.
4. **Stacks the sections in `contents` order**, one `<section id="sec-<name>"
   data-g-section="<name>">` each, appended to the page root in the order the
   array gives.
5. **Fills the `data-g-part` slots** from that section's resolved `parts`, and
   mounts every `data-g-plugin` node from its attributes alone.
6. **Wraps each section's own `<style>`** in `@scope (#sec-<name>)`.
7. **Clones each section's `<script>` into a live node** with `section`, `ctx`
   and `onTeardown` bound into its scope.
8. **Mounts the page-level plugins** — the entries under the document's `page:`
   key, each given a node of its own at the end of the stack.
9. **Posts `ready`** over the privileged port, carrying the number of sections it
   drew. Zero is a real answer and means an empty page.

The whole of that is one function, `drawPage`, and every redraw runs all of it.

**A generation counter guards the race.** Every draw bumps it, and a `page.read`
answer from a draw that has since been superseded is dropped rather than painted
— two refreshes arriving close together would otherwise race to fill one root.

---

## 2. Taking the ports, and the two correlators

`window.__g = { runtime, guest, page }` is published by the shim and **read once
and deleted by the runtime**. Deleting it is what stops a section script that
loads later from finding the privileged port lying about. Deleting is the
runtime's job and never the shim's: by then the shim has taken the guest port
into a closure and holds nothing that can go missing.

**It arrives asynchronously and both arrival orders are ordinary.** The ports
come back in a message, so `window.__g` is usually undefined for at least one
task after the shim runs — but the reply can also beat this script over the
network, in which case the object is simply there. `take()` handles both: it
checks for the object, and otherwise installs an accessor whose setter deletes
itself first, so the object is gone from the realm before a single line of section
code has run.

**Nothing draws until BOTH the ports have arrived and the document has finished
parsing.** That second condition is not politeness: a plugin registered by a
`<script>` tag further down the document has to exist before the first slot asks
for it, or the page draws a stack of *no plugin named …* messages and then never
redraws. `start()` is called from both the `DOMContentLoaded` handler and the
port hand-off, and the last one to arrive does the work.

**Two correlators, one per port, with distinct id prefixes.** The guest port is
**shared** with the shim, which mints its own ids on it and sets its own
`onmessage`. Two correlators handing out the same id on one port would each
resolve the other's calls — a caller handed the answer to a question it never
asked. So the runtime prefixes its guest-port ids differently, listens with
`addEventListener` rather than assigning `onmessage` (which would take the shim's
channel away), and defers `port.start()` by one task, because the shim publishes
`window.__g` and installs its own handler in the same synchronous run.

**The runtime port never leaves `boot.js`.** It is what `page.read`,
`section.write`, `section.order`, `section.remove` and `variables.patch` travel
on. `ctx.call`, which is what every plugin and every section script is handed,
goes over the **guest** port and therefore carries `HostRequest` and nothing
wider — **there is no path from a plugin to `section.write`**. A plugin declares
`edit: true` and the runtime does the writing.

That separation is a **closure, not a browser guarantee** — see `boundary-guide`
§6. It is written down in `boot.js` and it stays written down.

---

## 3. The default section is a FILE, and that is load-bearing

A section that names no `data` draws with `guest/sections/default.html` — one
centred slot named `body`, at a reading measure — and `DrawnSection.fallback`
says the default was used.

**A default living in the runtime would be the one shape nothing else could
reach.** It would need no HTML file, no `data:` key and no slot declaration, and
every other section would be the exception to it. "The document" would be
privileged all over again — which is exactly what the deleted render layer kept
collapsing into, where one render owned the whole sheet and prose was one column
at one measure because there was nowhere else for it to be.

As a file it is the same mechanism every other section uses: read by the server,
sent inline in the `page.read` answer like any section's markup, drawn by the
same code path, **legible, copyable and replaceable**. The runtime marks a
defaulted section `data-g-default` so the EDITOR can tell a default section from
an authored one. No checker rule reads it: the rule that warned on an all-default
page was retired with the two-kinds change, because a doc is mostly defaults.

**The reading measure lives in that file, on the section, rather than on the
page.** That is what makes a full-bleed section cost nothing: it simply does not
carry the default's `max-width`, and there is no sheet-level width for it to
fight. The file sets no colour, deliberately — every colour resolves to a token
the palette rewrites at runtime, and a section that reached for a raw one would
be the section that stopped theming.

The server reads the file once at composition and hands the string down; a
missing file falls back to a stand-in of the same shape in `server/domain/pages.ts`
and says so once. **That stand-in is not a second default** — it is the answer to
"the framework could not read its own file", and it has the same one slot named
`body` so a reconciled child section still lands somewhere. Do not invent a third.

---

## 4. What one filling box buys, and why `effects.js` implements no effects

`guest/runtime/effects.js` contains no effects at all, and that is the point.
One box, one document, one scroller: the box takes the whole canvas and scrolls
inside itself, so **it IS the viewport**. `animation-timeline: scroll()` finds a
scroller, `view()` has a view, `position: sticky` sticks, `100vh` means the box,
`position: fixed` pins to it, and an `IntersectionObserver` with a null root gets
the right root. **Every one of those works natively and needs no JavaScript from
us.**

If the box measured itself and the HOST page scrolled instead, the scroll
container would be outside the box and all of them would break at once — which is
why `GuestNotice` has no `size` and why the page root is deliberately **not** a
scroll container. `root()` makes a plain `<main id="g-page">` if the document
does not declare one; a scrolling div in here would take the whole toolkit away.

What *does* need code is the bookkeeping either side of a redraw, which is §5 and
§6.

---

## 5. `data-g-scope="page"`, and what a reorder must and must not re-run

Moving a section moves its element. **Re-appending an element does not re-run its
script and does not tear down its effects**, which is exactly right for a
section-local script: it is bound to its own element and to nothing else, and its
picture of the page did not change because the page moved around it. Re-running
every script would restart every effect mid-scroll and be visibly janky.

**A `<script data-g-scope="page">` is the opposite case.** It is rebound to the
page root rather than to its own section — it measured or observed the whole
stack — so after a reorder its picture of the page is wrong. **Exactly those are
torn down and re-run, in the stack's new order.** Re-running everything is
wasteful and janky; re-running nothing is quietly broken, which is worse.

`rt.page.reorder(names)` moves the elements and then calls `effects.replay(root)`,
which reads the order **from the DOM rather than from the order the scripts were
remembered in** — the whole reason to replay is that the stack moved, and a
script that walks it must see it as it is. Every affected script is torn down
first, all of them, and only then re-run: interleaving would let an early script
observe a page half of whose effects had already been rebuilt, a state that never
occurs on a fresh draw.

**A replay is a NEW script node every time.** A script element that has already
executed does not execute again when it is moved — a browser rule, not a
preference — so `run()` removes the inert node and builds a fresh one.

Teardown buckets encode the relationship: a section's own bucket is its name, and
a page-scoped script gets `<name>::script<i>`, so disposing a section disposes
the scripts it declared without a second index to keep in step.

---

## 6. Teardown, and the page that gets slower the more it is edited

A section's script may open an `IntersectionObserver`, a `ResizeObserver`, a
`setInterval` or a listener on the document. **When that section is redrawn or
removed its nodes go away and the observers do not**: they hold references to
detached elements, keep firing, and **the page gets measurably slower every time
somebody edits it** — fast in a demo, slow after ten minutes of use.

So every `onTeardown` a section registered runs before its element is replaced.
Both spellings are honoured — a plugin may return a teardown from `mount` or call
`ctx.onTeardown(fn)` — because a plugin with one observer finds the return
easier, a plugin that mounts several children finds the callback easier, and being
made to pick would only make one of them write a wrapper.

Teardowns run **last registered, first torn down**: an effect built on top of
another has to come down before the thing it was built on. A teardown that throws
is caught and reported and does not take the others with it — a redraw that
stopped halfway would leave every later section mounted twice.

`effects.outstanding()` reports the count per bucket. Nothing draws from it; it
exists because "observers outlive their nodes" is invisible until something can
be asked, and **a number that only ever grows is the symptom**.

`disposeAll()` runs on every whole-page redraw and on `pagehide`.

---

## 7. Drawing one section

**`@scope` around the section's own `<style>`.** A `<style>` element applies to
the whole document wherever it sits, so a section that styled `h2` would restyle
every section under it and the page would depend on the order its sections happen
to be in. `scopeCss` wraps the rules in `@scope (#sec-<name>)`, which lets a
section style itself as freely as if it were the only thing on the page — the
freedom the format exists to give. `:scope` inside the result is the section's own
element. `@scope` is feature-detected (`"CSSScopeRule" in globalThis`) rather than
version-sniffed, because the box is whatever browser the user has; where it is
absent, plain nesting under the same selector is the fallback, and what nesting
lacks is the donut hole, which nothing uses yet.

**Some at-rules must be hoisted OUT of the wrapper**, and `@keyframes` is the one
that matters: a scroll-driven section is `animation-timeline: view()` plus a
`@keyframes` block, and a `@keyframes` nested inside `@scope` is not a valid
nested rule — **the browser drops it and the animation silently does nothing**.
The hoist set in `sections.js` carries it and the others that name something for
the whole document. `splitCss` is brace-aware and string-aware and is
deliberately **not** a CSS parser: it only has to find top-level rule boundaries,
and a `}` inside a string or a comment is the only thing that could move one.

**A section name may be a child key.** `@page-notes` is a legal `id` attribute and
an illegal selector written bare, so the selector is built with `CSS.escape`.

**`{{name}}` is resolved at DRAW time, against three scopes, nearest first** —
the part's own variables, then the section's, then the page's. It arrives raw and
**stays raw in the stored data**: prose is edited in place and writes back, so
resolving earlier would round-trip `62` over the top of `{{rate}}` and destroy
the variable the first time somebody touched the paragraph it sits in. A name
nothing answers is **left verbatim rather than blanked**, because a visible
`{{tota1}}` is a typo somebody can fix and an empty space is not. A list joins
with `", "` and `null` reads as empty, because a variable is a scalar or a list of
scalars and both of those have an obvious reading in a sentence.

**The section's markup is interpolated as TEXT, before it is parsed.** That is
the only way `<img alt="{{caption}}">` can work at all — an attribute value is not
a node and cannot be filled after the fact. **Nothing is escaped on the way in**,
and the file says so plainly rather than leaving it to be discovered: the values
are scalars a person typed into a field, the markup is the page author's own code,
and it is running in a box with an opaque origin and no credentials to steal. A
variable holding `<` will be read as markup.

**Scripts are cloned into fresh nodes.** A `<script>` inserted through `innerHTML`
never executes — a browser rule, not a preference — so they have to be re-created
either way. Since the node is being built anyway, three names are bound into its
scope: **`section`** (its own element, so a section script never has to guess
which of five copies on the page it belongs to — or the page root, when the script
is `data-g-scope="page"`), **`ctx`** (the same context object a named plugin gets,
`ctx.use` and all), and **`onTeardown`**. The wrapper is a function, so a section
script's `var`s and functions are function-scoped: two sections that both declare
`let i` do not collide, and `return` at the top level is legal. That is a
difference from a real `<script>` and it is the right one — a section should not
be able to name a global by accident.

The three values are handed over through a **scratch array cleared immediately
after the claim**, because a script element carries text and nothing else, and
leaving them there would keep every context on the page reachable from one array
for as long as the box is open.

**A `<script type="module">` in a section is removed and reported by name.** It
cannot load at an opaque origin, and silently running it as a classic script would
turn its `import` line into a syntax error and report *that* instead of the real
cause. A script with any other `type` is a data island — `application/json`,
`text/template` — and is **left exactly where the section put it**, because
extracting it would delete data the section is reading. An external section
script (`src=`) gets no bindings, since there is nothing to wrap; it can still
reach `biom` and `window.__gRuntime`, which is how vendored code loaded by a
section works at all.

**Slot queries are taken BEFORE anything is mounted.** A plugin fills its node by
replacing what is inside it, so a `data-g-plugin` node that lived inside a slot is
gone by the time the slot has been drawn — and mounting markup a plugin generated
is not the same thing as mounting markup the section wrote. Snapshot, then check
what survived (`el.contains(node)`).

**An unfilled slot is not a failure.** A `data-g-part` the page has not filled
gets `data-g-empty` and keeps whatever the section put inside it, so a section can
carry its own placeholder and the editor has somewhere to put a caret. A failure —
a plugin that threw, a part kind nothing draws, a `data-g-plugin` naming nothing —
is kept **inside that node** with `data-g-failed` and a sentence in it: a blank
rectangle in the middle of a page is indistinguishable from an empty slot, and the
person looking at it is usually the person who can fix it. Letting a plugin's
throw escape would stop the section, and every section under it, from drawing at
all.

---

## 8. The page's slots are claimed from the shim, for the whole page

At load — not at draw — `boot.js` calls `biom.claimSlots()`.

**Both halves are correct on their own, and together they are two writers on one
node.** The shim hydrates every `data-g-part` region from the page's
**variables**; the runtime fills those same regions from the page's **parts** and
saves with `section.write`. **Two writers on one element is the one state nobody
can reason about**, so the claim stands the shim down.

**It is the whole page and never a slot**, because a half-claimed page is the
same problem with a smaller blast radius.

It is claimed at load because the shim is inlined ahead of every runtime file, so
it is already there, and a `refresh` can reach it before the first draw has
finished. The call is guarded, because the runtime is verified in a bare box with
no shim in it — a verification that needed the shim would be testing two files
and telling you about one.

**It used to be `biom.onEdit(fn, { manual: true })`**, and the shim used to
carry a whole `contenteditable` pass behind that flag. The flag gated the
dressing and NOT the hydrate, which is how a page variable called `missing`
landed in an empty slot called `missing` — measured, not reasoned about. The
dressing is gone with edit mode; the claim is what is left, and it gates hydrate
as well.

---

## 9. Host events, and the redraw the edit wave narrows

**Both ports see every host event; the asymmetry is in what may be SENT.** The
runtime acts on `refresh`, because re-reading the page and re-filling every slot
is its job. The shim acts on `theme`, because re-declaring the palette is its.
`edit` is heard by both.

A `refresh` whose change names another page and does not set `shape` is ignored.
A change to a table is a plugin's business — it registers `biom.onRefresh`
and redraws itself.

**A refresh naming this page is dropped while one of our own writes is still in
the air.** A debounced `section.write` lands on disk, the server announces it,
and the announcement comes straight back as a refresh — which would redraw the
paragraph under the caret and take the caret with it. So `rt.page.write` counts
its outstanding writes and the refresh handler drops the echo.

> **The cost is stated rather than hidden:** a change to this page made somewhere
> else in the same half-second is dropped along with the echo. In a local
> single-user instrument that is the right trade against throwing the caret away
> on every keystroke, and it is why the window is short. The counter comes down
> on a timer rather than on the answer, because the server announces AFTER it
> answers — releasing on the answer would open the window a moment before the
> echo arrived through it.

---

## 10. The privileged surface, `rt.page`

The kinds only the runtime may send are exposed on the runtime's **own**
namespace (`window.__gRuntime.page`) and never on `biom`, because
`biom` is what a section is handed. `write` / `order` / `remove` / `patch`
each go straight down the runtime port; `redraw`, `reorder`, `sections()`,
`vars()`, `onDraw` and `root` are local. `order` is one kind for adding,
reordering, duplicating and removing because they are one edit to one list —
`contents` IS the order.

Again: that is a closure, not a guarantee, and it says so in the file.

---

## 11. The edit wave: there is no mode, and nothing is drawn over the page

`edit.js` builds on §10 and its whole surface is the caret. Click a paragraph and
type; the whole slot it sits in opens as raw markdown, each block still drawn at
its own size. There is no toggle, so there is no state in which a section is "not
being edited" and nothing for a section author to branch on.

**The chrome is gone.** There was a menu on every section's corner carrying a
grip, a name, Duplicate and Delete; a `+` at every seam between sections; a grip
on every list item; and an overlay holding all of it, `pointer-events: none`
until `data-hot` said a piece was showing. All of it is deleted, along with the
hit-testing that decided what the pointer was asking for and the `ResizeObserver`
that kept it placed. A section's order is structure an agent writes; rearranging
it is a sentence you hand the agent, not a gesture you make over the page. The
overlay was an intricate mechanism serving a gesture that turned out not to be
wanted, and every problem it solved — the invisible 26px strip eating clicks, the
Delete that had to ask, the bar that had to be rebuilt on every draw — was a
problem it had created.

**`section.order` and `section.remove` are still on the wire**, because
`contracts/` is frozen and a kind is not deleted to tidy up; `rt.page.order`,
`rt.page.remove` and `rt.page.reorder` still exist in `boot.js`. Nothing in the
shipped runtime calls any of them.

**What the runtime does NOT draw is a section's own add, delete or reorder.**
Where a `+` sits in a comparison, or an `✕` on a ledger row, is that section's
design. `ctx.read` / `ctx.write` is the door — the array you write is the order —
and the vault's `sections` skill makes drawing them a condition of the section
being finished, with `R59` warning where a list has neither.

### What that mechanism demands of whoever writes a section

The editable region is a **markdown part**, reached through a `data-g-part` slot
and stored in `content.yaml`. Nothing else on the page opens under the caret. So
the authoring standard is not a preference, it is this mechanism read backwards:
**all text is markdown in the document, and a section's html file carries the
visuals and the structure and none of the words** — because **a word baked into
an html file is a word nobody can ever edit.** The one exception is text inside
an `<svg>`, which is part of a drawing.

Two consequences fall out of §7 and of the block-level rendering above, and both
bite in practice: a slot element must be a **neutral container** (`<div
data-g-part="title">` with `title: "# Ship faster"`, never `<h1
data-g-part="title">`, or an `<h1>` renders inside an `<h1>`), and every CSS rule
aimed at a slot moves one level down onto the block markdown produced —
`.title h1`, `.kicker p { margin: 0 }`.

`vault/.agents/skills/sections/SKILL.md` is where an author reads this, with the
worked before/after; `skill/check.ts` WARNs on it as **R56**. This guide states
it because the rule is a property of `edit.js`, not of taste.

### Live preview, and why the stored markdown survives

The **slot** under the caret shows its **raw markdown** — the whole part, every
block and the blank lines between them — and every other slot stays rendered. So
what is being edited is the source: `{{quarter}}` is four words of template while
you are in the slot and the value everywhere else, and any HTML the author wrote
is the HTML they wrote.

The alternative was contenteditable over the **rendered** output. It reads better
in a screenshot and it destroys data — saving means serialising HTML back to
markdown, and the first keystroke in a paragraph holding `{{rate}}` writes `62`
over the top of the variable with nothing on screen to say a variable was ever
there.

### A LIST SLOT IS MANY REGIONS, ONE PER ITEM

A slot whose stored value is an array resolves to `{ kind: "list", items }`, and
`sections.js` draws **one element per item** into the slot, tagged
`data-g-item="<i>"`. Each is its own editable region.

**An item gets a wrapper and a block does not**, and the difference is what each
one is. A block is part of a passage — a div around it would break `.prose > p`
and buy nothing. An item is a thing: the section lays out one box per item, which
is what `.cards > *` already means, and a region that is one element is a region
the editor can take, mount into and redraw.

`ctx.read(part)` answers an array for a list slot and a string otherwise;
`ctx.write(part, array)` writes one. **A write redraws the page**, because adding
or removing an item changes how many elements the slot has — patching that in
place would mean the runtime keeping a second model of what is on screen.

---

### A BLOCK IS WHATEVER THE PLUGIN SAYS IT IS

`rangesOf()` asks the plugin drawing the slot: `def.blocks(source)` answers
character ranges, **each carrying the tag the renderer would draw it as**, and
`markdown.js` implements it off markdown-it's own token map, tracking nesting so
a fenced block containing a blank line is one block and a list is one block
rather than one per item. `tag` is markdown-it's own `token.tag` — `h1`, `p`,
`ul`, `blockquote` — with a fence read as `pre` and an html block answering `""`.
A plugin that declares `edit` and no `blocks` is edited as one region, and that
is also the fallback when a plugin's splitting throws — a page edited in bigger
pieces than it meant beats a page that cannot be edited.

Splitting on blank lines here would be a second parser that agrees with the
renderer until the first fence, and then tears a paragraph in half while somebody
is typing in it.

**The ranges do not cover the string, and the segments do.** The blank lines
between blocks belong to no block, which is what lets the editor draw them as
gaps of their own rather than as part of the heading above them. `segments()`
turns ranges into the open slot's children — one per block, one per gap — and
**a block owns the newline that ends its last line**, because a pre-wrap block
draws no extra line for a trailing newline and a gap of two newlines has to read
as one blank line. Joining the slices back in order **is** the source, which is
why closing a slot stores exactly what the editor held and somebody's spacing
comes back as they left it.

### No wrapper element, and the slot IS the editor

A block's own top-level nodes are tagged `data-g-blk="<i>"` in place while the
slot is rendered. A `<div>` slipped in to hold a block would break every
`.head > h1` a section wrote, with nothing to say why; an attribute changes no
selector that already existed.

**Opening makes the slot's own element the editor** — `contenteditable` and
`data-g-src` go on the `data-g-part` node itself — holding one child per segment,
each an element of that block's own tag with the exact source as its text.
**Nothing is mirrored and no size is named.** The slot already carries
`data-g-md`, which is what the page's type scale attaches to, and it is the
element a section's CSS aims at, so an `<h1>` segment inside it is styled exactly
as the rendered `<h1>` was. A heading's source is heading-sized while it is open,
with its `# ` showing.

**And it re-sizes as you type.** Every `input` schedules one rebuild per frame:
the text is read back, split again, and the children replaced only when their
shape changed — a paragraph that became a heading, a new block, a `<div>` the
browser inserted for Enter — with the caret restored at the same character.
Ordinary typing inside a paragraph changes a text node and nothing else, so it
costs no DOM work. A rebuild is skipped mid-IME-composition, which would
otherwise drop the characters being composed.

**The residual is undo**: replacing the children is a DOM replacement, and the
browser's native undo does not survive one. Undo works within a run of ordinary
typing and is lost across the keystroke that changed a block's shape. That is
accepted rather than fixed, because the alternative is an undo stack of our own.

**A SECTION'S OWN FURNITURE IS NOT WORDS.** The shipped list section paints a
delete button into every item and puts it back whenever that item is redrawn, so
while a region is open its furniture is sitting inside a `contenteditable`.
`keep()` carries those nodes through every rebuild rather than sweeping them (or
they would flicker on every keystroke and fight that section's observer), and the
reader ignores every top-level element that is neither one of our segments nor a
`<br>` — otherwise the glyph on that button would be folded into somebody's
markdown and saved there. Text and a `<br>` still count, because those are what a
browser leaves behind when a person types.

`padding` is dropped on a list segment — a list's indent belongs to its marker
column and raw `- one` has no marker — so a list opens flush with its slot.

### An empty slot is still a slot

A slot the section's markup declares and the yaml has not filled draws a
placeholder, opens, and writes back. `writeSlot` creates the part on first
keystroke — **but only where the section's own html declares that slot**, so a
typo still lands on `no such slot` instead of writing a key into `content.yaml`
that nothing draws and nobody can see.

### `section.order` goes through the store

Adding, reordering and duplicating move the SHAPE of a page, so they go through
`ws.setSections` exactly as `section.remove` goes through `ws.removeSection`.
A forward straight down the transport writes the file and tells nobody, and the
symptom is precise: the section reaches disk and never appears, because nothing
announced the change and so nothing redrew.

---

## Key files (where the runtime actually lives)

- **The entry, and the spec:** `guest/runtime/boot.js` — its header is
  the authoritative statement of the document's load order and the handshake.
  `take` (read `window.__g` once, delete it), `correlator` (per-port, prefixed
  ids), `guestCall`, `root`, `normalise`, `drawPage` (the generation counter, the
  dispose, the stack, `ready`), `mountPagePlugins`, `claimSlots`,
  `onEvent`, `start`, and `rt.page` — the privileged surface.
- **Drawing one section:** `guest/runtime/sections.js` — `draw`,
  `fillSlots`, `runScripts`, `makeCtx` (the context every plugin, page plugin and
  section script is given), `mountWith`, `fail`, `interpolate` / `merge`,
  `scopeCss` / `splitCss` and the hoist set, the reserved `data-g-*` names, the
  script wrapper and its scratch bench.
- **The bookkeeping either side of a redraw:** `guest/runtime/effects.js`
  — `onTeardown`, `dispose`, `disposeAll`, `remember`, `replay`, `outstanding`.
  Implements no effects, deliberately; §4 says why.
- **The registry:** `guest/runtime/registry.js` — the lookup that stands
  in for an import graph. Owned by `plugin-guide`; the runtime consumes it
  through `rt.plugins`.
- **The shipped default section:** `guest/sections/default.html` — one
  centred slot named `body`. Read by `server/main.ts` and handed to `makePages`
  and `makeDesign` as a string, because nothing may import `guest/` and both
  readers must draw the same default. Its stand-in twin (`DEFAULT_SECTION`) and
  the slot name (`DEFAULT_SLOT`) live in `server/domain/pages.ts`.
- **The edit wave:** `guest/runtime/edit.js` — `dress` (one controller
  per editable slot), `rangesOf` (asks the plugin's `blocks`) / `render` (tags
  each block in place, no wrapper), `segments` / `build` (the open slot's
  children, and the identity that they cover the source), `open` / `close` /
  `release` (the slot as the editor, and taking it back with or without reading
  it), `rebuild` / `same` / `schedule` (the live re-cut, one per burst of
  keystrokes, none mid-composition), `keep` / `ours` (a section's furniture, kept
  and never read), `read` (why `innerText` is the wrong answer here, and how the
  caret's offsets are gathered), `caretOffset` / `place` / `sourceOffset` /
  `clickedAt` (caret mapping), `take` (one region under control) and `siblings`
  (the regions of one list slot, in item order). There is no overlay, no
  `layout`, no drag and no pointer tracking; if you are looking for them, they
  were deleted rather than moved.
- **What a `DrawnSection` and a `Part` are:** `contracts/types.ts`.
- **The author-facing counterpart, shipped inside a vault:**
  `vault/.agents/skills/sections/SKILL.md` — how to WRITE a section. It and this
  skill describe the same mechanisms from opposite sides and must not disagree;
  when the runtime changes, check whether that file needs the same edit.
- **Siblings:** the box and the ports → `boundary-guide`; `register` / `mount` /
  `ctx.use` → `plugin-guide`; what `page.read` answers with →
  `page-format-guide`.

---

## This is a living document

This skill is the single source of truth for the section runtime. Whenever the
runtime genuinely changes — a new draw step, a change to how a section's CSS is
scoped or its scripts are bound, a new `data-g-*` attribute, a change to teardown
or replay, a change to how the slots are claimed, a narrowed redraw — **update this
skill in the same change** so it never goes stale, and check whether
`vault/.agents/skills/sections/SKILL.md` needs the same edit for its own
audience. If a rule here is what diverged, fix the rule; if the divergence is a
mistake, fix the code. Either way they agree when you are done.
