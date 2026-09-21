---
name: biom-pages
description: "HOW A PAGE IS WRITTEN WELL, and the complete rule index for this workspace. The MECHANISM — a page as a directory, `content.yaml`, ids, what sits beside `pages/`, the document's keys, sections and slots, the part types, the three variable scopes — is `docs/` at the vault root, one file per question, and this file links it rather than restating it. What is here is the judgement. Use whenever the task is to create a page, choose the plugin that draws it, decide what belongs in `content.yaml` versus in a file, decide what is a variable, or read a checker finding. OPENS WITH THE PAVED PATH FOR MAKING ONE — the directory, the document, a starter copied out of `base/` and named in `data:`, the words in `parts`, the arguable numbers in `variables`, then the checker — with a worked page that reports nothing. SAYS WHICH PLUGIN TO REACH FOR AND HOW TO DECIDE: `doc` where the page's WORDS are the point, no `plugin:` at all where its SHAPE is, a board over a table — read off what the person will want to CHANGE later. SAYS THAT A DOC IS DRAWN AND NOT ONLY WRITTEN — read a doc back a paragraph at a time for what each argues (a count, a sequence, a comparison, a boundary, a rule that turns something back) and put a figure there, at a cadence of one every paragraph or two, with the figure never absorbing the prose, prose split only where a figure lands, grounding before drawing, and length staying the author's call. SAYS THAT A SLOT HOLDS WHAT THE PAGE IS AND NEVER A DESCRIPTION OF IT, with the three narration shapes to delete on sight and the test that separates narration from content. CARRIES THE ARGUABLE-NUMBER RULE that decides what is data, the authoring loop and the three ways to classify a request, how to run `.agents/skills/check.ts`, THE COMPLETE RULE INDEX with the skill that owns each number, and the retired numbers that are never reused. Read this before any other skill in `.agents/skills/`. SAYS HOW TO SEE THE PAGE DRAWN when nobody is at the screen — the browser tools, the page URL, and the `Drawn` count to wait for before looking."
---

# Pages

**A page is a directory, and `content.yaml` in it is the page.** That is the whole format, and everything else in this vault is a consequence of it.

**One file holds everything a page says** — its name, the PLUGIN that draws it, its variables, and either `contents` (the ordered list of sections) or the configuration the plugin it named reads. Asked to change what a page says, you open one file.

**A page names the plugin that draws it, and you read the request to know which.** `plugin: doc` is the document — sections, slots, markdown, the type scale — for a page whose WORDS are the point. Leaving `plugin:` out means `html`: the page is its own `index.html`, drawn exactly as written, for a page whose SHAPE is the point, with the freedom that implies and the responsibility that comes with it. `plugin: kanban` is a board over one of this workspace's tables, and any plugin in `plugins/` is named the same way. **Sections exist only on a doc page**; a board has none and an html page has none.

**Read it off what the person will want to CHANGE later: the sentences, or the arrangement.** That is the tell, and it is usually in the request already. A doc where the shape was the point is a document nobody wanted to look at; an html page where the words were the point is a page nobody can type into.

---

## Making one

**The shape, top to bottom.** Follow it in order and the page comes out behaving like every other page in this workspace — which is the point: nobody using this folder should have to work out how a second page works.

1. **Make the directory where the page belongs in the tree.** A page lives inside its parent's `children/`, so `pages/home/children/Winter_Timetable/` is the page `home/Winter_Timetable`, and the directory name is one segment of that id — the grammar and the case rule are in [`../../../docs/pages.md`](../../../docs/pages.md). **Name it for what the page IS**: `Winter_Timetable`, never `page2`, because the id is what a reader sees in the rail and in a URL and a rename is the one expensive edit in the format.

2. **Write `content.yaml`, because it IS the page.** Nothing in the directory exists until that file is there. It states `name` and `plugin` — and on a doc page `contents` as well, always, even when it is empty.

3. **Give each section its own layout, and take that layout from `base/`.** A section is a div: full width, its own markup, its own CSS, and the reading measure lives inside the default section rather than on the sheet, so a full-bleed band costs a section nothing. `base/` holds starter sections — list it to see what is there. Copy a starter's `index.html` beside your `content.yaml` under a name that says what it is (`figure.html`, `masthead.html`), name that file in the section's `data:`, and change everything about it. **A copy is yours; nothing links back to the original.** [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) is where a section is written from scratch.

4. **Put the words in `parts`, one entry per `data-g-part` slot the markup declares.** A bare string is markdown, and markdown already carries headings, lists, quotes, tables, fences and rules — so a run of prose is ONE slot however long it is and however many headings it contains. **Cut a second slot where the section PLACES or PAINTS the piece differently, never where the topic changes**; a new topic is a heading.

   **A REPEATING THING IS ONE SLOT HOLDING A LIST.** Write the slot's value as an array, one entry per item, and the runtime draws one element per entry into that one slot. Never a slot per item: a slot per item is a ceiling at a number nobody chose. [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) has it worked end to end.

5. **Put every number two people could argue about in `variables`, and read it with `{{name}}`.** A rate, a multiplier, a threshold, a rounding step, a currency symbol, a stage list. *What goes in them*, below, is the decision the rest of this file is downstream of.

