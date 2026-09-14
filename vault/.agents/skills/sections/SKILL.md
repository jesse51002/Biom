---
name: biom-sections
description: "WRITING A SECTION WELL — the entries in `contents` and the HTML file each one names. The MECHANISM is `docs/` at the vault root: `sections.md` for what a section is and what the runtime does to your file, `code.md` for what its `<script>` is handed and what the sandboxed box cannot do, `styling.md` for the tokens and the type scale. This file is the BRIEF and the numbered rules, and it links those rather than restating them. Use whenever the task is to build or repair a page layout, write a `hero.html` or any other section file, add a slot, place a plugin, write a section `<script>`, drive a scroll effect, or give a section its own adding and removing. OPENS WITH THE BRIEF THAT OUTRANKS THE REST: THERE IS NO EDIT MODE, a page is editable the instant it is drawn, and NOTHING IS DRAWN OVER YOUR PAGE — no section menu, no grip, no seam `+`, no drag — so three things must be possible on every section (add a part, take one away, change the order), every one of them yours to DESIGN at the same time as the columns and the type, never bolted on afterwards. A section that cannot gain a part or lose one is unfinished however good it looks. THEN A WORKED EXAMPLE THAT PASSES THE CHECKER: every word a markdown part, one slot holding a LIST rather than a slot per item, the section drawing its own `+` and `✕` as splices of that array; ANYTHING POSITIONAL IS COMPUTED AND NEVER TYPED, because an item can be moved; the controls hold their space and come up on `:hover`/`:focus-within`, with `visibility` and not `opacity` alone, and staying up under `@media (hover: none)`. SAYS WHY THERE IS NO SEPARATOR, carries the question that decides how many slots — could this page ever want one more of these — and the hard case of a NUMBER per item. Carries R9, R13–R35, R56, R57, R58, R59, R60 IN FULL with the boundary of what each rule cannot see, why the shipped default is a floor and not a template, when a coordinated effect is one section and what that costs, and the house rules a section file is checked against. Read `../pages/SKILL.md` first, and `../plugins/SKILL.md` for what to reach for before writing any code at all."
---

# Sections

**A section is a div that draws part of a page. It is also a thing people will keep changing, and the UI it draws has to be built for that.** It is full width of the canvas, it owns its layout entirely, its `<style>` is scoped to it, and it holds any number of plugins wherever its own HTML puts them. Nothing in the runtime privileges prose, a column or a measure.

The second half is what this file is organised around. Everything below is either the shape that makes a section changeable, or a consequence of it.

## Editability is not a feature of the page. It is the brief.

**There is no edit mode.** A page is editable the instant it is drawn: the words take a caret. Nothing is unlocked first, so **there is no state in which your section is "not being edited"** and nothing to hide behind. **And nothing is drawn over your page** — the runtime puts no menu on a section's corner, no grip on a list item and no `+` at a seam. Your layout is the whole of what a reader sees.

**So three things have to be possible on every section you write.** A reader looking at it must be able to:

| | who provides it |
|---|---|
| **add a part** | **you**, out of this section's own design |
| **take a part away** | **you**, out of this section's own design |
| **change the order** | **you** — the array you write with `ctx.write` IS the order |

**All three are yours, and they are not chrome bolted on afterwards.** Where the `+` sits, what the `✕` looks like, whether a card's controls rest on its corner or run along its foot — that is composition, and it is decided at the same time as the columns and the rule and the type. A section designed first and given buttons second always looks like it, because the buttons end up in the one place the layout had nothing better to do with.

**A section that cannot gain a part or lose one is unfinished, however good it looks.** That is the single most common way a generated page fails here: it renders beautifully, it passes the checker, and the person it was made for can change three words and nothing else. **A layout only an agent can change is a picture of a document.**

---

## The shape that works

**Before the moves, the two rules this workspace's `AGENTS.md` puts at the top, because both of them are decided here.**

**A page is DRAWN and not merely written.** We are not a plain markdown framework, for a reason: a section exists so a page can carry a drawing, a board, a figure, a live table. So a doc page gets its figures without being asked, wherever the content has a shape — a count, a sequence, a flow, a comparison, a boundary, a cycle — chosen deliberately for that subject and never decorative. **And drawn means an inline `<svg>` that animates on reveal** — vector, on the palette's tokens (R30 holds on a `fill` as it holds in CSS), with no pixel width on the `<svg>` itself (R25), its labels inside the drawing (R56's one exception), and its motion behind `--motion` so stillness is one switch away. A picture pasted in is not a figure, and a figure that only sits there has spent its one chance to read faster than the sentence beside it.

**And a drawing with even a small chance of being wanted on a second page is a PLUGIN, not a section script.** A section's `<script>` is for a drawing that is genuinely about this one section's own content. Everything else goes in `plugins/<id>.js` from the start — see [`../plugins/SKILL.md`](../plugins/SKILL.md) §3 — because the alternative is measured: one drawing became eighty-eight copies in eleven shapes in a workspace whose agents had this file open.

**These moves were worked out together and they fit together. A section that makes every one of them is a section somebody can use without you.**

1. **Every word a reader reads is a markdown part**, held in `content.yaml` and reached through a `data-g-part` slot. The markup carries the layout, the bands and the drawings, and none of the words.
2. **A repeating thing is ONE slot holding a LIST**, never one slot per item. The document holds an array — one entry per item — and the runtime draws one element per entry into the slot, in order, so the section's CSS lays out `.cells > *` and nothing anywhere names a number.
3. **The section draws its own way to add a part, take one away and move one**, writing through `ctx.write`. Nothing is shipped for any of it and nothing should be: a gallery wants a different gesture from a ledger. Moving is the same call as adding — you write the whole array and the array is the order — so a pair of arrows on an item, or a "move up" in its own menu, is all it takes.
4. **Those controls live in the composition and hold their space**, quiet by default and up on `:hover` or `:focus-within`. There is no mode to hide them behind and nothing to switch, so what makes a page read as a page is restraint in the design rather than a toggle somewhere else.

Here they are in one section. It draws a lede and a row of outcome columns; the columns are one slot holding a list, and the page can gain a fifth outcome without anybody opening a file.

```yaml
# content.yaml
name: Trays
variables:
  season: spring
contents:                        # Sections. Nothing else. Ever.
  - name: intro                  # no data: -> the shipped default section FILE
    parts:
      body: "We potted on through {{season}} and lost fewer trays than last year."
  - name: outcomes
    data: outcomes.html
    parts:
      lede: "## What came off, and why"
      outcomes:                  # A LIST. One entry per outcome.
        - |-
          ### Potted on

          Seventeen trays, mostly the February sowings.
        - |-
          ### Failed

          Four trays. Damping off in the cold frame, twice.
        - |-
          ### Given away

          Nine trays, to the allotment down the road.
```

