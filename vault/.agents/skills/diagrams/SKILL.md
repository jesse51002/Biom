---
name: biom-diagrams
description: "WHEN A DRAWING IS WORTH MAKING, and what shape it takes when it is. A diagram here is a CUSTOM drawing and never a library's: HTML elements in the section's own markup, with the boxes and the arrows held as parallel `variables` in `content.yaml` and laid out by the section's own `<script>` — so editing the words edits the diagram, and nothing in the markup holds a position somebody has to maintain. `base/diagram/` is that written out and is what to copy. Use whenever the task is to draw a flow, a hierarchy, an architecture, a sequence, a state machine, a timeline, or anything else where the answer might be a picture of relationships. Leads with the shape that works and the section it sits in, then the test for whether the subject earns a drawing at all (and when a table or a list beats one), then the layout the script computes and the rules that keep a drawing readable: top to bottom, sibling-only edges, names not sentences, edges labelled with the contract, solid versus dashed, and never colour alone. Carries how a drawing arrives behind `--motion`, palette tokens only (R30), reflow rather than pixels (R25), when a drawing becomes a `plugins/<id>.js` rather than a script in one section, the `-->`-in-a-comment trap, and the FENCE MECHANISM — a fenced block whose info string names a plugin this workspace carries is handed to that plugin, which is how a vault that wants a diagram LANGUAGE gets one without the framework picking it."
---

# Diagrams

**This file settles when a drawing is worth making, and what it looks like when it is.**

**A diagram is a drawing this workspace makes, not one a library makes for it.** HTML elements in the section's own markup, on the palette's tokens, drawn in when it arrives — which is what every other figure on a page already is. **Nothing ships a diagram language**, and that is the decision rather than an omission: a picture of relationships is the case a custom drawing is best at, and a page whose diagram came out of somebody else's renderer is a page whose one picture does not look like the rest of it.

**The words are the diagram.** The boxes and the arrows are `variables` on the section, in `content.yaml` beside the prose that explains them, and the section's `<script>` turns them into geometry. So moving a box is editing the document, a new node is a new name, and the html file never has to be opened to change what the picture says.

**`base/diagram/` is all of it written out** — the lists, the layout, the reveal, the fault slot for a drawing with no nodes yet. **Copy that rather than starting from an empty file**; everything below is what it does and why.

---

## The shape that works

````yaml
contents:
  - name: how-it-fits
    data: shape.html
    variables:
      nodes: [Somebody asks, Claude writes the file, The window redraws, The page is the workspace]
      edgeFrom: [Somebody asks, Claude writes the file, The window redraws, The page is the workspace]
      edgeTo: [Claude writes the file, The window redraws, The page is the workspace, Somebody asks]
      edgeSays: [in a sentence, one commit per write, no build step, and asks again]
      edgeKind: [solid, solid, solid, dashed]
    parts:
      head: |
        ## How a page gets made

        There is no build step between asking and seeing.
      argument: |
        The loop closes because **the file is the product**. Nothing is exported and
        nothing is published: the page a person is looking at is the file that was
        just written.
````

**Parallel lists sharing a stem, one entry each per edge** — `edgeFrom[2]`, `edgeTo[2]`, `edgeSays[2]` and `edgeKind[2]` are one arrow. A variable is a scalar or a list of scalars and nothing else, so anything tabular is parallel lists; that is the format's rule and not this drawing's.

**The markup is a band with a plate in it, and the script fills the plate:**

```html
<style>
  :scope { display: block; container-type: inline-size; padding-block: 3rem; }
  .band {
    display: grid;
    gap: 1.5rem 2.5rem;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    grid-template-areas: "head  head" "plate say";
    color: var(--ink);
  }
  .head  { grid-area: head; }
  /* NO PIXEL WIDTHS ANYWHERE. The drawing takes the column it is given and the
     type sizes what is in it — R25, and what makes one drawing right on a phone
     and on a projector. */
  .plate { grid-area: plate; min-inline-size: 0; overflow-x: auto; overscroll-behavior-x: contain; }
  .say   { grid-area: say; }
  /* One column when there is no room for two. Last in the file, so it wins. */
  @container (width <= 52rem) {
    .band { grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "plate" "say"; }
  }
</style>
<div class="band">
  <div class="head"  data-g-part="head"></div>
  <div class="plate"></div>
  <div class="say"   data-g-part="argument"></div>
  <span data-g-plugin="reveal"></span>
</div>
<script>
  /* ctx.vars is the page's variables and this section's, merged with the nearest
     last — so the drawing is edited in `content.yaml` and this file is not. */
</script>
```

**The drawing gets a section, and the section is what gives it width.** A graph is nearly always wider than the measure prose is set to, and reading it under a paragraph means losing one to see the other — so the band goes edge to edge and the argument sits beside the picture.

**The plate wants `overflow-x: auto`.** The page's one frame IS the scroller for the whole document, so a drawing left to widen the page would drag every section on it sideways.