6. **Run the checker, answer or note every finding, then look at the page drawn.**
   ```
   bun run .agents/skills/check.ts pages/home/children/winter-timetable
   ```
   The checker reads the file and cannot see the page. Anybody with this workspace open already has it on screen — the window notices the file and redraws. To read it back yourself, with browser tools, open `http://localhost:4400/?vault=<absolute path of this workspace>#/page/<id>` (the framework serves on 4400 unless told otherwise), wait until the status strip reads `Drawn` followed by a number, and read the picture back. A section that drew nothing looks fine in `content.yaml`.

### The whole of it, worked

```
pages/home/children/winter-timetable/
  content.yaml
  figure.html        <- base/figure/index.html, copied and then changed
```

```yaml
name: Winter timetable
variables:
  season: Winter 2027
contents:
  - name: opening                       # no data: -> the shipped default section
    parts:
      body: |
        # The {{season}} timetable

        Two boats a day until the ice goes out, then four. The 07:10 is gone and
        everything after it moves twenty minutes earlier.
  - name: the-crossing
    data: figure.html                   # its own markup, its own layout
    parts:
      body: |
        ## Why the crossing moved

        The ferry now waits for the 06:40 bus rather than the other way round, which is
        the whole of the change and the reason every later sailing shifted with it.
      figure: |
        ![The harbour at first light](harbour.jpg)
      caption: |
        _A placeholder. Put a real picture in `assets/` and name the file alone._
```

**That page reports `0 fail, 0 warn`.** It is two sections: one that took the default because its prose wanted nothing done to it, and one that was handed a layout by a starter.

### The default section, and what earns a file

**A section that names no file draws with the shipped default**, which is one centred slot called `body` at a reading measure. It is what somebody pressing `+` in the app gets, immediately, with no agent in the loop, and it is the right answer for a run of prose that wants nothing done to it.

**Give a section its own `data:` file where the layout carries meaning**: a figure beside the prose that explains it, a grid where things are being compared, a band where the page changes subject. Every bit of cleverness in a layout is a thing that has to survive the next rewrite, so spend it where it is doing work.

**When the SHAPE of the page is the point, it is an html page.** That is what the second kind is for.

---

## A doc is drawn, and not only written

**THIS IS A RULE AND NOT AN ENCOURAGEMENT — it is at the top of this workspace's `AGENTS.md` for that reason.** Every doc page gets its figures **without being asked**, and plain prose is an unfinished page: we are not a plain markdown framework, and a page that is only paragraphs has used none of what the format is for and could have been a markdown file in a folder. **A figure, a board or a drawn section goes wherever the content has a shape** — a count, a sequence, a flow, a comparison, a boundary, a cycle — and the looking for that shape happens before the prose is finished, not after somebody asks.

**A page whose words are the point still has a shape, and a doc handed over as an unbroken run of paragraphs is the commonest thing generated here gets wrong.** Read back what you have written for the passages that argue something a reader would rather SEE — a count, a sequence, a comparison, an oscillation, which kind of evidence sits behind each of a run of decisions — and put a figure there. **This is what the format is for.** A document that draws itself is what this workspace has over a folder of markdown files, and a doc that could have been one of those has not used it.

**The figure never replaces the prose and never absorbs it.** The words stay in plain default sections somebody can click and rewrite; the figure sits between them in a section of its own and can be dropped without touching a sentence. It says nothing the paragraph beside it does not — it repeats one fact in a shape the eye reads faster.

**Split a prose section only where a figure lands.** A run of paragraphs is one part however many headings it holds, and cutting it up so the page has more sections buys nothing and costs the edit, because a slot boundary is a wall a sentence cannot be moved across. A figure going between the halves is the good reason to cut; there are few others.

**Let the figure read its state off the document's own words.** A status word in a row, a level named in a column, a number in a heading — the section finds that word and lights accordingly, so editing the words is the whole of editing the figure and there is no second copy to keep in step. Anything positional is computed rather than typed. [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) carries that mechanism in full, and the add, the delete and the reorder every figure owes its reader.

**Ground it before you draw it.** A figure states a fact more confidently than a sentence does, and a reader believes a lit dot. Where the record does not support the granularity you had in mind, draw the coarser thing you can defend and say so in the note under it. The vault's own `AGENTS.md` says when grounding is required and what to run.

**The cadence is a figure every paragraph or two, and a run of prose longer than that has missed a shape.** The owner decided this on 2026-09-17, after a page that argued a rule in nine paragraphs and drew it once: *it is just a bunch of text.* Read the page back a paragraph at a time and ask what each one argues — a count, a sequence, a flow, a comparison, a boundary, a rule that turns something back, a thing that changes on an event — and draw that, between this paragraph and the next. Two paragraphs may share a figure when they argue one thing; a third without one is the tell that a shape was skipped rather than absent. What this does NOT license is the ornament: a figure drawn because a section looked bare says nothing, and the rule is *find the shape the passage already has*, never *put something here*. A page with genuinely nothing drawable in it is finished as prose, and it is rare. A long doc carries more figures than a short one because it carries more paragraphs.

