---
name: biom-design
description: "WHOSE TASTE WINS, and the file to read before any page is written. Opens with the one instruction that applies every time — read `design/` first, and where it disagrees with what you would have done, it wins — then what to do when it is still the doc the workspace shipped with: design is step one on a new vault, because everything generated here comes out of `theme.json` and `design/` and a page is not skinned afterwards. Use whenever the task is to set a workspace up, to make something look right, to decide how something should read, or to work out whether a visual choice is yours to make at all. Carries what `design/` is (a page, in the vault root, beside `pages/` rather than in it) and why it is authoritative over your taste; what 'decided' means — palette, type roles, type scale, design doc — and which of those belong to the user to choose rather than to you; GIVING `design/` A SECTION OF ITS OWN, with a worked example that passes the checker; patching it rather than regenerating it; how to use the Impeccable skill inside a vault — no `PRODUCT.md`, and `design/` stands in for `DESIGN.md`; R30 — nothing sets a raw colour, with the token names and the tint in `docs/styling.md` rather than here; the pointer to `../markdown/SKILL.md` for type SIZES, which this file deliberately does not carry; the division of labour between `theme.json`, which is colour and type, and `design/`, which is brand, voice, patterns and density; and R53, which WARNs once at the end of a run when a workspace still has the design language it shipped with."
---

# Design

## Read `design/` first, and it wins

**Before you write a page, a section, a plugin or a line of CSS, open `design/` and read it.** It sits in the vault root, beside `pages/`, and it is this workspace's own brand, voice, patterns and density, written in its own words.

**It is the user's, and it is authoritative over your taste.** Where it disagrees with what you would have done, it wins. It is not a brief you take advice from; it is the answer. A generated page that ignores it is a page that looks like it came from somewhere else, and that is the failure this file exists to prevent.

**It is a page in every way that matters** — a directory with a `content.yaml`, `contents` holding sections, `parts` filling their slots, drawn by the same runtime as everything else and edited in the app like any other page. **It is not in `pages/`**, so it never appears in the page tree, and somebody is still free to keep a page of their own called *design* under `pages/` without the two ever colliding.

**Read `theme.json` with it.** That is the palette and the type roles — `sheet`, `furniture`, `gauge` — and between them the two files say what colours a section may reach for, what its prose is set in, how dense it is allowed to be, how a control is worded and what an empty state says.

---

## If it is still the doc the workspace shipped with, the design has not been done

**Ask, in this order.** Does `design/` hold markup somebody here wrote — a section naming a `data:` file that is not one of the bands it shipped with? Is the palette in `theme.json` one somebody chose? Do its words describe THIS workspace rather than the one it shipped with? **If any answer is no, design is the next thing, before the page** — the palette, the type roles and the design doc, before a single page is written. The checker asks a laxer version of the same question and says R53 only when nothing at all has been done; its silence is not the same as an answer of yes.

**A fresh `design/` already has markup in it, so "is there an `.html` file here" answers nothing.** What it ships with is a masthead, the workspace's own palette drawn small, and three worlds under it — a newspaper, a field notebook, an instrument panel — each a complete design in its own type, density and palette, named in the sentence a person would say to get it. They are there to be *pointed at*: the first move on a new vault is usually the user reading them and saying which one is closest, or how theirs differs. **Then they are replaced.** A vault that keeps all three is a vault whose design doc still argues for three designs it does not use.

Everything an agent generates in a workspace comes out of `theme.json` and `design/`. **A page is not skinned afterwards.** Changing the design language changes the measure, the density, the section shapes and half the words, so a page written before the language existed is not re-themed later — it is written again.

**A workspace whose design was decided after twenty pages has twenty pages to go back and fix.** That is the whole argument, and it is the reason the order is worth being difficult about. Doing it first costs one conversation with the user; doing it last costs a rewrite per page, and in practice it does not happen, so what the workspace keeps is twenty pages that look like they came from somewhere else.

### What "decided" means, and who decides it

