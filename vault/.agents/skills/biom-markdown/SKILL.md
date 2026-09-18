---
name: biom-markdown
description: "WHICH OF THE THREE PLACES A TYPE DECISION BELONGS IN — the workspace\'s `markdown.yaml`, a page\'s own, or a section\'s `<style>` — and the two rules the checker reports about a type scale. The MECHANISM — the merge, what the scale sets on the page versus what it only offers a section, the property table, the elements it speaks about, the three things it deliberately cannot say, and why a section always wins — is `docs/styling.md` at the vault root, and this file links it rather than restating it. Use whenever the task is to change the size, weight, leading, letter-spacing, spacing, case, style or type role of prose anywhere in this workspace, to give one page a texture of its own, to set the reading measure, or to read an R54 or R55 finding. Carries the house scale that ships as the shape to EDIT rather than replace, why a page\'s own scale states ONLY what differs, why `measure:` is a line that does nothing unless the sections read it, the test that decides which of the three to reach for — does the answer belong to the WORDS or to the ARRANGEMENT — and R54 and R55."
---

# The markdown type scale

**`markdown.yaml` is where this workspace says how big a heading is.** A small declarative file — elements, and properties on them — and the answer to a question the format could not previously answer anywhere.

**It exists because almost every visible word on a page is a markdown part.** That is what makes a page editable: click a paragraph and type. The cost of it is that *how big is a heading* stopped being one section's business and became the page's, and there was nowhere to say it except inside each section's own CSS — sixteen sections, sixteen answers, and no way to change your mind once.

**Every property is optional, and so is the file** — [`../../../docs/styling.md`](../../../docs/styling.md) — and nothing anywhere reports a scale that is not there. So the job is almost always to EDIT the shape below rather than to write one from nothing.

---

## The house scale — the shape to start from

`markdown.yaml` at the vault root is the **house** scale, and every page in this workspace inherits it. A workspace ships with one, so the job is almost always to **edit this file rather than to write one from nothing**:

```yaml
# <vault>/markdown.yaml — the house scale
measure: 34rem

h1: { size: 2.25rem, weight: 600, leading: 1.08, tracking: -0.015em, above: 0, below: 1rem }
h2: { size: 1.5rem,  weight: 600, leading: 1.15, above: 2.25rem, below: 0.75rem }
h3: { size: 1.15rem, weight: 600, leading: 1.25, above: 1.75rem, below: 0.5rem }

p:  { size: 1rem, leading: 1.6, below: 1rem }
li: { size: 1rem, leading: 1.55 }

blockquote: { size: 1.125rem, style: italic, leading: 1.5, above: 1.5rem, below: 1.5rem }

# The gauge face is the one that lines up, which is what code is for.
code: { face: gauge, size: 0.9em }
pre:  { face: gauge, size: 0.875rem, leading: 1.5, above: 1.25rem, below: 1.25rem }
```

**Which properties this workspace's prose actually wants is a design decision**, so it is settled with the design language rather than after it — see [`../biom-design/SKILL.md`](../biom-design/SKILL.md).

---

## Everything the file can say is `docs/styling.md`

**[`../../../docs/styling.md`](../../../docs/styling.md) is the mechanism** — the
two files and the property-at-a-time merge, what the scale SETS on the page versus
what it merely OFFERS a section, the complete property table and the elements it
speaks about, the three things it deliberately cannot say and what each absence
buys, why a section's own `<style>` always wins and the measured heading boundary
where it does not follow a wrapper, and why an unknown line is dropped rather than
fatal.

**Two things follow from it that are judgement rather than mechanism.**

**A page's own scale states only what DIFFERS.** A page whose scale restates the
house scale will be wrong the first time somebody edits the house one, and nothing
on screen will say why.

**Set `measure:` only where the sections read it.** It is published and applied to
nothing, so a `measure:` on a page whose sections all set their own widths is a
line that does nothing at all.

---

## Which one to reach for

| Reach for | When |
|---|---|
| `markdown.yaml` at the vault root | the answer should be the same on every page — the workspace's reading size, its heading rhythm, its measure |
| `markdown.yaml` in a page directory | this **document** has a texture of its own: a brief set larger, a reference page set tighter |
| a section's own `<style>` | it is about **this layout** — a display heading in one band, a caption under one figure, anything with a selector in it, anything that is a colour |

**The test is whether the answer belongs to the words or to the arrangement.** Prose that reads the same wherever it sits is the scale's; type that only makes sense inside one section's grid is that section's, and putting it in the scale would set every other page's headings on the way past.

---

## The two rules

**Nothing in a type scale is fatal — the reader drops what it cannot use and the
page still opens.** That is only defensible because somebody is told, and telling
them is the checker's job:

**R54 — a line the reader threw away.** The scale still applies and the page still draws; that one property simply comes out as the browser's own. The finding names what was dropped and why. *(WARN)*

**R55 — a `markdown.yaml` that does not parse as YAML at all.** Not one line but the **whole file**, and the page gives no sign of it — which is why this is the loud one and R54 is not. *(FAIL)*

**The page's own scale is reported with the page. The workspace's is reported once at the end of a run**, however many directories were checked — a line the house scale lost is one fact about the vault, and repeating it per page would bury every finding about the pages themselves.

```
bun run .agents/skills/check.ts pages/home/children/brief
```

---

## Where the rest of it is

**[`../../../docs/styling.md`](../../../docs/styling.md) is how the scale and the
palette work.** This file is which one to reach for.

| | |
|---|---|
| [`../biom-design/SKILL.md`](../biom-design/SKILL.md) | the design language this scale is one expression of, the palette, and the type roles `face:` names |
| [`../biom-sections/SKILL.md`](../biom-sections/SKILL.md) | a section's own `<style>`, which always wins, and the measure the default section file asks for |
| [`../biom-pages/SKILL.md`](../biom-pages/SKILL.md) | what else a page directory holds, and the complete rule index |