```html
<!-- outcomes.html — ONE SLOT HOLDING A LIST OF OUTCOMES, laid out as columns.
     The runtime draws one element per entry into the slot, in order, so the
     layout is `.cells > *` and nothing in this file names a number.

     WHAT IS HERE IS THE SHAPE, AND THE SHAPE ONLY. There is no card, no accent
     and no second typeface, because an example is a thing that gets copied and a
     look copied is a look nobody chose. Design your own section around this. -->
<style>
  :scope { display: block; padding-block: 3rem; }
  .rack  { display: grid; gap: 1.5rem; max-inline-size: 64rem; margin-inline: auto; padding-inline: 1.25rem; font-family: var(--sheet-face); color: var(--ink); }

  .lede  { max-inline-size: 34rem; line-height: 1.55; }
  .lede > :first-child { margin-block-start: 0; }

  .panel { display: grid; gap: .9rem; justify-items: start; }

  /* ONE SLOT, ONE ELEMENT PER ITEM, so the layout never names a number. */
  .cells { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); align-items: start; }
  /* ONE HAIRLINE, and it is structure and not decoration: without some mark a
     reader cannot tell where one item ends and the next begins. EVERYTHING PAST
     THAT IS YOURS — a card, a tint, an accent per column are all fine choices,
     and none of them belongs in an example, because what an example does is get
     copied. `base/list/` says the same thing at greater length and it was
     measured: an earlier version of this block had cards and an accent cycling
     in threes, and three independently generated pages came back wearing both. */
  .cells > * { min-inline-size: 0; padding-block-start: .6rem; border-block-start: 1px solid var(--rule); }

  /* THE CONTROLS ARE FURNITURE IN THE LAYOUT. There is no mode to hide them
     behind, so quiet is a design decision made here: the bar HOLDS ITS SPACE
     always — nothing reflows when it appears — and comes up on hover or on
     keyboard focus, which is what keeps it reachable by tab and not only by
     pointer.

     `visibility`, not `opacity` alone. An invisible ✕ that still takes a click
     is a card somebody deletes by accident and cannot get back.

     And a touch screen has no hover at all, so there they simply stay up. */
  /* `flex-end`, because a bar that starts at the item's leading edge sits over
     the first words of it. */
  .bar { display: flex; justify-content: flex-end; gap: 3px; margin-block-end: .5rem; visibility: hidden; opacity: 0; transition: opacity 120ms ease; }
  .cells > *:hover .bar,
  .cells > *:focus-within .bar { visibility: visible; opacity: 1; }
  @media (hover: none) { .bar { visibility: visible; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }
  .btn, .add { font-family: var(--furniture-face); border: 1px solid var(--rule); background: transparent; color: var(--ink-3); cursor: pointer; }
  .btn { padding: .05rem .4rem; font-size: .7rem; }
  .btn:hover, .add:hover { color: var(--ink); border-color: var(--ink-3); }

  /* ADD STAYS UP. It is the only control that is not about an item that already
     exists, so there is nothing for it to appear over — and somewhere to write
     next is the thing a page should never make you hunt for. */
  .add { display: inline-flex; padding: .3rem .8rem; font-size: .72rem; }
</style>

<div class="rack">
  <div class="lede" data-g-part="lede"></div>
  <div class="panel">
    <div class="cells" data-g-part="outcomes"></div>
    <button class="add" type="button" data-add title="Add an outcome to this section">＋ Another outcome</button>
  </div>
</div>

<script>
  var SLOT = "outcomes";
  var slot = section.querySelector('[data-g-part="' + SLOT + '"]');

  /* THE SLOT ANSWERS AN ARRAY. A slot nothing has been put in yet answers "",
     so normalise once and adding the first outcome is a push like any other. */
  function list() {
    var held = ctx.read(SLOT);
    return Array.isArray(held) ? held.slice() : held ? [held] : [];
  }

  function control(glyph, title, go) {
    var b = document.createElement("button");
    b.className = "btn";
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.textContent = glyph;
    /* THE PRESS IS REFUSED AND THE CLICK IS ACTED ON. Pressing a mouse button
       inside an open editor blurs it, the blur redraws that item, and the redraw
       would destroy this button before the click reached it — so the press is
       prevented and the default focus move with it. Acting on `click` rather
       than on `mousedown` is also what lets Enter and Space reach these. */
    b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
    b.addEventListener("click", function (ev) {
      ev.preventDefault();
      /* A click inside an item opens that item's markdown. This is a control
         and not words, so the click stops here. */
      ev.stopPropagation();
      go();
    });
    return b;
  }

  /* THE BAR ASKS THE ELEMENT WHERE IT IS rather than being handed an index this
     script would then have to keep in step. `data-g-item` is the runtime's own
     numbering and it is right by construction. */
  function bar(item) {
    var row = document.createElement("div");
    row.className = "bar";
    row.appendChild(control("✕", "Delete this outcome", function () {
      drop(Number(item.getAttribute("data-g-item")));
    }));
    return row;
  }

  /* Every item gets a bar. An item is redrawn whenever its words change, which
     takes its bar with it, so this runs again off what is on screen. */
  function dress() {
    Array.prototype.slice.call(slot.querySelectorAll("[data-g-item]")).forEach(function (item) {
      if (item.querySelector(".bar")) return;
      item.insertBefore(bar(item), item.firstChild);
    });
  }

  /* ADD AND REMOVE ARE OPERATIONS ON THE ARRAY. Nothing is parsed and nothing is
     joined back together. Reordering is not here because the runtime already
     the array you write is the order, so moving one is the same splice. */
  function drop(i) {
    var items = list();
    items.splice(i, 1);
    ctx.write(SLOT, items);
  }

  section.querySelector("[data-add]").addEventListener("click", function () {
    ctx.write(SLOT, list().concat(["### A new outcome\n\nWhat happened, and how many."]));
  });

  var watch = new MutationObserver(function () { dress(); });
  watch.observe(slot, { childList: true, subtree: true });
  onTeardown(function () { watch.disconnect(); });

  dress();
</script>
```

**What it buys.** Read straight through it is an ordinary page — a lede and three columns. Rest the pointer on a card and that card says how to remove it and how to move it; the `+` under them says how to add one. Every one of those is a splice of an array the document already holds in that shape. **There is no state anywhere that could disagree with the document, and nothing anywhere has to be parsed**: an item is an entry, and an entry is an element on screen. Measured: adding takes three cards to four, dragging swaps two of them, deleting takes four back to three, and it reads off disk as a YAML list of block scalars.

**When to leave it, and what leaving it costs.** A section with no repeating structure — a full-bleed quote, a single chart, a masthead — has no list and needs none of the script; the parts alone are the whole of it, and its own add and delete belong to the page rather than to the section, which the runtime already draws. A run of plain prose that wants nothing done to it should be a default section, not a file. And where the SUBJECT genuinely has a fixed count — below — a slot each is right. What leaving the shape costs is the thing the product is for: a layout only an agent can change is a picture of a document.

### Why there is no separator, and why you must not invent one

**A section used to declare one markdown string and cut it up itself** —
`ctx.read(SLOT).split(/\n(?=###\s)/)` — calling the separator a convention. If
you have seen that shape anywhere in this workspace, it is old and it is wrong.

**A separator is a format invented inside a format, and it fails in both
directions.** A heading somebody types by hand either becomes an item or
silently does not, depending on whether they guessed the split right. A section
that changes its mind about the separator silently re-reads every page ever
written against the old one. **The person typing and the code parsing had to
agree about something neither of them could see**, and there was nowhere to
write the agreement down.

An item is an element now. There is nothing to agree about and nothing to parse
— so **do not reach for a marker, a delimiter, an HTML comment or a heading level
to separate items.** If you find yourself splitting a string, the thing you want
is a list slot.

---

### The question that decides how many slots

**Answer it out loud before you write the markup: could this page ever want one
more of these? If yes, it is a list, and a list is one slot.**

The question is about the SUBJECT, not about today's content. Three outcomes is
not a fixed set because you can only think of three — a nursery that pots on,
loses and gives away trays will one day sell one. Four ferry options is not a
fixed set because four were tabled at the meeting. If a fifth would go on this
page rather than on a different one, the count belongs to the page and the page
must be able to change it.

**The genuinely fixed sets are smaller than they look.** Twelve months on an
axis. Four inks in CMYK. The two halves of a before and after. Those are fixed
because the SUBJECT has that many, and a thirteenth month would be a different
subject rather than another item.

**A NUMBER per item is the hard case, and there are only two homes for it.**

