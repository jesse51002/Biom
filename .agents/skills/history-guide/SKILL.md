---
name: history-guide
description: >-
  The single source of truth for THE HISTORY AND THE VIEW SWITCHER in this
  repository — what each window has open, what was opened, changed and shown
  and by whom, and the switcher in each window that decides from that alone
  whether an agent's write brings its screen up, is offered as Go to page, or
  does nothing. Covers every screen's address (`contracts/address.js`), the
  history a workspace keeps in memory (`server/domain/history.ts`) and its two
  doors, the person's writes stamped once per request on the route and the
  `own` check that keeps anything else from stamping them, the context a
  window reports and how long the server keeps it, the stream's `history`
  event, this window's copy of the history (`client/store/history.js`), who
  moved the screen and what that does to Back (`client/store/ui.js`, the
  address bar in `client/shell/shell.js`), the switcher's rules and its three
  times (`client/store/switcher.js`), the `touch` notice and the host's own
  touches, the gate that honours a box's `open` only just after a touch, and
  Go back to and Go to page. Load this whenever you touch any of those files,
  `client/views/goback.js`, the history's wiring in `server/main.ts` or
  `client/boot.js`, or anything that moves the screen. Trigger on "history",
  "switcher", "view switcher", "context", "window.report", "history.read",
  "window id", "Place", "uid", "Address", "parseAddress", "HELD", "claim",
  "adopt", "settle", "idle", "touch", "open gate", "OPEN_AFTER_TOUCH",
  "NOT_TOUCH", "Go back to", "Go to page", "follow", "cause()", "Back",
  "contextOf", "inLine".
---

# The history and the switcher — what each window has, what changed, and when a change moves the screen

The workspace's *History and View Switcher* spec is what this builds. **An
agent working in the workspace changes pages the person is not looking at, and
the switcher brings the change up** — the page it wrote, beside the chat that
wrote it — **unless the screen is the person's**, in which case it offers it
instead. Everything the switcher decides from is the history, and the history
records; it decides nothing.

It owns what was opened, shown and changed, and what moves the screen. It does
**not** own:

- **How an agent's write is seen and named** → `chat-guide`. This guide starts
  where the chats hand an edit to the history.
- **The box a page is drawn in, and what it may say** → `boundary-guide`, which
  states the `touch` notice and the `open` gate as rules of the wall.
- **The runs' own screens and the page's Instructions and Automations** →
  `runs-guide`; here they are only addresses.

## 1. The split

| | where | knows |
|---|---|---|
| the addresses | `contracts/address.js` (0) | every screen's `Address`, its url fragment, `Place` by `uid`, the held screens |
| the history | `server/domain/history.ts` (2) | one workspace's entries, in memory, in call order; each window's context; the address table |
| the person's writes | `server/api/routes.ts` (4) | `writeOf`: which request is which edit, stamped once the answer is ok |
| the wiring | `server/main.ts` (5) | one history per folder, `own` on the route, the stream's `history` event and `?window=` |
| the window's id | `client/transport/http.js` (7), `client/boot.js` | written onto every call; minted once per tab |
| the moves | `client/store/ui.js` (9) | `open`, `follow`, `go`, and `cause()`: who moved the screen |
| the mirror | `client/store/history.js` (9) | this window's copy, and its reports, one at a time |
| the switcher | `client/store/switcher.js` (9) | `decide()`, pure; whose the screen is; Go back to and Go to page |
| the open gate | `client/bridge/bridge.js` (10) | a box's `open` honoured only just after that box's touch |
| the touch | `guest/biom.js`, `client/frame/frame.js` (11), `client/shell/shell.js` (15) | the person's hand, in a box and on the host's own screens |
| the pop-ups | `client/views/goback.js` (14); Go to page in `client/views/agent-input.js` (14) | drawing only |

## 2. Every screen has an address

**`Address` is `{ view, id, screen }` and `contracts/address.js` is its one
spelling**: `parseAddress` and `formatAddress` between an address and
`#/<view>/<id>[/<screen>]` — the id one encoded segment, a page's own screen
after it, `#/agent/<chat>` for a chat — and `normalAddress` so a screen sits
only on a page with an id. A page's Instructions and Automations are addresses
of their own, so a reload lands on them and Back leaves them.

**The history names a page by its `uid`, never its id** — `Place`, and
`placeOf` / `addressOfPlace` between the two — so a page renamed or moved since
still resolves, and one deleted is skipped rather than mistaken for whatever
took its path. **`HELD` is data**: the screens the switcher never leaves for an
agent, which `isHeld` reads and no branch spells.