| | | Whose |
|---|---|---|
| **The palette** | set on the Theme page, stored in `theme.json`. Every colour any page ever draws is one of these tokens — R30 below | the **user's**. Ask, recommend with a reason, and wait |
| **The type roles** | `sheet`, `furniture` and `gauge`, each pointing at a face the Theme page offers. Prose, chrome and figures — a page reaches them as `var(--sheet-face)` and its pair | the **user's**, same as the palette |
| **The type scale** | `markdown.yaml` at the vault root: how big a heading is, how long a line of prose runs, what the rhythm between them is | a **file**. Write it with the user |
| **`design/`** | this workspace's brand, voice, patterns and density, in its own words rather than the ones it shipped with | a **file**. Write it with the user |

**Never pick a scheme on somebody's behalf.** The palette and the faces are set in the app and they are the two things a person will look at first; a colour chosen for them is a colour they have to undo. Propose, give the reason, and wait for the answer.

---

## Give `design/` a section of its own

**`design/` is a page in the format this vault uses, so it can SHOW the workspace's design language instead of describing it.** A design doc whose every section took the shipped default is a design doc arguing for layout in one centred column — and the page an agent reads before writing UI is the worst possible place for that.

**So write it a real section**: its own `data:` file, its own layout, the workspace's own type and spacing on the page rather than in a paragraph about the page.

```yaml
# design/content.yaml
name: Design
contents:
  - name: palette
    data: palette.html
    parts:
      why: |
        ## The palette is **Pen plotter**

        Near-white stock, near-black ink, three saturated accents. It reads as
        pen on paper rather than as a website, and a pale ground gives a section
        room to be dramatic without the page turning into noise.
      rule: |
        Nothing here writes a colour. Every colour is a role and a role resolves
        to a token — `var(--ink)`, `var(--cyan)`, `var(--rule)`. To tint, mix.
```

```html
<!-- design/palette.html — the section says the palette by showing it -->
<style>
  :scope {
    display: grid;
    grid-template-columns: minmax(0, 24rem) minmax(0, 1fr);
    gap: 2.5rem;
    padding-block: 3rem;
    border-block-end: 1px solid var(--rule);
  }
  .chips { display: flex; gap: 0.5rem; }
  .chip { block-size: 4rem; flex: 1; }
  .ink { background: var(--ink); }
  .cyan { background: var(--cyan); }
  .stock { background: var(--stock-lo); }
</style>

<div>
  <div data-g-part="why"></div>
  <div class="chips"><i class="chip ink"></i><i class="chip cyan"></i><i class="chip stock"></i></div>
</div>
<div data-g-part="rule"></div>
```

**The shipped `design/` is the starting shape, not a template to imitate.** Its prose sections — brand, voice, patterns, density — take the shipped default and say what this workspace is like; replace their words with this workspace's. **The three worlds above them are specimens and are meant to go**: once the palette and the type are settled, the world that was chosen becomes `theme.json` and the design doc's own words, and the bands that were not chosen are sections to delete. What replaces them is a section of this workspace's own, like the one above. Everything in [`../sections/SKILL.md`](../sections/SKILL.md) applies to every section here unchanged.

**A world is worth reading before you write one of your own**, because each is the same week of an invented business drawn three ways and every difference between them is a decision this file is about: which type role carries the reading, how tight the leading is, whether a figure is counted, plotted or metered, what is allowed to be coloured. **A band's palette lives in that section's own `variables`** and is declared onto the workspace's own token names, so nothing inside one spells a colour and R30 holds there as it holds everywhere else. **Every ink a world declares clears 4.5:1 on both of that world's own stocks**, and it is measured rather than judged: `tests/theme.test.js` reads the three palettes straight out of `vault/design/content.yaml` and fails on any figure under it, which is the bar the shipped palette is held to as well. A label at three to one reads as a deliberately quiet grey and is simply unreadable — three of these were, and nothing but the measurement said so.

---

## You may write it, and you patch it

**When the design language genuinely moves, update `design/` in the same change.** It is a living document, not a read-only brief. When you and the user settle on a pattern — how an empty state reads, how a figure sits beside its prose, what a destructive control looks like — the settlement belongs in `design/` or it is lost the next time anybody generates anything.

**Patch it; never regenerate it.** It is a page, so [`../pages/SKILL.md`](../pages/SKILL.md) binds it exactly as it binds any other, and a rewrite silently drops what the user wrote and renames the section names and slot ids their edits are attached to.