A slot holds markdown, so a chart that needs one figure per row cannot read its
figures out of a list slot without parsing them back out of prose — which is the
separator problem wearing a different hat. The other home is **parallel
variables**: `walls: [...]`, `weeks: [...]`, `problems: [...]`, one entry each per
row, read in that order. `../pages/SKILL.md` blesses that shape and it is what a
data drawing should use.

**What it costs is the `+`.** Variables are edited in the page's own config
screen, not on the page, so adding a row means adding an entry to each list there
— and R59 will not report it, because the section has no list slot. Say so on the
page, in the words beside the drawing, rather than leaving a reader to discover
that this one thing does not work like the rest.

**Do not split the difference.** A list slot for the words plus parallel
variables for the numbers looks like the best of both and is the one shape that
can go silently wrong: the runtime lets a reader DRAG a list item, and the moment
they do, item *i* is no longer the row that variable *i* describes. Nothing on
screen says so. Either the whole thing is a list of markdown, or the whole thing
is parallel variables.

**Three columns of prose is ONE section, and the number of SLOTS in it is a
different question.** "Three columns is one section with three markdown slots"
is the sentence that produced the failure below, because a column reads like a
slot. Slots are right when the three are different things a reader reads
differently — a label, a figure and a note. They are wrong when the three are
three of a kind, and then the whole row is one slot the section lays out.

**Here is the failure, from a real page written against this skill.** A section
called *What came off, and why* declared three slots — `potted`, `failed`,
`given` — one per outcome, laid out as three columns:

```html
<!-- WRONG: three outcomes, forever -->
<div class="cells">
  <div class="cell" data-g-part="potted"></div>
  <div class="cell" data-g-part="failed"></div>
  <div class="cell" data-g-part="given"></div>
</div>
```

Nobody using it can record a tray that was SOLD, and nobody can delete an
outcome that never happens here. The author had read this rule and reasoned that
three outcomes were the section's own business. They were not: an outcome is
exactly the kind of thing a page wants one more of.

```html
<!-- RIGHT: outcomes are a list, and a list is one slot -->
<div class="cells" data-g-part="outcomes"></div>
```

The layout is identical — the worked example above is that section, finished.
What changes is that the page can be worked on.

**The same failure once had six slots in it**, in the first version of a panel
section here: a ceiling nobody asked for, at a number nobody chose. It was also
the worse document — six sealed regions where one you can restructure would do,
because a slot boundary is a wall a sentence cannot be moved across. **One slot
holding many items has no number in it at all.**

**No rule counts this.** The checker cannot see a ceiling and has no finding for
one, so the last check is the one you do by hand: open the page, press the edit
toggle, and try to add a fifth.

---

### What that example knows, and every section of this kind has to

- **A list is written WHOLE, and the page redraws itself.** `ctx.write(part, array)` sends the array, because the array is what the document holds. Adding or removing changes how many elements the slot has, so the page draws again after the write and **a section never re-renders the list itself.**
- **An ITEM is redrawn whenever its own words change** — by a button here, or by somebody typing in it — and **decoration a script put inside that item goes with it.** Rebuild from what is on screen rather than tracking it: a `MutationObserver` on the slot with `subtree: true`, guarded against your own work, is the whole of it.
- **A control drawn INSIDE an item needs two lines of care, and both are measured.** Refuse the `mousedown` with `preventDefault()`, because a press blurs the open editor, the blur redraws that item, and the redraw destroys the button the click was travelling to. Then act on `click` — which is also what lets Enter and Space reach it — and `stopPropagation()` there, or the click lands on the item and opens it for editing. A control drawn outside the slot — the `+` above — needs neither.
- **PUT AN ITEM'S OWN CONTROLS WHERE THEY DO NOT COVER ITS FIRST WORDS.** The top right is the obvious home and is what the example above uses; a foot, a gutter or a hover strip are all fine. Whichever you pick, `justify-content: flex-end` on a bar inserted as the item's first child is the one-line version, and it is what `base/list/` does.
- **A slot nothing has been put in yet answers `""`, not `[]`.** Normalise once, as `list()` does, and the first item is a push like any other.
- **Do not write `items: []`.** An empty list draws no items, so there is no region for the section to write through: `ctx.write` answers `false` and says so in the console, and the `+` is dead. Leave the slot out of `parts` until there is something in it, or seed it with one entry. Measured.
- **`ctx.write` is for a discrete act, not for mirroring typing.** The editor already debounces what a person types to disk. A write per keystroke fights it.

### Anything positional is COMPUTED, never typed

**A reader can drag any item of a list slot anywhere in that list.** It is a
runtime gesture, it needs nothing from your section, and it works on every page —
so the moment you write a list, **position stops being something the document can
state and becomes something the page derives.**

A number typed into an item — `### 1. Brush it` — is right until somebody drags
it, and then it is a rule numbered 1 sitting third. Nothing reports that. The
document and the page now disagree, the document wins, and the wrong number is
the one that survives the reload.

**So let CSS count.** It is three lines and it is free:

```css
.cells             { counter-reset: rule; }
.cells > *         { counter-increment: rule; }
.cells > *::after  { content: counter(rule); }
```

Add one, delete one, drag one — they renumber themselves, and no number was ever
written down to go stale.

**The same holds for every other meaning position carries.** "The next one coming
off the wall" is `.cells > :first-child`, inked by a rule — not the word NEXT
typed into the first item. "The last day" is `:last-child`. Written that way,
dragging a notice to the top *makes* it the next one, which is exactly what the
reader meant by dragging it there. Written the other way, dragging produces a
page with two nexts or none.

**And it generalises past numbering: an item may not remember its own index.** A
control that reads `data-g-item` at the moment it acts is right; one that captured
`i` in a closure when the page first drew is wrong the first time anything moves.
The bar in the example above asks the element where it is for exactly this reason,
and so does every `✕` in this workspace.

### THE PART is what opens, and the plugin decides what a block inside it is

**Clicking anywhere in a part opens the whole part** — as raw markdown, `#`
markers and blank lines and all — and clicking away renders it again. Every other
part on the page stays rendered. **Inside the open part each block keeps its own
size**: the heading line is heading-sized, the paragraph under it is body-sized,
a list is list-sized. Type `#` in front of a line and it becomes a heading as you
type, with the caret where you left it.

**The boundaries come from the parser, not from the text.** `markdown.js` reads
them off markdown-it's own token map, along with the element each block is drawn
as, so a fenced code block containing a blank line is one block and a list is one
block rather than one per item. Splitting on blank lines would tear a fence in
half while somebody was typing in it.

**What it costs, stated because you will meet it:** the browser's own undo does
not survive the keystroke that changes a block's shape — turning a paragraph into
a heading rebuilds it — so undo works within a run of ordinary typing and stops
at that boundary.

**So there are two units and no third: the PART and the ITEM.** Prose that reads
as one passage is one value in one slot, however many headings it holds. Things
a reader looks ACROSS rather than down — cards, columns, panels, the rows of a
ledger — are a list, one entry each. **The question is what the reader does with
them**, and it can be answered while looking at the page.

---

## What the framework gives a section, and where it stops

**The runtime draws NOTHING over your page.** There is no menu on a section's corner, no `+` at a seam, no grip on a list item and no overlay of any kind. There was all of that once, invisible until the pointer came near it; it is gone, because the order of a page's sections is structure an agent writes and rearranging it is a sentence somebody hands the agent. What is left is the caret: **the words take a click and open as their own markdown.**

**So everything a reader can do to your section, your section draws.** That is not a gap: inside a section is where the layout lives and the layout is yours. A shipped control for adding a card would decide, once, for every page ever written in this format — and it would land in the corner of somebody's masthead.

**There is no flag to read and no event to subscribe to.** There used to be `data-g-editing` on the section and `biom.onEdit` to hear the toggle move; both are gone, along with the mode they described. **If you find either in a file in this workspace, that file is stale** — the attribute is never set now, so a rule written against it can only ever hide a control forever.

