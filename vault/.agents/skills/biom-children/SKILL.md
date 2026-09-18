---
name: biom-children
description: "WHAT A PAGE SHOULD LOOK LIKE TOWARD WHAT IT HOLDS. THERE IS NO FOLDER — any page may have children, and a page that draws them is what a folder was. The MECHANISM — a child made by writing a directory, how its section is reconciled onto the parent, the derived `@page-<segment>` key, and what `child.html` is — is `docs/pages.md` at the vault root, and this file links it rather than restating it. Use when the task involves nesting, the rail, moving something under something else, reordering anything anywhere, making a page act like a folder, MAKING A FOLDER PAGE LOOK LIKE ANYTHING AT ALL, writing or repairing a `child.html` or a `@page-<segment>.html`, or a child row that draws blank. CARRIES THE ONE METHOD FOR A PAGE WHOSE WHOLE JOB IS HOLDING PAGES, and it is that there is nothing to write: the document draws a BOARD OF CHILDREN at the bottom of any page that holds any — a count, a sort control and a row each, read from `biom.children()` — with no file, no section and no `data:` line. The parent\'s own line about a child is `holds`/`holdWords`, two parallel lists in the parent\'s variables keyed by the child\'s own last segment, because a variable is a scalar or a list of scalars and never a map. The page still says its own NAME in a masthead section, and the tally that used to go there is gone because the board counts. CHANGING WHAT A FOLDER PAGE LOOKS LIKE IS CHANGING `plugins/doc/index.html`, the file in your own vault that draws the board — an override, so deleting it brings the shipped one back — and that is why nothing about a board is in `base/`. Says how the board and the reconciled sections coexist. Carries the traps: NEVER NAME A SECTION FILE `index.html`; a row carrying a markdown part cannot be a `<button>`; and one round trip for the whole board. Then the shapes a page can take toward what it holds, in order of what they cost, and the split that decides where a word goes: THE CHILD\'S NAME AND KIND COME FROM THE FILESYSTEM AND ARE NEVER TYPED. Carries R37 and R38."
---

# Children

**There is no folder.** No `kind: folder`, no folder page, no folder section. **Any page may have children, and a page that draws them is what a folder was.**

---

## Making a page hold another page

**Write the directory. That is the whole of it.**

```
pages/home/content.yaml
pages/home/children/notes/content.yaml      ← home now holds "notes"
pages/home/children/notes/children/q3/…     ← and notes holds "q3"
```

The parent gets a section for that child on its next read, written back by the
host, and **you do not type it yourself**. How that reconciliation behaves — keyed,
additive only, never moved, appended at the bottom — and what the derived key
looks like are in [`../../../docs/pages.md`](../../../docs/pages.md). Read it
before you try to place, rename or delete one of those sections.

**A child is a page or a table**, and both live in the same tree, so a table sits
directly under the page that uses it rather than in a section of the workspace of
its own.

**A new page has one more file worth knowing about.** A page created from inside
the app is given a `child.html` — how it looks inside its parent — copied from
`base/child/index.html`. **A page you create by writing a directory has none**, and
draws the built-in row until you copy that file in. Both states are supported;
neither is broken.

---

## A page that holds pages already draws them, and there is nothing to write

**The document draws a board of children at the bottom of any page that holds any** — a count, a sort control, and one row per child, read from `biom.children()`. **No file, no section, no `data:` line, nothing in `content.yaml`.** Create a page under another page and it is on the board the moment it exists.

**It is a SIBLING of the section stack rather than inside it**, which is what makes it unconditionally last: no ordering to respect, no section to place and nothing for a page to get wrong. It sorts by name, or by date where every child is named for one, and it says which it chose; a child is opened by clicking its row.

**This is the only method, and it used to be two hand-written files.** The paved path was a `masthead.html` carrying a tally and a `row.html` named by every child's section, written against a design doc nobody had read yet — which produced one implementation per folder page and, in the workspace it was measured in, eighteen copies of `row.html` before the board landed.

### What the parent says about a child, and it is still the parent's to write

**The child's name and kind come off the filesystem**; the parent's own line about that child is two parallel lists in the parent's `variables`:

```yaml
name: Research
plugin: doc
variables:
  holds:
    - 2026-08-02-attach-rate
    - 2026-08-04-mobile-app-code-gen
  holdWords:
    - What a job is worth after the first one
    - Whether a phone can carry the whole loop
```

**`holds` names the child by its own last segment** — the folder name on disk — so the line follows a rename. **`holdWords` says the line.** A child named in neither simply has no line, and a page with no `holds` at all is the ordinary case.

