# What a page's own code can do

A section's HTML file may carry a `<script>`. That script is the workspace's own
drawing code: it reads rows, draws a chart, adds and removes items, drives a
scroll effect.

## The box it runs in

**The whole page is one sandboxed iframe.** It is `sandbox="allow-scripts"` with
no `allow-same-origin`, so its **origin is opaque**: the server is on the other
side of the window and completely unreachable even though it is right there. Every
path to your data goes through a message port the host granted, and the browser
enforces that for free.

**One thing is delegated back in: writing to the clipboard.** `navigator.clipboard
.writeText` works from a page's own script, on a real click, in a focused
document — the frame is handed that one permission so a page carrying a path or a
prompt can offer a Copy that actually copies. Reading the clipboard is not
granted. A write can still be refused, so leave the text selected when it is.

**The box fills the canvas and scrolls inside itself**, so it is its own viewport.
That is a mechanism rather than a simplification, and the scroll toolkit below is
what it buys.

## A section's `<script>`

Three names are bound into its scope:

| | |
|---|---|
| `section` | this section's own element, so a script never has to guess which of five copies on the page it belongs to |
| `ctx` | the context object, below |
| `onTeardown(fn)` | run `fn` before this section is redrawn or removed |

`biom` is a global in the box, so the whole guest API is reachable from the same
scope without being bound into it.

**It is wrapped in a function rather than run at the top level.** Its `var`s and
functions are function-scoped, so two sections that both declare `let i` do not
collide and a top-level `return` is legal. **`await` at the top level is therefore
a syntax error** — anything awaited goes inside an async IIFE:

```html
<div class="board"></div>
<script>
  (async function () {
    const view = await biom.table("readings");
    const board = section.querySelector(".board");
    for (const row of view.rows) {
      const cell = document.createElement("div");
      cell.textContent = String(row.cells.name);
      board.append(cell);
    }
  })();
</script>
```

**It runs after the editor has taken the section's markdown slots over.** That
order is deliberate: a wave arriving after the scripts would replace every node
they had just decorated. So a script can count on the rendered prose being present
from its first line, and on a list slot already holding one element per item.

**`DOMContentLoaded` never fires for a section script.** The runtime clones the
script into a live node at the moment it draws the section, long after the document
was parsed — so the listener is registered, nothing calls it, and everything inside
it is dead code that reads exactly like working code. Do the work at the top level;
`section` is already in the document.

**`data-g-scope="page"` rebinds `section` to the page root** and tells the runtime
to re-run the script after a reorder. Use it for a script that is about the whole
stack — a progress bar, a table of contents, an observer over every section —
rather than about the div it was declared in.

**A `<script type="module">` does not load.** The box has an opaque origin, so a
module script is CORS-gated. The runtime removes it and says so, because silently
running it as a classic script would turn its `import` line into a syntax error
and report that instead of the real cause. A section script with a `src` gets no
bindings — there is nothing to wrap — but can still reach `biom`.

**Anything with a `type` the runtime does not recognise is left exactly where the
section put it**, so a `<script type="application/json">` data island survives.

### Teardown

A script opens an `IntersectionObserver`, a `MutationObserver`, a `setInterval`, a
`biom.onRefresh` subscription. When the section is redrawn or removed **its nodes
go away and the observers do not**: they hold references to detached elements, they
keep firing, and the page gets measurably slower every time somebody edits it.

```js
const io = new IntersectionObserver(onPanel, { root: document });
onTeardown(() => io.disconnect());
```

Register the teardown in the same breath as the thing that needs it. Everything
mounted through `ctx.use` shares the parent's teardown bucket, so a section coming
down takes everything mounted underneath it with it.

## `ctx`

**One shape for a section script and a named plugin alike**, because the two
differ in what they are *given* and not in what they may *do*.

