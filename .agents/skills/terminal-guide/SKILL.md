---
name: terminal-guide
description: >-
  The single source of truth for the AGENT TERMINAL in this repository — the
  real shell that runs beside the visual workspace so a person can start their
  own agent CLI (claude, codex, aider, gemini) in the vault's folder and watch
  its edits land on the page. Covers the PTY service owned by the local Bun
  server (`server/platform/pty.ts`), the per-workspace session registry and its
  lifetime rules (`server/workspace/terminals.ts`), the guarded WebSocket route
  in `server/main.ts` and every check in `terminalRefusal`, the client socket
  (`client/transport/terminal.js`), the session and dock store
  (`client/store/terminals.js`), the xterm.js emulator view
  (`client/views/terminal.js`), and the dock with its tabs, full screen, hide,
  end and drag-to-any-edge (`client/shell/dock.js`, `client/css/terminal.css`).
  Load this whenever you touch any of those files, the vendored xterm files, or
  anything that decides when a shell starts, stops or may be reached. Trigger on
  "terminal", "PTY", "shell", "xterm", "dock", "agent terminal", "New terminal",
  "End session", "Hide terminal", "fullscreen terminal", "drag to edge",
  "session", "replay", "scrollback", "resize", "SIGWINCH", "process tree",
  "orphan", "capability cookie", "terminalRefusal", "Ctrl+`".
---

# The agent terminal — one server-owned PTY per session, one dock per window

A person opens a workspace, opens Agent Terminal, and runs the agent they already use.
The shell starts in the **vault root**, beside `AGENTS.md` and `.agents/skills/`.
The page stays mounted and usable beside it; the agent's writes reach the page
through the file watcher exactly as any other write does. Biom presents the
terminal and owns the process lifetime. It does not read the session, parse the
agent's output, type into it, or supply a command of its own.

It owns the terminal. It does **not** own how an agent's write becomes a redraw —
that is the watcher (`server/platform/watch.ts`) and `AGENTS.md`'s live-reload
rules, and **terminal output never triggers a reload**.

## 1. The split, and why it is Zed's

Three responsibilities, three layers, and none reaches sideways:

| | where | knows |
|---|---|---|
| the process | `server/platform/pty.ts` (1) | a directory, an environment, bytes, a size, an exit, a tree to kill |
| the session | `server/workspace/terminals.ts` (3) | ids, lifecycle, the output ring, who is connected, the limits |
| the wire | `server/main.ts` (5) | the upgrade, the checks, one socket ↔ one attachment |
| the socket | `client/transport/terminal.js` (7) | reconnect, `hello`, frames — and it queues nothing |
| the state | `client/store/terminals.js` (9) | mirrored sessions (server's) and the dock (this window's) |
| the emulator | `client/views/terminal.js` (14) | one xterm per session, fit, input, replay |
| the furniture | `client/shell/dock.js` (15) | tabs, drag, grip, zoom, the notes on screen |

`boot.js` constructs the link, the store and the view and hands them to the
shell; xterm's constructors are injected so no module below the root names the
library. Zed's source (read at a pinned commit, not run) separates process,
terminal model and view the same way; nothing of its Rust was reused.

## 2. The PTY

`Bun.spawn(cmd, { terminal: { cols, rows, data } })` — a real TTY, measured on
macOS with Bun 1.4.2: the given directory, the given size, `stty size` reads a
resize back, the shell's own exit code. **A missing folder or shell throws
`PtyError` naming it** and nothing starts anywhere else.

- **Login shell** (`$SHELL -l`, else the platform's usual ones) so a
  dock-launched app gets the PATH a person's own terminal has.
- **`scrubEnv`** keeps the person's environment — credentials included, because
  the CLI's login is theirs — and drops every `BIOM_*` marker (`BIOM_SHELL` above
  all), `VAULT`, `VAULTS`, `PORT`, and the shell's own font cache on Linux.
- **`end()` takes the tree**: the process table is walked for descendants
  (an interactive shell puts each job in its own process group, so the group
  alone misses `sleep 60 &`), then HUP → TERM → KILL with a wait between each.
  Answers `false` when the shell did not go — a failure, never a close.
  A process that deliberately left the tree is not claimed.
- **`kill()`** is the synchronous SIGKILL for the server's `exit` handler.

## 3. Sessions and their lifetime