What you are given instead is one door, and everything a reader changes goes through it.

### To CHANGE — `ctx.read(part)` and `ctx.write(part, value)`

**One door, and everything a reader changes goes through it.** The contract — what
each answers, that a list slot answers an ARRAY and is written back whole, which
slots it reaches and what a slot with nothing in it answers — is
[`../../../docs/code.md`](../../../docs/code.md).

```js
const items = ctx.read("cards");                 // string[]
items.push("### Another\n\nSomething worth saying.");
items.splice(i, 1);
[items[i], items[i - 1]] = [items[i - 1], items[i]];
ctx.write("cards", items);
```

**What it is FOR is the whole of why it exists, and it is not a new capability.**
The person reading the page can already type any of it. What it removes is the
CEILING: **a section no longer has to declare its slots ahead of time to have
somewhere to put a new item**, because an item is another entry in a list that
already exists. Without it a section could only drive the editor by faking clicks
at it, which is what the first attempt did and it did not work.

**Use it for a discrete act, not for mirroring typing.** The editor already
debounces what a person types to disk; a write per keystroke fights it.

---

## The words are markdown — R56

**All TEXT is markdown, held in `content.yaml` and addressed by a `data-g-part` slot. Raw HTML is for VISUALS AND STRUCTURE — layout, grids, rules, bands, drawings, decoration — and it carries no words.**

**This is the first move of the shape above, seen from the checker's end.** Every markdown part is a place a person can click and type, so **a word baked into a section's HTML file is a word nobody can ever edit** — the difference between a page that can be used and a page that can only be looked at. One rule is about the STRUCTURE being changeable; this one is about the WORDS, and both come out of the same mechanism.

Everything a reader reads as prose is a part: a heading, a kicker, a label, a caption, a figure, a name, a date. **When in doubt, make it a part.**

**The one exception is the ARTWORK.** Text that is genuinely part of a drawing — a label inside an `<svg>` chart, a tick on an axis — stays in the markup, because pulling it out breaks the drawing rather than making it editable. **R56 WARNs once per file and quotes the words it found**, because the answer is a slot and a `parts` entry, which is an edit rather than a rewrite. *(WARN)*

### What the rule cannot see, and what that does and does not permit

**It reads this file, and only this file.** Four things are hidden before it looks, and one of them is a hole worth naming:

- **A comment, a `<style>` and a `<script>`.** `content: " rows"` in a stylesheet is a rule, not a sentence. **But a SENTENCE a script builds with `textContent` is invisible too, and that is the same failure R56 exists to stop** — the checker simply cannot say so. Prose assembled in a script is prose nobody can edit.

  **A VALUE a script writes with `textContent` is a different thing entirely, and is right.** A chart labelling its rows from `ctx.vars.walls`, a figure printing `ctx.vars.rate` — the words came from the document and somebody can change them there, which is the whole test. What the warning is about is a script that *composes* the sentence: `el.textContent = "Set " + n + " weeks ago, and due off"` bakes six words into a file nobody can open. The rule of thumb is that every word in the script's own quotes should be furniture — a unit, a separator, a label on a control.
- **Everything inside `<svg>`, to any depth.** That is the artwork exception, and it is a blunt one: a paragraph parked inside an `<svg>` is never reported. Put words there because they are part of the drawing, not because the rule goes quiet.
- **`{{name}}`**, which is already something somebody can change without opening this file.
- **Every attribute**, because the whole tag is hidden. That is right for the controls a section draws: a name written into `aria-label` or `title` is furniture rather than the document's words, and nobody wants to click into a delete button's label and rewrite it.
- **`<button>` and `<summary>`, contents and all**, for the same reason and stated separately because it is the one you will rely on. **A control may say what it does in words, and the one that ADDS should.** Without this exemption every `+` and `✕` a section drew had to be a bare glyph — three unlabelled marks in a corner, and the answer to "what does this do" being "hover and wait for a tooltip" — which is exactly what a page's own add and delete must not be. **`＋ Another column` beats `+`**, because the add is the control a reader has to find without being told it is there; the `✕` on a card can stay a glyph, because a delete beside the thing it deletes reads on sight. Put the label on the button and the long form in `title`. It also means **an `alt=` describing a photograph is a word nobody can edit and R56 will never mention it.**

**A run with no letter or digit is not a finding**, so a `+`, an `✕`, a `·` or an `&mdash;` written straight into the markup is fine. Those are decoration, not words.

**A doc is a document, and that is settled before any of this is written** — by reading the request rather than asking about it. The vault's `AGENTS.md` carries the two kinds: a doc, whose words are the point and whose sections are mostly the shipped default, and an html page, which you write whole because its shape is the point. Everything below is about a doc.

### A visual gets its own section. A markdown section stays simple.

**Visuals belong in a doc. What matters is WHERE they go.**

Do not thread slots through a complicated visual layout so that a paragraph and a chart share one section's markup. Give the chart a section, give the prose a section, and let `contents` put them next to each other. Then:

- **The prose section is one or two plain markdown parts.** Somebody can rewrite it, reorder it or throw it away without touching a line of layout.
- **The visual section owns its markup** and is not at risk every time somebody edits a sentence.
- **Either can be rewritten or dropped on its own**, which is what makes restructuring cheap.

The failure this avoids is a section whose prose is shattered into a dozen tiny slots woven through a grid. Every word is technically editable and the thing as a whole is unmaintainable: you cannot move a paragraph without moving markup, and you cannot change the layout without re-threading the words.

**Where a section genuinely IS a grid of small labelled figures — a metrics row, a spec table, a roster — many small parts is exactly right**, and is not what this is warning about. The rule is about not interleaving PROSE with visuals; it is not about avoiding small parts.

### The trap: markdown renders BLOCK-LEVEL

`# Ship faster` becomes an `<h1>` and a bare line becomes a `<p>`. **So the slot element is a NEUTRAL container and the markdown carries its own semantics.**

```html
<!-- WRONG: an <h1> renders inside an <h1> -->
<h1 data-g-part="title"></h1>

<!-- RIGHT: the div is the slot; the markdown says it is a heading -->
<div class="title" data-g-part="title"></div>
```
```yaml
title: "# Ship faster"
```

**And every CSS rule aimed at a slot moves one level down**, onto the block markdown rendered inside it:

```css
/* was */  .title { font-size: 3rem; }
/* now */  .title h1 { font-size: 3rem; margin: 0; }
/* a one-line label is a <p>, so kill the margins it arrives with */
.kicker p { margin: 0; }
```

**Check every rule you move.** A layout that was right before and forgets this comes out with stray vertical gaps everywhere.

**One consequence found in practice, because it does not look like a CSS problem:** the house type scale in `markdown.yaml` sizes a bare `<p>` and a bare heading, and that beats a size the block would otherwise have inherited — so a label that used to take its size from its wrapper comes back at body-text size. Set `font-size: inherit` on the wrapped block when that is what you meant.

### Before, and after

A hero band with its lines written into the markup — not a word of it editable, and a section with no slots at all:

```html
<div class="band">
  <p class="kicker">Q3 review</p>
  <h1>We shipped on time</h1>
  <p class="standfirst">Three months, four releases, one regression.</p>
</div>
```

The same band, with the words where a person can reach them:

```html
<div class="band">
  <div class="kicker" data-g-part="kicker"></div>
  <div class="headline" data-g-part="headline"></div>
  <div class="standfirst" data-g-part="standfirst"></div>
</div>
```
```yaml
  - name: hero
    data: hero.html
    parts:
      kicker: Q3 review
      headline: "# We shipped on time"
      standfirst: Three months, four releases, one regression.
```
```css
/* was */
.kicker     { font-family: var(--gauge-face); font-size: .7rem; }
h1          { margin: 0; font-size: 3rem; }
.standfirst { color: var(--ink-2); }

/* now — every rule one level down, onto the block markdown rendered */
.kicker p     { margin: 0; font-family: var(--gauge-face); font-size: .7rem; }
.headline h1  { margin: 0; font-size: 3rem; }
.standfirst p { margin: 0; color: var(--ink-2); }
```