**Which screen shows a file is the history's address table, `addressOfPath` in
`history.ts`, and the switcher never reads it**: a file of a page's is that
page, its `INSTRUCTIONS.md` its Instructions, a file under its `automations/`
its Automations, anything under `design/` Design, the root `INSTRUCTIONS.md`
and `.agents/skills/` the workspace's Instructions; the mirror, the theme,
`plugins/` and `assets/` show on no screen. The history stamps `place` on an
edit as it is appended, and **the client follows an edit by its `place` and
never maps a path.** That is why the table is not in `contracts/`.

## 3. The history, and its two doors

**One per mounted workspace, in memory, gone when the server stops**, nothing in
it saved or committed. Nobody asks it anything: the person, the chats' agents
and the route write; it records; the switcher in each window reads it.

**Two doors, and only two:**

- **`edit`** — a write Biom can name. The route calls it once per write a window
  made through the app (`you`, `app`); the chats' `onEdit` calls it for an
  agent's (`agent`, `fs` / `tool` / `shell`). **The file watcher is not a
  source**: a change nobody can name is not an edit, and the framework writing
  for itself — the markdown mirror, the editors' one commit — is nobody's.
- **`report`** — a window saying what it has open. With `moved`, it appends:
  the person's move (`you`) an `open` and a `view`; the switcher's a
  `view` under the agent, or nothing when that agent in that chat is unknown; a
  `claim` a `view` by the person with no `open`, or nothing when the window's
  latest view is already theirs at that address. An address that names no
  place appends nothing. It answers what it appended.

**One order.** Both doors look a page's `uid` up off the disk before they can
append, and a lookup may finish out of turn; so each call takes its place in
the order it was MADE, and `seq` is that order. The lookup reads through a
`Files` with no baseline — the vault's own would make a page an agent has just
made KNOWN, and the watcher would never report it arriving — and is given five
seconds before the line goes in with no place.

**A page with no `uid` is given one there.** An agent's new page carries none —
the vault's rules tell it never to type one — and one that wrote a document
whole may drop the one it had. So the lookup is `makeIdentities` in
`server/domain/pages.ts`: the first time the history, or the watcher's
structural settle, meets a page without a `uid`, it gets the one this session
already knew for that page — or the one its folder last carried, which the page
index remembers — or a new one, and it keeps that `uid` for the session however
the file is written again. A page that was there before the folder opened is
given one the same way in the background after the mount, and the root in the
mount itself. It goes into the file behind a commit as ONE `uid:` line under the
first top-level `name:`, every other byte as it was, kept only if the document
reads back as itself plus that `uid`; only where that cannot be verified is the
document written whole with it. Either is a `replace` (`DiskFiles` in
`server/platform/files.ts`), never a `write`: a page deleted from outside
between the write-back's read and its write stays deleted, where a write made
the folder again and brought the page back, `uid` and all. A page whose document
will not parse — an unknown top-level key included — gets none and is never
rewritten.

**Bounded in every part**: a ring of `LIMIT` (5000) entries, oldest first out,
which a reader sees as a gap in `seq`; typing coalesced into **one edit per
burst** — a keystroke's save by the same writer to the same file within two
seconds of its last, sliding, with nobody else's edit to that screen between —
so a morning's typing cannot flush a day's agent edits out of the ring; and
**one agent write seen twice recorded once** — an `fs` write and the tool call
reporting the same file, same agent, same turn, within ten seconds.

**A window's context lives while its stream does.** The stream's `?window=`
(`WINDOW_PARAM`) attaches the window, refcounted so a second stream of the same
window closing does not forget the first; `windows()` answers only attached
windows, and the last stream closing forgets the context. The context's
`agent` is always the server's to derive, from the chat, whatever the window
sent.

## 4. The person's writes, stamped once

**A write a window makes through the app is ONE edit**, recorded in
`handle()` in `routes.ts` once the answer is `ok`, from `writeOf` — a pure
table from a request to a vault path or a table's place. One request is one
act, however many files the domain touched to carry it out: a page moved is
every file under it copied, and that is still one thing somebody did. So the
writer is stamped on the way out and **never threaded through `Files`**. A slot,
a variable, a table's rows and the editors' quiet saves are bursts. Not
recorded: `page.projection`, `vault.commit`, `sql`, `run.*`, `theme.set`.

