---
name: biom-plugins
description: "HOW CODE REACHES A SLOT, and the decision order to take before writing any. START HERE BEFORE WRITING ANY CODE THAT DRAWS SOMETHING: most slots need none — a part\'s kind names the plugin that fills it — and where code IS the answer it goes in the section\'s own `<script>`, which is handed the same `ctx` a named plugin gets. The MECHANISM is `docs/plugins.md` at the vault root: where a plugin comes from and how it is resolved, the registration contract, `ctx.use`, `data-g-plugin`, the part kinds that are spoken for, and the fence hand-off. This file is the DECISION and the rules, and it links that rather than restating it. Use whenever the task is to fill a slot with something the plugins in `plugins/` do not draw, to place a `data-g-plugin` node, or to read or repair a plugin. Carries the order to try things in, the rule that decides the rest — if there is even a small chance somebody else will use it, it is a plugin and not a copy inside a section — the four-point bar a plugin has to meet because every one of them is global to every page in the workspace, THE ORDER TO EXTEND A FRAMEWORK PLUGIN IN — a variable in a rung, a plugin of your own named in one, a plugin of your own under a bare name — and why `doc` is never copied, the shape of a plugin folder as a worked example, R50: a plugin may never claim a PART KIND or a `biom-` id, and R65 to R68 on the folder shape and a rung naming a variable nothing declares. Read `../biom-sections/SKILL.md` for the section a plugin is mounted from."
---

# Plugins

**A plugin fills one node.** That is the entire job, and everything a page draws is one: the prose in a slot is the `markdown` plugin, a grid is `table`, a child's row is `child`, and a reveal is `reveal`. There is no privileged path underneath any of them — **one shape, one code path, all the way down**, which is what makes the built-in drawing replaceable rather than special.

**So the question this file settles is not "how do I write a plugin". It is: what do I write, so that this node draws what I want?** The answers are below in the order to try them, and the first one covers most pages.

---

## 1. Most slots need no code of yours

**A slot's plugin is named by its part's kind.** Write the part; the plugin that fills it is decided by that and nothing else. There is no wiring, no registration and nothing to name in the markup beyond the slot id.

```yaml
contents:
  - name: intro
    data: intro.html
    parts:
      body: |-
        Ordinary prose. A fenced block naming a plugin this workspace carries is handed to it.
      figures: { type: table, data: readings }
```

```html
<div data-g-part="body"></div>
<div data-g-plugin="reveal"></div>
<div data-g-part="figures"></div>
```

The part kinds and what `data` means for each are in [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md). **`data-g-plugin="id"` is the other door**: it mounts a plugin with no stored content at all, configured entirely by its own `data-g-*` attributes, which is how a section places a rule, a wash or a diagram without inventing a slot in `content.yaml` for something nobody will ever edit — see [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md).

**Ask this before writing any code at all: is the thing I want a run of prose, a grid of rows, a child's row or a diagram?** If yes, it is a part or a `data-g-plugin` node and you are finished. **`biom.plugins.ids()` answers what is actually registered in this workspace**, which is the only listing that cannot go stale, and `plugins/` on disk is the same set as files.

**LOOK AT WHAT IS ALREADY THERE BEFORE HAND-DRAWING ANYTHING.** A list a reader can add to is `items`; a numbered list where nothing holds is `open-list`; a list where some entries carry a status word is `checklist`, which takes the WORD off your node rather than holding one of its own; a figure that should play once when it is scrolled to is `reveal`; a page that holds pages already draws its children. **A hand-written version of any of those is a worse version of it** — it is the same work, it will be missing the teardown or the empty case or the redraw, and nobody else can reach it.

**And the rule that decides the rest of them: if there is even a small chance somebody else will use it, it is a plugin.** Anything you draw or code that another page or another person might want is written as a public plugin from the start and never as a copy inside a section. That is at the top of this workspace's `AGENTS.md`, it is not a preference, and it is measured — one drawing became 176 copies in the workspace this framework was built alongside, another 88 in eleven drifting shapes. §3 is the route, and it is one file.

**Where this stops: anything that has to REACT.** A drawing that changes with a table's rows, with the scroll, or with what the page holds is not a part — it is the next section.