**Nothing about how it looks changed.** The class names, the sizes and the band are the same; what moved is which file the words live in.

**And read that "after" against the next rule before you copy it** — three bare slots stacked in a plain box is the exact shape R57 reports, and here it is right to report: one part holding `**Q3 review**`, `# We shipped on time` and the standfirst draws the same band and gives back a region somebody can restructure. It is written out as three only because it is the smallest before/after that shows the move.

---

## Do not cut prose into slots that are only stacked — R57

**PAINTED APART IS NOT PLACED APART.** This is the test, and it is the one thing
to take from this rule:

> If the only difference between two stacked slots is how they LOOK, they are
> one part. Markdown already tells a heading from a paragraph.

**THE RULE IS ABOUT PROSE, and a list slot is not what it objects to.** A list is
one slot already — it is the shape the rule points AT, not a cut to undo. Merging
one into the paragraph beside it would fold its entries back into a single string
and put a separator convention back with them, which is exactly the thing that
was removed. **Never merge a slot that holds a list**, whatever a finding says.

**It is the same argument as the ceiling.** A slot boundary is a sealed box: a
sentence cannot be moved across one, a paragraph cannot be added between two, and
the order of two slots is fixed in the markup rather than in the document. So
cutting where markdown would have done the work for free costs the edit and buys
a class each.

**Markdown already stacks.** Two slots one after another, with nothing between them and nothing on either to tell them apart, draw exactly what ONE part holding both paragraphs draws:

```html
<!-- cut for no reason -->
<div class="col">
  <div data-g-part="intro"></div>
  <div data-g-part="detail"></div>
  <div data-g-part="caveat"></div>
</div>
```
```html
<!-- the same page, its words in the document -->
<div class="col">
  <div data-g-part="body"></div>
</div>
```
```yaml
body: |
  The intro paragraph.

  The detail paragraph.

  The caveat.
```

**Cut a slot where the section PLACES the pieces differently** — a named grid area, an `order`, something out of flow, a label beside a value, a figure in a grid cell, a caption under a drawing. Merge one of those and the arrangement is gone. **A width or a measure is not placement**, and does not exempt a slot: it can be re-aimed at the paragraph markdown produces. **Nor does a class** — the class is stripped before the rule decides, because a class that only paints is the case the rule is FOR. *(WARN, naming the run it found.)*

### What keeps the rule quiet

Everything here has to be true at once before it says anything, which is why it
fires far less often than the test above would suggest:

- Each slot in the run is an EMPTY element — `<div data-g-part="x"></div>`. Anything inside one and it is skipped.
- The run is all one tag, adjacent, with only whitespace between.
- No slot in the run carries an attribute other than the part attribute and a class. An `id`, a `style` or a data hook a script reads was put there on purpose and breaks the run.
- Tags whose adjacency already means something are skipped — `td`, `th`, `tr`, `dt`, `dd`, `li`, `option`. A table cell sits *beside* its neighbour rather than under it, and merging two would destroy the row rather than tidy it.
- The run's container does not lay it out ACROSS: a class on the immediate parent whose rule in this section's `<style>` says flex in its default direction, or a grid with more than one column. A grid of one column and a flex column both stack, and are reported.
- No slot in the run is PLACED by a class of its own: `position`, `float`, `grid-area`, `grid-column`, `grid-row`, `order`, `align-self`, `justify-self`, `place-self`.
- Every slot in the run holds PROSE. A run holding a table, a child or an `html` slot is skipped, because only markdown can be merged into markdown and there is nowhere else for those to go.

### THE RULE CANNOT SEE LAYOUT, and it cannot see your script

**Adjacent in the markup is not stacked on the screen.** Three bare `<div>`s that a grid lays out in a row are a row, and joining them into one part collapses it.

**Here is exactly how far its sight reaches, because the boundary is the useful part.** It looks for a CLASS on the immediate parent and for a rule on that class in this section's own `<style>`. So a container laid out by `:scope`, by a tag selector, by an inherited rule or by a shorthand it cannot parse is **invisible to it, and the run inside is reported as stacked even when it is a row.** Nothing about the finding says which case you are in.

**It also cannot see that a slot is a script's working surface.** A slot the section fills with generated columns is a slot the script addresses by name; merging it into its neighbour takes the section's behaviour with it, and the rule has no way to know.

**Read what the slot HOLDS as well.** A run naming a slot that holds a LIST is a wrong finding for the same reason: a list is many regions, and there is nowhere for them to go inside a prose part. Leave it, and say so.

**This is not hypothetical and the numbers are worth carrying.** Two agents checked every candidate in this workspace against the live computed layout. On one page **all four findings were wrong** — chart axis ticks living in a twelve-track grid, and totals in a flex row — and acting on them collapsed a chart axis to three cells. **Read what the container does, and what the script does, before you merge.** Where the container stacks them and no script names them, merge; otherwise the cut is doing work and the warning is wrong. Say which it was rather than silencing it.

---

## A list the reader cannot add to — R59

**A section that draws a list slot, places no `items`, `open-list` or `checklist`
node at it and never calls `ctx.write`, is reported.** Those three are the
plugins that write the list back; a node naming any other one — `reveal` over the
same slot, or an id with a typo in it — is not an answer to this and does not
quiet it. The list is the shape a page grows in — one entry per
item, and adding or removing one is a splice of an array the document already
holds — so a section that draws one and offers no way to add to it has handed the
reader a row of things they can retype and never re-count.

**The short way is the harness the workspace already has**, and it is one node:

```html
<div data-g-part="steps"></div>
<span data-g-plugin="items" data-g-for="steps"></span>
```

`items` draws the add into its own node and a delete into each item, and inks
nothing — the look is yours, in this file's `<style>`. `open-list` is the same
with a numbering hook, and `checklist` reads a status word off each item, its
vocabulary named on the node. **Use them rather than writing a worse version**:
`base/list/`, `base/open-list/` and `base/checklist/` are the worked sections.
The long way — your own `<script>` doing the splice — is right where the gesture
is genuinely this section's own.

**This is the commonest way a generated page turns out to be a picture of a
document.** It renders beautifully, every word is editable, the checker is clean,
and the one thing the person actually wanted to do — put a fourth card in — needs
an agent. **Reordering is already done for you**; add and remove are not, and
they are not meant to be.

**It is a WARN and not a FAIL**, because a genuinely fixed list is a real thing to
want: the four suits, the twelve months, the three shifts a day has. What the rule
insists on is that a fixed list be a decision somebody made rather than one nobody
noticed — so say it in a comment in the file, and leave the warning standing.

**What the rule cannot see** is *where* you put the control, whether it is any
good, or **which of the two it is**: any `ctx.write` in the file satisfies it, and
so does a `data-g-plugin` node naming the slot — which is a CLAIM that something
is handling it rather than proof, because this checker is handed one page
directory and cannot see `plugins/` around it. That is the right amount of trust
for a WARN. So
a section that can only delete passes exactly as a section that can do both. That
is deliberate — the alternative is a rule guessing at what a splice means from
its shape — and it is why the rule is a floor rather than the test. Open the page
and add a fifth thing yourself, then take one off. A `+` in the corner of a
masthead passes the rule and fails the page.

## Nothing is written against a mode that is gone — R58

**`data-g-editing`, `biom.onEdit` and `ctx.editing` are all gone**, and a
section file naming any of them FAILS.