**Visibility is not lifetime.** Nothing a dock does is a message. Three things
end a session: `end`, the shell exiting, the server going. A fourth is the
**orphan rule**: a workspace with live sessions and no connected client for
`LIMITS.grace` (120 s) ends them — a reload reconnects well inside that, a closed
browser tab does not, and a hidden shell nobody can see is not allowed. In the
desktop application closing the window ends the server and every tree with it.

- **A retried create is not a second terminal.** Creates carry a nonce; the
  server answers a seen nonce with the session it already made. The client
  resends pending creates with the same nonce after a reconnect.
- **The limit counts creates in flight.**
- **Ending a session closes it.** A session this window ended, or a shell that
  exited with code 0, is dismissed by the store as soon as it is gone. An exit
  nobody asked for — a failing code or a signal — is kept with its real status
  and final output until dismissed, because that output is the only account of
  what went wrong. Nothing respawns. A failed `end` becomes `failed` and cannot
  be dismissed.
- **No terminal, no dock.** Once the socket has listed the sessions, a dock
  with none, none starting and no spawn failure left to read is hidden — when
  the last tab closes, when a reload finds none, and when the last failure is
  dismissed (`closeIfEmpty` in the store). Opening it again starts a new shell.
- **Leaving a workspace with live sessions asks first** (`Close workspace` in the
  rail's foot) and ends them on yes. Quitting the desktop application does not
  warn yet — it ends every session; see §8.

## 4. Output, replay and bounds

Output is binary frames — kind, id length, id, bytes — so UTF-8 is never split
into replacement characters on the way. Each session keeps a **ring** of at most
`LIMITS.buffer` bytes. A new or reconnected client gets `sessions`, then a replay
frame per session:

- never overflowed → a replay from byte zero, which is a coherent screen;
- overflowed → a tail, `truncated: true`, a note on screen, and the PTY is
  nudged one row and back so a full-screen program redraws.

The client **resets the pane before writing a replay** and does not announce
bells or titles fired during it. **Input is never kept or replayed** — the link
refuses a send while the socket is down.

A socket with more than `LIMITS.lag` bytes queued is marked behind and sent
nothing; on drain it gets a `resync` and the ring. The ring is the memory bound.
**What is not bounded is the producer**: Bun's PTY reader offers no pause, so a
shell printing forever costs one ring and CPU, not memory.

## 5. Who may open one — `terminalRefusal`

The API route is open in a source run; the terminal is not, in any build,
because it is command execution and `Bun.serve` listens on every interface.
Every check stops something the others do not:

1. **WebSocket upgrade** — the page proxy is a `fetch`, which cannot upgrade.
2. **The launch token**, in the built application, as the API route takes it.
3. **Loopback peer address** — the network is refused before a header is read.
4. **Host is a loopback name on this port; Origin is that address** — defeats
   DNS rebinding, a site in another tab, and the box (`Origin: null`).
5. **The capability cookie** — minted per launch, `HttpOnly; SameSite=Strict`,
   set only on the composed document and only for a loopback request. The page
   proxy strips `set-cookie` from what it hands a page.

The refusal is logged and never told to the socket. **What stays open, said
plainly:** in a source run another local program can fetch `/`, take the cookie
and forge headers — a different local user on a shared machine is the gap in
development, and the launch token closes it in the built application.

**No terminal authority is on any page contract.** `contracts/` is untouched; the
wire is spelled in `server/workspace/terminals.ts` and
`client/transport/terminal.js` and `tests/terminal-wire.test.ts` holds them equal.

## 6. The dock

`.work` holds the bed and the dock as two fixed children for the life of the
window. **Edge, size, shown and full screen are classes and `--dock-size` on
`.work`** — a grid template — so a move never reparents the page's frame. Full
screen lays the dock over the bed's cell and drops the rail and strip rows
(`.app.tfull`); the title bar of the built application stays.

- **Drag the handle** to show four edge targets and a preview; drop on one to
  move the dock with all its tabs; the middle, `Esc` or a cancelled pointer
  change nothing. **Press the handle** for the same four as a menu.
- **The grip** on the inner edge resizes (pointer or arrow keys); sizes are per
  edge and clamped so neither side drops below `DOCK_MIN`.
- **Full screen / Restore** returns the same edge and size; **Hide from full
  screen** returns to the workspace and reopening returns to the edge.
- **Every control is an icon**, drawn in CSS in `terminal.css` the way the window
  controls are, with the `aria-label` as the only name anything depends on: the
  bar carries no words, because a dock on the LEFT edge has room for about two.
  The hide chevron points at the edge the dock is on.
- **Tabs** are a roving `tablist`: arrows, Home/End, F2 renames (double-click
  too), Delete asks to end. The bar scrolls and keeps the selected tab in view.
  A tab is a prompt icon plus `tabText(label)` — a default `Terminal 3` draws as
  `3`, a renamed one draws its name, and the full label is the accessible name
  and the tooltip either way.
- **States a tab can honestly show:** Starting, Running, Disconnected, Ending,
  Exited with its code or signal, Failed to end — plus unread output and bell
  marks for a tab not in front. None is a guess about what an agent is doing.
- **Zoom** is the dock's, not a session's: one workspace on one screen is one
  reading distance. The two `A` buttons, `Ctrl/Cmd` with `=`, `-` or `0` from
  inside the dock, and `Ctrl/Cmd` with the wheel over the terminal all move it
  between `FONT_MIN` and `FONT_MAX`; it is remembered with the rest of the dock
  and sent nowhere. A size change reaches the shell only as the resize the fit
  computes from it.
- **Dock layout is per tab** (sessionStorage, per vault): a reload keeps it, a
  restart does not — longer retention is an open decision.
- **Help is a dialog in the middle of the screen**, not a popover off the `?`:
  it holds a Copy line per agent CLI (the command that starts it and the one
  that installs it) and a first thing to ask it, through `copyButton` in
  `client/widgets/prompt.js`, so a refused clipboard selects the line instead.
  It is appended to the body so a narrow dock does not size it, and it stops its
  own Escape so the shell's does not also close a panel. It is copy only —
  nothing is typed into a shell. The list is `AGENTS` in `client/shell/dock.js`.
- **The rail's Agent Terminal button is in every build**, drawn filled in the primary accent (`.tool.prime`)
  and last on the bar so it is in the same place on every page, and it shows how
  many sessions are still running while the dock is hidden.

## 7. Keys

The emulator owns keys while focused. `Escape` reaches the program — the shell's
Escape handler ignores events from inside the dock. `Ctrl+C` is always SIGINT;
copy/paste are Cmd on macOS and `Ctrl+Shift+C/V` elsewhere (paste is handed to
the browser so bracketed paste survives). `Ctrl+\`` toggles the dock from the
chrome and from the terminal — **not from inside a page's box**, whose key events
do not leave its frame; the rail's button is the way that always works. Restore
is a button, so it works while Vim owns the keyboard. The zoom keys are taken
**only when the event came from inside the dock**, because `Ctrl+-` anywhere else
is the browser's own zoom and the host does not steal it; the emulator hands
those keys back rather than sending them to the shell.

## 8. What is not built, on purpose or not yet

- Quit warning in the desktop application (it ends sessions without asking).
- Survival of sessions past a server exit; transcript retention; restoring dock
  layout across restarts.
- Splits, agent launch presets, vendor-specific status parsing, worktrees.
- Link opening and clipboard reads from terminal output — deliberately absent.
- Windows: `taskkill /T` is the tree kill and has not been run on Windows.
- Resource limits are starting numbers, not measurements.

## Key files

```
server/platform/pty.ts            shell discovery, env scrub, spawn, end the tree
server/workspace/terminals.ts     sessions, ring, limits, orphan rule, the wire (server copy)
server/main.ts                    terminalRefusal, the cookie, the upgrade, exit handler
server/api/routes.ts              proxy strips set-cookie
client/transport/terminal.js      the socket, frames, the wire (client copy)
client/store/terminals.js         sessions mirror, dock transitions (pure dockAfter)
client/views/terminal.js          xterm panes, fit, input, replay
client/shell/dock.js              tabs, drag, grip, notes, page reference
client/shell/shell.js             .work, rail toggle, Escape guard, Close workspace ask
client/css/terminal.css           the grid templates and the dock's dress
client/boot.js                    constructs link, store, view; dock layout in sessionStorage
vendor/xterm.* vendor/addon-fit.* the emulator, verbatim, with our partial .d.ts
tests/pty.test.ts                 a real shell: TTY, cwd, size, exit, tree kill
tests/terminals.test.ts           registry rules against a fake spawner
tests/terminal-wire.test.ts       both wire copies equal; the refusal table
tests/terminal-route.test.ts      a spawned server: cookie, refusals, a shell in the vault
tests/terminal-store.test.js      dock transitions, nonce retry, hide sends nothing
```
