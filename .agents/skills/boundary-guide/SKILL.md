---
name: boundary-guide
description: >-
  The single source of truth for the ARTIFACT BOUNDARY in this repository — the
  sandboxed box a page is drawn in, the handshake that opens it, and the two
  ports that are the whole of the authorisation. Covers the
  `sandbox="allow-scripts"` frame with no `allow-same-origin` and the opaque
  origin that follows from it, one box per page and why it never reports a
  height, the split handshake (`hello` over `window.postMessage`, `ready` over
  the privileged port) and the top-level-`await` deadlock it exists to prevent,
  the two transferred ports and why the order IS the protocol, the three rings
  `HostRequest` ⊂ `RuntimeRequest` ⊂ `ApiRequest` and the guards that narrow
  each, the in-flight cap per ring, the flattening of failure onto the closed
  error enumeration, frame keying and reuse, and the honest limit — that inside
  the box the runtime/section split is a CLOSURE and not a browser guarantee.
  Load this whenever you touch `client/frame/frame.js`,
  `client/bridge/bridge.js`, `guest/biom.js`, `contracts/guards.js` or the
  request unions in `contracts/types.ts`. Trigger on "opaque origin",
  "allow-same-origin", "sandbox", "srcdoc", "hello", "ports", "ready",
  "window.__g", "MessagePort", "transfer list", "isHostRequest",
  "isRuntimeRequest", "HostRequest", "RuntimeRequest", "ApiRequest",
  "GuestNotice", "HostEvent", "chokepoint", "the box cannot fetch",
  "self-reported", "childKey", "adding a wire kind", or any change to the
  host-to-artifact contract.
---

# The artifact boundary — one box, two ports, three rings

This is the deep design rationale for **part of the framework's public surface,
expected to outlive any given implementation**. `AGENTS.md` says the
rest of the framework is still expected to change freely, but not
`client/bridge/bridge.js` and `guest/biom.js`, because the Architecture page
calls the host-to-artifact contract *"expensive to change once artifacts exist in
the wild."* This skill is the prose behind that contract: the mechanisms, the
measured facts, and the failure each mechanism exists to prevent.

It owns the boundary. It does **not** own:

- **What the runtime does once it is inside the box** — drawing sections,
  `@scope`, slots, teardown, the always-on edit wave → `section-runtime-guide`.
- **How a plugin is registered and composed** → `plugin-guide`.
- **What a page is on disk and how it is resolved** → `page-format-guide`.
- **The product invariants and the decisions behind them** → the workspace's
  `Architecture/Foundations/Architecture` page, which is authoritative where the
  two disagree.

---

## 1. The boundary is one attribute, and the browser does the enforcing

`client/frame/frame.js` creates the iframe with `sandbox="allow-scripts"` and
**no `allow-same-origin`**. That single omission is the whole boundary: the frame
gets an **opaque origin**, so from inside it `fetch` is blocked, cookies are
gone, `localStorage` throws, and the host document's DOM is unreachable — even
though the server is right there on localhost. **Every path to workspace data is
forced through a port, and no code in this repository enforces that.** The
browser does, for free.

**One permission is delegated back over it, and it is the clipboard's writing
half.** The frame also carries `allow="clipboard-write"`. Permissions policy
reads an opaque origin as a cross-origin child, so `navigator.clipboard
.writeText` inside the box is *blocked because of a permissions policy applied
to the current document* unless the container says otherwise — measured both
ways, with the argument beside the attribute. `clipboard-read` is deliberately
absent: reading the clipboard is taking something nobody offered, and no page
needs it. The browser still wants a real gesture and a focused document before a
write, so what is delegated is an act a person has to make. **This is not a hole
in the boundary**: the clipboard is not workspace data, nothing comes back, and
the alternative was a `clipboard.write` wire kind — a `contracts/` edit for
something an iframe attribute already does.

Two consequences are load-bearing and neither is negotiable.

**The host can never read what is inside the box.** There is nothing to scrape
and no way to scrape it. The section count is **self-reported** by the runtime as
a `ready` notice. When the host needs a new fact about a page, that is a new
`GuestNotice` — not a query, not a `contentDocument` read, not a hidden
same-origin escape hatch. Reaching into the frame is not merely discouraged here;
it is impossible, and code written as though it were possible fails silently.