**The window is the transport's to write.** `client/transport/http.js` writes
this window's id onto every call's envelope OVER whatever the request carried
— the rule `run.start`'s `by` follows — and `client/boot.js` mints it once per
tab, in `sessionStorage` as `biom-window`, so a reload is the same window with
its history. A box's writes are its window's: the bridge rebuilds every request
it forwards, so a box never names a window at all.

**A WINDOW IS NAMED ONLY BY A WINDOW THAT COULD REPORT FOR IT.** `route()`'s
fourth argument, `own`, is the local gate's check without a kind; a request
that fails it has its envelope's `window` DROPPED before it is answered. Its
write is answered as ever and recorded as nobody's — otherwise anything holding
the launch token, a run's script reading every window's id off `window.list`,
could put its writes in the history as the person's.

## 5. On the wire

| kind | answers | who may say it |
|---|---|---|
| `window.report {context, moved?}` | the entries it appended | this machine's own window (the local gate); the envelope's `window` required |
| `window.list` | every attached window's context | the launch token, for a run |
| `history.read {since?}` | `{entries, head}` | the launch token, for a run |

**The stream's `history` event carries every batch appended, each entry once,
in `seq` order.** Nothing is replayed: on every open the client reads again
and reports its whole context again, because the server forgot the window when
its stream closed. A `head` below the `since` asked for means the server
restarted and its `seq` began again.

## 6. This window's copy — `client/store/history.js`

**A catch-up reads everything again and does not trust what it held**: a server
that restarted numbers its entries from 1 again, and an entry held from before
would be mistaken by `seq` for another. A reconnect is the only moment that can
have happened, so it is read whole. Between reconnects the stream is the feed
and a hole in it is filled from `head`.

**What came from where is kept, because only one of them may move the
screen.** An entry the stream brought is `live`; one a read or a report's
answer brought is the past — after a reload that is every entry, and following
one would bring up a page an agent wrote minutes ago. **Each entry is stamped
with when THIS WINDOW got it, by its own clock**: the switcher times everything
by that and never by the server's `at`, which is what lets an end-to-end test
move one window's time. **Reports go one at a time, in the order they were
made**, each answer taken before the next goes, and the ones in flight are
readable (`unanswered`). **A message to an agent goes in the same line**
(`inLine`, which the chat store sends `chat.send` and a first `chat.new`
through): it leaves once every report made before it is answered, and a report
made after it waits for its answer — because the server adds the page on
screen to a message from the context this window last reported (`contextOf`,
which answers a window's context the moment its report arrives, stream or no
stream), and two separate requests promise no order on the way.

## 7. Who moved the screen, and Back

**Only the person and the switcher move the screen**, and `client/store/ui.js`
says which beside every route change:

- **`open(view, id, screen?, panel?)`** — the person: the rail, a link, the
  crumbs, a pop-up, the tree, a page just made, a box's `open`, Back and Forward,
  a typed hash — and a hash the browser moved while the window was still
  booting, which the shell takes when it mounts rather than writing the
  address it loaded with back over it. An `open` in the history, and a new
  entry in the browser's.
  **Off the full Agent screen with a chat open, it brings that chat along** in
  the panel, in the same move — to any view but the workspace picker, which
  draws no panel, and never from the start screen, which has no chat. It is
  decided here once, so no caller can forget it and leave a bare page with the
  chat gone.
- **`follow(to, by, replace)`** — the switcher, for an agent: always with the
  chat's panel open beside the page.
- **`go(view, id, screen?)`** — the system, with nobody asking: a cold start, a
  rename or a delete re-pointing the route, a trouble screen. It REPLACES the
  address bar's entry, because Back to an id that names nothing is Back to
  nothing.

`cause()` answers the latest — `{ seq, mover, replace }` — and is not on
`UiState`, which is frozen; the switcher reports it and the shell's `syncHash`
decides the address bar from it. **Back never walks through the agent's
moves**: the switcher's move PUSHES when it leaves the person's own screen and
REPLACES when it leaves one it brought up itself, so Back from anything it
brought up lands on the person's work. **A route on the Agent screen names the
window's chat**: every move there sets `chat` to the address's id, and leaving
keeps it, so the window knows which chat was last open.

## 8. The switcher

**`decide(facts, timing)` is pure, and every rule of the spec is a row of it**,
in the order they bind:

1. **Only the open chat's writes, while it is on screen** — the Agent screen, or
   the panel beside a page. A chat in the background, a panel shut and a run
   never move the screen and are never offered.
