# How is any of it sized and coloured?

Two files answer that, and they answer different halves.

| | |
|---|---|
| `theme.json` | **colour and type faces.** The palette, and which face fills each of the three type roles |
| `markdown.yaml` | **the type scale.** How big a heading is, how long a line of prose runs, the rhythm between them |

Everything else — how a particular section lays itself out, what a figure looks
like — is that section's own `<style>`.

## The palette

**Every colour on a page resolves to a token.** A literal is invisible to the
Theme page and stays wrong on every palette but the one it was written against, so
the whole point of the palette is that a page never names a colour.

```css
.band  { color: var(--ink); border-block-end: 1px solid var(--rule); }
.chip  { background: var(--cyan); }
```

These are the roles a page reaches for. `theme.json` is the palette itself, and
anything added on the Theme page arrives as a token too.

| | |
|---|---|
| `--stock` `--stock-hi` `--stock-lo` `--stock-edge` `--field` | the paper |
| `--ink` `--ink-2` `--ink-3` | the text, in three weights of presence |
| `--rule` `--rule-soft` | the lines |
| `--cyan` `--magenta` `--yellow` `--cyan-t` `--magenta-t` | the accents, and the `-t` pair that is safe to set TEXT in — lighter than the accent on a dark palette, darker on a light one |
| `--nonrepro` `--nonrepro-t` | the non-reproducing blue: guides, outlines, the furniture a section draws |
| `--sheet-face` `--furniture-face` `--gauge-face` | the three type roles |

**What a new workspace ships with is the product's own brand**: charcoal `#0E0F11` as the ground everywhere, cream `#EDE6D6` for the type, and Sunflower `#FFB020` as the one hot colour, filling `--cyan` for anything filled or focused and `--yellow` for anything warned about. It is a taste rather than a floor — a folder arrives dressed as Biom — and changing it changes every page here, because no page names a colour.

**A tint is mixed from a token, never sampled off one.**

```css
.wash { background: color-mix(in srgb, var(--cyan) 12%, transparent); }
```

### How the palette reaches the box

**Custom properties do not cross a document boundary**, so `var(--ink)` is not
free inside the page frame and assuming it is breaks theming for exactly the pages
that matter most.

**The palette arrives over the port as data and is re-declared on `:root` inside
the box before the page is shown.** The tokens work because that happened, not
because CSS inherits across an iframe. **The property name is the palette key
kebab-cased**: `stockHi` becomes `--stock-hi`, `ink3` becomes `--ink-3`.

**Where a custom property cannot be read at all** — a `<canvas>`, a shader, a
library that writes literal fills into its own output — `biom.theme()` hands back
the raw values. A drawing made of ordinary HTML elements is not one of those cases
and takes the tokens like everything else.

### The three type roles

`theme.json` says which installed face is the **sheet** (prose), the
**furniture** (chrome and controls) and the **gauge** (figures and code). A page
asks for a role and never for a family name:

```css
.rack  { font-family: var(--sheet-face); }
.btn   { font-family: var(--furniture-face); }
```

A section that writes `font-family: "Some Face", sans-serif` has substituted its
own taste for a decision the person made, on one page, silently — and it will be
the one block on screen that does not change when they change the face.

## What every doc page already has

The document declares four things in a cascade layer, so **every section on every
doc page has them without asking for them**:

| | |
|---|---|
| `--motion` | `1`, and `0` under `prefers-reduced-motion`. Multiply a duration or a delay by it and the reduced-motion case is handled in one place |
| `.wrap` | a centred column at `64rem` with inline padding — a figure's own width, wider than prose |
| `.wrap > * > :first-child` / `:last-child` | the outer margins of a slot's blocks flattened, so the wrap's `gap` is the spacing |
| `[data-g-part]` | held to `var(--md-measure, 34rem)`, the workspace's own reading measure |

**It is a default and never a ceiling.** The frame is in a cascade layer, and an
unlayered author rule beats every layered one whatever its specificity — so a
section's own `<style>` wins by existing. A full-bleed band, a table at its own
width, a figure with a rhythm of its own: each is one ordinary rule in your file.

## `markdown.yaml` — the type scale

**A small declarative file: elements, and properties on them.** One at the
workspace root is the **house** scale every page inherits; one in a page's own
directory is that page's.

```yaml
# <vault>/markdown.yaml
measure: 34rem
h2: { size: 1.5rem, weight: 600, leading: 1.15, above: 2.25rem, below: 0.75rem }
p:  { size: 1rem, leading: 1.6, below: 1rem }
```

The one this workspace ships with is the whole shape, in the file itself.

**Every property is optional, and so is the file.** Delete a line and the
browser's own default comes back; delete the file and the workspace looks exactly
as it did before.

### The two files, and the merge

A page may put a `markdown.yaml` beside its own `content.yaml`, and it states
**only what differs**:

```yaml
# pages/home/children/brief/markdown.yaml
h1: { size: 3rem }
```

**The page's is merged over the house one property at a time**, which is the whole
reason there are two. That page keeps the house's `h1` weight, leading and
spacing — and it keeps them when the workspace changes its mind, rather than
holding a copy that quietly drifts. `h1: { size: 3rem }` never disturbs
`h1: { weight: 600 }` one level up.

**There are exactly two, and nesting does not add a third.** A parent page's scale
does **not** reach its children: `pages/home/markdown.yaml` styles `home` and
nothing under its `children/`.

### What it can say

