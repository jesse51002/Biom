---
name: biom-tables
description: "WHETHER THE THING IN FRONT OF YOU IS A TABLE AT ALL, and what a page should say beside one. The MECHANISM — what a table is, every column type and what each does in a page\'s grid, reading and writing, a section placing its own grid, retyping, renaming and CSV — is `docs/tables.md` at the vault root, and this file links it rather than restating it. Read whenever a page shows figures, rows, a list somebody keeps adding to, or anything a second page will also need; whenever a column\'s type or meaning is in question; or whenever data is coming in from CSV. Leads with the shape that works — a section whose slot holds a `table` part, drawn by the `table` plugin — then the question that decides whether the page wants a table at all or just its own variables, why three things compared side by side are a LIST and not a table, why rows that each want different fields are PAGES and not rows, what to do when the table does not exist yet (a page cannot create one: check first, then say exactly what you need, and write the page anyway), the narration rule for the sentence beside a grid, THE OTHER KIND OF TABLE — a `grid` part, the document\'s own rows, edited on the page a cell at a time, which is what every markdown table in a paragraph becomes — and when a page wants that rather than a table in the database, R19 — prefer the row calls to `sql` — the fact that a table is a child in the tree with a parent page, exactly as a page is, and R62 to R64, what the checker says about a grid."
---

# Tables

**This file settles how a page gets at data, so that nobody has to work out where figures live or how rows reach the screen.**

**Everything else in a workspace is replaceable and tables are not.** A section can throw away the built-in drawing, take the whole canvas and answer to nothing. Data cannot work that way: it is the thing two pages have to agree about, the thing that has to still be readable after the page that wrote it was rewritten, and the thing a person expects to still be there next year. So a page reads and writes tables; it never invents a second shape for them.

---

## The shape that works

**A grid on a page is a SECTION whose slot holds one.** `contents` holds sections and nothing else, so a table arrives exactly the way prose does — a part in a `parts` map, with `type: table` and the table's **name** as its `data`.

```yaml
contents:
  - name: work
    data: split.html
    parts:
      standfirst: "Everything quoted this month."
      rows: { type: table, data: jobs }
```

```html
<style>
  :scope { display: block; padding-block: 2.5rem; }
  .split {
    display: grid;
    gap: 1rem 2.5rem;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
    grid-template-areas: "lede grid";
    color: var(--ink);
  }
  .lede { grid-area: lede; max-inline-size: 24rem; }
  .grid { grid-area: grid; min-inline-size: 0; }
  /* One column when there is no room for two. Last in the file, so it wins. */
  @media (width <= 52rem) {
    .split { grid-template-columns: minmax(0, 1fr); grid-template-areas: "lede" "grid"; }
  }
</style>
<div class="split">
  <div class="lede" data-g-part="standfirst"></div>
  <div class="grid" data-g-part="rows"></div>
</div>
```

**That is the whole of it.** The shipped `table` plugin fills that slot — no script, nothing loaded, and every column drawn the way its type says to; what it does with each type is [`../../../docs/tables.md`](../../../docs/tables.md).

**Take this by default.** It is the cheapest route, it looks the same on every page in the workspace, and a person who learns to read one grid can read all of them. The rest of this file is what to do when the default does not fit.

**Give the grid a sentence only where the sentence carries a fact the grid cannot.** A table dropped onto a page on its own can leave the reader working out why it is here — but the cure is a line saying **what to notice in these rows**, which is a judgement the grid cannot make for itself. *"Everything quoted this month; the three over ten days are the ones to chase"* is content. *"This grid shows the jobs table and updates when the rows change"* is narration — it restates what is already on screen, and the page is better with it deleted. See **A slot holds what the page is, never a description of what it is** in [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md). **Give the section a real layout either way**: two slots one under another in a plain box is a cut markdown did not need, which the checker reports as R57.

---

## First: is it a table at all?