**Length is the author's call and not yours.** Making a doc visual is not licence to compress it — cut a doc when you are asked to, and not otherwise.

**Deliberate, never templated, never decorative.** The shape is chosen for THIS subject — the same figure reached for twice in a row is the tell. A figure that says nothing the prose does not is an ornament, and an ornament is worse than nothing because a reader stops to read it.

**Drawn in HTML, and animated.** A figure is elements in the section's own markup — grid and flex for the layout, borders and backgrounds on the palette's tokens for the ink — never a raster and never a screenshot of a chart. Its words come out of the section's `variables`, so the figure is edited in the document. And it moves when it arrives: the bars grow, the edge draws itself, the reached step lights. The animation is a reveal, once, on the `--motion` switch, so a reduced-motion reader gets the finished figure and nothing else; a loop that decorates is the same ornament as a figure that says nothing. `base/` holds starters that already do both — copy one rather than drawing the first bar from nothing. **A diagram of what connects to what is no exception**: it is the same drawing with boxes and edges in it, laid out by the section's own script from the nodes and edges in its `variables`, and `base/diagram/` is that starter — [`../biom-diagrams/SKILL.md`](../biom-diagrams/SKILL.md).

**A drawing with even a small chance of being wanted on a second page is a PLUGIN and not a copy in this section** — `plugins/<id>/<id>.js`, a folder, from the start. That is the other rule at the top of `AGENTS.md`, and [`../biom-plugins/SKILL.md`](../biom-plugins/SKILL.md) §3 is the route.

**What a figure LOOKS like is `design/`**, which is authoritative over your taste; read it before drawing one. [`../biom-diagrams/SKILL.md`](../biom-diagrams/SKILL.md) is the other family — what is connected to what.

---

## Write what is true NOW, and point at where rather than at how many

**A page states the current position and never narrates its own edit history.** No correction notes, no *"this used to read…"*, no banner saying a section was revised. When something changes, rewrite the passage and delete the old wording — the vault is a git repo and the server commits before every write, so the old wording is kept whether or not a sentence on the page claims it existed.

**The narrow exception is a live warning**, where somebody acting on the old belief would do damage — and even then it is written as what to do now, not as a changelog.

**A page that needs a disclaimer has failed as a page.** If a claim is too strong to stand alone, make a weaker one or do not make it. A banner apologising for the page under it is a banner every reader has to get past and nobody acts on.

**Point at WHERE, not at HOW MANY.** Never write a pointer that has to be re-counted or re-listed to stay true — *"read these four"*, *"the two decisions"*, a hand-copied tree of what a folder holds. **Write the location and the rule for finding the thing**: *"list `plugins/`"*, *"work backwards from the newest page under that one"*. One canonical place may hold the full list; everything else points at it.

**It does not apply to a count inside the page's own argument**, or to a figure that counts something. A tally read from `biom.children()` is computed and is right by construction; a number typed into a paragraph about a folder is the thing this rule is about.

---

## What a page is on disk, and the rules about it

**[`../../../docs/pages.md`](../../../docs/pages.md) is the mechanism** — the
tree, the folder as the hierarchy, the id grammar, what a page directory holds and
what sits beside `pages/`. Read it once; the rules it produces are here.

**R1 — a directory is a page if and only if it holds `content.yaml`, and that file has to read back as a page.** Without one it is not an empty page, it is not a page at all: the host answers `not_found` and the rail does not list it. `children/` is not a page; it is where pages live. `content.yaml` is **required**, and the same rule covers the document's shape all the way down — a `contents` that is not a list, an entry in it that is not a map, a `parts` that is not a map — and its top level, which is closed: `name`, `uid`, `plugin`, `variables`, `contents`, `input` and nothing else. `uid` is the framework's, written into every page the first time it is opened; leave it where it is and never type one — the parser refuses a `uid` it did not mint. *(FAIL)*

**R6 — the ids are the format.** A directory name is one segment of a page id and matches `^[A-Za-z0-9][A-Za-z0-9_-]*$`; the page's id is the segments from the root, joined with `/`. Case is part of the id and is kept, with one rule against it: two siblings may not differ only in case. A section name matches `^[a-z][a-z0-9_-]*$` and never contains a dot, and so does a slot id. A section the host cannot name is skipped and never draws, because a name is how the editor reorders it, how the runtime redraws it, and how every finding about it is addressed. *(FAIL)*

The one other shape a section name takes is a **child key** — `@page-notes`, `@table-jobs` — derived by the host rather than written by anybody. See [`../biom-children/SKILL.md`](../biom-children/SKILL.md).

**R45 — the page's words are in `content.yaml`.** There are no `.md` files and no `.mermaid` files: a markdown part carries its prose inline, and a diagram is a drawing in a section's own markup laid out from the section's own variables. A file of prose beside `content.yaml` is invisible — nothing reads it, and two copies of a paragraph is one of them going stale. What a page's directory holds besides the document is **markup** — a section's own HTML file, `child.html`, and `_assets/` under it — and **`markdown.yaml`**, this page's own type scale. *(FAIL)*