| | |
|---|---|
| `ctx.page` | which page this is |
| `ctx.section` | the section's `name`, or `null` for a page-scoped mount |
| `ctx.part` | the slot id, or `null` for a `data-g-plugin` node and a section script |
| `ctx.plugin` | which plugin is mounting, or `null` inside a section script |
| `ctx.root` | the section's own element — or the page root for a page-scoped mount |
| `ctx.vars` | the three variable scopes already merged, nearest last |
| `ctx.options` | this node's `data-g-*` attributes, camel-cased with the `g` taken off. `data-g-max-rows` reads as `options.maxRows` |
| `ctx.text(s)` | resolve `{{name}}` in a string against this mount's scopes |
| `ctx.read(part)` | the stored markdown of one of **this** section's slots, braces unresolved |
| `ctx.write(part, value)` | replace it, redraw, and save |
| `ctx.call(kind, params)` | one request over the guest port |
| `ctx.has(id)` / `ctx.use(id)` | is a plugin registered, and reach it. See [`plugins.md`](./plugins.md) |
| `ctx.onTeardown(fn)` | run `fn` when this section is redrawn or removed |

`biom.*` wraps the same port with a friendlier surface and is the ordinary way to
ask for data. `ctx.call` is there so the runtime is complete on its own.

### `ctx.read` and `ctx.write` — changing the page's own words

```js
// A SINGLE-VALUE SLOT: a string in, a string out.
const src = ctx.read("standfirst");
ctx.write("standfirst", src + " Revised.");

// A LIST SLOT: an ARRAY in, an ARRAY out. Add, remove and reorder are splices.
const items = ctx.read("cards");
items.push("### Another\n\nSomething worth saying.");
ctx.write("cards", items);
```

**`ctx.read` answers what is on disk** — the raw markdown, `{{name}}` unresolved,
because that is what an edit has to write back. **A list slot answers an array in
item order; a single-value slot answers a string. A slot with nothing in it
answers `""` either way**, so normalise before you push to it.

**`ctx.write` takes back whatever `ctx.read` gave you.** A string replaces the
slot's markdown and redraws that slot immediately, saving on the same debounce a
person typing gets. **An array replaces the whole list and the page redraws
itself** — adding or removing changes how many elements the slot has, so there is
nothing for the section to re-render by hand. It answers `false` and says so in
the console if the part is not one of this section's own.

**It is scoped to this section's own slots, by name, and reaches only the slots
the editor took over** — every part whose plugin declares itself editable, which
in practice is markdown. A read of a table slot, a child slot or an `html` slot
answers the empty string, and so does a read of a name no slot on this section has.

**Nothing here is a new capability.** The person reading the page can already type
any of it. What it removes is the ceiling: a section no longer has to declare its
slots ahead of time to have somewhere to put a new item.

## The `biom.*` calls

Reachable as a global from any section script or plugin. **Every one of them
answers a promise**, so the fragments below belong inside an async IIFE in a real
section — `await` at the top level of a section script is a syntax error.

| | |
|---|---|
| `biom.page` | which page this box is. `null` until the host has answered |
| `biom.input` | this page's own `input:` map, for a page a plugin draws. Present synchronously |
| `biom.data()` / `biom.setData(patch)` | this page's variables, read and merged |
| `biom.variables(pageId)` | **another** page's variables |
| `biom.doc(pageId)` / `biom.docs()` | another page as prose; every page |
| `biom.children(pageId?)` | what a page holds. Below |
| `biom.table(name, query?)` | `{ schema, rows, total }`. See [`tables.md`](./tables.md) |
| `biom.schema(name)` / `biom.tables()` | one table's columns; every table with its row count |
| `biom.insert` / `biom.update` / `biom.remove` | rows |
| `biom.sql(query, params?)` | resolves for real. Prefer the row calls |
| `biom.fetch(url, init?)` | **the only way out.** The host performs the request |
| `biom.theme()` | the palette as raw values, for a canvas or a shader |
| `biom.vault()` | which folder this workspace is. Below |
| `biom.open(target)` | go to a page or a table. Takes what `children()` hands back |
| `biom.embed` / `biom.embedInto` | draw another page inside this one. Below |
| `biom.onRefresh(fn)` | the page's data changed and a drawing built from it should redraw |
| `biom.onTheme(fn)` | the palette changed |

### Asking what a page holds

```js
const kids  = await biom.children();                 // this page's, in its own order
const other = await biom.children("home/team-hub");
```

```js
{ kind: "page",  id: "home/team/notes", name: "Team notes" }
{ kind: "table", id: "jobs",            name: "jobs", rows: 42 }
```

**It is a normalised read** — the name and the kind arrive resolved and a table's
row count is already there, so nothing makes a second call to find out what it is
holding. It reads the filesystem rather than any page's claim about who its parent
is. **There is no `pageKind`**: there is one kind of page.

