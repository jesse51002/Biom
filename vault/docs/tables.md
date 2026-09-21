# Where does data live?

**Rows live in `workspace.db`** — SQLite, in the workspace root, owned by the
server. It is the one thing in the folder that is not a text file you edit.
Opening it with a text editor corrupts it, and a row written around the server is
a row the app does not know changed.

Everything else in a workspace is replaceable and tables are not: data is the
thing two pages have to agree about, the thing that has to still be readable after
the page that wrote it was rewritten, and the thing somebody expects to still be
there next year.

**A page can also hold a table of its own, in the document.** That is a `grid`
part — rows as data in `content.yaml`, edited on the page a cell at a time — and
it is the last section of this file. It is for rows that belong to one page: a
spec's list of pieces, a comparison, a schedule. Rows two pages share, rows
somebody adds to over time, rows a person wants to sort and count, are a table
in `workspace.db`, which is what everything above that section is about.

## What a table is

A name, a kind, and an ordered list of columns.

```
{ name: "jobs", kind: "basic", columns: [ … ] }
```

**`basic` is a typed grid a person edits. `sql` is a table an agent made** —
listed and readable, with no column metadata beyond its kind. A `sql` table draws
every cell as text, because there is nothing that says what a cell means.

**A table is a child in the tree, exactly as a page is.** It has a parent page and
sits under the page that uses it, rather than in a section of the workspace of its
own. A page asks what it holds and gets pages and tables back in one answer.

## The column types

A column is `{ name, type }` plus whatever its type needs. **The type is not a
label on the data — it is what the cell does**, so the third column here is the one
to choose against.

| Type | What it holds | What it does in a page's grid |
|---|---|---|
| `text` | a string | drawn as it is |
| `number` | a number | right-aligned on the last digit, in figures of one width, so a column reads down |
| `checkbox` | yes or no | a box, ticked or not — never the word `true` |
| `date` | one day, stored `YYYY-MM-DD` | drawn as that text, and sorts chronologically because the spelling is fixed |
| `categories` | **any number of labels** | each label as a tag, in the palette colour its option carries |
| `person` `url` `email` `phone` | text, entered differently in the app | **drawn as plain text.** The box cannot open a link, so an address is drawn as the address |
| `link` | a row in another table | **drawn as that row's id — a number.** Showing the other row's name is a join you write |
| `page` | a page in this workspace, by id — **an id is a path**, `home/clients/ashgrove` | drawn as that path |

**`categories` is select, multi-select and status collapsed into one type.** Three
types differing only in how many values they allowed was a distinction a person had
to learn for nothing. A value is a **set** of labels; `options` carries each label
and the palette role it takes; a label written into a cell that the column has not
seen before is **learned** and joins the options. So a `where` on a categories
column means *carries this label*, not *equals this string*.

**A `link` column names the table it points at and which column to show** —
`{ type: "link", table: "clients", show: "name" }`. It stores the referenced row's
id, so a rename on the other side does not break it. **`show` is honoured by the
app's grid and not by a page's**: over the port a link cell is the id and nothing
else. A page that wants the name reads the other table and matches on `id`.

**`url`, `email` and `phone` are input affordances and not truth claims.** Only
`date` and `checkbox` are constrained on the way in, because they are the only two
with exactly one legal spelling; refusing a pasted phone number would lose the
person's text, which is worse than storing a malformed one.

**A column states where it comes from as a relationship, never as a query.** There
is no `SELECT` on a column, no formula language and nowhere to put one. Two tables
relate because one has a `link` column naming the other, and that is the entire
mechanism.

## Putting a grid on a page

A grid is a section whose slot holds a `table` part, and the table's **name** is
the part's `data`:

```yaml
contents:
  - name: ledger
    parts:
      body: "Everything quoted this month."
      rows: { type: table, data: jobs }
```

The `table` plugin fills that slot: it asks the host for the rows and the schema,
draws a header, draws each cell the way its column's type says to, and puts the
grid in a box that scrolls sideways on its own. You write no script and load
nothing.

**A section can also place a grid with no stored content at all:**