**Naming a thing for what it IS is the judgement this leaves you.** A page id is read by a person in a URL, in the rail and in the mirror, and it is the one name in the format that a rename makes expensive — every id beneath it moves. `Winter_Timetable` rather than `page2`, and never a number.

---

## The document, and the rules about it

**[`../../../docs/sections.md`](../../../docs/sections.md) is the mechanism** —
every key a page and a section may carry, the keys that are refused by name and
what replaced each, `contents` as the order, and the shipped default section. The
rules it produces are here.

**R61 — the plugin a page names has to be able to draw it.** The host looks in three places, in order: the page's own `index.html`, then this workspace's `plugins/<id>/index.html` under the bare name — a plugin of your own — then the framework's own `biom-<id>/index.html`, which a workspace never shadows. A page that names a plugin nobody has draws a stand-in saying so, which is a page nobody can use.

**The checker can only see the first of the three**, because it is handed one page directory and cannot see the workspace or the framework around it — so a page naming a plugin the checker cannot find is never a finding, and might well be the framework's own. What it does report is the case with no ambiguity in it: **a page that names no plugin, and therefore draws its own `index.html`, and has no `index.html`.** *(FAIL.)*

**And `contents:` left on a page a document is not drawing** is a WARN: sections are the doc plugin's input, so on a board or an html page nothing reads that key and every word under it is invisible. It is the shape a page ends up in when `plugin:` was changed and the body was not.

**R47 — a page states its own `name`, and a doc page its own `contents`.** An absent `name` falls back to the directory's segment, which is an id and not a title. `contents` is written even when it is empty — it is a document's spine, and a file without it reads as truncated rather than as empty. On a page drawn by anything else it is not written at all, because it is a key belonging to a reader that is not drawing this page. **`variables` and `input` are left out entirely when the page has neither**, because an empty map is furniture nobody put there. *(WARN — and FAIL in a directory holding `preset.yaml`, because installing a preset copies its `content.yaml` verbatim and the omission ships.)*

**R40 — `contents` IS the order.** The list, top to bottom, is what a person reads. A section with nothing in it draws empty and **keeps its place**, which is what makes emptying one a recoverable act and deleting one the act that takes the words. The same rule notices a markdown part with no prose in it and a markup file that is empty — each is a hole the page keeps a place for. *(WARN)*

**R43 — two sections cannot share a name.** The reader keeps the first and drops the second, so half of what is written never draws — and a slot write addressed to that name would have two places to land and no way to say which. *(FAIL)*

### Which key a plugin's settings go under is the PLUGIN's choice

**Read a board that works before writing one.** A page drawn by something other than the document carries that plugin's configuration, and there are two doors: `biom.input` reads the page's `input:` block, and `biom.data()` reads its `variables:`. **The shipped board reads `variables:`** — a board written with `input:` draws an empty page and says nothing about why, because the plugin asked for data and got a map with no `table` in it. [`../../../docs/plugins.md`](../../../docs/plugins.md) is the mechanism.

```yaml
name: Plants board
plugin: kanban
variables:
  table: plants
  lanes: status     # a categories column: its options ARE the lanes
  name: species     # the column a card is titled by
  show: [bed, height, planted]
  page: doc         # a page column, so a card opens that plant's page
```

---

## Sections and slots, and the rules about them

**[`../../../docs/sections.md`](../../../docs/sections.md) is the mechanism** —
what a section is, what `data:` names, how a slot is filled, the five part types,
what a list slot is and how one is written. [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md)
is how to WRITE one. The judgement and the rules are here.

**A SLOT HOLDS WHAT THE PAGE IS, NEVER A DESCRIPTION OF WHAT IT IS.** The reader is already looking at the view. A paragraph above a board explaining that it shows one card per person and one column per stage is a screen of reading that says nothing the board is not already saying — and it is the first thing a generated page reaches for. **A view with no prose on it at all is finished, not unfinished.**

Three shapes to delete on sight, because they are the ones that keep arriving: **a lede that says what the section under it is**; **a note that says where the figures came from** or that they recompute when the data moves; and **a sentence that explains a mechanism** — which columns are derived from what, what a control does, what the page reads at draw time. The mechanism belongs in the section file's own comment, where whoever changes the markup will find it, and nowhere near the reader.

**The test: delete the sentence and see whether a fact went with it.** A caveat that every figure on the page is invented, a rule somebody has to know before acting on what they see, what an empty column means — each carries something the view itself cannot show, so each is content and stays. A sentence that only restates what is already on screen is narration, and taking it out costs the reader nothing.

**This is not an argument against prose.** A page whose job is to say something is all slots and should be. The rule is about a page whose job is to SHOW something, where every sentence added above it is a toll charged before the reader reaches the thing they came for.

**Do not split prose for the sake of splitting.** A run of markdown belongs in ONE slot however long it is, however many headings it contains. Markdown already carries headings, lists, tables, quotes, fences and rules; cutting it into `intro`, `background`, `detail` and `summary` buys nothing and costs a document somebody has to reassemble in their head. **A LIST IS NOT THAT SPLIT, and the two are opposites**: cutting prose makes several slots out of one passage, while a list is ONE slot holding several items. Prose that reads down is one value; things a reader looks ACROSS — cards, columns, panels — are a list. **Split when the layout changes**, never when the topic does; a new topic is a heading.