**A classic `<script src>` still loads, and a module script does not.** Loading a
subresource is a different mechanism from a same-origin data read, so the box can
**RUN** host-served code from `/guest/`, `/vendor/` and the vault's own
`/plugin/` without being able to **READ** anything back — and the chokepoint,
which is about data, still holds. This is measured, not assumed:
`vendor/README.md` records the headless-Chrome run, and the negative control in
the same frame — a module `<script src>` at `markdown-it.mjs` — failed with
*blocked by CORS policy: … from origin 'null'*. It was re-verified during this
rewrite, which is why `markdown-it` is vendored twice and why `mermaid.min.js` is
the IIFE build.

**One host refuses the load altogether, and it is not a browser anyone ships
to.** The Claude Code in-app Browser pane (Electron) rejects every request an
opaque-origin frame makes — script, image and fetch alike, measured 2026-09-04
with an unsandboxed frame on the same page loading the same URLs — so in that
pane the runtime never arrives and the box reports nothing. Real Chrome and
Playwright's Chromium load it; `AGENTS.md` says how a page is looked
at from a session.

**The one exception to "everything arrives over the port" is code.** Section
markup does **not** load over a `src` — it arrives inline in the `page.read`
answer, because loading it would be a fetch and a fetch is exactly what the frame
cannot do.

---

## 2. One box per page, and it never reports a height

There is no box per block and no self-sizing mode. One iframe takes the whole
canvas, scrolls inside itself, and **never posts its height**. `GuestNotice` has
no `size`, `guest/biom.js` has no `measure()` and no `ResizeObserver`, and
`frame.js` has no height to apply.

**That is a mechanism, not a simplification.** If the box sized itself to its
content and the HOST page scrolled, the scroll container would be **outside** the
box, and every one of these would break at once:

| what breaks | why |
| --- | --- |
| `animation-timeline: scroll()` | no scroller inside the box to find |
| `animation-timeline: view()` | no view to be in |
| `position: sticky` | nothing to stick against |
| `100vh` | means the host viewport, not the page |
| `position: fixed` | pins to the wrong thing |
| `IntersectionObserver` with a null root | gets the wrong root |

**Filling is what makes the box its own viewport, and being its own viewport is
the entire reason a section can drive a scroll effect at all.** Every one of
those capabilities is then native and costs the runtime not one line of
JavaScript — which is exactly why `guest/runtime/effects.js` implements no
effects. Do not put a height notice back; do not add `scrolling="no"`, whose
absence is equally load-bearing (suppressing the scrollbar would clip the content
at the fold and take the scroller with it).

---

## 3. The handshake is in two halves, and the split prevents a deadlock

**Half one — `hello`.** The shim posts `{ kind: "hello", g: PROTOCOL }` to
`window.parent` the instant it runs, over `window.postMessage`, because it has no
port yet. It is inlined by `weave()` ahead of everything else in the box, so this
happens before the runtime, before any plugin and before any section script. Its
only job is to buy the ports.

**Half two — `ready`.** The runtime posts `{ kind: "ready", g, sections: N }`
over the **privileged** port once it has actually drawn. Zero is a real answer
and means an empty page, not a failure. `frame.js` records it only when it
arrives on the runtime port; a `ready` on the guest port is a section claiming to
be the runtime, and is ignored.

**It must never be collapsed into one, and the reason is a deadlock.** A
`<script type="module">` is deferred, and `DOMContentLoaded` fires only after
deferred scripts finish. A handshake that waited for a drawn DOM before granting
the port would therefore be waiting on the very script that is waiting on the
port: a page whose module script opens with `await biom.data()` would stall
until `CALL_TIMEOUT` and then render nothing, with no error a person could act
on. **Writing a module script with a top-level `await` is an entirely ordinary
thing to do**, so the contract accommodates it rather than forbidding it.