It is the same data the built-in drawing of children reads, which is why the two
can never disagree.

### Asking which folder this workspace is

```js
const v = await biom.vault();
document.querySelector("#where").textContent = v.path;
```

```js
{ path: "/home/you/Notes", name: "Notes", seeded: true, history: true }
```

`path` is absolute, and it is what somebody types after `cd` to reach the agent
that edits these pages. `name` is the folder's own name, which is what the
workspace shows. `seeded` says the folder already holds a workspace. `history`
says it is keeping versions — false is a workspace with no undo, which is worth
saying out loud where it matters and worth saying nothing about where it does not.

**Read it, never store it.** A page that put the folder in a variable would be
carrying a fact that stops being true the day somebody moves the workspace; this
is read where the page is drawn and cannot go stale.

**It takes no argument, and that is the whole of it.** A page may know where it
lives; it may not look around and it may not move. Walking to another folder,
opening one and making one are the workspace's own screens and no page can ask
for any of them.

**Matching a child to the section that stands for it** goes through the key the
host derives, and **a page's key is its last segment and not its whole id**:

```js
const key = (c) =>
  "@" + c.kind + "-" +
  (c.kind === "page" ? c.id.slice(c.id.lastIndexOf("/") + 1) : c.id);
```

Spelling it with the whole id works for a top-level page and draws blank for every
nested one — see [`pages.md`](./pages.md).

### Drawing another page inside this one

**`biom.embedInto(iframe, pageId)` draws another page, as it is, in an iframe you
supply.** The host hands over that page's document and the ports it needs; the
page draws with its own runtime, is editable where it sits, hears its own
refreshes, and **the sandbox is inherited rather than opened**.

It resolves to a handle. **Call its `close()` in `onTeardown` from a section
script**, because a doc page empties its section stack on every redraw and the
iframe goes with it. The handle also has `onScroll(fn)` and `scrollTo(at)`, both a
fraction of the nested page's run, for keeping two pages level by proportion.
`biom.embed(pageId)` is the raw half for a caller doing the relay itself.

## The scroll toolkit

Because the box fills the canvas and is its own viewport, all of this is native and
none of it needs a line of JavaScript from us:

- `animation-timeline: view()` has a view, and `scroll()` finds a scroller.
- `position: sticky` sticks, and `position: fixed` pins to the canvas.
- `100vh` means the box.
- Text selects continuously from the first section to the last, because it is one
  document.
- `IntersectionObserver` sees the right scroller — with one exception.

**`sticky` only pins within its containing block**, so an element cannot stay
pinned while the page scrolls past a *sibling* section. **The section is therefore
the unit of a coordinated effect**: a pinned sequence with three panels of text
moving past one visual is one section with three panels inside it, not three
sections.

### An IntersectionObserver with no root ignores `rootMargin` in here

Measured in a real browser, inside a real sandboxed frame, against the same page
loaded at the top level as a control. The box has an opaque origin, so an
implicit-root observer counts as cross-origin with the page above it:
`rootBounds` comes back `null` and **the margin is never applied, in either
direction.**

| | `rootBounds` | is `rootMargin` applied? |
|---|---|---|
| implicit root — `new IntersectionObserver(fn, { rootMargin })` | `null` | **no** |
| `{ root: document, rootMargin }` | the real box | **yes** — identical to the top-level control |
| `{ root: someElement, rootMargin }` | a zero box | no, and nothing ever intersects |

So the usual scrollytelling idiom — `rootMargin: "-45% 0px -45% 0px"` to fire when
a panel crosses the middle — fires on first contact with no root named, and the
figure runs a whole panel ahead of the words.

```js
const io = new IntersectionObserver(onPanel, {
  root: document,                          // NOT null, and not an element
  rootMargin: "-45% 0px -45% 0px",
});
onTeardown(() => io.disconnect());
```

The route that depends on nothing is choosing by `intersectionRatio` from the
entries you are given, which needs no margin and no root at all.

## What the box cannot do

Each of these is a consequence of the opaque origin rather than a policy.