**It is a FAIL rather than a warning because the page still looks right.**
`:scope[data-g-editing] .bar { display: flex }` is valid CSS that can never match
now, so the bar it was revealing is hidden for good, on a page that renders
perfectly and reports nothing. `biom.onEdit` is louder and worse: it throws,
which takes the rest of that script's top level down with it, so the `+` never
gets wired either.

**If you are reading a section in this workspace that uses one, that file predates
the change** — it is not a pattern to copy, whatever else in it is worth copying.

## What earns a section its own file

**The default section — `parts:` with no `data:` — is one centred slot at a reading measure.** It is what a human pressing `+` gets, and it is the right answer for prose that wants nothing done to it.

**A section earns its own file when the layout carries meaning**: a figure beside the prose that explains it, a grid where things are compared, a band where the page changes subject. Layout a document did not ask for is layout somebody works around the next time they restructure it. When the SHAPE of the page is the point, the answer is an html page.

**A section that names no file takes the shipped default — one centred slot named `body`, at a reading measure.** It is a FILE and not a branch in the runtime, and that is load-bearing: a default living inside the runtime would be the one shape nothing else could reach, and "the document" would be privileged all over again, which is exactly what the old doc render kept collapsing into. As a file it uses the same mechanism every other section uses — legible, copyable, replaceable. **The built-in shape has no privilege nothing else can reach**, which is what makes this section true rather than merely encouraged.

**`base/` holds starter sections; list it to see what is there, copy one and it is yours.** Copy them for their layout, and **read every one against this file rather than as its answer.** A starter that names one slot per column has the ceiling in it, and a starter that reads one slot and splits the string it gets — at a `###`, at a line, at anything — is written against the shape this file replaced. Copying either unchanged is how a fault gets into a page that never meant to have one. Nothing links back and nothing updates a copy.

---

## No build step, and no dependency

**A section is a file a browser loads directly.** Its `<script>` is a classic script in a box with an opaque origin: it cannot `fetch`, it cannot be a module, and the one thing it may load is a classic script from `/vendor/`. **Do not add a bundler, a build step or a package** — the loop this format exists to demonstrate is that you write the file and it is on their screen, and a transpile step between those two breaks exactly that.

## Emptying a section is recoverable; deleting one takes the words

**A section's entry in `contents` carries its own text and there is no copy
anywhere else** — [`../../../docs/sections.md`](../../../docs/sections.md). So when
somebody asks for a section to go away, ask which they meant, and prefer the
recoverable one.

---

## How a section is drawn

**[`../../../docs/sections.md`](../../../docs/sections.md) is what the runtime does
to your file** — the `@scope` wrapper around your `<style>`, the `@keyframes`
family hoisted back out of it, the markup interpolated as text before it is
parsed, and the one id space the whole page shares. **Read it before you write a
`<style>` or an `<svg>`**: two of those four are traps that fail silently.

---

## Slots

**[`../../../docs/sections.md`](../../../docs/sections.md) is the mechanism** — a
`data-g-part` and its key in `parts`, the four part types, a list slot, and
`data-g-plugin` for a node with no stored content. **[`../../../docs/styling.md`](../../../docs/styling.md)
is what every doc page already declares for you** — `--motion`, `.wrap`, the
margin flatten and the reading measure — **so do not write any of them again.**
They were being re-declared by hand at the top of almost every section that drew
anything: in one measured workspace the reduced-motion pair in 176 files, the
measure in 167, the flatten pair in 136, the wrap in 122 — **and the four did not
appear together**, so some sections had part of the frame and the rest did not.
That is the drift, already happened, in the files somebody would have pointed at
as the house style. What still belongs to the section is the motion itself:
`--motion` is a switch, not an animation, and a section that has to REMOVE a
transform rather than shorten it still writes its own `prefers-reduced-motion`
block. `base/reveal/` is the worked example.

**R9 — one element per slot id.** The runtime fills ONE node per part, so a second element carrying the same id is either drawn stale or not drawn at all, and an editable part commits one value — which leaves the other copy silently wrong until somebody reloads. The instinct this catches is showing one value twice: a headline repeated in a sticky bar, a figure quoted back in a caption. Give the second place its own slot and its own words, or fill it from the section's script by reading the first one's text. *(FAIL)*

**Write a slot as an empty element**, because a plugin FILLS the node and a placeholder you put inside one does not survive the first draw. Anything a section wants to show BESIDE an empty slot — a rule, an icon, a shape — goes next to it in the markup, where nothing overwrites it. **A placeholder made of WORDS is R56 whatever it sits next to**: put the sentence in `parts`.

**Use `data-g-plugin` for a visual that is part of the layout; use a markdown part with a fence for a diagram somebody will change** — see [`../diagrams/SKILL.md`](../diagrams/SKILL.md).

---

## Choose a width per section, and choose in `rem`

**A section that wants the whole canvas takes it by not asking for anything** —
the reading measure lives in the default section's own file rather than on the
sheet, so there is no wrapper to escape and no `calc()` against a width somebody
else chose. [`../../../docs/styling.md`](../../../docs/styling.md) is the
mechanism, and the container-query declaration that goes with it.

**Say the counterweight too, because it is the half a generation gets wrong.** Prose still wants a measure — around 34rem of it — and **a page that is edge-to-edge everywhere is exactly as monotonous as one that is 34rem everywhere.** The freedom is to choose per section. A page that chooses the same thing every time has not used it.

**R26 is that sentence with a number on it.** A `max-width` written in px WARNs, because a measure in pixels stops tracking the reader the moment they change their type size — and the person who most needs a wider column is the person who made the text bigger. **The finding is about the UNIT and never about the measure**: convert it to `rem` rather than deleting it. Anything at or under 32px is let through, so a hairline cap on an icon is not a finding. *(WARN)*

**Prefer a container query to a media query for anything inside a section**, and declare the container — [`../../../docs/styling.md`](../../../docs/styling.md) is how. A media query measures the whole canvas, so a section that is half the width of the page collapses at the wrong moment. The starters in `base/` do it this way; copy that.

**`max-inline-size` is not a media feature — R60.** `@media (max-inline-size: 52rem)` matches nothing at all and the collapse it describes never happens — silently, because a media query that never matches looks exactly like a page that was never narrow. *(FAIL.)*

**It is a FAIL, and it was earned twice.** The starters shipped here carried it once. Then a page in the reference workspace carried it in four files, passing a clean report for weeks, with this very paragraph sitting in the guide it was written against — which is the whole argument for the rule existing rather than the warning. A section a person can read is not a section a person reads.

**The rule reads past comments**, so a file may explain the trap in its own words without failing on the explanation. That, too, was earned: the first version of the rule failed the two starters whose comments exist to describe it.

---

## Scripts, and the rules about them

**[`../../../docs/code.md`](../../../docs/code.md) is the mechanism** — the three
names bound into a section's scope, the function wrapper and why `await` at the
top level is a syntax error, the order against the editor, `data-g-scope="page"`,
teardown, the module-script refusal, and the scroll toolkit the one filling frame
makes available. **Read it before you write a `<script>`.** The rules a section's
script is checked against are here.

**R23 — `DOMContentLoaded` never fires for a section script.** The runtime clones the script into a live node at the moment it draws the section, which is long after the document was parsed, so the event has already happened: the listener is registered, nothing calls it, and everything inside it is dead code that reads exactly like working code. That is the quietest failure in this file — the section draws, its markup is right, and its behaviour is simply absent. Do the work at the top level. `section` is your own element and it is already in the document by the time the script runs. *(WARN)*

**R17 — no code built out of a string.** `eval`, `new Function` and `document.write`. A section is reviewed by reading it, and a page that assembles its behaviour out of text cannot be — the file in the diff is not the program that runs. `document.write` is the worse one and fails for a second reason of its own: it reopens the document, which takes the shim with it, so the port is gone and nothing left on the page can reach the host again. *(FAIL)*