**A redraw keeps the reader's place, and `ready` is when it is put back.** The
box scrolls inside itself and the host cannot read where to, so the shim of a
box of its own reports it — `{ kind: "position", g, top }` on the ordinary port,
pixels from the top, coalesced to one per frame — and the mount keeps the
latest. The shell says `frameHost.keep(key)` just before a redraw (the Reload
button, or the watcher pressing it), which copies that position aside; the
next realm's `ready` on the runtime port is the one moment the host knows it
has drawn, so that is when it goes back as `{ kind: "place", top }`, once, and
is cleared. The box clamps it to ITS run — a page that got shorter lands at its
foot, not past it — and applies it instantly, one frame on and once more after
a bounded settle, never on a loop, with scroll anchoring off for exactly that
window (measured: the fonts land between the two and the browser otherwise
moves the box to keep the visible anchor still — 52 px, every time). Said by nothing but a redraw: the mount
outlives its realm either way, so without `keep` a page come back to from the
rail would land where the reader last left it, and it does not. A `position` is
recorded and never dispatched to the shell, so a scroll never repaints the
strip; it is still not a height, and `GuestNotice` still has no `size`.

A `hello` from a box that already holds ports **revokes them and takes new
ones**. That is not politeness: assigning `srcdoc` while the previous realm is
still loading means the old realm's `hello` can arrive *after* the rebuild, take
the ports, and die with them — leaving the realm the user is looking at with no
channel and no way to ask for one. Possession is the grant, so re-granting is
`close()` plus two fresh channels, and a box that spams `hello` can only starve
itself.

The reply is posted with `"*"`, and that must not be "fixed" later: **a sandboxed
frame has no origin to target.** Identity is object identity against a frame this
host created (`el.contentWindow === ev.source`), checked before the reply is
built.

---

## 4. Two ports, and the ORDER is the protocol

`hello` is answered with `{ kind: "ports", g, page }` and a transfer list —
**privileged first, ordinary second**. The bootstrap reads `ev.ports[0]` as the
runtime port and `ev.ports[1]` as the guest port, and **there is no field naming
them, because a transfer list is positional and a name beside it could only ever
contradict the position.**

- The **privileged** port speaks `RuntimeRequest`. `guest/runtime/boot.js` takes
  it into a closure and never hands it on.
- The **ordinary** port speaks `HostRequest`. `guest/biom.js` keeps this one
  and wraps it as `biom.*`; it is what every section and every plugin gets.

**Which port a message arrived on is the whole of the authorisation.**
`frame.fromGuest` does not inspect the message to decide what it may be — it
hands it to `bridge.runtime` or `bridge.resolve` according to the port, and that
entry narrows with its own guard. A branch there that read `msg.kind` and decided
would be a second copy of the judgement, and two copies of a judgement are two
things to get out of step.

**Both ports hear every `HostEvent`.** `edit`, `theme`, `refresh` and `place` go to both.
A host event is an announcement, not a capability: **the asymmetry is entirely in
what may be SENT.** Inventing a second asymmetry in what may be HEARD would only
give one side a stale picture.

**Which page a box is on travels WITH the ports**, in the same `ports` message,
rather than as an event of its own — because the bootstrap publishes both
together as `window.__g` and the runtime reads that object once. A separate event
carrying the same fact a moment later would be a second statement of it, and the
two could disagree.

---

## 5. The three rings, and the guard at each door

`HostRequest` ⊂ `RuntimeRequest` ⊂ `ApiRequest`, all three in
`contracts/types.ts`.

| ring | who may say it | narrowed by | entry point |
| --- | --- | --- | --- |
| `HostRequest` | a section, a plugin, anything the shim wraps | `isHostRequest` | `bridge.resolve` |
| `RuntimeRequest` | the section runtime, on the privileged port | `isRuntimeRequest` | `bridge.runtime` |
| `ApiRequest` | the workspace UI, over HTTP | the server's own route | `server/api/routes.ts` |

**Each entry is a type narrowing, not a permission check.** There is no
allow-list to keep in sync with a second place and no branch that can be got
wrong. *A section cannot ask to reorder a page for the same reason it cannot ask
in French.* The middle ring exists because the runtime must read the page and
write its shape back, and a section must never be able to: a generated page that
could call `section.order` could restructure the workspace it was asked to
decorate. The outer ring holds what neither may express — a page created or
destroyed, a schema altered, another folder opened.