**Two lists rather than a map, because a variable is a scalar or a list of scalars and never a map.** Anything tabular in this format is lists sharing a stem and the same length; that is R44 and it binds here like everywhere else.

### The page still says its own name, and a masthead is how

**The board says what the page HOLDS. It does not say what the page IS.** So a folder page still opens with a section carrying its `# Heading` and the passage under it — one markdown part, because a title and the paragraph under it are one passage and cutting them apart makes two sealed boxes with nothing between them, which is what R57 reports.

**The tally that used to go in a masthead is gone**, because the board counts. A count written into the passage has to be re-counted by hand every time the folder changes, and it never is.

### Writing a board of your own

**The board is a drawing, and the most opinionated thing in a workspace is a board** — so the file that draws it is in the vault, at `plugins/doc/index.html`, and it is yours. Open it, change the rows, change the sort, delete the board entirely. **That file is an override of the shipped document, not a fork of it**: delete it and the shipped one comes back and every page still draws.

**That is why nothing about a board is in `base/`.** A starter's look turns up in every page copied from it, and a board copied per folder page is the eighteen copies again. The argument that kept it out of `base/` was right; what changed is that there is now one place for it to be instead.

### The reconciled sections, and why the board does not fight them

**Every child is still guaranteed a section on its parent**, reconciled in on every read — that is what makes a page created in any way impossible to lose. The board does not replace those entries and cannot: reconciliation is about what the document holds. **What the document does is decline to draw a BARE one twice.** A rule in the document's head is a document stylesheet and genuinely reaches a section, unlike a section trying to hide a sibling.

**A reconciled section that somebody wrote a file for is still drawn**, because the rule carries `[data-g-default]` — the mark the runtime puts on a section that resolved to the shipped default because it named no file of its own. So a parent that wrote `@page-notes.html` for one child gets that row AND the board: they meant that row, and the board is not entitled to overrule them.

**Never name a section file `index.html`.** That name is the HTML plugin's page document: a file called `index.html` beside a `content.yaml` **wins over the plugin the page named**, so the file is injected into the body as well as drawn as a section, its script runs once unwrapped — no `section`, no `ctx`, no `onTeardown` — and throws before the real copy runs. The page draws correctly and the console carries a `ReferenceError` nothing on screen explains. Name a section file for what it is: `masthead.html`, `@page-notes.html`.

## Then decide how much the page says about what it holds

**Above is what a page whose WHOLE JOB is holding pages should do.** The shapes below are for every other page — one that holds a table it charts, or a couple of pages beside its own prose — and they are in order of what they cost. **The first is the right answer for most of those.** Each of the others costs a file, so take it only when the question beside it is a yes.

### 1. Leave the reconciled row alone

It is already a real row: the child's name, a word for what it is, a table's row count, and **clicking it opens the child**. Nothing to write, and it stays true when the page is renamed.

*Take the next shape when* the list has to say what each child is FOR, not only what it is called.

### 2. This page always looks like this, wherever it is held → `child.html`

**In the CHILD's own directory.** A page knows how it wants to be summarised better than every page that might hold it, and this is where it says so. It travels with the page: hold the same page somewhere else and the same drawing goes with it. Delete it and the built-in row comes back — a supported act, which is why nothing on the read path ever puts it back.

### 3. This particular list wants its rows a certain way → `@page-<segment>.html` on the PARENT

**Beside the parent's own `content.yaml`, named for the child it draws.** It becomes that section's markup, exactly as `hero.html` would, with the same slots and the same rules as any other section file. **The parent wins where both exist** — a parent is looking at a list it composed and the child is not — and when it wins, the child's own `child.html` is not sent at all, because it would be markup nothing asked for.

*Does this page always look like this* → `child.html`. *Does this list want its rows a certain way* → the parent's file. Writing the parent's version once per parent is how a drawing goes stale the moment the same page is held somewhere else.

### 4. The page wants a board, a gallery or a grid → one section that reads `biom.children()`

Not a row at all. **The built-in drawing is replaceable because it reads `biom.children()` and nothing else**, so a section reading the same call draws the whole set however it likes — §*Drawing the whole set*.

**Take it only where the board at the bottom is not the drawing this page wants** — a gallery of pictures, a grid of cards, a map. The board is still there underneath, because nothing a section does can hide it. **Wanting it gone is the tell that this is not a section at all**: the board is drawn by `plugins/doc/index.html`, in your own vault, and changing what a folder page looks like is changing that file.