**R21 — build nodes; never parse markup out of a string.** `innerHTML`, `outerHTML` and `insertAdjacentHTML`. The section's own markup is the author's code and is interpolated as text on purpose — but what a script handles at RUNTIME is not the author's: a card somebody typed, a table row, a variable, anything a person put into a field was written by somebody else, and `innerHTML` is the path that turns their text into markup. `document.createElement` plus `textContent` is the same amount of code and cannot do it. *(WARN)*

**R18 — no inline handlers.** `onclick=` and every other `on…=` attribute in the markup. Behaviour goes in the one `<script>`, attached by id, so what a section DOES is in a single place and a change to it reads as a diff — rather than hiding in an attribute two thirds of the way down a file nobody rereads. *(FAIL)*

**R20 — never branch on the platform.** `navigator.userAgent`, `.platform`, `.vendor`, `.userAgentData`. A section responds to the canvas it was handed and asks nothing about who handed it over. The same file is drawn in a narrow panel, in a full window and on a phone, and the answer to all three is one layout that reflows — a platform branch is a guess about the reader that is wrong the moment they resize, and it doubles what has to be tested to find out. *(WARN)*

**Teardown matters more than it looks like it does, and a section that draws its own controls runs it constantly.** The failure it prevents is a page that is fast in a demo and slow after ten minutes of use — the worst failure to debug, because nothing is wrong in the file you are looking at. **Write the undo as you write the thing that needs undoing**, never in a pass afterwards — [`../../../docs/code.md`](../../../docs/code.md) is what the runtime tears down for you and what it does not.

---

## A coordinated effect is ONE section, and that is a choice with a cost

**A section cannot hold anything pinned while the page scrolls past a *sibling* section** — [`../../../docs/code.md`](../../../docs/code.md) is the containing-block rule that makes it so. **The section is therefore the unit of a coordinated effect**: a pinned sequence — one visual held while three panels of text move past it — is ONE section with three panels inside it, not three. The mechanism is in [`../../../docs/code.md`](../../../docs/code.md).

**Draggability granularity IS effect granularity, and the author chooses per case.** Splitting the sequence into three sections buys the person three things they can reorder and delete independently, and costs the effect entirely. Keeping it as one buys the effect and costs the independent handles. Neither is the default answer — decide which one the page actually wants, and say which you chose.

**And when you keep it as one, the panels inside it are a repeating structure like any other.** Three panels that can only ever be three is the ceiling again, wearing a scroll effect: hold the sequence in ONE slot as a list, one entry per panel, and let the section add and remove its own.

---

## What the box cannot do, and the rules about it

**[`../../../docs/code.md`](../../../docs/code.md) is the mechanism** — the opaque
origin, what it costs and what it buys. These are the rules a section file is
checked against.

**R13 — the storage APIs throw.** `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches`. An opaque origin has no storage. State that must survive a reload is a variable in `content.yaml`, a row in a table, or — for anything a person should be able to see and edit — markdown in a slot. *(FAIL)*

**R14 — the network is unreachable.** `window.fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon` reach nothing from in here. `biom.fetch` is the only way out and the host performs the request. *(FAIL)*

**R15 — do not reach past the shim.** `window.parent`, `window.top`, `window.opener`, a raw `postMessage`, `document.referrer`. The port is the one contract this page has; going around it is going around all of it. *(FAIL)*

**R16 — no external stylesheet, no `@import`, no module `<script src>`, no dynamic `import()` of a URL.** A module `<script src>` is CORS-gated at an opaque origin and never loads — measured, not assumed. Host CSS does not cross the boundary either: the palette does, as data. And never load the shim yourself; the host inlines it ahead of your markup and a second copy takes the port. *(FAIL)*

**R24 — the artifact is never told how wide it is, and must never ask.** `innerWidth`, `outerWidth`, `screen.width` and `matchMedia` are all refused. The frame is whatever width the page gave it; that width changes the moment a side panel opens, the window is resized or the same file is opened on a phone, so a number read once at mount is stale before the reader has finished the first paragraph. `screen` is not even the canvas — it is the monitor, which the section has no relationship with at all. Lay out with grid, `flex-wrap` and CONTAINER queries, which respond to the box without ever naming a size. *(FAIL)*

**A CSS viewport unit is not measuring**, which is why this rule costs the scroll toolkit nothing. `100vh` is resolved by the browser against the box on every frame; `innerWidth` is a number your script copied out once and now has to keep in step by hand.

**R25 — reflow, and no fixed pixel widths.** A `width` or `min-width` in px in the CSS, or a pixel `width` attribute on a `div`, `section`, `main`, `table`, `img` or `svg`. It is the same failure as measuring, written declaratively: a length that does not know the canvas is a length that will be wrong on it. Anything at or under 32px is let through, and that allowance is the honest statement of the exception — an icon's size is fixed by what it IS rather than by where it is drawn. Everything else reflows. *(FAIL)*

**R28 — wide content scrolls inside its own box.** A `<table>` in a section whose CSS has no `overflow-x: auto` anywhere WARNs. A table is as wide as its widest row, and it cannot wrap: on a narrow canvas it pushes the whole page sideways, so every OTHER section on the page acquires a horizontal scrollbar it did not ask for and the reader loses the left edge of the prose. Put the wide thing in a wrapper that scrolls. *(WARN)*

**R28 only sees a `<table>` written into this file.** A pipe table inside a markdown part, and a `table` part drawn as a grid, both produce a wide thing at runtime that the rule will never mention. A section that holds either wants the same wrapper, and `.cells > * :is(pre, table) { max-inline-size: 100%; overflow-x: auto; }` is the whole of it.

**R35 — a CLASSIC script from `/vendor/` is the one external load that works, and it is a capability rather than an exception.**

```html
<script src="/vendor/three.min.js"></script>     <!-- window.THREE,   706KB -->
```

**`biom.plugins.ids()` is not the answer here** — that lists plugins, not libraries — so list `/vendor/` in the repo or ask, rather than guessing at a name. Adding one is a change to the framework and not something a page can do. **Nothing shipped loads any of them**: a library is a workspace's own choice, taken in its own plugin or its own section, and the drawing this format is for needs none — [`../diagrams/SKILL.md`](../diagrams/SKILL.md). **Never load one unconditionally** — megabytes fetched for a page that takes no branch through them is a page that is slow for nothing; fetch on the branch that needs it, and share one fetch between two sections the way [`../../../docs/code.md`](../../../docs/code.md) describes. *(WARN on an unconditional `/vendor/` load; FAIL for any `src` outside it.)*

**A WebGL section must still be a section without WebGL.** The machine may have no GPU, the context may be lost, the 706KB may not arrive. Draw the words first and add the canvas when the library is there — a page whose argument is inside a `<canvas>` is a page that is sometimes blank, and it is unreadable to anything that is not an eye.

**AND THE SAME SHAPE ANSWERS A FAILED `ctx.call`.** A section drawing its own chart owns what happens when `table.get` refuses — the table was renamed, the column went, the workspace moved — and R56 forbids writing the apology into the markup. So carry the sentence as a part like every other word, hide it by default, and let the script decide:

```html
<p class="fault" data-g-part="fault"></p>   <!-- or a {{faultLine}} variable -->
```
```css
.fault { display: none; }
:scope.is-fault .fault { display: block; }
:scope.is-fault .chart { display: none; }
```

The words stay editable, the failure is legible to the person who can fix it, and nothing in the file is a string only you can change. **A blank rectangle where a chart was is indistinguishable from a page that is still loading**, which is the failure this prevents.

**A picture is named by its file and nothing else** — `<img src="kitchen.jpg" alt="The finished kitchen">` — and never a path, a URL or a leading slash. [`../../../docs/code.md`](../../../docs/code.md) says why.