Ask these before you name one. **Any yes is a table:**

- **Will a second page need the same facts?** Two pages that each hold their own copy disagree the first time one is edited.
- **Will somebody add to it a row at a time, after this page is written?** Rows arrive; prose does not.
- **Does a person want to sort, filter or count them?** A grid does that; a paragraph does not.

**All no, and it is this page's own handful of figures — then it is variables, and `{{name}}` in the prose.** A page that states one rate, one date and one total does not want a two-column grid of them; it wants those values in the document, editable in place. See *Variables* in [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md).

**All no, and it is still rows — a spec's list of pieces, a comparison the reader looks DOWN, a schedule, anything with a header and cells of prose that belongs to this page — then it is a `grid` part: the document's own table.** Its rows are data in `content.yaml`, it is edited on the page a cell at a time, and it needs no section file of its own. It is the shape below, and it is what the doc plugin makes out of every markdown table it finds in a paragraph, so a run of pipes is never the final shape of anything.

```yaml
contents:
  - name: pieces
    parts:
      body:
        type: grid
        rows:
          - [Piece, Where, What changes]
          - [The part, "`contracts/types.ts`", A fifth part kind beside the four]
          - [The drawing, "`plugins/biom-grid.js`", Draws the rows as a board]
```

**The line between the two is who else needs the rows and what happens to them.** Rows a second page names, rows that arrive one at a time over months, rows somebody sorts, filters or counts, rows with a type per column — a table, in the database, with a name. Rows that are this page's own argument, whose cells are sentences, and that change when the page changes — a grid, in the document. A grid holds words; a table holds values. The mechanism of a grid — the shape on disk, the board, the cell edit, the four controls, the mirror, and what the conversion does to a document — is the last section of [`../../../docs/tables.md`](../../../docs/tables.md).

**And never style the pipes.** A markdown table inside a prose part is converted the next time the page is drawn, so a section written to make one look like a board is styling a thing that is about to leave. Write the grid.

**Three things compared side by side are not a table either.** A comparison the reader looks ACROSS is one section holding a LIST of three items — the `list` starter in `base/` is that shape already. A workspace table is for many rows of the same shape, not for three columns of prose.

**And if each "row" wants different fields, they are pages, not rows.** A table has one shape for every row. A set of things that each want their own layout and their own words are children of this page — see [`../biom-children/SKILL.md`](../biom-children/SKILL.md).

---

## A page cannot create a table. Check first, then say what you need.

**Creating a table, adding or retyping a column, and importing CSV all happen in the app.** `workspace.db` is the one thing in a vault that is not text, and the server owns it — an agent that opens it corrupts it. There is no call for any of these from a page, and no file you can write that makes one appear.

**So the first thing to do is look** — `biom.tables()` and `biom.schema(name)`, in [`../../../docs/tables.md`](../../../docs/tables.md).

**If the table is there, write against the schema you just read** rather than against the column names you were hoping for. A page that hard-codes a column name breaks silently when somebody renames it; a page that reads the schema can say so instead.

**If it is not there, still write the page, and hand over the exact schema to create** — the name, `kind: basic`, and every column's name and type. Until it exists the slot draws one line saying that table could not be read, in place, with the rest of the page around it intact. That is a visible prompt rather than a broken page, which is why it is safe to write the page first. What is not safe is inventing a table name and saying nothing about it: the page looks finished, and the only sign is a line of failure text nobody was told to expect.

---

## Everything behind that is `docs/tables.md`

**[`../../../docs/tables.md`](../../../docs/tables.md) is the mechanism** — that
`workspace.db` is the server's and not yours to open, every column type and what
each one DOES in a page's grid, the three ways rows get in, reading with
`biom.table` and a query, writing with insert/update/remove, a section placing its
own grid with `data-g-plugin="table"`, why a change to a table redraws the whole
stack, and what only the app can do: create a table, retype or rename a column,
import CSV.

