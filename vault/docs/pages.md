# Where is my page?

A page is a directory. `content.yaml` inside it is the page. That is the whole of
the format, and everything else is a consequence of it.

## The folder is the hierarchy

A page's children live inside its `children/` directory, and **a page's id is the
path that reaches it**:

```
pages/
  home/                                 <- the root page
    content.yaml
    children/
      notes/
        content.yaml                    <- the page `home/notes`
        figure.html                     <- one of its sections' markup
        markdown.yaml                   <- optional: this page's type scale
        children/
          q3/
            content.yaml                <- the page `home/notes/q3`
            child.html                  <- how this page looks inside its parent
```

There is no `parent:` key anywhere, and there is no list of children anywhere.
The directories *are* the answer, so the shape of a workspace can be read by
listing folders instead of opening every file in them.

**Renaming a directory renames the page and rewrites every id beneath it.** That
is the price of the folder being the truth rather than a copy of it.

## The id grammar

A directory name is one segment of an id, and it must match
`^[A-Za-z0-9][A-Za-z0-9_-]*$` — letters, digits, dashes and underscores, starting
with a letter or a digit. The full id is the segments from the root, joined with
`/`. A page id may be at most twelve segments deep.

**Case is kept.** `Office_Hours` stays `Office_Hours` in the folder, in the URL
and in the markdown mirror — a workspace read in another editor should look like
the workspace rather than like a slug of it. What case costs is one rule: **two
pages in the same `children/` may not differ only in case.** `Airtable` and
`airtable` are one directory on macOS and on Windows, so the second page would be
written into the first one's folder. The server refuses it when a page is created
or moved.

A leading `_` is the one position that is refused, which is what keeps `_markdown`
and `_assets` out of the page tree. A dot, a slash or a space in a directory name
means it is not a page.

## What a page directory holds

| | |
|---|---|
| `content.yaml` | **required.** It *is* the page. Without it the directory is not a page at all — the server answers *not found* and it does not appear in the rail |
| `*.html` | a section's own markup, named by that section's `data:`. See [`sections.md`](./sections.md) |
| `child.html` | how *this* page draws when another page holds it as a child. Below |
| `markdown.yaml` | this page's own type scale, merged over the workspace's. See [`styling.md`](./styling.md) |
| `_assets/` | files a section or an `html` part names, one level down. One of the two reserved subdirectories |
| `plugins/` | this page's own plugins, and its rung over any plugin's variables — `plugins/biom-doc/extensions.yaml` reaches this page and no other. The other reserved subdirectory; it is never a page, and a page called `plugins` under `children/` still is one. See [`plugins.md`](./plugins.md) |
| `children/` | where this page's children live. It is not a page |

**There are no `.md` files and no `.mermaid` files in a page directory.** A
page's prose is inline in `content.yaml`; a diagram is a drawing in a section's
own markup, laid out from that section's own variables. A file of text beside `content.yaml` is invisible, because
`content.yaml` is the only thing the server reads for what the page says.

Names starting with `_` or `.` belong to the server.

## What sits beside `pages/`

`pages/` is not the whole workspace, and **nothing beside it is a page** — which
is why none of these appears in the page tree, and why you are still free to keep
a page of your own called `design`. List the folder rather than trusting a copy of
its contents written down here; these are the ones with a reason worth knowing.

| | |
|---|---|
| `AGENTS.md` | what an agent pointed at this folder reads first |
| `docs/` | these files |
| `.agents/skills/` | one directory per subject: how to write well in this format, and the checker that reports it |
| `design/` | this workspace's own brand, voice, patterns and density. **It is a page** — a directory with a `content.yaml`, drawn by the same runtime — kept out of `pages/` so it never appears in the tree |
| `base/` | starter sections. Copy one into a page and the copy is yours; nothing links back and nothing updates it |
| `plugins/` | every plugin this workspace wrote, one folder each, and its rungs over the framework's. See [`plugins.md`](./plugins.md) |
| `assets/` | pictures. A photograph is usually wanted on more than one page, so it is a root rather than a folder inside one. Named from a page by its filename alone |
| `theme.json` | the palette and the type roles. See [`styling.md`](./styling.md) |
| `markdown.yaml` | the house type scale every page inherits |
| `workspace.db` | the rows of every table. SQLite, owned by the server — opening it in a text editor corrupts it. See [`tables.md`](./tables.md) |
| `_markdown/` | this workspace projected as one markdown file per page. Derived and read-only. See [`changes.md`](./changes.md) |

`assets/` and `plugins/` come into existence the first time something is put in
one. Creating the directory is the whole of making it exist.

## Making a page hold another page

**Write the directory.** A page is a directory holding a `content.yaml`, so:

```
pages/home/children/notes/content.yaml          <- home now holds "notes"
pages/home/children/notes/children/q3/…         <- and notes holds "q3"
```

The parent gets a section for that child on its next read, written back into its
own `content.yaml` by the server. You do not type it yourself; it arrives looking
like this:

```yaml
contents:
  - name: "@page-notes"                    # the key, derived from the child
    parts:
      body: { type: child, data: notes }   # the child's own last segment
```