---

## 2. When you need code, it goes in the section's `<script>`

**A section's `<script>` IS a plugin.** It is handed the same `ctx` a named plugin is handed, it fills nodes the same way, it composes through `ctx.use` the same way, and it needs no registration and no file of its own. **This is where a workspace's own drawing code lives.**

```html
<style>
  .board { display: grid; grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr)); color: var(--ink); }
</style>
<div data-g-part="note"></div>
<div class="board"></div>
<script>
  const board = section.querySelector(".board");
  for (const word of ["north", "south", "east"]) {
    const cell = document.createElement("div");
    ctx.use("markdown").mount(cell, { kind: "markdown", md: "**" + word + "**", vars: {} });
    board.append(cell);
  }
</script>
```

**A script that awaits anything goes inside an async IIFE**, because the runtime
wraps a section script in a plain function and `await` at its top level is a
syntax error that silently costs the whole script. The wrapper, the worked
example and everything else the box does and does not give a script is
[`../../../docs/code.md`](../../../docs/code.md).

**Where this is the wrong answer: when the same drawing has even a small chance of being wanted on a second page, or by a second person.** A section script belongs to one section file, so a second page means a second copy, and two copies drift — that is not a prediction, it is what happened: one drawing became eighty-eight copies in eleven different shapes in a workspace that had this exact instruction. **Write it as a plugin in `plugins/` from the start** — §3, and the rule at the top of the vault's `AGENTS.md`. A section script is for a drawing that is genuinely about this one section's own content.

Everything a section script may do, and what the box cannot do at all, is [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md). Everything it is *handed* is the `ctx` table below.

---

## 3. A plugin of your own is a folder in `plugins/`, and it loads

**Write `plugins/<id>/<id>.js` and it draws.** Every plugin is a folder of one
shape — its scripts directly inside, an `index.html` if it draws a page, a
`plugin.yaml` if it reads variables, inner plugins under its own `plugins/` —
and a loose `plugins/<id>.js` is refused naming the folder to move it into.
Name it from a section with `data-g-plugin="<id>"`, and it is registered before
the first slot asks for it — no document copied, nothing registered from a
section script. **[`../../../docs/plugins.md`](../../../docs/plugins.md) is the
mechanism**: the shape, how the folders are loaded, how a page plugin is
resolved, which five names are spoken for, and what a broken file reports.

**The framework's own plugins are the rung under this folder**, wearing `biom-`,
and this folder holds only what you wrote and what you changed about theirs:
list it rather than trusting a roster written down here, and read the
framework's in `docs/plugins/`, which is a mirror and not a source.

**The decision this file exists for is narrower than it looks: a `parts` entry can
never name your plugin.** **Yours is chrome, ornament and behaviour, not a new
kind of stored content** — so anything with words in it is a markdown part beside
it, and a plugin that wants to draw those words asks for them with
`ctx.use("markdown")`. Why a `parts` entry cannot reach one, and what yours is
handed instead, is [`../../../docs/plugins.md`](../../../docs/plugins.md).

**The cost, so that it is a decision rather than a surprise: every plugin in this workspace is global to every page in it.** That is what makes one folder reach twenty pages, and it is why a plugin has to hold itself to four things:

1. **Refuse in words where its node is misplaced.** A node naming a slot that is not this section's writes the sentence into its own node and stops. A blank rectangle sends the next hour to the wrong file.
2. **Touch only the slot it was named.** Never the section around it, never the page.
3. **Ink nothing.** The look is the section's, in the section's own `<style>`. A plugin sets a `data-*` attribute and inserts controls; a plugin that sets a colour has set it for every page in the workspace. **The one exception is a plugin a document's variable named** — `head: board-look` in a rung — which may append a `<style>`, because the document asked for it and the page's own dress is exactly what it is for. A plugin a section mounts still inks nothing.
4. **Tear down what it started.** An observer or a listener outlives the section otherwise, and the page gets measurably slower every time somebody edits it.

---

## 4. Extending a framework plugin, in this order — and never copying `doc`