**Slots only where the section PLACES them differently.** Head across the top, picture and argument side by side. Slots stacked one under another with nothing to tell them apart are one markdown part that has been cut up for no reason — that is R57, in [`../sections/SKILL.md`](../sections/SKILL.md).

---

## Does this earn a drawing?

**A diagram answers one question: what is connected to what.** Ask whether that is the question the reader has.

- **Is the point the RELATIONSHIP between named things** — what flows into what, what contains what, what happens after what? Then draw it.
- **Would every node carry two or three facts?** That is a table, not a diagram. Boxes and arrows cannot hold figures. See [`../tables/SKILL.md`](../tables/SKILL.md) — and a table here is a real table with typed columns, not a picture of one.
- **Is it a sequence with no branching?** Six boxes in a vertical line is a numbered list that took longer to write and is harder to edit. Write the list.
- **Would you have to invent the relationships to fill it out?** Then there is nothing to draw yet. A diagram that is mostly guesses reads as authoritative and is the most expensive kind of wrong on a page.

**One good graph beats three.** A page with a diagram in every section has stopped using them to answer anything.

---

## The layout is computed, never typed

**No position belongs in a file.** A row and a column written by hand are numbers somebody has to maintain, and the day a node is added every one of them is wrong — which is how a drawing quietly stops matching the argument beside it. The script places the boxes; where it has to tell the stylesheet where something goes, it writes a custom property and the stylesheet decides what to do with it.

**A node's ROW is how far it is from a source** — one more than the deepest thing pointing at it — **and its place across that row is the order it was written in.** That is the whole of the layout in the starter, and it is deliberately not cleverer than that:

- **Relaxed rather than sorted.** A cycle is an ordinary thing to draw — a loop that closes is usually the point — and a topological sort has nothing to say about one. Cap the passes at the number of nodes and a cycle settles instead of spinning.
- **No crossing-minimising sweep.** It would reorder a row the day somebody added an edge, and a diagram that rearranges itself under its own author is worse than one with a crossing in it.
- **Nothing is measured.** A box is as wide as its own name makes it, which is a thing the browser already does — a script that reads a box back to decide where to put the next one is a drawing that waits for the face to load and a section that is blank while it does.

**An edge naming a node nobody wrote is dropped rather than drawn around.** And a section with no nodes yet says so in a slot of its own: a blank rectangle where a drawing was is indistinguishable from a page still loading, and the person looking at it is usually the person who could have fixed it.

---

## The drawing rules

**Top to bottom.** Sources at the top, shared things at the bottom, and the reader scrolls down rather than sideways. A wide diagram is unreadable on a laptop and impossible on a phone. **This is a rule about the drawings where you CHOOSE** — a flow, a graph, a hierarchy. A sequence runs across by construction and a timeline is a timeline; do not fight either into a column.

**Only connect boxes that share a parent.** An arrow from inside one group to inside another is the single most common way a diagram becomes a hairball. Draw the relationship at the level where both boxes are siblings, and put the detail on the label. **Where the crossing edge IS the point** — a deliberate exception, a back channel — draw it and say in the prose that it is one, so it reads as an argument rather than as an accident.

**A node label is a name, not an explanation.** A couple of words. When a node needs a sentence to be understood, the sentence belongs in the prose beside it and the node keeps the name. A diagram whose boxes have grown into paragraphs has stopped being scannable, and a row of them has nowhere left to go on a phone.

**Label the edges with the contract**, not with a verb. `writes the rows`, `GET /things/{id}`, `one commit per write` — each says more than `uses`. An edge that carries nothing worth naming can be left bare.

**Solid is a live dependency. Dashed is build-time, operational, or a handoff** — and an edge that runs back up the page is dashed too, because it is going the way the reader is not. Keep it consistent across every diagram in a workspace, or the distinction stops carrying information.

**Never let colour carry the meaning on its own.** Every colour comes from the workspace palette, so a hue cannot be chosen to mean something. Where two kinds of node have to be told apart, tell them apart by SHAPE or by stroke — and **say what the distinction is in the prose beside the picture**, which is also what makes the drawing readable to somebody who cannot tell two tokens apart.

**The markup says not one word of it.** Every name in the drawing is a value out of `variables`, set as `textContent` by the script — which is what makes editing the document editing the picture, and what keeps R56 quiet without an exception being spent on it.

---

## It moves when it arrives

**The edges draw themselves in, once, when the section is first seen.** A figure that arrives reads before the prose does, which is the whole reason it is there.

- **`<span data-g-plugin="reveal">` adds `is-seen` to the section and disconnects.** Everything the reveal does is in the section's own `<style>`, hung off `:scope.is-seen`.
- **Every duration is multiplied by `--motion`**, which the document declares as 1 and as 0 under `prefers-reduced-motion`. A reader who asked for stillness gets the finished drawing and no move at all, with no second media query to keep in step.
- **The figure is legible at every frame.** The boxes are already there and the edges draw in over them; a reveal that starts from nothing is a section that is blank while it plays.
- **The stagger is a custom property.** The script sets `--i` to the edge's index — a custom property is the one thing a script may write onto an element's style — and the stylesheet decides what the delay does with it.
- **A reveal, never a loop.** Motion that decorates is the same ornament as a figure that says nothing.