**A child is what a slot holds** — a part whose `type` is `child`, inside an
ordinary section, exactly the same shape a paragraph or a table has. It is not a
special kind of entry and it has no parser path of its own. **A child is a page or
a table**, and both live in the same tree, so a table sits under the page that
uses it.

**The child that part draws is found by the SECTION'S name, not by the part's
`data`.** The server matches `@page-notes` against what the page actually holds
and resolves the child there; the `data` beside it is never consulted, so the two
cannot drift. Which is why **you do not write a `child` part yourself** — one
written into a section with an ordinary name finds no child, and that slot does
not draw.

### The key is one segment, never a path

`@page-<segment>` for a page — the child's own directory name — and
`@table-<name>` for a table. A page's id is a path (`home/team/notes`) and **its
key is the last segment of it** (`@page-notes`). The same is true of the part's
`data`: the child's segment, not its id.

A page's `contents` only ever names its **direct** children, so there is nothing
further away for a key to reach. Keeping it one segment is also what keeps it a
legal filename, which matters because customising that section means writing
`@page-notes.html` beside `content.yaml`. Two parents may each hold a `notes`
without colliding.

### How the section gets there, and why it stays put

Reconciliation runs on every read and has three rules, each load-bearing:

1. **Keyed, and the key is derived rather than chosen.** The same child yields the
   same key every time, which is the only reason the next two can be true.
2. **Never overwritten and never moved.** A section already in `contents` stays
   exactly where it is — the order of a page is somebody's decision.
   **Reconciliation is additive only.**
3. **Appended at the bottom when it is missing.**

The section that gets added is an ordinary one with no `data:`, so it takes the
shipped default section with the child in the default's `body` slot. It is written
back to `content.yaml` only when something was actually added, because a rewrite
on every read would put a commit in the workspace's history every time a page was
opened.

**A section whose child has gone draws nothing and keeps its place**, so a child
that comes back comes back where it was rather than at the bottom. And you cannot
delete a child by deleting its entry — it reappends on the next read. Deleting the
child is what removes it.

## `child.html` — how a page looks inside its parent

A page may carry a `child.html` saying how it draws when another page holds it. It
travels with the page: hold that page somewhere else and the same drawing goes
with it. Delete it and the built-in row comes back. A page created from inside the
app is given one, copied from `base/child/index.html`; a page you create by
writing a directory has none and draws the built-in row.

**It is markup. It is not a program, and it holds no slots.** Four things happen
to it on the way in:

- **`{{name}}`, `{{kind}}`, `{{id}}` and `{{rows}}` mean *this child*, and they
  are the nearest scope.** That is what makes one file general enough to sit in
  every page directory. `{{rows}}` is empty for a page, which says nothing rather
  than saying zero. The page's own variables are still in scope behind them.
- **Its `<style>` is scoped to the slot**, through the same mechanism a section's
  own stylesheet goes through — otherwise a child that styled `h2` would restyle
  every section around it.
- **Its `<script>` is removed, and the removal is reported.** A `<script>`
  inserted as markup never executes — that is a browser rule — so leaving one
  would be dead code that looks live. Behaviour a row needs goes in the parent's
  own section file, where a script gets its bindings ([`code.md`](./code.md)).
- **A `data-g-part` in here is never filled.** The section's slots are found
  before the child is mounted, so a slot inside a `child.html` is markup nothing
  reaches: **words written into this file cannot be edited in the app.**

A parent that wants *this particular list* drawn its own way writes
`@page-<segment>.html` beside its own `content.yaml` instead. **The parent wins
where both exist**, and when it wins the child's own `child.html` is not sent at
all.

### Clicking a row

**The child plugin wires the click**, for the built-in row and for a custom
`child.html` alike, calling the host with the child it was drawn from. The host
decides: an id nothing holds is refused rather than navigated to.

What your markup decides is how the keyboard reaches it, and there are exactly two
shapes — draw one, never both:

- **Nothing focusable in the markup** — the plugin makes the whole drawing the
  control: `role="button"`, `tabindex="0"`, an `aria-label` from the child's name,
  and Enter and Space handled for you.
- **Exactly one `<a href>`, `<button>` or `[tabindex]`** — the plugin leaves the
  accessibility alone and lets the click bubble up from it.

Both at once is two tab stops for one row and a screen reader announcing it twice.

A drawing that reads the children itself — a parent's `@page-<segment>.html`, or a
section drawing the whole set — wires its own click. That is `biom.open`, in
[`code.md`](./code.md).

## Every ordering in the workspace is some page's `contents`

The top level is the children of the root page, `home` — a real page whose name
you may change and whose id you may not. The rail is that page's children drawn as
a tree.

There is no workspace-level order file and no separate children list anywhere.
Reordering anything — a section on a page, a page in the rail, a table under the
page that uses it — is one write to one page's `contents`.

---

**Writing a page well** — the paved path for making one, what earns a section its
own file, what a page that holds pages should look like, and the numbered rules
the checker reports — is
[`../.agents/skills/biom-pages/SKILL.md`](../.agents/skills/biom-pages/SKILL.md) and
[`../.agents/skills/biom-children/SKILL.md`](../.agents/skills/biom-children/SKILL.md).