**A framework plugin is changed by its variables, and a workspace changes a
plugin by changing its variables.** Every plugin declares the ones it reads,
with defaults, in its `plugin.yaml`; you write over them in
`plugins/biom-<id>/extensions.yaml`, and a page writes over those in the same
file beside its own `content.yaml`. Three rungs, nearest wins, one key at a
time — the mechanism, the typing and every refusal are in
[`../../../docs/plugins.md`](../../../docs/plugins.md). **Try these in order, and
stop at the first that does it:**

1. **Change a variable, where the plugin declares one.** One line in a rung. It follows every framework release.
2. **Name a plugin of your own in a variable, where the plugin reads one.** The `doc` document reads `head` and `foot` and mounts what each names; `head: board-look` in a rung and a `plugins/board-look/` folder is how this workspace dresses its board, and `foot:` left empty is how a page drops it. One line and one folder, and it still follows every release.
3. **Write a plugin of your own under a bare name, where you want the whole thing.** `plugins/doc/index.html` is a document of the workspace's own, and every page saying `plugin: doc` draws with it. It is yours to keep current from that day, which is the whole of what it costs.

**There is no fourth door.** A folder wearing `biom-` in this workspace holds `extensions.yaml` and nothing else; a script or a document dropped into it is refused by name and never draws. **Do not copy `doc`.** It is the most-used plugin in the framework and the one the framework will change most, and a copy is the one shape that stops following it — the workspace this framework was built alongside measured its copy a layer-order fix behind the day after it was taken, and four hundred lines owned for a hundred it wanted. Where a variable does not reach what you want, say so in the framework rather than take the copy.

**What a plugin mounted from a variable owes the page is the same four things**, plus one: it may carry a look, as above, and only then.

**The one thing that is still true of a section's `<script>` calling `register`**: it works, and the ordering makes it a trap. A section's own slots are filled before its script runs, so the registration reaches later sections and never that section's own slots. **There is no reason to take it any more** — write the file.

## The contract, and what it is for

**[`../../../docs/plugins.md`](../../../docs/plugins.md) carries `register` and
its four keys, `mount`, `ctx.use` as the whole of composition, and what a plugin
may and may not change.** [`../../../docs/code.md`](../../../docs/code.md) carries
the `ctx` a section script and a plugin are handed alike — they are the same
object, because the two differ in what they are *given* and not in what they may
*do*.

**Two things in it are judgement rather than API, and they are the reason to read
that page before writing a plugin.**

**Fail on purpose, in words, in your own node.** A plugin that throws fails inside
the node it was mounted into and the rest of the page draws — which is the right
containment and the wrong message. The person looking at a blank rectangle is
usually the person who could have fixed it if it had said anything.

**Ask `ctx.has(id)` before `ctx.use(id)` only where the dependency is genuinely
optional.** `use` throws on a name nothing registered, and that is the behaviour
you want by default: a silent null draws a blank cell, reads as missing data, and
sends the next hour to the wrong file. The optional form is for a real choice —
markdown hands a fence to the plugin its info string names only where this
workspace has one, and draws an ordinary code block where it does not.

**What `ctx.read` and `ctx.write` are FOR** — a section that draws its own `+`,
`✕` and reordering, with no ceiling on how many items it holds — is
[`../biom-sections/SKILL.md`](../biom-sections/SKILL.md).

---

## R50 — a part kind is drawn by the folder the format names, and one folder owns each id

The refusal is readable rather than a silent overwrite:

> `"table"` is a part kind and only plugins/table/ draws it — plugins/a-notes/a-notes.js must register under an id of its own

**The rule cannot be about where a file came from, because every plugin in this workspace is a folder in `plugins/` and every one of them is yours.** It is about what the NAME is — and five of them are already spoken for, so a folder claiming one would silently redraw pages its author never opened. Which names, and what the runtime does about each of them, is [`../../../docs/plugins.md`](../../../docs/plugins.md). **A `biom-` id is refused the same way**: the prefix is the framework's, and a script of yours wearing it is a copy by another name.

**What to do instead.** Register under your own id and reach the one you wanted with `ctx.use("markdown")`: the same composition with none of that. Name it `callout`, `field-note`, `spec-table`, and let the node that wants it say so with `data-g-plugin`. **If you want the drawing of markdown itself to change, write `plugins/markdown/markdown.js` registering `markdown`** — the bare name is nearer than the framework's, and it is what every markdown slot draws with from then on.

