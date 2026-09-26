---
name: terminal-guide
description: >-
  The single source of truth for the SIGN-IN TERMINAL in this repository — the
  one terminal left after the Chat spec replaced the agent terminal: a pop-up
  that runs ONE command, the one an agent's own terminal sign-in method asked
  for, in a real PTY, and closes when it exits. Covers the PTY service
  (`server/platform/pty.ts`), the one-command run and its ticket
  (`server/workspace/terminals.ts`), the guarded WebSocket route in
  `server/main.ts` and every check in `terminalRefusal`, the client socket
  (`client/transport/terminal.js`), and the pop-up with its emulator and key
  table (`client/views/terminal.js`, `client/css/terminal.css`). Load this
  whenever you touch any of those files, the vendored xterm files, or anything
  that decides which command may run, when it stops or who may reach it.
  Trigger on "terminal", "PTY", "xterm", "sign-in terminal", "sign in pop-up",
  "terminal-auth", "ticket", "redeem", "openSignInTerminal", "process tree",
  "orphan", "capability cookie", "terminalRefusal", "paste a code".
---

# The sign-in terminal — one command, from a ticket, for as long as one socket

A person talks to an agent on the Agent screen, over ACP. Most agents sign in
through ACP too, but some offer only a sign-in of type `terminal` — a command of
their own, like Claude Code's `auth login --claudeai`, GitHub Copilot's or
OpenCode's (the Chat spec's `credentials`, and its *Agent sign-in* research).
Such a command usually opens a browser and finishes by itself; where the browser
cannot call back, over SSH or in a container, the terminal is where the code is
pasted. So Biom keeps exactly what that needs: the PTY service, one route, and an
emulator in a pop-up. The dock, the Agent Terminal button, the session registry
and a shell of the person's own are gone (the Chat spec's `removed`), and an
agent CLI that does not speak ACP has no way in.

It owns that one run. It does **not** decide whether the agent is signed in —
that is the agent's session opening, which the server checks again once the
command has gone — and nothing the command prints ever reaches a page.

## 1. The split

| | where | knows |
|---|---|---|
| the process | `server/platform/pty.ts` (1) | a command, a directory, an environment, bytes, a size, an exit, a tree to kill |
| the run | `server/workspace/terminals.ts` (3) | the ticket, which command it stands for, the socket's lifetime, the bounds |
| the wire | `server/main.ts` (5) | the upgrade, the checks, the vault's root and its sign-in state per socket |
| the socket | `client/transport/terminal.js` (7) | one socket per sign-in, opened once, never reopened |
| the pop-up | `client/views/terminal.js` (14) | the dialog, one xterm, fit, input, the key table |

`boot.js` constructs the pop-up with xterm's constructors and a `connect` over
this vault's socket, so no module below the root names the library. What opens
it is the Agent screen, for a `SignIn` of kind `terminal`.

## 2. A client never names a command

`agents.signIn{agent, method}` answers a terminal method with a `SignIn` carrying
a **ticket** beside the command it stands for, which the client may show and
never sends. The socket's `create` carries that ticket and a size — nothing else
in the message is read, so a `command`, `args` or `env` there does nothing.
`Tickets.redeem(ticket)` — the vault's `Agents.redeem` — turns it back into the
`AgentLaunch` it stood for **once**: a ticket spent, expired or never minted
starts nothing. The run also remembers every ticket it has spent, so a replay is
refused whatever the minter answers, and every refusal is the same sentence, so
a caller learns nothing about which tickets exist.

`spawnPty` takes the command as an **argument vector**, never a line for a shell:
an absolute path, a path from the vault's root, or a bare name found on the
command's own `PATH` (the login environment's, not the server's). Its environment
is the launch's — the person's login environment plus the method's variables —
passed through `scrubEnv`, which drops every `BIOM_*` marker, `VAULT`, `VAULTS`,
`PORT` and the desktop shell's font cache, and adds `TERM`, `COLORTERM` and a
UTF-8 `LANG` where none was set.

## 3. The lifetime is the socket's

There is no session to come back to: no ids, no replay, no orphan grace, nothing
a second window could attach to.

- **The command exiting** says `exited` with its code or signal and closes the
  socket, 150 ms later so the last output arrives first.
- **The socket closing first** — the pop-up's Close, a reload, the window gone —
  ends the command's whole tree: the process table is walked for descendants
  (a job in a process group of its own included), then HUP → TERM → KILL with a
  wait between each, and if even that did not take, the synchronous kill. A
  process that deliberately left the tree is not claimed.
- **A socket that names no ticket** within ten seconds is closed.
- **The server going** kills every tree still running, synchronously, in the
  `exit` handler, beside the runs'.
- **However it went**, `Tickets.ended(ticket)` is called, so the server looks at
  that agent again and says the verdict on the `agents` stream event. The client
  never decides that a sign-in worked.

## 4. The wire

Spelled in `server/workspace/terminals.ts` and `client/transport/terminal.js`,
held equal by `tests/terminal-wire.test.ts`, and **not in `contracts/`**, on
purpose: no box may ever be able to name a terminal kind.