**Leave a slot OUT of `parts` until there is something in it, rather than writing `cards: []`.** An empty list is kept and is a real answer, but it draws no items — so there is no region for a section's `+` to write through, and the section gets `false` in the console instead of a first card.

**R56 — the markup carries no words.** All TEXT is markdown, in `content.yaml`, addressed by a `data-g-part` slot; raw HTML is for visuals and structure — layout, grids, rules, bands, drawings — and carries none of it. The reason travels with the rule: the framework edits markdown live and always, so **a word baked into a section's HTML file is a word nobody can ever edit.** The one exception is text inside an `<svg>`, which is part of a drawing. The rule, the trap that comes with it and a worked before/after are in [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md), because that is where the markup is written. *(WARN, once per file, quoting the words it found.)*

**A file named in `data:` that is not on disk falls back to the shipped default section.** The slots still draw, so the words are still on screen: the fault reads as a section that lost its layout rather than as a page that lost a section. It is a default section as far as the count is concerned, and the checker says which one it was. *(WARN)*

**R51 — a slot in the document is a `data-g-part` in the markup, and the two have to match.** The section's HTML declares `<div data-g-part="headline">`; `parts.headline` says what fills it. A part naming a slot the markup does not declare never draws — nothing on screen says the words are there. A slot the markup declares and the document has not filled is **not** a failure: the editor takes it over as an empty editable region carrying its own prompt, so it is somewhere a person can click and type from the very first draw. **Write a slot as an empty element** — a plugin FILLS the node, so anything the markup put inside one is replaced. A rule, an icon or a shape a section wants beside an empty slot goes NEXT to it, where nothing overwrites it, and **a placeholder made of WORDS is still words in the markup** whatever it sits next to, which is R56: put the sentence in `parts`. *(FAIL for a part with no node; WARN for a section whose markup declares slots and whose document has filled none of them.)*

**R48 — a bare string is markdown, a map is a full `Content`, and a LIST is a list of items.** Prose is most of what a slot holds and `body: "..."` should not need a wrapper. The long spelling carries `type`, `data` and the part's own `variables`, and nothing else — **no `name`**, because the key it sits under already stated the id. *(FAIL)*

**R49 — the part types, and `data` read the right way for each.** `markdown` carries the prose itself, `html` a filename beside `content.yaml`, `table` a table's name, `child` a direct child, and `grid` no `data` at all — it carries `rows`, the document's own table, and `rows` on any other type is refused as `data` on a grid is — and an entry in a LIST is one of these too, read exactly the same way. Which of `grid` and `table` a page wants is [`../tables/SKILL.md`](../tables/SKILL.md). *(FAIL)*

**R42 — the type and the data have to agree.** An `html` part naming a file that is not in the directory draws an EMPTY slot: the entry is visible and there is nothing in it. A `markdown` part whose `data` is a filename draws the filename as a paragraph. A `table` part names a table and a `child` part names one segment — a path is a page reaching past its own children, which the format does not have. And an HTML file on disk that no section and no part names is invisible, because the document is the only thing the host reads. *(FAIL; the unnamed file and the missing section file are WARNs)*

**A diagram is drawn IN the page** — elements in a section's markup, over boxes and edges held as that section's `variables`, never a file beside it, because two files that have to be updated together are two files that drift. How one is drawn is [`../biom-diagrams/SKILL.md`](../biom-diagrams/SKILL.md); why the format offers no part type for one is [`../../../docs/sections.md`](../../../docs/sections.md).

---

## Variables, and the rules about them

**[`../../../docs/variables.md`](../../../docs/variables.md) is the mechanism** —
the three scopes and nearest-wins, where `{{name}}` is resolved and where it is
not, the name grammar and the two traps in it, parallel lists, and the two doors a
plugin's settings can go through. **What BELONGS in one** is the judgement, and it
is the decision the rest of this file is downstream of.

**R44 — a variable is a scalar, or a list of scalars, and nothing else.** It is a thing somebody types into a field: there is no field for a nested map and no `{{name}}` that could name a leaf of one. **Anything tabular is parallel lists** sharing a stem and the same length — `access: [Ground, Stairs, Scaffold]` beside `factors: [1, 1.15, 1.35]` — never a list of maps. Read them defensively: the shorter list decides, because a hand-edited document is the normal case. A name matches `^[A-Za-z][A-Za-z0-9._-]*$`. **A dot in one is legal in the name and unreachable from a template**, so keep it for a value a script fetches and out of anything prose interpolates. *(FAIL)*

**R41 — every `{{name}}` resolves to something in scope.** An unanswered name draws with its braces on rather than blank, which is what makes this a WARN-shaped failure the checker can turn into a FAIL. **There is no cross-slot form and no cross-page form.** `{{rate::calc}}` was a mechanism for a flat file where every value shared one dictionary; scopes nest now. **Reaching another PAGE is a call and never a template** — `biom.variables(page)` — because prose has to be readable without chasing it across the workspace. **The one hole in this rule is a DOT**: `{{brand.name}}` resolves as far as the checker is concerned and still draws with its braces on, so a dotted name is the one unresolved hole nothing reports. *(FAIL)*