2. A write to what is already on screen changes nothing.
3. **Never off a held screen**: it is offered instead.
4. **The person's screen, touched in the last `idle`, stays**, and the write is
   offered. More than two minutes ago is what lets it move, so a touch exactly
   `idle` ago still holds; a touch counts only after the person's latest
   message to that chat — one at the same instant is the act that sent it.
   When that was is the chat store's `lastSent`, by this window's clock — and
   a message that waited in the chat's queue counts from when it went out,
   which the stream says with its `unqueued`, never from when it was queued.
5. **No bouncing**: inside `settle` of the last move the write WAITS and is
   decided again when the settle ends, rather than dropped.
6. Otherwise it moves, with the chat in the panel beside the page — never a
   bare page with the chat gone.

**The three times are injected and nothing else switches them**: `TIMING` —
`adopt` five minutes, `idle` two, `settle` five seconds — passed by
`client/boot.js`, with `Date.now` and `setTimeout`; a test passes its own.

**Whose the screen is, is kept here, synchronously**, and the history only
seeds it — the mirror is a round trip behind, and a decision against it alone
would move the screen off a page the person opened a millisecond ago. A screen
is the person's when they **opened** it (an open counts as a touch), **touched**
it, or kept it **on screen `adopt`** with the window in front — visible and
focused, the time accumulating across absences. Becoming theirs without an
open is reported once as a **`claim`**. A system move to a different screen is
theirs too, as a claim; one to the same page under another id — a rename — is
nobody's move and changes nothing.

**It follows only live entries, and only the open chat's latest in a batch**, so
a background chat writing in the same batch never stands in front of it, and a
write read back after a reload is never followed. **What it knows of pages is
the window's directory** — `refOf` and `idOfUid` in `client/store/workspace.js`,
filled by the levels the window has listed, the pages it has read and what it
has asked for — and never a list of every page: a page an entry names that the
directory does not know is asked for by id or `uid` with `want`, which batches
the misses into `page.locate`, and the switcher decides again when the answer
lands (`onPages`). **So a write to a page this window has not heard of is not
dropped**: a page an agent has just made reaches the history, `uid` and all,
about 30 ms after the write, before any level naming it has been listed again.
Its `uid` is asked for at once, and the write is kept — the latest such one, a
newer write of the chat's replacing it — and decided the moment the answer names
the page, as if it had been named on arrival; it never waits for the tree. A
`uid` the server answers absent is remembered as absent until the next change on
disk, which asks again, and `UNLISTED_CAP_MS` (a minute) after the write arrived
it is let go.

**It is also what reports the context**: every change of address, panel or
chat goes out as `window.report`, with `moved` saying who. On start it reads the
history and, if nothing has happened since the window loaded, takes whose the
screen was from this window's latest view — a reload in the middle of an
agent's screen keeps Go back to. On every reopen of the stream it `resync`s:
reads again, and says the context and whose the screen is again wherever the
history no longer agrees.

## 9. The person's hand

**A box says `touch` — `click`, `key`, `select` or `scroll`, and nothing
else.** The shim listens in the capture phase and takes only events the
browser says a person made (`isTrusted`): a scroll only as the gesture
(`wheel`, `touchmove`), never the `scroll` event, which fires for a scroll the
box made itself; a selection only under a fresh user activation. One of each a
second, the latest said when the second is up. `frame.js` hands it to the
bridge, keyed by that realm, and up to the switcher as the page of the box on
screen — the OUTERMOST box, for a page drawn inside another.

**The host's own screens are watched by the shell** — pointer, key, wheel and
touch on the canvas, one of each a second — except inside an element carrying
`NOT_TOUCH` (`data-no-touch`): Go back to is one, and the chat's input box is
the one the mark exists for, because **typing to an agent is talking to it,
not touching the page.** Nothing done on the Agent
screen is a touch, and a touch from a box that is not the screen's own — the
chat's box in the panel, or the page just left — is nobody's touch of it. A
page route naming a framework screen's `@` id has no box at all (`boxOf` is
null), because the shell draws no page for it.

## 10. A page's code never moves the screen

**A box's `open` is honoured only as the person's, in answer to their hand on
THAT box**: a `touch` from the same realm in the last `OPEN_AFTER_TOUCH` (1.5
s), waiting `OPEN_GRACE` (250 ms) for one still on its way, because a wikilink
opens over the runtime's port while the touch rides the ordinary one and two
ports promise no order. A child row, a board's card and a followed link are
each a click first, and the shim reports the click before the page's handler
runs. An `open` on load or on a timer is refused `identity`, and said in words
on the window's console. **This is a reasonableness property, not a wall**: code in
the box shares a realm with the shim and could forge a touch, as it could do
anything the person can with the data kinds.