---

## What is the filesystem's, and what is yours to write

This is the split that decides where every word in a child's row goes, and getting
it backwards means either fighting the filesystem or leaving text uneditable.

| | Comes from | Written how |
|---|---|---|
| The child's **name** | its own `content.yaml` | never typed into a row. `{{name}}` in a `child.html`, or `biom.children()` |
| The child's **kind**, **id**, **row count** | the filesystem and the tables | the same |
| The child's **section on the parent** | derived — `@page-<segment>` | reconciled in; never hand-written, never hand-deleted |
| **The parent's own words about that child** | you | a slot in the parent's `@page-<segment>.html`, so a person can click and type them |

**R38 — a drawing of a child reads the child.** A `@page-notes.html` that prints a name it copied is wrong the moment somebody renames that page, with nothing on screen to say so. The same goes for a child list copied into `variables`: the children are not content, they are what the page holds, and there is one place to ask. *(FAIL)*

**The other half of that rule is the one people miss: a row's own commentary IS content, and belongs in a slot.** The parent's file is an ordinary section file, so a `data-g-part` in it is filled from the parent's `parts` and opens under the caret like any other prose. A sentence about why this child is in this list, written into the markup instead, is a sentence nobody can ever edit.

**A file named for a child that keeps the `child` part instead** — `<div data-g-part="body"></div>`, letting the child plugin draw the row — still reports R38, because the rule cannot see that the part is doing the reading. Either read the child yourself, or leave the section without a file of its own.

### The shape that does both

`content.yaml`, on the parent — **state `data:` so the section says which file is its markup**, which is also what lets the checker read the file as this section's own:

```yaml
contents:
  - name: "@page-notes"
    data: "@page-notes.html"
    parts:
      blurb: |-
        Why this page is here, in the parent's own words. Editable, like every other part.
```

`@page-notes.html`, beside it:

```html
<style>
  .rail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 1rem; align-items: baseline; color: var(--ink); }
  .rail-open {
    justify-self: start; background: none; border: 0; padding: 0;
    color: var(--ink); font: inherit; text-align: left; cursor: pointer;
  }
  .rail-open:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
</style>
<div class="rail">
  <button class="rail-open" type="button"></button>
  <div data-g-part="blurb"></div>
</div>
<script>
  // THIS SECTION'S NAME IS THE CHILD'S KEY, so the child is found rather than
  // named. Not async: `await` at the top level of a section script is a syntax
  // error, so anything awaited goes inside an async IIFE.
  (async function () {
    var key = function (c) {
      return "@" + c.kind + "-" +
        (c.kind === "page" ? c.id.slice(c.id.lastIndexOf("/") + 1) : c.id);
    };
    var kids = await biom.children();
    var mine = kids.find(function (c) { return key(c) === ctx.section; });
    if (!mine) return;
    var open = section.querySelector(".rail-open");
    open.textContent = mine.name;
    open.addEventListener("click", function () { biom.open(mine); });
  })();
</script>
```

**`{{name}}` in the parent's file is the PAGE's scope and not the child's.** The child's own fields are the nearest scope only inside a `child.html` — [`../../../docs/pages.md`](../../../docs/pages.md) — so a parent's file that wants the name reads it, which is what R38 asks for and what the example above does.

---

## The key is ONE SEGMENT, and never a path

**R37 — a child key is derived, never invented, and is ONE SEGMENT.** A section name starting with `@`, or a file named for one, matches `@page-<segment>` or `@table-<name>`. Anything else stands for no child, is never reconciled onto, and leaves the real child appended at the bottom as though the file were not there. *(FAIL)*

**This has already been got wrong once, and the way it failed is the way it will fail again.** A helper spelled the key as `"@" + c.kind + "-" + c.id`. What it built for a nested page was `@page-home/team/notes` while the host had written `@page-notes`; the match failed, the drawing had no child to draw, and **every nested page's child row drew blank until somebody read the line.** A top-level page has one segment, so it worked in exactly the case anyone would have tried first. Any hand copy takes the last segment, as the example above does. Why it is one segment rather than the id is in [`../../../docs/pages.md`](../../../docs/pages.md).

---

## Asking what a page holds

**Any page can ask what it holds, whether or not it draws any of it** —
`biom.children()`, and [`../../../docs/code.md`](../../../docs/code.md) is the
call and the shape it answers. **It is the same data the built-in drawing reads**,
which is why the two can never disagree, and why replacing the drawing is an
upgrade rather than a fork.

---