---

## Use the Impeccable skill, with amendments

For real design work — a surface being shaped, a redesign, a critique — use the **Impeccable** skill. What changes inside a vault:

**Do not create or use `PRODUCT.md`.** This workspace has no product brief and does not want one. Impeccable's setup step loads `PRODUCT.md` and offers to write one through `init`; skip that here, and do not run `context.mjs` looking for it.

**`design/` is the `DESIGN.md` it would otherwise look for or write.** Read it in place of that file, and write back to it in place of that file. Everything else in Impeccable applies unchanged.

---

## Pitch it at the subject. Nothing here is a template

**Work as the design lead at a small studio known for their versatility.** A studio like that has no house look to apply; what it has is a reading of what each job is, and the same people make a field guide and a ticketing app look like two different things on purpose. **That is the standard, and the failure it names is the opposite of ugliness — it is sameness.** A page that could have been about anything was designed by nobody.

**So every choice is made FOR this subject.** The shape of a figure, the density, the rhythm, what is lit and what is quiet — each of those is decided against what this page is arguing, and none of them is carried over because the last page had it. A section copied from another page brings that page's argument with it.

**Where a workspace HAS a decided look, `design/` is where it is decided and it wins** — that is the top of this file, and it is not in tension with the above. The house palette, the voice and the patterns are settled once; how a particular page uses them is settled per page.

---

## Use the convention the reader already knows

**Before inventing a way to show something, ask what the reader has already seen a hundred times.** A timeline runs left to right or top to bottom. A comparison is two columns. A status is a word. A progression is numbered. An invented convention costs the reader and buys the author — they have to learn it, on this page, for this one figure, and they have nothing to spend it on afterwards.

**This is not an argument for the boring choice.** It is an argument about WHERE the novelty goes: into the drawing, the type, the rhythm and the detail, and not into what a shape means. A reader who has to work out the grammar is not reading the argument.

---

## When a choice is rejected, write the ban down in the same change

**The moment the person you are working for overrules a choice, the ban goes into `design/` before anything else happens.** Not after the page is fixed, and not "next time" — in that change. `design/` is the living page and it is authoritative, so a rejection that only lives in a conversation is a rejection that reaches nobody: the next agent, in the next session, reads the file and not the chat, makes the same choice, and the person has to say it again.

**Write it as a rule about what to do, not as a note about what happened.** *"Headings are set in the display role and never in the gauge role"* is actionable; *"we decided against the pixel face on the 12th"* is archaeology.

---

## Nothing sets a raw colour

**R30 — no hex, no `rgb()`, `hsl()`, `oklch()`, no named colour, in a section, a plugin, a `child.html` or a diagram.** Every colour resolves to a palette token and every face to a `--*-face` stack. A literal is invisible to the Theme page and stays wrong on every palette but the one it was written against — it will be the one thing on screen that does not match the morning somebody changes the scheme. *(FAIL)*

**A tint is mixed from a token, never sampled off one.** `color-mix(in srgb, var(--cyan) 12%, transparent)` keeps the palette in charge of the wash a full-bleed section wants. Anything the user adds on the Theme page arrives as a token too.

**The token names, how the palette reaches the box, and how a tint is mixed rather than sampled** are in [`../../../docs/styling.md`](../../../docs/styling.md).

**A SECTION THAT NAMES A FACE IN A FONT STACK IS REACHING PAST THE USER'S CHOICE**, and that is the corollary of the rule above rather than a separate one. The type ROLES are theirs — `theme.json` says which face is the sheet, the furniture, the display and the gauge, and they chose those. A section that writes `font-family: "Some Face", sans-serif` has substituted its own taste for that decision on one page, silently, and it will be the one block on screen that does not change when they change the face. **Take `var(--sheet-face)`, `var(--furniture-face)` and the rest; never a family name.**

**In a plugin it is worse by exactly the number of pages in the workspace.** A seeded plugin that inks a face has done it for every page in every vault, for people who never saw the decision. A plugin sets a `data-*` attribute and inserts controls; what any of it LOOKS like is the section's.

