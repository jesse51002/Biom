# base/

**Starter SECTIONS. Real files, written to be copied and then owned.**

**THEY ARE DELIBERATELY PLAIN, AND THAT IS THE MOST IMPORTANT THING ABOUT THEM.**
Each one carries a MECHANISM and no visual opinion: no card, no accent, no tint,
no second typeface, one hairline where a boundary has to be visible and nothing
anywhere else. They are here to show what the format IS — the shape of a page on
disk, what a section file is, how a slot is filled, what a list slot lets a reader
do — and not to show what a page should look like.

**That is not modesty, it is measured.** An earlier `grid/` was a designed thing:
cards, a coloured top border, an accent that cycled in threes. Three independently
generated pages in the reference workspace came back carrying its class names and
its card border, and nobody chose either — one example had quietly become a house
style. A starter's look is inherited by every page copied from it and then by
every page copied from those, so the only safe amount of look in here is none.

**So: take the shape and design your own section around it.** The document is
already biased toward what these files teach — lists, slots, add and delete —
which is the bias that was wanted. Anything past that is yours.

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
own file where the layout carries meaning**, and these are what that looks like: a slot that holds a list, two slots side by side with one of them held
while the other scrolls, a graph given room to be wide. Start from one rather than
from an empty file, and change everything about how it looks.

## What they answer the same way

Each one is a different layout. They answer four questions identically, and
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

**Every colour is a palette token and every face is a `--*-face` stack.** Nothing
sets a literal, because a literal is invisible to the Theme page and stays wrong
on every palette but the one it was written against. Take a token and mix it —
`color-mix(in srgb, var(--ink) 12%, transparent)` — rather than reaching for a
value. **These files take almost none**: `--ink`, `--ink-3`, `--rule` and the two
faces are close to the whole of it, because a starter that reached for an accent
would be choosing one for every page copied from it.

**A layout that collapses does it with a CONTAINER query**, and the section says
`container-type: inline-size` on itself, because nothing declares that for you. A
media query measures the whole canvas rather than the section, so it collapses at
the wrong moment wherever the section is not the full width of the page.

**Run the checker on a starter and it reports the starter, not your page** —
`bun run .agents/skills/check.ts base/<name>`. Every section starter here is clean, and a
test in the framework runs the real checker over every one of them, so a starter
cannot quietly stop matching the format it is here to teach.
`base/child/` still reports R42, and that is the starter being a starter:
nothing names its `index.html` because you have not copied it into a page yet.

**One of these is not only an example.** `child/index.html` is the file every new
page is created with, copied into it as `child.html`: how that page draws when
another page holds it as a child. Editing the copy here changes what every page
made afterwards starts from, and it is the one directory whose `index.html` is
not a section.