**And `@media (prefers-reduced-motion: reduce)` still has one job a multiplier cannot do: putting the ink back.** An element whose animation is what makes it opaque is invisible at zero duration unless the stylesheet says otherwise.

---

## One section's script, or a plugin

**The drawing goes in the section's own `<script>`** — handed the same `ctx` a named plugin gets — **when it is genuinely about this one section's content.**

**Write `plugins/<id>.js` the moment a second page might want the same drawing.** A workspace's own plugin file loads: the server reads `plugins/` and hands the page every `.js` in it, so the choice is between a script that belongs to one section and a plugin that belongs to the workspace, and nothing else decides it. [`../plugins/SKILL.md`](../plugins/SKILL.md) is that contract in full, and §3 is the decision.

**A drawing that has to DO something is the same question one step on.** Respond to a click, filter itself, read rows out of a table and redraw when they change, be dragged or zoomed — that is a verb, and a verb belongs in a plugin the moment it is worth having twice. **A large graph that only needs ROOM needs none of that**: give it its own section at whatever width that section chooses, and let the plate scroll sideways inside itself.

**Working alone, this IS the decision — make it and go.** Nothing here waits on a reply. **Where there is somebody to ask and the drawing is about to become a plugin, ask** — a plugin is global to every page in the workspace, which is a commitment worth one question. Recommend and explain; do not present a menu and wait.

---

## A fence can be handed to a plugin

**A fenced block whose info string names a plugin this workspace carries is handed to that plugin** — the markdown plugin looks the name up with `ctx.has` and mounts it with the fence's source. So a vault that writes `plugins/flow.js` gets ```` ```flow ```` blocks drawn by it, with nothing else to wire up, and a vault carrying its own copy of some diagram library's plugin goes on getting that library's fences drawn.

**The framework names no language there, and that is the point.** This vault's `plugins/` folder is the whole of the list: a drawing language is a workspace's own choice rather than one picked for everybody. **A fence naming something the workspace has no plugin for stays an ordinary code block**, which is the correct reading of it.

**The four part kinds can never be handed a fence.** ```` ```html ```` is an ordinary thing to write — somebody documenting their own section markup writes it and means it — so `markdown`, `html`, `table` and `child` are excluded by name and a code sample stays a code sample.

**Reach for this when a diagram LANGUAGE is genuinely what is wanted** — a page full of small graphs whose author would rather type than lay out — and know what it costs: a library's renderer draws in its own idiom, it cannot read a custom property (so its colours have to be mapped from `biom.theme()` rather than taken from tokens), and the picture will not look like the rest of the workspace. **The drawing above is the default and this is the exception.**

---

## Traps

**R30 — nothing sets a raw colour.** Every line takes `--rule`, every label takes `--ink`, so the whole drawing repaints when the palette does. A hex written into a drawing is the one thing on screen that stops matching the morning somebody changes the scheme. **A colour inside a fence in `content.yaml` is the checker's blind spot** — it reads section files, not prose — so nothing will tell you. R30 itself is in [`../design/SKILL.md`](../design/SKILL.md).

**R25 — nothing in the drawing has a width in pixels.** The boxes take the column they are given and the lanes between them are `rem`; the moment a pixel width goes on, the drawing has stopped reflowing.

**`-->` ends an HTML comment.** A section file explaining its own edges in a `<!-- -->` banner and writing an example arrow inside it terminates the comment there, and every line after it draws on the page as stray text. Write `==>` inside a comment.

**A drawing that fails should say so in a slot.** The fault sentence is words, so it is markdown in `content.yaml` behind a `data-g-part` like every other word — R56 does not have an exception for an error message.

---

## Where the rest of it is

| | |
|---|---|
| `base/diagram/` | the starter: the lists, the layout, the reveal, the fault slot. Copy it |
| [`../pages/SKILL.md`](../pages/SKILL.md) | what a page is on disk, the part types, and the numbered rule index |
| [`../sections/SKILL.md`](../sections/SKILL.md) | the section a diagram sits in: slots, R56, `/vendor/`, what the box cannot do |
| [`../plugins/SKILL.md`](../plugins/SKILL.md) | the contract a section's script and a `plugins/<id>.js` share |
| [`../markdown/SKILL.md`](../markdown/SKILL.md) | how the prose around a diagram is sized |
| [`../tables/SKILL.md`](../tables/SKILL.md) | where the facts go when the answer was never a picture |
| [`../design/SKILL.md`](../design/SKILL.md) | the palette a diagram draws in, and R30 |
| [`../../../docs/plugins.md`](../../../docs/plugins.md) | the mechanism under a plugin, and the fence hand-off |
