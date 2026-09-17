# base/

**Starter SECTIONS. Real files, written to be copied and then owned.**

**THEY ARE EXAMPLES OF THE RULE AS WELL AS OF THE MECHANISM, AND THAT IS THE MOST
IMPORTANT THING ABOUT THEM.** The rule is at the top of this workspace's
`AGENTS.md`: *we are not a plain markdown framework, for a reason* — a page is
DRAWN, a figure is HTML that moves when it arrives, and its words come out of the
document. So each starter here draws something: a real instrument beside the
prose, a run that arrives, a diagram whose stations carry marks drawn in CSS, a
list whose rows light under the pointer. One hot colour, spent once, on the one
thing worth looking at.

**That is a correction, and it is worth knowing which way it went.** These files
used to open by saying they were deliberately plain — one hairline in one ink, no
accent, nothing drawn — on the argument that a starter's look is inherited by
every page copied from it. The argument was right about inheritance and wrong
about what was being inherited: what a page copied from a plain example inherits
is PLAINNESS, and a workspace full of pages that could have been markdown files in
a folder is the exact failure the format exists to prevent. An example has to look
like the thing the rule asks for.

**The earlier worry has not gone away, so it is answered differently.** A `grid/`
starter here was once a designed thing — cards, a coloured top border, an accent
cycling in threes — and three independently generated pages in the reference
workspace came back carrying its class names and its card border, chosen by
nobody. The answer is not to draw nothing. It is that **every starter says, in its
own header, which half is the MECHANISM and which half is a DESIGN** — the
mechanism is what to keep when you copy, the design is yours the moment the file
is yours, and `design/` is whose taste decides it. Read that header before you
copy the file.

**So: take the mechanism, keep the register, design your own section.** What
should survive a copy is that the words are in the document, that a repeating
thing is one slot holding a list, that the drawing reads its values out of
`variables`, that motion is one reveal behind `--motion`, and that nothing spells
a colour. What should not survive is the plate, the mark, the medallion and the
tick — those are four decisions this loop happened to need.

**One directory each, in the shape a page has** — a `content.yaml` and an
`index.html` — so a starter and a page are the same kind of thing read two ways.
List this directory to see what is here; nothing keeps a summary of it, because a
list written down somewhere else is a list that goes wrong the first time
somebody adds a starter.

**There are two ways to take one, and they end in the same place.**

Copy the whole directory into a page's place in the tree —
`pages/<parent>/children/<name>/` — and it is a working page immediately: the
`content.yaml` already names `index.html` in a section's `data:`, so it draws as
it stands and you edit it from there.

Or copy just the `index.html` beside a page's own `content.yaml`, give it a name
that says what it is (`hero.html`, `figure.html`), and paste the section entry
from the starter's `content.yaml` into that page's `contents` with `data:`
changed to match. That is the usual way, because most pages want one starter's
layout rather than a whole page of it.

**A copy is yours.** Nothing links back, nothing updates it, and editing it is
editing your workspace. `base/` is the original and is never what runs.

**Why these exist at all.** The default section — a `parts:` with no `data:` — is
one centred slot, and it is there so a person pressing `+` has somewhere to type.
A doc is mostly made of them, and nothing warns about that. **Give a section its
own file where the layout carries meaning**, and these are what that looks like: a
slot that holds a list, two slots side by side with one of them held while the
other scrolls, a graph given room to be wide. Start from one rather than from an
empty file.

## What they answer the same way

Each one is a different layout. They answer five questions identically, and
**those answers are the part to keep when you copy** — a starter's pattern
spreads to every page copied from that page, so a change here is a change to
pages nobody has written yet.

**Every word a reader reads is in `content.yaml`, behind a slot.** The html files
carry layout, rules, bands and decoration, and not a sentence. Read one and the
only text in it is in comments and in `<style>`.

**No section declares one slot per item.** A repeating structure — columns,
cards, rows, steps — is ONE slot holding a LIST. The runtime draws one element
per item into it, in order; the section lays those elements out with its own CSS
and draws its own add and delete for them — always present, quiet until the
pointer or the keyboard reaches the item they belong to, because there is no edit
mode to put them behind. **Moving one is yours too** — nothing is drawn over your
page, so there is no grip and no drag, and a move is the same splice of the array
that an add is. `list/` is the worked
example: a fourth item is a fourth entry in the list — written in `content.yaml`,
or added by the button the section draws — and never an edit to the markup.
**A section that named a slot per item could hold that many forever, at a number
nobody chose.** If you copy a starter and give it slots called `one`,
`two` and `three`, you have put the ceiling back.

**A FIGURE'S VALUES ARE `variables`, AS PARALLEL LISTS — never a list slot.** A
slot holds markdown, so reading a figure back out of one is parsing; and a reader
can DRAG a list item, which would put bar 3 under label 2 with nothing on screen
to say so. `figure/`, `reveal/` and `diagram/` all read their drawings out of
parallel lists sharing a stem, one entry each per thing drawn. What it costs is
the `+` — variables are edited on the page's own config screen rather than on the
page — so each of those says so, on the page, in a slot.

**A FIGURE ARRIVES ONCE AND THEN RESTS.** `<span data-g-plugin="reveal">` puts one
class on the section the first time it comes into view and disconnects its
observer; everything under that class is the section's own `<style>`. Every
duration is multiplied by `--motion`, which the document declares as 1 and as 0
under `prefers-reduced-motion` — and each file still carries the one thing a
multiplier cannot do, which is putting the ink back, so **stillness gets the
FINISHED drawing rather than an empty one.** The unfinished state is the
element's, the finished state hangs off `is-seen`, and that ordering is what makes
an item added after the reveal has fired arrive finished rather than invisible.

**Every colour is a palette token and every face is a `--*-face` stack.** Nothing
sets a literal, because a literal is invisible to the Theme page and stays wrong
on every palette but the one it was written against. Take a token and mix it —
`color-mix(in srgb, var(--cyan) 12%, transparent)` — rather than reaching for a
value. **The hot colour is a ROLE and not a hue**: `--cyan` is whatever this
workspace fills and lights things with, so a drawing that lights one bar repaints
itself the morning somebody changes the scheme.

**A layout that collapses does it with a CONTAINER query**, and the section says
`container-type: inline-size` on itself, because nothing declares that for you. A
media query measures the whole canvas rather than the section, so it collapses at
the wrong moment wherever the section is not the full width of the page.

**Run the checker on a starter and it reports the starter, not your page** —
`bun run .agents/skills/check.ts base/<name>`. Every section starter here is clean, and a
test in the framework runs the real checker over every one of them, so a starter
cannot quietly stop matching the format it is here to teach. `base/child/` is
clean too: nothing in its document names its `index.html`, and R42 exempts that
name because a file called `index.html` IS the page rather than something a
document has to point at.

**One of these is not only an example.** `child/index.html` is the file every new
page is created with, copied into it as `child.html`: how that page draws when
another page holds it as a child. Editing the copy here changes what every page
made afterwards starts from, which is why it carries ONE touch — an edge that
lights when the row is reached — rather than a look. It is also the one directory
whose `index.html` is not a section.