**R46 — a variable no template reads is dead weight.** Either put it where the words are or take it out. *(WARN)*

### What goes in them

**Not "the text goes in `content.yaml`". Anything anyone might want to change without a programmer.**

Every word on screen, and **every number two people in the same business could argue about**: a rate, a multiplier, a threshold, a rounding step, a currency symbol, a unit, a stage list, the month abbreviations. A constant belongs in the code only when changing it would make it a different program.

This is the rule the rest is downstream of. A quote calculator with `const ACCESS = { Scaffold: 1.35 }` in its JavaScript answers *"scaffold is 1.4 for us"* with a code edit — and that sentence is the first one a real user says. As a variable it is one line, it survives regeneration, and the user can change it themselves without asking anyone.

**Prose a person edits belongs in a `parts` entry, not in `variables`.** A slot is editable in place and writes back; a variable is read by the markup. The test is who touches it: the paragraph is a part, the label the script prints beside a number is a variable.

**Every name here describes the ROLE, never the position.** `labelArea`, never `label2`, because a page is reordered and a number in a name is wrong the first time somebody does it. **Names are stable across regenerations, forever** — renaming one orphans an edit somebody made. If a region's meaning genuinely changes, add a name and leave the old one; do not renumber and do not tidy.

---

## The loop

**You write the file. It appears on their screen.** There is no model call inside the app and no hot patch: an agent writes into `pages/`, the server notices the file move and re-reads from disk, the frame is dropped, and the page comes back cold. Nobody presses anything — the Reload button is still there for rereading on demand, and it is not the loop. The vault is a git repo and the server commits before every agent write, so undo is a revert and the change somebody asked for is a readable diff.

**Disk wins over what somebody is typing.** When your file lands the page redraws from it, the slot under their caret included, and whatever their debounced save had not yet written is dropped rather than merged. Nothing is held back and nothing is offered as a second version. It costs them a caret; it is why a page has to be right cold.

**So never regenerate a `content.yaml` to make a small change, and never leave one half-written.** A file that will not parse takes the page down with it — [`../../../docs/changes.md`](../../../docs/changes.md) is what happens then and what is there to recover it. Patch the file, and reload the page before calling the edit done.

What that means for how a page behaves:

- **It must be correct from a cold start, every time.** No warm state, no cache, no previous session.
- **It must draw before the host answers.** A section paints its own markup immediately and fills in what arrives over the port. A page that renders nothing until a promise resolves is a blank box in front of somebody.
- **A cold reread is the test of every edit.** An in-place slot edit that does not survive one has not been saved.
- **A drawn page is the test of a section.** With browser tools, open the page, wait for `Drawn` with a number in the status strip, and look; the checker cannot see a slot that drew nothing.
- **Never regenerate a file from scratch to make a small change.** A rewrite silently drops edits somebody already made and renames section names and slot ids that were stable. Patch it.
- **A COMMENT IN `content.yaml` DOES NOT SURVIVE THE FIRST EDIT, so do not put anything there you need to keep** — [`../../../docs/variables.md`](../../../docs/variables.md) says why, and where to put the explanation instead. **It matters most for the thing you will most want to explain**: this skill tells you to put an arguable number in `variables`, and the note saying WHY that number is 6 cannot sit beside it.

Classify the request before writing anything:

1. **A value change** → one line in `content.yaml`. Say so.
2. **A new editable region** → the slot and the `data-g-part` that shows it, added together in the same edit.
3. **A structure change** → say it is one first, then patch the markup, keeping every existing section name and slot id.

Then run the checker, answer or note every WARN, and reload.

```
bun run .agents/skills/check.ts pages/home/children/rates-note
bun run .agents/skills/check.ts pages/home/children/*
```

It exits 1 when a FAIL survives, so a generation loop can stop on its own mistake. **It is not a gate on rendering** — the host never runs it, a page that fails every rule still draws, and its raw-YAML fallback still opens. It is a report for whoever wrote the page and whoever reads the diff. A rule that cannot be checked mechanically says so and has no number in the code.

**One finding is about the workspace rather than about a page**, and the CLI says it once at the end of a run however many directories it was given: R53, below.

**The checker reads `content.yaml` with its own reader and imports almost nothing.** A vault has no `vendor/`, no `node_modules/` and, when it matters most, no network, so a checker that reached for a package would be a command that only works on the machine it was written on. A test in the framework runs that reader and the server's over every `content.yaml` in the repo and demands the same answer, because a second implementation is a second opinion only if something holds the two together.

---

## The rule index

Complete. The **Skill** column says which file carries the prose; the number is what `.agents/skills/check.ts` cites.