| | |
|---|---|
| **Storage** | `localStorage`, `sessionStorage`, `indexedDB`, `document.cookie` and `caches` all **throw**. An opaque origin has no storage. State that must survive a reload is a variable, a row in a table, or markdown in a slot |
| **The network** | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` reach nothing. `biom.fetch` is the only way out, and the host performs the request |
| **Reaching past the shim** | `window.parent`, `window.top`, `window.opener`, a raw `postMessage`, `document.referrer`. The port is the one contract the page has |
| **External CSS or modules** | no external stylesheet, no `@import`, no module `<script src>`, no dynamic `import()` of a URL. Host CSS does not cross the boundary either — the palette does, as data ([`styling.md`](./styling.md)) |
| **Measuring the canvas** | `innerWidth`, `screen.width` and `matchMedia` are refused. The frame is whatever width the page gave it, and that changes when a panel opens or the window resizes. A CSS viewport unit is *not* measuring — `100vh` is resolved by the browser against the box on every frame |
| **Navigating away** | no popups and no top-level navigation, so an anchor to the outside either does nothing or replaces the page with no way back. Moving somewhere inside the workspace is `biom.open` |

### One classic script from `/vendor/`, and nothing else

```html
<script src="/vendor/three.min.js"></script>     <!-- window.THREE,   706KB -->
```

**Nothing the framework ships loads one.** A page draws with the platform — HTML,
CSS and the section's own script — and a library is this workspace's own choice,
taken where a page genuinely needs one and never at page load.

**A classic `<script src>` loads at an opaque origin and a module one does not** —
measured, not assumed — which is why what is vendored is the IIFE build and why
`import()` of a `/vendor/` URL fails for the same reason a module tag does. From a
section's own realm `location.origin` is `"null"`, `fetch("/vendor/three.min.js")`
is refused, the classic tag loads, and a `WebGLRenderer` puts real pixels on a
canvas.

**It is the host handing you something**, exactly as it hands you the shim. A
subresource served at a route the host chose cannot carry your data anywhere and
cannot be pointed at anything else, which is why it is neither a hole in the
network rule nor an exception to the module one. **No other URL is reachable, from
any tag, ever.**

**Load it only when you need it**, and park the promise on `window` under a
prefixed name of your own so two sections on one page load it once between them. A
section script is function-wrapped, so `window` is the only surface two of them
share.

### Reduced motion is read, not asked for

`matchMedia` is refused, so the media query lives in your stylesheet and hands its
answer to the loop through a custom property:

```css
.stage { --motion: 1; }
@media (prefers-reduced-motion: reduce) { .stage { --motion: 0; } }
```
```js
var moving = getComputedStyle(stage).getPropertyValue("--motion").trim() !== "0";
```

Read it inside the frame rather than once at mount, and the answer follows a
reader who changes the setting while the page is open. The document already
declares `--motion` for every doc page, so most sections need only the second line.

### Pictures

**A picture is named by its file and nothing else** —
`<img src="kitchen.jpg" alt="The finished kitchen">`. The host gives every frame a
`<base>` pointing at the workspace's `assets/`, so a bare filename resolves to this
workspace's copy and the same filename works in prose. **A leading slash is not a
shortcut**: `/kitchen.jpg` resolves against the app's own address, finds nothing,
and says nothing about why.

## What a failure looks like

**A plugin that throws fails inside its own node**, marked `data-g-failed` with the
message where the trouble is. One slot the page could not draw is a bad slot; a
plugin allowed to escape would stop the section — and every section under it —
from drawing at all.

**A section script that throws takes the rest of that script's top level with it**
and nothing else. The page draws; the behaviour is absent.

**A page that draws into a blank rectangle has reported "the product is broken"
when what happened was one refused call.** So: draw the words first and add the
drawing when the data is there, and when a call is refused, say so in the page's
own words. The sentence belongs in a part like every other word, hidden by default
and revealed by the script:

```html
<p class="fault" data-g-part="fault"></p>
```
```css
.fault { display: none; }
:scope.is-fault .fault { display: block; }
:scope.is-fault .chart { display: none; }
```

Errors the box reports reach the browser console prefixed `[biom]`.

---

**What a section's code owes its reader** — the add, the delete and the reorder,
where controls go, and the numbered rules a section file is checked against — is
[`../.agents/skills/sections/SKILL.md`](../.agents/skills/sections/SKILL.md).
**When to write code at all rather than reach for a plugin already in the folder**
is [`../.agents/skills/plugins/SKILL.md`](../.agents/skills/plugins/SKILL.md).