**Where it does not apply: something that cannot read a custom property at all** — a canvas, a shader, a library that writes literal fills into its own output. `biom.theme()` hands back the raw values for exactly those. A diagram here is ordinary SVG and is NOT one of them — every line takes `--rule` and every label `--ink`, so the drawing repaints when the palette does; see [`../diagrams/SKILL.md`](../diagrams/SKILL.md). Reach for it when the thing you are painting has no CSS to read, and **never as a way around the rule.**

---

## Anything invented says so, on the page

**A figure, a name or a job you made up is written as a fixture, in a slot, admitting it.** A fixture that does not say what it is is a number somebody will quote back to you — and the slot is the point: it is a word a person can change once they have the real one.

## Type SIZES have a file, and it is not this one

**`markdown.yaml` owns how big a heading is** — size, weight, leading, tracking, the space above and below, case, the reading measure, and which type ROLE a run of prose is set in. One at the vault root is the house scale every page inherits; one in a page's directory is that page's, merged over the house a property at a time.

**It is part of deciding the design, and it is written where it can be checked and where a control could one day drive it.** Do not restate a size here in prose and do not write one into a section that every page would want — a number in two places is one of them going stale, and the one in the file is the one that draws.

**[`../markdown/SKILL.md`](../markdown/SKILL.md) is which of the three places a type decision belongs in**, and [`../../../docs/styling.md`](../../../docs/styling.md) is how the scale works.

---

## The division of labour

**`theme.json` is colour and type. `design/` is everything else** — brand, voice, patterns, density.

**Keep them apart, in both directions.** A colour written into `design/` is a colour the Theme page cannot rewrite, so it becomes a second palette that drifts from the real one and is never noticed until a scheme changes. Voice written into `theme.json` is voice nobody reads, because that file is a machine's and the person edits it through a picker.

---

## What the checker says about it — and what it does not

**R53 — there are pages in this workspace and its design language is still the one it shipped with.** *(WARN)*

**Nothing in the product refuses.** No page fails to draw, no write is blocked, and a workspace is perfectly entitled to keep exactly what it shipped with. R53 is said **once at the end of a run** rather than once per page, and it is worded as a prompt because what it is asking for is judgement rather than a fix.

**It says nothing until BOTH halves are untouched**, which is what keeps it quiet for anybody who has started:

- the palette in `theme.json` is still the one a fresh vault ships with, **compared by name** — so choosing a palette on the Theme page silences it, and editing a shipped colour by hand does not; and
- `design/` has no section of ITS OWN — no `.html` file in it, and no section naming one in `data:`, **beyond the bands it shipped with**, which are compared by name for the same reason the palette is. A seeded vault arrives with markup in `design/`, so the mere presence of a file there says nothing; one somebody added says everything.

**It says nothing when there is no workspace to say it about**: a page directory handed over on its own, or a vault whose `pages/` is empty. A fresh workspace with nothing in it has not skipped its design work; it has not started.

**Read the softness honestly, in both directions.** The checker cannot tell a considered decision to keep the shipped palette from never having opened the Theme page, so it does not try — it asks. And its silence is not evidence the design is good: writing one section and picking any palette is enough to quiet it. What it cannot do is undo the cost of getting the order wrong, and that cost is not softened by the rule being a warning.

---

## Where the rest of it is

**[`../../../docs/styling.md`](../../../docs/styling.md) is how colour and type
reach a page.** This file is who decides what they should be.

| | |
|---|---|
| [`../pages/SKILL.md`](../pages/SKILL.md) | what a page is on disk, and the numbered rule index |
| [`../sections/SKILL.md`](../sections/SKILL.md) | writing a section: layout, `@scope`, the palette tokens, the scroll toolkit |
| [`../markdown/SKILL.md`](../markdown/SKILL.md) | which of the three places a type decision belongs in |
| [`../plugins/SKILL.md`](../plugins/SKILL.md) | what fills a slot, and how a plugin is allowed to look |
| [`../diagrams/SKILL.md`](../diagrams/SKILL.md) | a diagram's colours, which come from the palette and never from the library |
| [`../children/SKILL.md`](../children/SKILL.md) | how a page appears inside another one, which is a design decision as much as a format one |