**Which ring a kind goes in is decided by what it can REACH, not by what it is
about,** and `vault.info` is the case that settles it. *Which folder is this*
reads like workspace-level state and sat in the outer ring for exactly that
reason; it is inner-ring now, because **a person reading a page has to be able to
point an agent at it** — everything in a workspace is edited by an agent opened
in a directory, and a page that wanted to say where to start had to send the
reader to a host screen or carry a path somebody typed into a variable, which is
a fact that stops being true the day the folder moves. **What makes it safe is
that the kind takes no argument**: the vault is an address rather than a message,
so it asks about the folder the request was already addressed to and there is no
field with which to name another. A page may know where it lives; it may not look
around and it may not move. `vault.browse`, `vault.open`, `vault.create` and
`vault.recent` each NAME a folder that is not this one and stay outer-ring. The
wrapper is `biom.vault()`, and the bridge answers it out of the store the
workspace's own screens read — so a page and the panel beside it cannot disagree
about where the workspace is. It was the third contracts edit; `AGENTS.md`
keeps the record.

**The framework grants unrestricted data access.** `table.get`, `row.insert`, `sql`
and `fetch` all resolve for real, against any table, with no scoping. The inner
ring stays a separate type anyway, so that narrowing it later is one edit in
`bridge.js` rather than a rewrite of every page that exists.

**Except in a production build, where `sql` and `fetch` are refused at the
server.** The kinds still exist and the guards still admit them — a type narrowed
by environment would be a type that means two different things — so this is a
field on `Deps` in `server/api/routes.ts` and a `case` arm each, not a
`contracts/` change. It is refused there rather than left off a menu because any
page in the workspace can say either without touching a control anybody could
hide. The refusal spends `unsupported`, which joined `HostErrorCode` at a barrier and
means exactly *this build does not offer that*: not retryable, not the caller's
fault, and not a claim that the kind is unknown. The sentence is what a page
author reads and says so plainly. See the environment section of `AGENTS.md`.