| | |
|---|---|
| `size` | a length — `2rem`, `18px`, `1.0625rem` |
| `leading` | line height, as a **unitless number** — `1.5` |
| `tracking` | letter spacing, a length — `-0.02em` |
| `above` | the space before, a length |
| `below` | the space after, a length |
| `weight` | `100`–`900`, or `normal` / `bold` / `lighter` / `bolder` |
| `style` | `normal`, `italic`, `oblique` |
| `case` | `none`, `upper`, `lower`, `title` |
| `face` | a type **role**: `sheet`, `furniture` or `gauge` |

**The elements it speaks about** are the ones markdown draws: `h1` through `h6`,
`p`, `li`, `blockquote`, `code`, `pre`, `hr`, `a`, `strong`, `em` and `table`.
`measure` is the only top-level key.

### What it sets, and what it only offers

This is the part that decides what a line actually does, and it is not uniform.

**Body size, leading and face are the page's, and every word on it inherits
them.** `p`'s `size`, `leading` and `face` are declared **on the page root**, not
on paragraphs. So they set the type for everything: a heading that names no size of
its own, a label in a grid cell, the text in a table, a caption under a figure.
**`p: { size: 1.0625rem }` is the workspace's reading size, not a rule about
paragraphs**, and it is the line to change when the whole page reads too small.

**Everything else is the element's.** Every other property on every other element —
and `p`'s own `weight`, `tracking`, `above`, `below`, `style` and `case` — is set
on that element directly, so **a heading keeps its own size wherever it sits.**

**A list follows whatever it sits in.** `li`'s `size`, `leading` and `face` fall
back to *inherit* rather than to the browser's default, so a list inside a section
that set small text stays small.

**The reading measure is published and applied to nothing.** `measure` lands on
the page root as a value and **no rule reads it** — nothing is capped behind your
back. The shipped default section asks for it with
`max-width: var(--md-measure, 34rem)`; any other section that wants a reading
column asks too; a section that wants the whole canvas says nothing and gets it.
That is why full bleed costs a section nothing here: there is no page-wide wrapper
to escape.

### What it cannot say, on purpose

Each absence is what buys the file one of its properties.

**No colour.** There is no property for it — an absence rather than a filter that
could be got wrong. Colour belongs to the workspace, and what the absence buys is
that a page cannot mint a second palette that drifts from the real one.

**No font name.** `face:` takes a role. What the absence buys is that a scale
cannot pin a page to a font this workspace does not use, on a machine that may not
have it.

**No selectors.** No `.wrap h2`, no `:first-child`, no media query. What the
absence buys is that everything a scale says is **knowable**: the checker can name
a line it does not understand, a colour cannot get in through a value, and a
control in the app could one day drive it.

**The freedom did not go anywhere; it moved.** Anything the scale cannot express, a
section's own `<style>` still can, and that is arbitrary CSS.

### A section always wins

**A section's own `<style>` beats the scale where the two name the same element**,
whatever the section's rule says and however narrow the scale's is — by
construction rather than by counting, because the scale's rules live in a cascade
layer. So a section writing `h1 { font-size: 4rem }` gets `4rem`, and whoever wrote
it never has to know the scale exists.

**For body text it wins even when it names something else**, because body size is
inherited from the page rather than declared on paragraphs. A section that sizes a
wrapper — `.kicker { font-size: 0.74rem }` — sizes the paragraph markdown puts
inside it.

**The boundary, and it is the one that catches people: a heading does not follow a
wrapper.** The scale names `h1` directly, so a section that sizes an ancestor
leaves it where the scale put it. Measured, with the house scale above: inside
`.kicker { font-size: 0.74rem }` the paragraph comes out at **11.84px** and the
`<h1>` next to it stays at **36px**. If the heading was meant to follow, aim the
rule at the element:

```css
.kicker h1 { font-size: inherit; }
```

### A typo is dropped, never fatal

**Anything the reader cannot use — an element nobody draws, a property nobody has,
a size that is not a length — is thrown away, and the rest of the file still
applies.** A page is the unit of a fault everywhere in this format, and a typo in a
type scale must not be the thing that stops a document opening. A
`markdown.yaml` that does not parse as YAML at all is dropped **whole**, in
silence, with the page looking exactly as it would if no scale had ever been
written.

That is only defensible because somebody is told, and the checker is what tells
them:

```
bun run .agents/skills/check.ts pages/home/children/brief
```

A page's own scale is reported with that page; the workspace's is reported once at
the end of a run.

## A container query needs a container

`@container (width <= 40rem)` matches nothing until something above it declares `container-type: inline-size` — nothing
declares it for you, because the box is the viewport and a section is an ordinary
block until it opts in:

```css
.band { container-type: inline-size; }
@container (width <= 40rem) { .cols { grid-template-columns: 1fr; } }
```

**`max-inline-size` is a container feature and a CSS property, not a media
feature**, so `@media (max-inline-size: 52rem)` matches nothing at all — silently,
because a media query that never matches looks exactly like a page that was never
narrow. Write a container query, or `@media (width <= 52rem)` if you really do
mean the whole canvas.

---

**Whose taste wins** — reading `design/` first, what "decided" means and who
decides it, and the rule that no page names a raw colour — is
[`../.agents/skills/biom-design/SKILL.md`](../.agents/skills/biom-design/SKILL.md).
**Which of the three files to reach for** is
[`../.agents/skills/biom-markdown/SKILL.md`](../.agents/skills/biom-markdown/SKILL.md).