| | Rule | Skill | |
|---|---|---|---|
| R1 | A directory is a page iff it holds `content.yaml`, and the document reads back as one | pages | FAIL |
| R6 | Page segments, section names and slot ids | pages | FAIL |
| R9 | One node per slot id | sections | FAIL |
| R13 | The storage APIs throw | sections | FAIL |
| R14 | The network is unreachable; `biom.fetch` is the way out | sections | FAIL |
| R15 | Do not reach past the shim | sections | FAIL |
| R16 | A section is one file | sections | FAIL |
| R17 | No code from a string | sections | FAIL |
| R18 | No inline handlers | sections | FAIL |
| R19 | Prefer `table`/`insert` to `sql` | tables | WARN |
| R20 | Never branch on the platform | sections | WARN |
| R21 | Build nodes, never markup from a string | sections | WARN |
| R23 | No `DOMContentLoaded` in a section script | sections | WARN |
| R24 | Never measure the viewport | sections | FAIL |
| R25 | Reflow; no fixed px widths | sections | FAIL |
| R26 | A measure on prose, in `rem` | sections | WARN |
| R28 | Wide content scrolls inside its own box | sections | WARN |
| R29 | No inline styles | sections | FAIL |
| R30 | Nothing sets a raw colour | design | FAIL |
| R31 | Every `<button>` carries `type` | sections | WARN |
| R32 | Every control has a name | sections | WARN |
| R33 | One skeleton, stable ids, deterministic formatting | sections | WARN |
| R35 | The one thing a page may load from `/vendor/` | sections | FAIL/WARN |
| R37 | A child key is derived and is one segment: `@page-<segment>`, `@table-<name>` | children | FAIL |
| R38 | A drawing of a child reads the child; it never copies its name | children | FAIL |
| R40 | `contents` IS the order; an empty section keeps its place | pages | WARN |
| R41 | Every `{{name}}` resolves in scope; another page is a call | pages | FAIL |
| R42 | The type and the data have to agree | pages | FAIL/WARN |
| R43 | Two sections cannot share a name | pages | FAIL |
| R44 | A variable is a scalar or a list of scalars | pages | FAIL |
| R45 | The page's words are in `content.yaml` | pages | FAIL |
| R46 | A variable no template reads is dead weight | pages | WARN |
| R47 | The keys a page states itself: `name` and `contents` | pages | WARN/FAIL |
| R48 | A slot's value is a string, a `Content`, or a LIST of either; a content has no name | pages | FAIL |
| R49 | The part types, and `data` read the right way for each | pages | FAIL |
| R50 | A part kind is drawn by `plugins/<kind>/`, and one folder owns each id | plugins | FAIL |
| R51 | A slot's id is its key in `parts`, and the markup declares it | pages | FAIL/WARN |
| R53 | The workspace never chose its own palette or wrote its own design doc | design | WARN |
| R54 | A line in a type scale the reader threw away | markdown | WARN |
| R55 | A `markdown.yaml` that does not parse at all, so the whole scale is gone | markdown | FAIL |
| R56 | The markup carries no words: all text is markdown in `content.yaml`, behind a slot | sections | WARN |
| R57 | Prose is not cut into slots that are only stacked — markdown already stacks | sections | WARN |
| R58 | Nothing is written against `data-g-editing`, `biom.onEdit` or `ctx.editing` — there is no edit mode | sections | FAIL |
| R59 | A section holding a list can add an item and take one away — its own `ctx.write`, or an `items`, `open-list` or `checklist` node naming that slot | sections | WARN |
| R60 | `inline-size` and `block-size` are container features, never media features | sections | FAIL |
| R61 | The plugin a page names can draw it, and `contents:` is not left on a page a document is not drawing | pages | FAIL / WARN |
| R62 | A grid is square — every row as long as the widest, a row a list, a cell text | tables | WARN / FAIL |
| R63 | A grid's head is a row — `head` true or false, and a header with a row under it | tables | FAIL / WARN |
| R64 | A bare pipe in a grid cell — outside a wikilink or a code span — is kept as a character and reported, because it is usually a row pasted into a cell | tables | WARN |
| R65 | A loose `plugins/<id>.js` — a plugin is a folder, and the finding names the one to move it into | plugins | FAIL |
| R66 | A `biom-` folder in `plugins/` holding anything beside `extensions.yaml` — it is an extension, not a copy | plugins | FAIL |
| R67 | A key in an `extensions.yaml` that the plugin's `plugin.yaml` does not declare — a typo that draws nothing | plugins | FAIL |
| R68 | A bare-named document in `plugins/` that is a copy of the framework's — it draws, and stops following the framework; an extension would do | plugins | WARN |

**R50 is the one number in here that `.agents/skills/check.ts` does not cite.** It is checked where plugins register, in the box, rather than where pages are read — see [`../biom-plugins/SKILL.md`](../biom-plugins/SKILL.md).

**The next number to spend is one past the highest that appears anywhere in this file** — this table and the retired one below, read together.

**Where this file and `.agents/skills/check.ts` disagree, THE CHECKER WINS.** It is what produces the findings a person reads, and a guide that is half true is worse than one that is plainly wrong, because the stale half is followed confidently. Found a difference: fix both in the same change, and say which way it went.

## Retired numbers

**Spent, and never reused.** **A finding cites its number**, so a reused number silently changes what an old finding meant — a report in an old diff would go on reading as if it said something it never said. A rule whose meaning changes gets a NEW number and its old one comes down here.