## 11. Go back to, and Go to page

**Go back to**, top left, names the person's work while an agent has the screen:
the latest screen in the history that is theirs — reports still in flight first,
then this window's views, newest first, skipping every one the switcher brought
up and every page since deleted. A view of a page the window's directory does
not know yet is passed over and its `uid` asked for, and the views are weighed
again once the answer lands. Pressing it is an open. It shows only while the
screen is not theirs and there is somewhere to go back to.
`client/views/goback.js` draws it; the switcher decides it.

**Go to page** belongs to one chat: the open chat's latest write the switcher
did not bring up, shown above the chat's input while that chat is on screen —
drawn by `client/views/agent-input.js` from the switcher's `offer`.
Pressing it is an open — from the full Agent screen, with the chat in the panel
beside the page. A move by the switcher clears it.

## 12. What is deliberately not built, and the known gaps

- **The door**: runs and agents outside Biom are not in the history
  (`Writer.run` is reserved); `snapshot` is null.
- A duplicated tab shares its window id, because it copies `sessionStorage`.
- A write seen only in a catch-up read is never followed — by design, since it
  is the past.
- A write whose page the server has not found within `UNLISTED_CAP_MS` of the
  write's arrival is never followed.
- On the Agent screen only the open itself holds the screen against a move.

## Key files

```
contracts/address.js           VIEW_NAMES, PAGE_SCREENS, HELD, address, normalAddress, parse/formatAddress,
                               sameAddress, isHeld, placeOf, addressOfPlace, samePlace
server/domain/history.ts       makeHistory (report, attach, forget, edit, placeOf, read, windows, contextOf, on),
                               LIMIT, COALESCE_MS, SAME_WRITE_MS, PATIENCE_MS, addressOfPath, placeOfPath
server/api/routes.ts           writeOf, recorded, historyAnswer, and `own` on route()
server/main.ts                 makeHistory per folder, uidOf through makeIdentities, events() with attach, the `own` check
server/domain/pages.ts         makeIdentities, withUidLine: a page's uid given mid-session, stable for it
server/domain/pageindex.ts     holders, uidWas: what the identities ask; locate: what page.locate answers
client/transport/http.js       the window written onto every call
client/transport/events.js     onNamed, onOpen, the stream's query
client/transport/chat.js       isHistoryEntry, isPlace: the history event, checked whole
client/store/ui.js             open, follow, go, cause, the Mover and Cause typedefs
client/store/history.js        makeHistoryStore: take, catchUp, report, unanswered, inLine
client/store/switcher.js       decide, TIMING, UNLISTED_CAP_MS, NOT_TOUCH, screenName, boxOf, makeSwitcher (onPages)
client/store/workspace.js      refOf, idOfUid, want: the window's directory, and a miss asked for by name
client/bridge/bridge.js        OPEN_AFTER_TOUCH, OPEN_GRACE, touched, the `open` case
client/frame/frame.js          the `touch` branch of fromGuest, a session's `top`, the `hear` argument
client/shell/shell.js          syncHash, the hashchange handler, the canvas's touches, the backslot
client/views/goback.js         makeGoBack, GO_BACK_WORDS
client/views/agent-input.js    Go to page, above the input; the dock's NOT_TOUCH
client/store/chats.js          lastSent: when this window last sent in a chat
client/boot.js                 thisWindow, the stream's query, the mirror and the switcher, inFront
guest/biom.js                  touches(): the `touch` notice
tests/address.test.ts  history.test.ts  history-route.test.ts  history-store.test.js  page-identity.test.ts
tests/switcher.test.js  touch.test.js  ui-moves.test.js  stream.test.js  stream-feeds.test.ts
tests/e2e/server.e2e.ts        a page's Instructions as an address, and a page's code refused the screen
tests/e2e/chat.e2e.ts          the switcher on a screen, on the window's own clock through Playwright's
```

## This is a living document

This skill is the single source of truth for the history and the switcher.
Whenever either genuinely changes — what is recorded and by whom, how long a
context lives, a rule of `decide`, a time, what counts as a touch, what the
address bar does with a move — **update this skill in the same change**. If a
rule here is what diverged, fix the rule; if the divergence is a mistake, fix
the code. Either way they agree when you are done.