Beyond narrowing, `bridge.js` does exactly this and nothing else: **scopes by
context** (one box is one page, so `BridgeContext` is one field), **caps in
flight per ring** (a `MessagePort` has no backpressure, so the first page with a
loop would otherwise take the host down — and the two rings are counted
separately so a section spinning on the guest port cannot starve the runtime out
of its ability to draw), **routes** (writes go through the store so the grid the
user is looking at updates; reads the store does not cache pass straight through
and keep the server's real error code), and **flattens failure** onto the closed
`HostErrorCode` enumeration. A code thrown by a lower layer is believed only when
it is one of ours; anything else becomes `internal`. **`message` is a leak
channel** and never carries a path, a query or a caught error's own text — the
detail goes to the console, where the person running the framework can see it and
the page cannot.

---

## 6. Say what the in-box split is, and what it is NOT

> **Inside the box, the runtime/section split is a CLOSURE, NOT A BROWSER
> GUARANTEE.** Section code shares a realm and a global object with the runtime
> and could reach into it. `window.__g` is deleted by the runtime the moment it
> is read, but a script that runs between the assignment and the delete could see
> it, and after the delete a section still shares a realm with the code holding
> the privileged port.
>
> **The enforced wall is between THE BOX AND THE APP** — no fetch, no cookies, no
> host DOM, and nothing out of there but the two ports the host handed in. That
> is the boundary protecting the files, the server and every other page.
>
> **Nothing in this repository may describe the in-box split as a security
> boundary.** It is written down in `frame.js`, in `bridge.js`, in
> `biom.js`, in `boot.js` and in `types.ts`, and it must stay written down
> in every one of them.

What the split *is* is a **reasonableness** property: it makes it impossible to
write a section that accidentally restructures its own page, and it keeps the
privileged surface in one closure rather than scattered.

---

## 7. `guest/biom.js` imports nothing, and typechecks clean no matter how wrong it is

The shim is delivered as one self-contained script into a frame with an opaque
origin, so **it could not have a dependency even if one were wanted**. The wire
constants at the top are duplicated from `contracts/wire.js` deliberately; that
is the one duplication in the framework, it is why `wire.js` is tiny, and the two
must be kept in step by a reader.

**This is worth stating plainly because the file looks checked.** `tsc` does read
it and will catch a syntax error or an implicit `any` — but because it imports
nothing, there is no `HostEvent`, no `GuestNotice` and no `Child` bound to
anything in it. **Every message name and every field name in that file is a
hand-copy of `contracts/types.ts` that only a reader can keep true, and a wrong
one compiles perfectly and simply never fires.**

**This has already cost a real bug.** The `open`/`children` documentation in the
shim carries the key a page must derive to match a child to the section standing
for it. It read `"@" + c.kind + "-" + c.id`, and it had **never once worked for a
page**: a page id is a PATH — `home/team/notes` — so it built
`@page-home/team/notes` while the host had written `@page-notes`, the match failed
silently, and every nested page's child row drew blank. `childKey` in
`contracts/types.ts` is the one true spelling — `@<kind>-` plus `segmentOf(id)`
for a page and the whole name for a table — and the shim carries a hand-copy of
it. **Nothing caught this. It was found by reading the file.** Treat every
hand-copied name in `biom.js` as unverified until you have compared it
against `contracts/types.ts` yourself.

The shim also does more than wrap `postMessage`, and each part of that is there
for a named reason: it **queues calls made before the port arrives** (so an
artifact whose top-level body calls `biom.data()` works, rather than every
generated page having to open with `await biom.ready`); it **re-declares the
palette on `:root`**, because custom properties do not cross a document boundary
and `var(--ink)` is otherwise undefined in there (the FONTS behind a role's stack
do not cross either — a stylesheet is not the opaque origin's — so
`client/theme/faces.js` writes every shipped `@font-face` a second time, `weave`
puts it in the box's head with absolute `/fonts/` urls, and the server answers
that route with `access-control-allow-origin: *`, the one CORS header the
framework sends, scoped to woff2); and it **hydrates `data-g-part`
text leaves from the page's variables**, unless the runtime has claimed the slots
with `biom.claimSlots()` — which on a real page it has, at load. See
`section-runtime-guide`.

---

## 8. Frames are keyed and reused; an answer is bound to the port it was asked on

`for(key, html, ctx)` hands back the **same element** when the html has not
changed. Without that, an artifact writing its own document emits from the store,
redraws the view and destroys the box the user is typing in — the difference
between a working demo and one that flickers on every keystroke. Only a changed
html, `drop` and a page reload tear one down. Assigning `srcdoc` navigates the
frame, which is the only reload there is: the shim runs again, says hello again,
and is given a fresh pair.

**An in-flight call is bound to the port it was made on**, and an answer whose
port is no longer the current one is **dropped rather than delivered**. A realm
can be replaced while its own question is still being answered, and correlation
ids restart with it because the id space belongs to the guest. Posting to
whatever the mount holds when the promise settles would not merely deliver a
stale answer — it could **resolve a different pending call in the new realm**,
handing a page the answer to a question it never asked. Dropping is the whole
remedy and it is safe: the realm that asked is gone, so nobody is left who wanted
this.

The guest port is **shared** — the shim sets `onmessage` on it and the runtime's
correlator listens on it as well — which is why both mint ids under distinct
prefixes and why the runtime uses `addEventListener` rather than assigning
`onmessage`. See `section-runtime-guide`.

**`refresh` is deliberately not a broadcast and not sticky.** A box is told only
about a change that can reach it: one to the page it is mounted on, or one to any
table (because two pages are routinely two views of the same table and a box
cannot say which tables it reads). It is not sticky because it describes a moment
rather than a state — replaying it to a box that mounts later would tell it to
re-read data it has just this second read for the first time. `theme` **is**
sticky, so a page mounted after the palette changed comes up in the new palette.
`edit` was the other sticky one and is gone: there is no edit mode, so there is
no state to replay.

---

## 9. A box may draw another page inside itself — embedded sessions

`page.embed { page }` on the guest port asks for another page, drawn. The
bridge answers what the page VIEW would have built for it — `page.read`, then
`weaveRuntime` from `client/platform/document.js` — and knows nothing about
ports. `frame.js` reads that answer on its way out, mints a **session** for the
target page (two channels wired to `fromGuest` exactly like a mount's, with the
target page as context), weaves the shim and `<base>` in, and posts the answer
**with the two far ends in its transfer list, privileged first, ordinary
second**. The box puts `html` in a nested iframe's `srcdoc` and relays the
handshake: the nested shim says `hello` to ITS parent, which is the box and not
this window, so the box matches that hello by identity against the iframe's
window and answers it with the ports it was handed. `biom.embedInto(iframe,
page)` is that relay, written once in the shim.

**Three things make this the same boundary and not a hole in it.**

- **The nested frame inherits the sandbox**, so it is exactly as opaque as the
  box: classic scripts load, modules and `fetch` do not. Measured 2026-09-11,
  two sandboxes deep, the Docs page drawing in full with its fonts and its
  vault palette.
- **What the box is handed is two ports minted for ONE page**, which is all a
  box of its own ever holds. Everything the nested runtime says goes down them
  with the target page as context and is narrowed by the same guards.
- **The ports ride the ANSWER, not a window message.** One message, correlated
  by id, bound to the port it was asked on (§8) — a grant delivered over
  `window` would need a token and a second listener racing the shim's own.

**One more thing travels over `window` between the box and its nested frame, and it is not data.** The `ports` message a box relays carries `embedded: true`, and a realm told that reports its scroll position to `window.parent` as `{ kind: "scrolled", at }` — a fraction of its run — and takes `{ kind: "scroll", at }` back from it. Neither reaches the host: a top-level box's parent is the host and it is never told it is embedded, so it never says either. The host's own `hello` listener would ignore them anyway, because neither is a `GuestNotice`. **They are not the redraw's pair** (§3): a box of its own says `position` in pixels over the PORT and takes `place` back, and a nested realm says neither — its embedder holds it level in fractions over `window`, and an embedded session is minted afresh on every grant, so there is no mount for it to keep a place on.

A session **dies with its parent**: `shut` closes a realm's embeds before its
own ports, so a re-hello, a changed document and `drop` all take the nested
pages with them. `unembed { embed }` is a `GuestNotice` that closes one sooner,
by the token the grant carried and only from the realm that holds it. Depth is
capped at `MAX_EMBED_DEPTH` and count at `MAX_EMBEDS` per realm, answered as
`limit` before the bridge is asked — a page that embeds itself stops rather
than recursing. An embedded realm's `ready` stays with its session and never
reaches the shell, which repaints the strip on that notice and shows the box's
own count; its `error` notices still surface, prefixed with the page.

---

## 10. Adding a capability touches the union, the switch AND the guard

A kind added to a union and to the bridge's switch but **not** to the guard set
in `contracts/guards.js` is refused before the case can run, and **the only
symptom is a request that never resolves**. That has happened more than once:
`children` did it, `open` was caught by the typechecker, and `variables` was
caught by an agent reading the file. So:

1. the union in `contracts/types.ts` (`HostRequest`, or `RuntimeRequest`, or
   `ApiRequest`),
2. the `case` in `client/bridge/bridge.js` — and, for the outer ring,
   `server/api/routes.ts`,
3. **the kind set in `contracts/guards.js`**, plus its payload check in
   `wellFormed` — and `isGuestNotice` for a notice kind, which is the same
   trap facing the other way.

Then, if a section should be able to say it, the wrapper in `guest/biom.js`
— remembering §7: nothing checks that the field names there are right.

**`contracts/` is frozen and changes only at a barrier**, never while parallel
work is in flight. If a type is wrong, stop and say so rather than widening it
locally.

---

## 11. Gotchas

- **A `</script>` inside the shim would end the tag it is inlined in.**
  `setShim` escapes it. The shim is host code and contains none, which is why
  this is one line rather than a build step.
- **A `srcdoc` document inherits its parent's base URL**, which here is the app's
  own address. Without the `<base>` that `weave()` writes, `<img src="kitchen.jpg">`
  asks the server for `/kitchen.jpg` and misses the workspace entirely. An
  absolute path resolves against the base's ORIGIN, so `/vendor/…` is
  undisturbed. Measured in a browser, because this is url resolution inside an
  opaque origin and neither half of that is worth guessing at.
- **The `<base>` goes BEFORE the shim.** A base declared after a script has
  already resolved a url is a base that arrived too late.
- **A malformed document is rendered rather than refused.** A blank rectangle
  during a session reads as "the product is broken".
- **An unknown protocol major is dropped silently, never answered.** That is what
  lets a major-2 host and a major-1 page share a channel later. A message with no
  correlation id goes the same way, because it cannot be answered at all.
- **No literal NUL bytes in source.** `bridge.js` builds its per-ring in-flight
  key by joining with an escaped NUL and says so in a comment. `make check` fails
  on a literal one and names the file: a NUL is legal JavaScript, completely
  invisible, and makes `grep` treat the whole file as binary, so every search of
  it comes back empty rather than wrong.

---

## Key files (where the boundary actually lives)

- **The box, and everything DOM-shaped about the boundary:**
  `client/frame/frame.js` — `makeFrameHost(bridge, assets, faces)` (`for` /
  `drop` / `broadcast` / `refresh` / `compliance` / `keep`), the `hello` listener and the
  two-port grant, `fromGuest` (port → bridge entry, answers dropped on a port
  that moved), `grant` / `closeEmbed` and the `Session` typedef (§9),
  `weave(shim, html, assets, faces)` (the `<base>`, the box's
  `@font-face` rules, and the shim, in that order), `sameCtx`, `shut`. Layer 11; replacing this file swaps iframe for
  shadow DOM or a webview host without either of the other two changing a line.
- **The chokepoint, DOM-free:** `client/bridge/bridge.js` —
  `makeBridge(ws, transport, ui)` returning `PageBridge` (`resolve` for
  `HostRequest`, `runtime` for `RuntimeRequest`), `route` / `routeRuntime`,
  `guarded` (the per-ring in-flight cap and the failure flattening), `codeOf`,
  `SAYS`, `proseOf`, `scopeOfSection`, `forward`. Layer 10; never sees an iframe.
- **The guest half:** `guest/biom.js` — the shim, the bootstrap and
  the `biom.*` surface. Imports nothing; nothing imports it. Its wire
  constants are a deliberate duplicate of `contracts/wire.js` and its field names
  are hand-copies of `contracts/types.ts` — see §7.
- **The narrowing predicates:** `contracts/guards.js` — `isHostRequest` /
  `isRuntimeRequest` over `HOST_KINDS` / `RUNTIME_KINDS`, the shared `wellFormed`
  envelope-and-payload check, `isGuestNotice`, `isVarPatch`, `isRowInput`,
  `isVarValue`. Layer 0; imports only `wire.js` constants.
- **The unions and the notices:** `contracts/types.ts` — `HostRequest`,
  `RuntimeRequest`, `ApiRequest`, `HostEvent`, `GuestNotice`, `HostError` /
  `HostErrorCode`, `Envelope`, `Protocol`, `BridgeContext`, `Frame`, `FrameHost`,
  and `childKey` (the one true spelling §7 is about).
- **The outer ring's door, and where a build refuses a kind:**
  `server/api/routes.ts` — `handle(req, deps)` (the envelope check, then
  one `case` per kind), `Deps` (including `production`), `CODES` / `codeOf` (a
  lower layer's code is believed only when it is one of ours), `refused` (the
  `unsupported` code and the sentence a build that does not offer a kind answers
  with), `NATIVE_DIALOG` (the twin
  of the constant in `client/views/vault.js`; a test holds the two equal).
- **The wire constants both halves duplicate:** `contracts/wire.js` —
  `PROTOCOL`, `ERRORS`, `MAX_INFLIGHT`, `CALL_TIMEOUT`, `SLOT_ATTR`, `nextId`,
  `fail`, `vaultBase` / `vaultOf`, and the three route names —
  `API_ROUTE`, `SHIM_ROUTE`, `EVENTS_ROUTE`.
- **The measurement behind "a classic script loads, a module script does not":**
  `vendor/README.md` (the headless-Chrome run and its module-script
  negative control) and `tests/vendor.test.ts`, which pins the build
  choices that follow from it.
- **Siblings:** what happens inside the box → `section-runtime-guide`; what fills
  a node → `plugin-guide`; what `page.read` answers with → `page-format-guide`.
  The product-level invariants and the decisions behind them → the workspace's
  `Architecture/Foundations/Architecture` page.

---

## This is a living document

This skill is the single source of truth for the artifact boundary. Whenever the
boundary genuinely changes — a new `GuestNotice`, a changed handshake, a kind
added to any of the three rings, a new guard, a change to how ports are granted
or revoked, a change to what the host may learn about a box — **update this skill
in the same change** so it never goes stale. If a rule here is what diverged, fix
the rule; if the divergence is a mistake, fix the code. Either way they agree
when you are done. The one sentence that may never be softened is §6: nothing in
this repository describes the in-box split as a security boundary.