**Three of those carry a judgement worth stating here, because the mechanism alone
does not produce it.**

**Choose a column's type for the BEHAVIOUR, not for the label.** The type is what
the cell does — a `number` reads down a column because it is right-aligned in
figures of one width; a `checkbox` is a box and never the word `true`; a
`categories` cell is a set of labels rather than a string. A column typed `text`
because the data is technically text is a column that does nothing for the reader.

**Ask for the rows and the schema together, and draw with whichever arrived.** A
header over an empty body reads as *this table is empty*; a blank rectangle reads
as *the product is broken*. The shipped plugin already does this; a plugin of your
own has to.

**Await every write and make the failure visible in the page's own words.** The
shape that works is optimistic: move it on screen now, write, and put it back if
the host refuses, with a line saying what happened.

**A table part carries no `variables` worth writing.** What a grid shows is the
table's own schema, which lives in the workspace database and is edited in the
app. A copy of a column name in the document is a second statement of it, stale
the first time somebody renames one.

---

## The rules

**R19 — prefer `table`, `insert` and `update` to `sql`.** `biom.sql` resolves for real; this workspace grants unrestricted access. It is still the call to avoid. A page written on SQL is a page that has to be rewritten the day access is scoped, and nobody using this workspace should have to read a `SELECT` to understand their own data. **Where it is genuinely the only answer** — an aggregate the row calls cannot express, a one-off count across tables — take it knowingly, keep it to one call, and draw from its result rather than building the page on it. *(WARN)*

**A table is a child in the tree, exactly as a page is.** It has a parent page and sits under the page that uses it, rather than in a section of the workspace of its own — which is the grouping the tree exists to make possible. A page asks what it holds and gets pages and tables back in one answer, and a slot can hold a table as a **child** — which points at it and opens it — rather than as a `table` part, which embeds the rows. **Point at it when the table is somewhere the reader goes; embed it when the rows are what this page is about.** The two are different acts and the format keeps them apart.

**R62 — a grid is square.** Every row has as many cells as the widest, empty ones written as `""`. The reader pads a short row on the right, so the page draws either way — but a cell that was meant for a later column has moved left, which is a wrong table that looks like a right one. A row that is not a list, or a cell that is a map or a list, is refused by the parser: a cell is markdown. *(WARN for a ragged row; FAIL for a row or a cell that is not what a row or a cell is.)*

**R63 — a head is a row.** `head` is true or false, and absent reads as true, because a grid comes from a markdown table and every markdown table has a header. A grid with `head` true and no rows has a header that is not there: write the header row, or say `head: false` for a grid that starts empty. *(FAIL for a head that is not true or false; WARN for a header with no row.)*

**R64 — a bare pipe in a cell is a note.** A cell holds its pipe as a character — nothing splits a cell on anything, which is the whole reason a grid is a part kind and not a markdown table dressed up — and the mirror escapes it on the way out. But a bare pipe in a cell is nearly always a table row pasted into one cell, so the checker says so and leaves it. If it was meant to be several cells, make them entries of the row. A pipe inside a `[[id|alias]]` link or a code span is the link's or the code's and is never reported: linking with an alias is how this format writes a link, in a cell as anywhere. *(WARN)*

---

## Where the rest of it is

**[`../../../docs/tables.md`](../../../docs/tables.md) is how data works.** This
file is whether to reach for it.

| | |
|---|---|
| [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md) | what a page is on disk, the part types, variables, and the numbered rule index |
| [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) | the section a grid sits in: slots, scripts, R28, what the box cannot do |
| [`../biom-children/SKILL.md`](../biom-children/SKILL.md) | pointing at a table instead of embedding it, and drawing children your own way |
| [`../biom-plugins/SKILL.md`](../biom-plugins/SKILL.md) | writing a plugin of your own that draws from rows |
| [`../biom-design/SKILL.md`](../biom-design/SKILL.md) | how anything here is allowed to look |