---

## A control says what it is

**R31 and R32 stopped being rules about forms the moment a section started drawing its own controls.** A `+` and an `✕` are controls, and every section that holds a list has both.

**R31 — every `<button>` carries `type`.** A `<button>` with no `type` inside a form defaults to `submit`, and submitting navigates the frame: the runtime, the ports and everything drawn go with it, so the reader loses the whole page to a click that looked like a toggle. There is no cost to being explicit — write `type="button"` unless the button really is the form's submit. *(WARN)*

**R32 — every control has a name.** An `<input>`, `<select>` or `<textarea>` needs an `aria-label` or `aria-labelledby`, or an id with a `<label for>` pointing at it. Hidden, button, submit and reset inputs are exempt, because none of them is something a person fills in. A control nobody can name is a control nobody can use: a screen reader announces "edit text" and stops, and the label is also the larger hit target that makes the field easier to use for everybody else. *(WARN)*

**A button whose visible content is a glyph wants the same treatment, and no rule will ask for it.** R32 checks form controls only, so `<button>✕</button>` passes every check and still says nothing to anybody who cannot see it. Write `aria-label="Delete this outcome"` — and a `title` with the same words, so the sighted reader gets it too.

---

## Presentation is in the one `<style>` block

**R29 — nothing is styled inline.** The `style=` attribute in the markup, `setAttribute("style", …)`, `el.style.cssText = …` and `el.style.color = …` from script. A section's look is decided in one place so a person can change it in one place and a diff shows what moved; a value set inline is invisible to the stylesheet, outranks it, and is found only by reading the script. Toggle a class and let the `<style>` block decide what the class looks like — and for a control that is quiet until it is wanted, toggle nothing at all: `:hover` and `:focus-within` are already true at the moment they should be.

**The one thing script may write onto an element's style is a CUSTOM property** — `el.style.setProperty("--at", "62%")` is allowed and is the intended route for a value computed at runtime, which is how a bar chart draws its bars. The stylesheet still decides what that token is used for and the palette still decides what a colour resolves to, so nothing is being routed around; any other first argument is an inline style with a longer name. *(FAIL)*

**R33 — one skeleton, and a file that diffs.** One `<style>` block rather than several, so the section has a single place its look is decided; LF line endings, a trailing newline, and two spaces rather than tabs. None of it changes what draws, and that is exactly the point: a page is edited by PATCHING it and never by regenerating it, so every line that moved for a reason nobody chose is a line somebody has to read before they can find the one that moved on purpose. *(WARN)*

---

## Never force a heading to break. Let it wrap

**A `<br>` in a heading, a `\n` typed into one, or a width chosen so the line lands where you wanted it — all three are the same mistake.** The break is right at one width and wrong at every other: on a phone it lands mid-phrase, in a narrow pane it leaves one word alone on a line, and nothing on screen says why. **It should all be on one line, and where it does not fit, the browser wraps it.**

**What to do instead where a long heading genuinely reads badly:** shorten it, or give the section a `max-inline-size` in `rem` and let the wrap fall where it falls. If a particular pair of words must never be split, that is `&nbsp;` between those two — a rule about those words, which survives every width — and never a break.

---

## One actor, one colour, everywhere it appears

**In any figure with more than one thing in it, a colour means an actor and nothing else.** If the agent is cyan in the flow at the top, the agent is cyan in the legend, in the sequence below it and in the table beside it. **A reader learns the mapping once, and every figure on the page spends it.** A colour that means "the agent" here and "a warning" three sections down has taught them something false, and they will misread the second figure before they notice.

**Which means colour is allocated for the PAGE and not for the figure.** Decide the cast before drawing the first one: who is in it, what token each takes, and which things are deliberately uncoloured. Uncoloured is a real choice and usually the right one for most of a drawing — a figure where everything is lit has lit nothing.

**And never colour ALONE.** A reader who cannot separate two hues gets no figure at all. The colour rides on top of a difference that is already there in shape, position, weight or a word.

---

## Large media loads when its section is reached

**A picture, a video or a heavy library below the fold must not be fetched at page load.** The page's frame is its own viewport and everything in it loads at once otherwise: a page with six figures pays for six before the reader has seen one, on whatever connection they are on.

**The two halves of it:**

- **Markup that says so.** `loading="lazy"` and `decoding="async"` on an `<img>`, `preload="none"` on a `<video>`, and a width and height (or an `aspect-ratio`) so the space is reserved and nothing jumps when it arrives.
- **Code that waits.** Anything heavier — a 3MB library, a canvas that has to be built — is appended when the section is actually on screen, which is the one-shot observer the `reveal` plugin already is and the scroll toolkit above documents. The bar is that a section which never comes into view never pays for it.

**Tear down what you started.** An observer that outlives its section keeps a detached element alive, and the page gets measurably slower every time somebody edits it.

---

## Nothing sets a raw colour

**R30 — no hex, no `rgb()`, `hsl()`, `oklch()`, no named colour**, in the CSS or on an SVG `fill` or `stroke` attribute. Every colour resolves to a palette token and every face to a `--*-face` stack, because the token is what the Theme page rewrites and a literal stays wrong on every palette but the one it was written against. *(FAIL)*

**The token names, how the palette reaches the box, and how a tint is mixed rather than sampled** are in [`../../../docs/styling.md`](../../../docs/styling.md); what this workspace wants them used FOR is [`../design/SKILL.md`](../design/SKILL.md).

**The controls a section draws take tokens like everything else.** `--nonrepro` is the one that exists for them: guides, outlines and anything that is furniture rather than page.

**And the starters in `base/` take almost none of this, on purpose.** They are the format worked out plainly — `--ink`, `--ink-3`, `--rule` and the two faces are close to the whole of what they use — because a starter's look is inherited by every page copied from it, and one example that reaches for an accent has chosen an accent for pages nobody has written yet. The palette is wide so that YOUR section can use it.

---

## Where the rest of it is

**[`../../../docs/`](../../../docs/README.md) is how the format WORKS** —
[`sections.md`](../../../docs/sections.md) for what the runtime does to this file,
[`code.md`](../../../docs/code.md) for what its `<script>` is handed and what the
box cannot do, [`styling.md`](../../../docs/styling.md) for the tokens and the type
scale. This folder is how we WRITE one.

| | |
|---|---|
| [`../pages/SKILL.md`](../pages/SKILL.md) | what a page is on disk: the directory, `content.yaml`, ids, variables, the rule index |
| [`../plugins/SKILL.md`](../plugins/SKILL.md) | what to reach for before writing code, and what a plugin owes every page |
| [`../design/SKILL.md`](../design/SKILL.md) | what this workspace wants those tokens used for. Read it before any UI work |
| [`../markdown/SKILL.md`](../markdown/SKILL.md) | `markdown.yaml`, the type scale a markdown slot starts from — which this file's `<style>` always beats |
| [`../diagrams/SKILL.md`](../diagrams/SKILL.md) | a fence or a plugin, and the question to ask before drawing either |
| [`../tables/SKILL.md`](../tables/SKILL.md) | a slot holding a table, and everything behind it |
| [`../children/SKILL.md`](../children/SKILL.md) | a slot holding a child, and how child keys are derived |

**When you are done, run the checker** — `bun run .agents/skills/check.ts pages/<id>` — and answer or note every warning rather than silencing it. It is a report and never a gate: a page that fails every rule still draws, and its raw-YAML fallback still opens.

**Then open the page and use it**, because the findings that matter most have no rule behind them: **try to add a fifth**, **try to delete one**, **drag one somewhere else**, and **rewrite a sentence**. A ceiling, a section with no way to lose a part, and a word baked into the markup all pass a clean report.