Four went with the flat sidecar. Most of the rest went with the render — the
layer that owned the whole sheet and drew every block on it. **R34 went for a
third reason, and it is the one worth learning from: it fired on correct work.**
Two agents building real pages hit it independently and the workspace's own
reference section tripped it too, because the rule counted files where the thing
it describes is page-wide. A rule that fires on work that is right is worse than
no rule, because it teaches people to stop reading the report.

| | What it used to say | What replaced it |
|---|---|---|
| R0 | Add a block to a doc rather than making a new KIND of page | nothing. `plugin:` names a document rather than a kind the host branches on, so there is no set to add to — and where a doc is the wrong shape entirely, the answer is `plugin: html` |
| R2 | A sidecar key was `<section>.<name>`, with one dot and no value spanning a line | R49 — the part types, and how `data` is read for each |
| R3 | `kind:` and `render:` described the page, and had to agree with what was on disk | R47 — a page states its name and its contents. Both keys are refused now, so a file carrying one does not open |
| R4 | `order:` named the sections, and an entry with no file drew an empty block | R40 — `contents` IS the order |
| R5 | Every dotted key belonged to a section that existed | R41 and R46 — variables are scoped by what holds them, and a dot in a name is a namespace |
| R7 | `data-g-slot` named a VARIABLE in scope | R51 — `data-g-part` names a SLOT, and a slot is FILLED by a plugin rather than substituted |
| R8 | A string no slot showed was a page that lied about what it held | R46 — a variable is reached only by `{{name}}` now, so a dead variable is the whole of it |
| R10 | A slot was a text LEAF, because the shim dressed one | nothing. A plugin fills the node: markdown becomes paragraphs, a table becomes a grid, so an element child is the normal case |
| R11 | A list variable was the page's own business, because the shim stepped over lists | nothing. There is no hydration to step |
| R12 | A slot key could collide with `name`, `kind` or `order` in one flat file | nothing. A slot id lives inside its section's `parts` |
| R22 | `height: 100%` and `vh` collapsed a self-sizing frame | **it inverts.** There is ONE frame per page, it is handed the canvas and it scrolls inside itself, so a viewport length in a section is now correct |
| R27 | `position: fixed` pinned to a block's own box rather than the window | nothing. The frame's viewport IS the canvas, which is what an author writing `fixed` already expects |
| R36 | The file carried the current value, because variables won at load | R45 — a section's words live in `content.yaml` and its file is markup, so prose in the file is the second copy |
| R34 | Assign `biom.toMarkdown`, so a page answers when the mechanism arrives | nothing yet, and it takes a new number when it comes. The hook is PAGE-WIDE and this was checked per section FILE, so a six-section page collected six warnings for a thing it can only do once — and if six sections each assigned it, five would silently lose. It belongs to the runtime, which owns the page |
| R39 | A `contents` entry had one of four types | R48 and R49 — a `contents` entry is a SECTION and has no type at all; the types moved down into `parts` |

**There is no sizing mode to tell apart any more, which is why R22 and R27 are retired rather than rewritten.** A page is one frame, the frame is handed the canvas, and it scrolls inside itself. Every rule that existed to distinguish two mounts went with the second mount.

---

## Where the rest of it is

**[`../../../docs/`](../../../docs/README.md) is how the format WORKS**, one file
per question — where a page lives, what draws it, where a value goes, what a
page's code can do, where a plugin comes from, where data lives, how it is sized
and coloured, when a change appears. This folder is how we WRITE in it and what
the checker will say. Every skill below links its doc and no passage is in both.

| | |
|---|---|
| [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) | writing a section's markup, CSS and script: slots, `@scope`, the scroll toolkit, the sandbox, the house style |
| [`../biom-markdown/SKILL.md`](../biom-markdown/SKILL.md) | `markdown.yaml`, the type scale: how big a heading is, on this page and in this workspace |
| [`../biom-plugins/SKILL.md`](../biom-plugins/SKILL.md) | what fills a slot, and when to write a plugin rather than a section script |
| [`../biom-children/SKILL.md`](../biom-children/SKILL.md) | the tree: a child as what a slot holds, derived keys, the two ways to draw one |
| [`../biom-tables/SKILL.md`](../biom-tables/SKILL.md) | columns and types, reading and writing, relationships, CSV |
| [`../biom-diagrams/SKILL.md`](../biom-diagrams/SKILL.md) | a drawing of boxes and edges laid out from a section's own words, and the question to ask before drawing |
| [`../biom-design/SKILL.md`](../biom-design/SKILL.md) | read FIRST on a new vault: the palette, the type and the design doc |

---

## Notes

- **The arguable-number rule is the one this file exists for.** Everything else is downstream of classifying a number correctly. A multiplier in JavaScript answers the most predictable first request in any demo with a code edit; as a variable it answers with one line the user could have typed themselves.
- **The checker never blocks a page from rendering, and it must not start.** A page that cannot be shown is worse than a page that is clumsy, and a checker with a veto is one bad regex away from being the thing that broke the demo.
- **These files are living documents.** When the code and a rule disagree, fix both in the same change. A rule that changes meaning gets a new number rather than a quiet edit, and the old number goes in the retired table.