*(FAIL, and it is the one number in the rule index `.agents/skills/check.ts` never cites — it is enforced in the box at REGISTRATION time rather than where pages are read.)*

---

## R65 to R68 — the folder shape, and a rung that names nothing

Four findings the checker reports on `plugins/`, at the vault root and under a page:

- **R65 — a loose `plugins/<id>.js`.** A plugin is a folder; `mkdir plugins/<id> && mv plugins/<id>.js plugins/<id>/` is the whole fix. *(FAIL: the loader refuses it, so nothing in it draws.)*
- **R66 — a `biom-` folder holding anything beside `extensions.yaml`.** It is an extension and holds a rung alone; a script or a document in it never draws. Move a document to a bare-named folder if you meant a plugin of your own. *(FAIL.)*
- **R67 — a key in an `extensions.yaml` that the plugin's `plugin.yaml` does not declare.** A typo, or a variable the plugin does not read: it draws nothing. The finding names the keys the plugin does declare. *(FAIL.)*
- **R68 — a document under a bare name that is a copy of a framework document.** `plugins/doc/index.html` shaped like the framework's own draws, as a plugin of the workspace's, and stops following the framework. An extension would do: §4. *(WARN.)*

---

## The shape of a plugin file

What a plugin's script looks like, both to write one and to read the ones already there. **A classic script, an IIFE, no imports, and registration at the top level.** **It takes its configuration from `ctx.options` and holds no words**, because the node that mounts it carries `data-g-*` attributes and no stored content:

```js
/* plugins/progress/progress.js — a reading-progress bar. */
(function () {
  "use strict";

  biom.plugins.register({
    id: "progress",

    mount(node, content, ctx) {
      const bar = document.createElement("div");
      bar.className = "progress";
      bar.style.setProperty("--thickness", (ctx.options.thickness || "3") + "px");
      node.replaceChildren(bar);

      const paint = function () {
        const doc = document.documentElement;
        const run = doc.scrollHeight - doc.clientHeight;
        bar.style.setProperty("--at", run > 0 ? String(doc.scrollTop / run) : "0");
      };
      addEventListener("scroll", paint, { passive: true });
      paint();

      // Returned, so the listener dies with the section rather than firing at a
      // detached node for as long as the page is open.
      return function () { removeEventListener("scroll", paint); };
    },
  });
})();
```

**Every colour it sets resolves to a palette token and every face to a `--*-face` stack** — the tokens are re-declared inside the box because custom properties do not cross a document boundary, so `var(--ink)` works there and a literal is wrong on every palette but one. R30 is in [`../biom-design/SKILL.md`](../biom-design/SKILL.md) and the token list is in [`../../../docs/styling.md`](../../../docs/styling.md).

**A plugin that reads variables declares them beside its script**, flat, each with its default, and reads them with `biom.plugin.extensions()`:

```yaml
# plugins/progress/plugin.yaml
thickness: 3
```

A page or the workspace then writes `thickness: 5` in an `extensions.yaml` under the plugin's id, and the plugin reads `5` there — the same three rungs the framework's own plugins are extended through.

---

## Where the rest of it is

**[`../../../docs/plugins.md`](../../../docs/plugins.md) is how a plugin is
resolved, loaded and registered**; [`../../../docs/code.md`](../../../docs/code.md)
is the `ctx` it and a section script are handed alike. This file is when to write
one at all.

| | |
|---|---|
| [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) | where code actually goes: slots, `data-g-plugin`, section scripts, the sandbox |
| [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md) | what a page is on disk, the part kinds, and the numbered rule index |
| [`../biom-tables/SKILL.md`](../biom-tables/SKILL.md) | reading and writing rows, which is most of what a data drawing does |
| [`../biom-diagrams/SKILL.md`](../biom-diagrams/SKILL.md) | a drawing laid out from a section's own words, and the question to ask before drawing |
| [`../biom-design/SKILL.md`](../biom-design/SKILL.md) | how anything here is allowed to look |