## You do not write a child entry by hand, and you cannot delete one that way

Removing the entry only makes it reappend on the next read; **deleting the child
is what removes it**, and the server says so rather than pretending otherwise.
The reconciliation rules behind that, and what happens to a section whose child has
gone, are in [`../../../docs/pages.md`](../../../docs/pages.md).

---

## What `child.html` is, and what it is not

**It is markup. It is not a program, and it holds no slots.**
[`../../../docs/pages.md`](../../../docs/pages.md) says what the child plugin does
to the file — the four substitutions that mean THIS child, the scoped `<style>`,
the `<script>` that is removed and reported, and the `data-g-part` that is never
filled.

**The judgement that follows from the last of those: words written into this file
cannot be edited in the app.** So keep it to the child's own fields, and put
anything a person should be able to change in the parent's file — the split above.
**The child says how it LOOKS; the section holding it says how the page BEHAVES.**

---

## A row you cannot click is not a row

**Following it is most of what a row is for**, and a custom drawing that lost the
click would be strictly worse than the built-in row it replaced. That is not a
hazard you have to handle: the child plugin wires it for you, and what your markup
decides is only how the KEYBOARD reaches it —
[`../../../docs/pages.md`](../../../docs/pages.md) has the two shapes, and the
rule is that you draw one of them and never both.

**A drawing that reads `biom.children()` and builds its own buttons wires its own
click**, with `biom.open`, which takes exactly what `biom.children()` hands back.
One line, as in the examples here.

---

## Drawing the whole set

A page that wants a board, a gallery or a grid of its children writes one section that reads the same call the built-in drawing reads:

```html
<style>
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .5rem; }
  .board-cell {
    background: none; border: 1px solid var(--rule-soft); color: var(--ink);
    font: inherit; text-align: left; padding: .6rem; cursor: pointer;
  }
  .board-cell:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
</style>
<div data-g-part="intro"></div>
<div class="board"></div>
<script>
  // Not async: `await` at the top level of a section script is a syntax error.
  (async function () {
    const board = section.querySelector(".board");

    async function paint() {
      const kids = await biom.children();
      board.textContent = "";
      for (const kid of kids) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "board-cell";
        cell.textContent = kid.name;
        cell.addEventListener("click", function () { biom.open(kid); });
        board.append(cell);
      }
    }

    // A child added or removed arrives as a refresh. The runtime re-fills the
    // SLOTS by itself; a drawing built from children() is yours to redraw.
    onTeardown(biom.onRefresh(function () { void paint(); }));
    await paint();
  })();
</script>
```

**The board at the bottom is still there**, and so is every reconciled section a file was written for — **and nothing a section does can get either out of the way.** A section's `<style>` is wrapped in `@scope (#sec-<name>)` and reaches only itself; `hidden` loses to the shipped default's own `:scope { display: block }`; and the inline style that would work is an R29 FAIL. So a section like this one sits ON TOP of a board that is still a board. **Changing what a folder page looks like is changing the file that draws it** — `plugins/doc/index.html`, in your own vault — and that is §*Writing a board of your own*, not a section.

---

## Every ordering in the workspace is some page's `contents`

**There is no workspace-level order file and no separate children list anywhere** —
[`../../../docs/pages.md`](../../../docs/pages.md) — so reordering anything is one
write to one page's `contents`. A second mechanism for the same job would be a
second answer to *where does this sit*, and the two would disagree the first week.

**Moving a table is the one operation with a second half.** The `contents` write
says where it sits; the table's own parent says whose child it is. Without both, a
dragged table leaves a key in the new page's order and stays listed under the old
one — see [`../biom-tables/SKILL.md`](../biom-tables/SKILL.md).

---

## Where the rest of it is

**[`../../../docs/pages.md`](../../../docs/pages.md) is the mechanism** — how the
filesystem is the hierarchy, how a child's section is reconciled in, what the
derived key is, and what `child.html` is. This file is what a page should LOOK
like toward what it holds.

| | |
|---|---|
| [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md) | what a page is on disk, the part types, and the numbered rule index |
| [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) | the section a child sits in: slots, `@scope`, scripts, what the box cannot do |
| [`../biom-plugins/SKILL.md`](../biom-plugins/SKILL.md) | how code reaches a slot, and the `ctx` a section script is handed |
| [`../biom-tables/SKILL.md`](../biom-tables/SKILL.md) | the other kind of child, and everything behind it |
| [`../biom-design/SKILL.md`](../biom-design/SKILL.md) | how a row is allowed to look before you draw one |