```html
<div data-g-plugin="table" data-g-table="jobs" data-g-max-rows="20"></div>
```

`data-g-table` is interpolated like everything else in a section's markup, so
`data-g-table="{{table}}"` lets one section file draw a different table per page.
`data-g-max-rows` becomes the query's `LIMIT`, and `total` still counts everything
that matched.

**A page's grid is read-only, and it says so rather than defaulting to it.** A
table *is* editable — in the app's own grid, which speaks the same calls a page
does. A second editing surface inside the box would be a second set of rules about
what a cell may hold, and the two would drift. If a page needs a reader to change
data, it draws the control itself and calls `biom.update`. A table the page
holds itself is the other thing, and IS edited on the page — see the `grid`
part at the end of this file.

## Reading

Every call answers a promise, so each fragment here belongs inside an async IIFE
in a real section — `await` at the top level of a section script is a syntax
error ([`code.md`](./code.md)).

```js
const view = await biom.table("jobs");            // { schema, rows, total }
const some = await biom.table("jobs", {
  where: { stage: "Quoted" },                     // categories: CARRIES this label
  order: [{ column: "due", dir: "asc" }],
  limit: 50, offset: 0,
});
```

**A row is `{ id, cells }`** — its own id, and a map of column name to value. Rows
carry their own id because finding a row by object identity cannot survive coming
from a database.

**`total` counts what the query matched, before `limit` was taken off it**, which
is what lets a page say *20 of 340* rather than *20*. **There is no default page
size: ask for what you will draw.** A `limit` is applied as the query's `LIMIT`
and not as a slice taken afterwards, so twenty rows of a hundred thousand move
twenty rows over the port.

`biom.schema(name)` is one table's columns; `biom.tables()` is every table with its
row count and its parent page. Inside a plugin the same request goes over
`ctx.call("table.get", { name, query })`.

**The rows arrive over the port and there is no other way to get them.** A `table`
part carries the name and nothing else. Prose and children are resolved inline in
the page's answer because the box cannot fetch — but a table is unbounded, and
inlining every row into every page that mentions it would make reading a page cost
the size of the database.

**The rows and the schema fail apart.** A renamed table answers *not found* to the
first while the second still describes something, and a table with no rows answers
an empty list with a header that still has to be drawn.

## Writing

```js
const id = await biom.insert("jobs", { name: "Ashgrove", hours: 12 });
await biom.update("jobs", id, { hours: 14 });
await biom.remove("jobs", id);
```

`insert` answers the new row's id. `update` and `remove` take that id, never an
index, and each answers a promise that can be refused.

**A change to a table names no page, so the whole stack redraws** and a grid in a
slot comes back current for nothing. A drawing that holds rows of its own — a
chart, a board, a summary line — has to redraw itself: register `biom.onRefresh`
and read again rather than reusing what you cached.

## What only the app can do

**Creating a table, adding or retyping a column, and importing CSV all happen in
the app.** There is no call for any of them from a page, and no file you can write
that makes a table appear. So a page **looks first**:

```js
const all  = await biom.tables();        // every table, with its row count
const jobs = await biom.schema("jobs");  // one table's columns
```

Until a named table exists, the slot draws one line saying that table could not be
read, in place, with the rest of the page around it intact.

**A retype is allowed when every value has one obvious destination, and refused
otherwise.** Every type has a faithful string, so anything may become text, and
parsing is what the other types are for, so text may become anything. The gaps are
the pairs where a value would have to be invented — a number is not a day; a set of
labels is not a yes-or-no — and two hops through text does them, visibly.

**A retype is destructive and there is no row-level undo.** A text column retyped
to number nulls every cell that was never a number. The workspace's git history
covers files; it does not cover `workspace.db`.

**A rename is a rename only if it says so.** The request carries the name the
column had before. Without that, a schema change arrives as two lists of names and
has to infer renames by position — which reads *drop one column and add another*
as a rename, and guessing wrong silently destroys a column of data.

