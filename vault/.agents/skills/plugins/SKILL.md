---
name: biom-plugins
description: "HOW CODE REACHES A SLOT, and the decision order to take before writing any. START HERE BEFORE WRITING ANY CODE THAT DRAWS SOMETHING: most slots need none — a part\'s kind names the plugin that fills it — and where code IS the answer it goes in the section\'s own `<script>`, which is handed the same `ctx` a named plugin gets. The MECHANISM is `docs/plugins.md` at the vault root: where a plugin comes from and how it is resolved, the registration contract, `ctx.use`, `data-g-plugin`, the part kinds that are spoken for, and the fence hand-off. This file is the DECISION and the rules, and it links that rather than restating it. Use whenever the task is to fill a slot with something the plugins in `plugins/` do not draw, to place a `data-g-plugin` node, or to read or repair a plugin. Carries the order to try things in, the rule that decides the rest — if there is even a small chance somebody else will use it, it is a plugin and not a copy inside a section — the four-point bar a plugin has to meet because every one of them is global to every page in the workspace, the shape of a plugin file as a worked example, and R50: a plugin may never claim a PART KIND. Read `../sections/SKILL.md` for the section a plugin is mounted from."
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

The part kinds and what `data` means for each are in [`../pages/SKILL.md`](../pages/SKILL.md). **`data-g-plugin="id"` is the other door**: it mounts a plugin with no stored content at all, configured entirely by its own `data-g-*` attributes, which is how a section places a rule, a wash or a diagram without inventing a slot in `content.yaml` for something nobody will ever edit — see [`../sections/SKILL.md`](../sections/SKILL.md).

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

Everything a section script may do, and what the box cannot do at all, is [`../sections/SKILL.md`](../sections/SKILL.md). Everything it is *handed* is the `ctx` table below.

---

## 3. A plugin of your own is a file in `plugins/`, and it loads

**Write `plugins/<id>.js` and it draws.** Put the file there, name it from a
section with `data-g-plugin="<id>"`, and it is registered before the first slot
asks for it — no document overridden, no YAML anywhere, nothing registered from a
section script. **[`../../../docs/plugins.md`](../../../docs/plugins.md) is the
mechanism**: how the folder is loaded, how a page plugin is resolved, which four
names are spoken for, and what a broken file reports.

**Every plugin the workspace draws with is already in that folder**, and they are
yours: open one, change it, and that is what draws. **List it** rather than
trusting a roster written down here.

**The decision this file exists for is narrower than it looks: a `parts` entry can
never name your plugin.** **Yours is chrome, ornament and behaviour, not a new
kind of stored content** — so anything with words in it is a markdown part beside
it, and a plugin that wants to draw those words asks for them with
`ctx.use("markdown")`. Why a `parts` entry cannot reach one, and what yours is
handed instead, is [`../../../docs/plugins.md`](../../../docs/plugins.md).

**The cost, so that it is a decision rather than a surprise: every `plugins/*.js` in this workspace is global to every page in it.** That is what makes one file reach twenty pages, and it is why a plugin has to hold itself to four things:

1. **Refuse in words where its node is misplaced.** A node naming a slot that is not this section's writes the sentence into its own node and stops. A blank rectangle sends the next hour to the wrong file.
2. **Touch only the slot it was named.** Never the section around it, never the page.
3. **Ink nothing.** The look is the section's, in the section's own `<style>`. A plugin sets a `data-*` attribute and inserts controls; a plugin that sets a colour has set it for every page in the workspace.
4. **Tear down what it started.** An observer or a listener outlives the section otherwise, and the page gets measurably slower every time somebody edits it.

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
[`../sections/SKILL.md`](../sections/SKILL.md).

---

## R50 — a part kind is drawn by the file the format names, and one file owns each id

The refusal is readable rather than a silent overwrite:

> `"table"` is a part kind and only plugins/table.js draws it — plugins/0-notes.js must register under an id of its own

**The rule cannot be about where a file came from, because every plugin in this workspace is a file in `plugins/` and every one of them is yours.** It is about what the NAME is — and four of them are already spoken for, so a file claiming one would silently redraw pages its author never opened. Which names, and what the runtime does about each of them, is [`../../../docs/plugins.md`](../../../docs/plugins.md).

**What to do instead.** Register under your own id and reach the one you wanted with `ctx.use("markdown")`: the same composition with none of that. Name it `callout`, `field-note`, `spec-table`, and let the node that wants it say so with `data-g-plugin`. **If you want the drawing of markdown itself to change, edit `plugins/markdown.js`** — it is in this folder for exactly that.

*(FAIL, and it is the one number in the rule index `.agents/skills/check.ts` never cites — it is enforced in the box at REGISTRATION time rather than where pages are read.)*

---

## The shape of a plugin file

What a file in `plugins/` looks like, both to write one and to read the ones already there. **A classic script, an IIFE, no imports, and registration at the top level** so `document.currentScript` is this file while it runs. **It takes its configuration from `ctx.options` and holds no words**, because the node that mounts it carries `data-g-*` attributes and no stored content:

```js
/* plugins/progress.js — a reading-progress bar. */
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

**Every colour it sets resolves to a palette token and every face to a `--*-face` stack** — the tokens are re-declared inside the box because custom properties do not cross a document boundary, so `var(--ink)` works there and a literal is wrong on every palette but one. R30 is in [`../design/SKILL.md`](../design/SKILL.md) and the token list is in [`../../../docs/styling.md`](../../../docs/styling.md).

---

## Where the rest of it is

**[`../../../docs/plugins.md`](../../../docs/plugins.md) is how a plugin is
resolved, loaded and registered**; [`../../../docs/code.md`](../../../docs/code.md)
is the `ctx` it and a section script are handed alike. This file is when to write
one at all.

| | |
|---|---|
| [`../sections/SKILL.md`](../sections/SKILL.md) | where code actually goes: slots, `data-g-plugin`, section scripts, the sandbox |
| [`../pages/SKILL.md`](../pages/SKILL.md) | what a page is on disk, the part kinds, and the numbered rule index |
| [`../tables/SKILL.md`](../tables/SKILL.md) | reading and writing rows, which is most of what a data drawing does |
| [`../diagrams/SKILL.md`](../diagrams/SKILL.md) | a drawing laid out from a section's own words, and the question to ask before drawing |
| [`../design/SKILL.md`](../design/SKILL.md) | how anything here is allowed to look |