| this side says (JSON) | the server says (JSON) |
|---|---|
| `create {ticket, cols, rows}` — once, first | `started` |
| `input {data}` | `exited {exit: {code, signal}}` — the socket closes next |
| `resize {cols, rows}` | `error {message}` — when nothing started, the socket closes next |

Output is raw binary. There is no `end`: closing the socket ends the command.
Bounds (`LIMITS`): one `input` at most 256 KB, refused whole rather than cut;
past 4 MB queued on the socket, output is dropped and the window told once — the
bound on what a command printing forever can cost; sizes are 2–1000.

## 5. Who may open one — `terminalRefusal`

The route is guarded in every build, because it is command execution and
`Bun.serve` listens on every interface. Every check stops something the others
do not:

1. **WebSocket upgrade** — the page proxy is a `fetch`, which cannot upgrade.
2. **The launch token**, in the built application, as the API route takes it.
3. **Loopback peer address** — the network is refused before a header is read.
4. **Host is a loopback name on this port; Origin is that address** — defeats
   DNS rebinding, a site in another tab, and the box (`Origin: null`).
5. **This machine's capability cookie** (`biom-local-<port>`) — minted per launch,
   `HttpOnly; SameSite=Strict`, set only on the composed document and only for a
   loopback request. The page proxy strips `set-cookie` on the way back and any
   `cookie` a page hands it on the way out. The same cookie guards the agent and
   chat kinds and the live stream, through `localRefusal`.

The refusal is logged and never told to the socket. Past the gate, the ticket is
the second wall: a caller that passed every check still runs only what the
server minted. **What stays open, said plainly:** in a source run another local
program can fetch `/`, take the cookie and forge headers — and would still need a
ticket, which only `agents.signIn` mints.

## 6. The pop-up

`openSignInTerminal({ ticket, title }) → Promise<{ exitCode }>` — `open` on what
`makeSignInTerminal` returns. It resolves once the pop-up has gone: the exit
code, or `null` when the command never ran, was ended by Close, or ended on a
signal.

- **The mockup's look**, in the chrome's tokens: the title, *Terminal, for this
  sign-in only*, a close control, the screen. Above every other layer.
- **Fitted before it starts**: the emulator is opened and fitted first, so the
  command starts at the size it is drawn at; a later resize is sent while it
  runs. Typing is off until `started`.
- **A clean exit closes it.** A failing exit, a signal, a refused ticket or a
  lost connection leave the output on screen and one sentence under it, drawn
  as text, with the caret on Close — that output is the only account of what
  went wrong.
- **Close** closes the socket, which ends the command. A click on the scrim does
  nothing: a stray click must not end a sign-in half done.
- **Every key pressed inside stays inside**, so the shell's own Escape never
  fires behind it. Escape in the emulator is the program's; once nothing runs,
  Escape closes the pop-up.
- **One at a time per window.** A second `open` while one is up is refused.

## 7. Keys

The emulator owns keys while focused. `Ctrl+C` is always SIGINT; copy and paste
are Cmd on macOS and `Ctrl+Shift+C/V` elsewhere (paste is handed to the browser
so bracketed paste survives). **⌘V on macOS depends on the Edit menu being
VISIBLE** in `app/main.js` — a hidden one registers no accelerator. The
platform's own terminal habits are one pure table, `terminalKey`, tested in
`tests/terminal-keys.test.js`: on macOS `Option+←/→` a word, `⌘←/→` start and end
of line, `Option+Delete` the word behind, `⌘Delete` to the start of the line,
`⌘K` clears, `⌘A` selects all; on Linux and Windows `Ctrl+Shift+A` selects all
and `Ctrl+Backspace` deletes a word; everywhere `Shift+Enter` sends `ESC Return`,
and `Ctrl/Cmd` with `=`, `-` or `0` is left to the window. Selecting out of a
program that has taken the mouse is `Option`-drag on macOS and `Shift`-drag
elsewhere.

## 8. What is not built

- A shell of the person's own, or any command but a sign-in's.
- Link opening and clipboard reads from terminal output — deliberately absent.
- Windows: `taskkill /T` is the tree kill and has not been run on Windows.
- Resource limits are starting numbers, not measurements.

## Key files

```
server/platform/pty.ts            one command in a PTY, env scrub, end the tree
server/workspace/terminals.ts     the ticket, the run, its lifetime, the wire (server copy)
server/main.ts                    terminalRefusal, the cookie, the upgrade, NO_SIGN_IN, exit handler
server/api/routes.ts              proxy strips set-cookie and cookie
client/transport/terminal.js      the one-shot socket, the wire (client copy)
client/views/terminal.js          the pop-up, xterm, fit, input, terminalKey
client/css/terminal.css           the pop-up's dress
client/boot.js                    constructs the pop-up with xterm and the socket
vendor/xterm.* vendor/addon-fit.* the emulator, verbatim, with our partial .d.ts
tests/pty.test.ts                 a real command: TTY, cwd, size, exit, tree kill, PATH
tests/terminals.test.ts           the ticket and the lifetime, fake and real PTY
tests/terminal-wire.test.ts       both wire copies equal; the socket; the refusal table
tests/terminal-route.test.ts      a spawned server: cookie, refusals, a made-up ticket runs nothing
tests/signin-terminal.test.js     the pop-up against a fake emulator and socket
tests/terminal-keys.test.js       the key table
```