**CSV import never throws data away.** A header the table does not have becomes a
`text` column rather than being dropped. **The count it answers with is the rows
that landed whole** — a row with one field that could not be read is still
inserted and deliberately not counted, because reporting a row whose date was
silently nulled as *imported* is the quiet half of a data loss. A count short of
the file's row count is a prompt to look, not a failure.

## A table the document holds: the `grid` part

**A `grid` part is a table whose rows live in `content.yaml`**, beside the prose,
and not in `workspace.db`. It has no name and no schema; it has `rows`, a list of
lists of markdown strings, and `head`, whether the first row is the header:

```yaml
contents:
  - name: pieces
    parts:
      body:
        type: grid
        rows:
          - [Piece, Where, What changes]
          - [The part, "`contracts/types.ts`", A fifth part kind beside the four]
          - [The drawing, "`plugins/biom-grid/`", "Draws the rows as a board"]
```

`head` is true when left out, because every markdown table has a header and that
is where a grid comes from; `head: false` is a grid of plain rows. A row shorter
than the widest is padded with empty cells on the right when the page is read.
There is no `data` on a grid, and `rows` on any other type is refused by name.
The rows are written back one per line, `- [Piece, Where, What changes]`, so
the file reads as the table it holds; a cell holding a comma, a pipe or a line
break is quoted on that line.

**It is drawn as a board by the framework's `biom-grid`** — or by a
`plugins/grid/` of this workspace's own, which wins by existing — a header band, the cells in
the sheet face, one hairline — and it needs no section file: a section with no
`data:` takes the shipped default, which widens from the reading measure to the
figure width when its slot holds a grid, and the board scrolls sideways inside
its own box only past that. A section of your own says its own width.

**It is edited on the page, a cell at a time.** Click a cell and it opens as its
raw markdown, braces and all; Enter or leaving the cell writes the rows back
whole over `section.write`, Escape puts the cell back. The cell is re-rendered
where it stands and the document is written only when the value changed, so the
next cell opens on the next click — a write from the board does not redraw the
page. A pipe typed into a cell is kept as a character; nothing splits a cell.

**A row or a column is added or removed from the gutter outside the board**,
and every control says what it does: *Delete row* beside each row, *Delete
column* over each column, *Add row* under the last row, *Add column* beside the
last. Deleting the last row under a header leaves the header; deleting the last
column is refused in words, because a grid with no columns is not a grid. A
section that reads the rows itself gets them from `ctx.read(part)` as an array
of arrays and puts them back with `ctx.write(part, rows)`, which is the same
door the board uses.

**In the mirror it is a markdown table again.** The projection writes the rows
as `| Piece | Where |` lines under a delimiter row, a pipe inside a cell
escaped as `\|` and a line break inside one as `<br>`, so Obsidian draws it and
a brain reads it. A `table` part, by contrast, projects as its name only,
because its rows change without the page changing.

**A markdown table in a prose part becomes one the next time the page is
drawn.** The doc plugin cuts the table out and rewrites the document once, in
place: the prose before keeps the section's name and its file, the table
becomes a section named `<section>-table` with no file whose `body` is the
grid, and the prose after becomes `<section>-after`. Both new sections carry
the section's own `variables` with the part's own over them, so a `{{name}}`
in a cell or in the prose after still resolves. A section that held nothing but the table — no file, no other
slot — gives its place to the grid section rather than staying as an empty
band. What that means for writing is that a run of pipes in a paragraph is
never the final shape of anything: write the grid, or write the pipes and let
the draw convert them, and never style the pipes.

**Which to reach for.** A grid is one page's own rows — a spec's pieces, a
comparison, a schedule, anything whose cells are prose and whose home is this
page. A table is rows with a shape: shared by pages, added to over time,
sorted, counted, typed. The question that decides it is
[`../.agents/skills/tables/SKILL.md`](../.agents/skills/tables/SKILL.md), and
so are the three rules the checker reports on a grid — R62, R63 and R64.

---

**Whether the thing in front of you is a table at all**, what to say beside a grid,
and the rule about `biom.sql`, are
[`../.agents/skills/biom-tables/SKILL.md`](../.agents/skills/biom-tables/SKILL.md).
