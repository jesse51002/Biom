# How a Biom workspace works

This folder explains the format your workspace is written in. It is for a person
who wants to understand their own folder — what a page is, what draws it, where a
word lives, when an edit shows up on screen.

**Everything here describes how the thing works.** What we have decided about
*writing well* in this format — the shape a good page takes, the rules the
checker reports, whose taste wins — lives beside it in
[`../.agents/skills/`](../.agents/skills/), one directory per subject. Each of
these files links the skill that covers its subject, and each skill links back.
Nothing is said twice in both places.

## What a workspace is

**A workspace is a folder, and there is nothing else.** No database of record, no
export step, no API to go through. Your pages are directories; the words on them
are lines in a YAML file; the design is a page; the theme is a JSON file. Editing
a file *is* editing the workspace.

A server reads that folder and draws it in a browser. It watches the folder while
it runs, so a file that changes on disk is redrawn a moment later. It commits to a
git repository inside the folder before every write it makes, which is why undo
exists without an undo button.

**The one thing in the folder that is not a file you edit is `workspace.db`** —
SQLite, holding the rows of every table, owned by the server. See
[`tables.md`](./tables.md).

## The order to read these in

| | |
|---|---|
| [`pages.md`](./pages.md) | **Where is my page?** The tree, a page as a directory, `content.yaml`, children, ids, and what sits beside `pages/` |
| [`sections.md`](./sections.md) | **What draws it?** `plugin:`, `contents` as the order, a section and its markup file, slots, the five part types |
| [`variables.md`](./variables.md) | **Where do the numbers go?** `variables:`, the three scopes, `{{name}}`, the name grammar, parallel lists |
| [`code.md`](./code.md) | **What can a page's own code do?** A section's `<script>`, `ctx`, the `biom.*` calls, and what the box cannot do |
| [`plugins.md`](./plugins.md) | **Where does a plugin come from?** The resolution order, the plugins in your `plugins/` folder, `data-g-plugin`, `page:` |
| [`tables.md`](./tables.md) | **Where does data live?** What a table is, every column type, reading and writing, and what only the app can do |
| [`styling.md`](./styling.md) | **How is any of it sized and coloured?** The palette tokens, the three type roles, and `markdown.yaml` |
| [`changes.md`](./changes.md) | **When does a change appear?** Automatic refresh, the Reload button, whose version wins, and the markdown mirror |
| [`automations.md`](./automations.md) | **How do I run something from here?** An automation as a folder under a page, the manifest, the three `INSTRUCTIONS.md` files, where a run lives and what it leaves, the two screens |

Read `pages.md` and `sections.md` in that order and you can find and change
anything on a page. The rest answer questions as they come up.

## The shortest possible tour

A page is a directory. This one is the page `home/notes`:

```
pages/home/children/notes/
  content.yaml
```

`content.yaml` is the page. It says what the page is called, which plugin draws
it, and — for a document — the ordered list of sections that make it up:

```yaml
name: Notes
plugin: biom-doc
contents:
  - name: opening
    parts:
      body: |
        # Notes

        Whatever this page is for, written as markdown.
```

Save that file and the page exists. Add a directory under
`pages/home/children/notes/children/` and this page holds another one.

## Where the words live

**Every word a reader can click and rewrite is in `content.yaml`**, in a `parts`
entry, as markdown. An HTML file in a page directory carries the layout — the
grid, the bands, the rules, a drawing — and none of the sentences. That is the
single rule the whole format is arranged around, because a word baked into a
markup file is a word nobody using the workspace can ever change.

[`sections.md`](./sections.md) is how that works;
[`../.agents/skills/biom-sections/SKILL.md`](../.agents/skills/biom-sections/SKILL.md) is
what it asks of you when you write one.
