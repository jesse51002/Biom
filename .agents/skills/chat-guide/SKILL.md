---
name: chat-guide
description: >-
  The single source of truth for CHAT AND THE AGENTS in this repository — a
  person talking to an agent already on this machine, over the Agent Client
  Protocol, one agent process per chat. Covers the hand-written JSON-RPC
  connection and its process group (`server/platform/acp.ts`), the ONE reading
  of the protocol the chats and the probe share (`acp-wire.ts`), the person's
  login-shell environment read once per server and again only on Check again
  for an agent signed in by a variable (`loginenv.ts`), finding,
  probing, installing and signing in an agent (`server/workspace/agents.ts` and
  the pure `server/domain/agents-*.ts`), a chat's lifetime, its light, its kept
  log and its reaping (`server/workspace/chats.ts`), which of an agent's
  actions is an edit and how it reaches the history (`edits.ts`,
  `shellwrites.ts`), Jev's faces (`jev.ts`), the chat's kept choices
  (`server/workspace/settings.ts`, `server/domain/choices.ts`,
  `.biom/settings.json`), the agent, chat and settings kinds on the
  route, the live stream's `chat` and `agents` events and their bounds, the
  gate that answers them only to this machine's own window, and the split
  between the Agent screen's look in the box and the input box in the host.
  and the host side — the window's copy of the chats (`client/store/chats.js`),
  the one box on the full screen and in the panel (`client/views/agent.js`),
  Biom's own input box (`agent-input.js`) and More agents, More models and
  sign-in (`agent-dialogs.js`). Load this whenever you touch any of those
  files, the agent wiring in `server/main.ts` or `client/boot.js`,
  `guest/plugins/biom-agent/`, `guest/plugins/biom-agent-look/` or
  `tests/fake-acp-agent.ts`. Trigger on "ACP", "agent client protocol",
  "chat", "agent", "probe", "sign in", "authenticate", "ticket", "registry",
  "install an agent", "checksum", "login env", "TYPESAFE_API_KEY", "Jev",
  "face", "held message", "Stop", "light", "kept log", "jsonl", "reap",
  "idle agent", "AgentId", "onEdit", "changed", "look", "look.state",
  "look.patch", "biom.onLook", "@agent", "Start Gateway", "AUTH_EVERY_PROCESS",
  "settings.json", "kept choices", "one view", "thinking folded", "Used N tools",
  "queue", "queued", "Send queued", "Send now", "look.sendNow", "chat.sendNow",
  "delete a chat", "session/delete",
  "biom-context", "page on screen", "the note", "withoutNotes".
---

# Chat — an agent already on this machine, one process per chat, over ACP

The workspace's *Chat* spec is what this builds: the Agent screen, where a
person talks to an agent they already have — Claude Code, Codex, Gemini CLI,
anything the ACP Registry lists — about the workspace it is open in. **Biom runs
no model and owns no agent loop.** It starts the person's agent in the vault's
folder, speaks ACP to it over stdio, carries out the file reads and writes the
agent asks of it, keeps its own copy of everything the agent said, and draws
it. What the agent does is the agent's.

It owns the conversation. It does **not** own:

- **What each window has open, what changed, and whether an agent's write
  brings its screen up** → `history-guide`. This guide ends where an agent's
  write is handed to the history.
- **The sign-in pop-up's terminal** → `terminal-guide`. This guide ends where
  a ticket is handed to it.
- **The box the Agent screen's look is drawn in, and what it may say** →
  `boundary-guide`. **How the look plugin is mounted and replaced** →
  `plugin-guide`.

## 1. The split

| | where | knows |
|---|---|---|
| the connection | `server/platform/acp.ts` (1) | JSON-RPC 2.0, one message per line, over a process's stdio; its process group; no method but the one it must refuse |
| the protocol | `server/platform/acp-wire.ts` (1) | every ACP method and shape Biom speaks, read into Biom's own; what is believed of an agent, bounded |
| the person's environment | `server/platform/loginenv.ts` (1) | the login shell's environment, read once per server, and again on Check again for an agent signed in by a variable |
| the pure halves | `server/domain/agents-*.ts`, `edits.ts`, `shellwrites.ts`, `jev.ts`, `choices.ts` (2) | the known agents, their sign-in methods, the registry, a downloaded archive, what is an edit, Jev, the kept choices' shape and what an agent still offers |
| the agents | `server/workspace/agents.ts` (3) | what this machine has: finding, probing, installing, signing in, tickets |
| the chats | `server/workspace/chats.ts` (3) | one agent process per chat, its turns, its light, its files, its kept log |
| the kept choices | `server/workspace/settings.ts` (3) | `.biom/settings.json`: the agent last picked, each agent's last model, mode and effort |
| the route | `server/api/routes.ts` (4) | each `agents.*` and `chat.*` kind, narrowed by `isChatRequest`, one module call each |
| the root | `server/main.ts` (5) | per server: the login environment, Jev, every connection, the idle timer; per folder: the agents, the chats, Jev's schedule; the gate, the stream, the exit |
| the look | `guest/plugins/biom-agent/`, `guest/plugins/biom-agent-look/` | the Agent screen as drawn in its box |
| the window's copy | `client/store/chats.js` (9) | the list, the agents, the open chat's stream folded; every `chat.*` and `agents.*` the host says |
| the Agent screen | `client/views/agent.js` (14) | the one box, on the full screen and in the panel; what the look is posted; the answer to the look |
| the input box | `client/views/agent-input.js` (14) | the text area, the pickers, Send and Stop, the / menu, Go to page |
| the pop-ups | `client/views/agent-dialogs.js` (14) | More agents, More models, sign-in, Start Gateway, Install |

ACP's own messages are the server's and are in **no contract**: they live
beside `acp.ts`, and what reaches a client is Biom's own `ChatSummary`,
`ChatUpdate`, `AgentInfo` and `SignIn` (`contracts/types.ts`, the eleventh
contracts edit).

## 2. The connection, and the one reading of the protocol

**`connectAcp(launch, cwd)` never throws.** An agent that cannot be started is
a connection already closed. Framing respects nothing the process does: a
chunk can end mid-line or mid-character, a line that is not a JSON object is
ignored (an agent that prints a banner is careless, not hostile), and a line
longer than `MAX_LINE` fails the connection rather than holding whatever a
runaway process writes. **`MAX_LINE` is held above the largest message a
handler here takes**: 6 × 32 Mi + 1 Mi characters, which is the chats' largest
file (`FILE_MAX`, 32 Mi characters) escaped at JSON's worst, six characters
each, with a mebibyte for its envelope. So a write too large is refused in
words by the chats' handler, and never by ending the agent mid-turn.

**Every request settles**: answered, past its own deadline where it named one,
or rejected with `ACP_CLOSED` when the connection ends — one error for every
pending request, however it ended. `session/prompt` names no deadline, because
a turn may run for hours. A request FROM the agent to a method nobody handles
is answered `-32601` rather than left hanging.

**Stderr is a diagnostic, never a message**: a bounded tail for the server's
log, never relayed to a client — it is where an agent prints a token or a path.

**The process is a group of its own.** `spawnAgent` starts it `detached` with
exactly the launch's environment; `close()` walks the process table for every
descendant and group (`pty.ts`'s `parsePs` and `treeOf`) and sends TERM, a
grace, then KILL; **`kill()` is the same KILL at once, for an exit handler that
runs no timer again.** An agent that exits on its own takes the tools it left
in its group with it.

**There is ONE reading of ACP, `acp-wire.ts`, and both the chats and the probe
speak through it** — the same `initialize`, the same `session/new`, the same
pickers through `toConfigOptions`. That is load-bearing: an option id the
start screen's picker shows before a chat has a session is one the chat's own
session knows. It reads loosely and writes exactly: a field missing or of the
wrong type reads as absent, and what Biom sends is the schema's shape.
`initialize` offers `fs` both ways, NO ACP terminal, and terminal sign-in both
ways the protocol has spelled it; `session/new` carries the vault as `cwd` and
**no MCP servers** — the door that would hand one to every agent is not built.
What is believed of an agent's pickers and commands is bounded by
`WIRE_BOUNDS`, because those lists ride every `agents` event and every chat's
`config` and `commands` update to every window: an id too long is left out, a
word too long is cut, and an id given twice keeps its first.

## 3. What agents this machine has

**Finding is looking, never guessing.** An agent is listed when this machine
has it: a command the known-agents table names (`KNOWN_AGENTS` in
`agents-known.ts`) on the login shell's `PATH`, one Biom installed into its own
folder, or — for Claude Code and Codex, whose own CLIs do not speak ACP — the
CLI plus a pinned adapter run through `npx`, said plainly to be missing Node
where there is none. **A command is in the table only where its name is the
agent's own**: finding one means starting it with ACP arguments, and `goose`,
`grok`, `droid`, `pool`, `nova` and `cortex` are also other programs' words, so
those agents are found only once Biom installed them. OpenClaw is reached only
through a Gateway on THIS machine, by a constant address, and **Start Gateway**
is `agents.start`. The first `agents.list` starts the search; **a list read more
than `TIMING.rediscover` (thirty seconds) after the last look looks again, and
probes what is new and any agent still here whose last probe FAILED** — so an
agent installed or mended while Biom runs is found without a restart, which is
also why a failed agent carries no button. An agent that is Active, waiting for
a sign-in, being installed or being checked is not probed unasked, so a busy
picker is not a probe storm.

**Active means a session opened, and nothing short of it**: the agent started,
answered `initialize`, and answered `session/new`. Anything less is Inactive
with a reason word (`AgentReason`) and a sentence of Biom's own — never the
agent's stderr or error text. The probe keeps the session's config options and
commands on the agent, so the pickers and the / menu are full before any chat
has a session of its own, and **deletes its own session** where the agent
offers `session/delete`, so looking leaves no empty chat in the person's own
history.

**Installing reads the ACP Registry** (`agents-registry.ts`, every field of it
untrusted), cached in memory and in Biom's folder of agents — `agents/` under
the per-user data directory, never a vault — and installs there at the
registry's pinned version: `npm install --prefix`, `uv tool install`, or a
binary for this platform fetched over https at every hop and unpacked only once
`agents-archive.ts` has judged its whole table of contents. **A listed SHA-256
must match.** Where the registry lists none, the download is **trusted on first
use**: the registry still names the url, the SHA-256 of what came is recorded
by version in `installed.json` and said in that agent's `install.log`, and a
later download of the same version with other bytes is refused — so a changed
file for a pinned version is never run. Refusing those downloads outright was
the first version, and it left Cursor, Devin, Junie and six more unusable.

**Nothing waits.** A probe, an install, a sign-in and a Gateway start each
answer the agent as it stands (`checking`, `installing`) and push the verdict
on the stream when it lands. Every step is bounded (`TIMING`), one job runs per
agent at a time, and `killAll` ends every probe and install process on the way
out. **One install of an agent and version runs at a time across every
workspace**, because they share the agents folder: a lock file beside its tree,
`<key>/.install-<version>.lock`, made with `O_EXCL`, touched every ten seconds
while the install works and taken over once nobody has touched it for a
minute. A second install waits on it, saying *It is being installed in another
workspace.*, and then uses what the first installed — or installs it itself
where the first did not.

**What the person is shown of an agent is Active or Inactive, and nothing
else**: an Inactive one carries at most ONE button, **Sign in** or **Start
Gateway**, and its reason's sentence as the line under it. Work in progress is
a pulsing lamp, with its button held in More agents while it runs; a failed
agent carries no button, because the list's own look probes it again. Install
and its progress live in More agents.

## 4. Sign-in, which is the person's and not a folder's

**Sign-in is asked for only when it is needed**: a probe's session, or a chat's
session or message, refused with ACP's *authentication required*. The chats
report theirs through `refused(key)`, which is **sticky**: an agent that opens a
probe session and then refuses a chat's message stays at **Sign in** until
somebody signs it in, rather than flipping back to Active on the next probe.
**The one exception is an agent Biom cannot sign in**: one that offers no way
at all, or whose every way is a variable to set. The person signs such an agent
in outside Biom and then presses **Check again**, which is `agents.probe`, and
for exactly that agent an explicit probe lifts the refusal before it looks —
for a variable, after reading the login shell again. An agent with a way Biom
can run keeps its refusal, because such agents can open a session while signed
out.

`agents.signIn{agent, method}` answers a `SignIn`, by the method's type:

- **`agent`** — `authenticate`, then `session/new` on the same connection, and
  the verdict is the session opening, never `authenticate`'s answer.
- **`terminal`** — a **ticket**: an `OPAQUE_ID`, single-use, five minutes
  (`TIMING.ticket`), standing for the command this module resolved, beside
  that command for the client to show and never send. The sign-in pop-up's
  socket names the ticket and `redeem` turns it back into the command once;
  when the command ends, `signedIn(ticket)` looks at the agent again and
  believes the session it opens. **Tickets are per folder**: the terminal
  route redeems through the agents of the vault it was addressed to, so a
  ticket minted in one workspace never runs in another.
- **`env_var`** — refused in words naming the variables: a key the person sets
  in their login shell, which Biom never holds. They set it there and press
  **Check again**, which reads the login shell again and looks.
- **no method at all** — Biom cannot sign it in: the person is told to sign in
  from its own command in a terminal, and **Check again** looks again.

**`authenticate` is never sent unasked** — on an agent already signed in it can
sign the person out, or open a browser for nothing. **Three agents are the
exception, and only they**: `AUTH_EVERY_PROCESS` — Grok Build, Cursor and Junie,
each unusable in a process that has not called it (the *Agent sign-in*
research carries a source for each). For those, `signedInWith(key)` answers the
method that last signed one in, and every process — a probe's and a chat's —
sends it before `session/new`.

**A sign-in that worked is news for every other open workspace**: the agents
module says `onSignedIn`, and the composition root calls `signedInElsewhere` on
every other folder's agents, which lifts the refusal there and, unless the
agent is Active there already, looks again. That look is never reported back
as a sign-in of its own, which is what stops the news echoing between two
folders.

## 5. The person's environment

**A desktop launcher hands the server none of the person's environment, so
the server asks their login shell** — `$SHELL -i -l -c`, printing its
environment between two random markers, bounded at ten seconds, with the
server's own `PATH` entries appended after the shell's so an agent the server
could see does not vanish because a profile reset `PATH`. `makeLoginEnv` is
constructed ONCE per server in the composition root and read the first time an
agent is looked for or started, never while the server comes up: **two
workspaces open at once are one person with one login.** Every agent a chat or
a probe starts, the sign-in pop-up's command, and Jev's key come out of it.
**It is read again only when `forget` drops the reading**, and only one thing
asks for that: Check again on an agent whose every way to sign in is a
variable, which the person has just set in their profile and a reading taken
at start would never see. Never automatically.

**Nothing of it is ever logged, sent to a client or written to a file.**
`AgentLaunch` — the command, its arguments and its complete environment — is
server-only; `AgentInfo` carries names, sentences and the agent's own lists;
`SignIn` carries the method's variables and nothing of the person's.

## 6. A chat

**One agent process per chat, started when a message needs it.** An open chat
nobody writes in costs no process: until the first message, the pickers and
the / menu come from the probe. **Every start mints a new `AgentId`** — the
first message, a restart after a crash, a reopening after the server
restarted, a switch of agent — because the history names a write by the agent
process that made it.

- **A held message.** `chat.new` may name no agent; its message is kept, its
  summary says `held`, and the first agent to turn Active takes it. **A message
  whose agent is not Active** — its Gateway down, installing, failed, being
  checked — **and which has no session of the chat's own open is held too**,
  and goes out when that agent turns Active; a session the chat has open is an
  agent that answers, whatever the list says. A message refused for want of a
  sign-in is held, and goes out once that agent has been seen Inactive and then
  Active again — never on the list it was refused against, and through at most
  two refusals.
- **One message at a time, and the rest wait in the chat's queue** — Biom's,
  because ACP has none. `chat.send` while a turn is held, starting or running
  puts the message in the queue, said as a `queued` update, kept in the chat's
  log (a `queue` record) and answered as a `ChatSent` with its place; the
  summary carries `queued` and `queueHeld`. When a turn ends `end_turn`, or
  is stopped — `cancelled` — the next queued message goes out by itself, one
  a turn — `unqueued` with `sent`, then the next turn's `prompt`: **Stop ends
  the turn and not the queue** (the sixteenth contracts edit; it held the
  queue before). After a red end, a crash, a closed agent (`chat.close`) or a
  restart the queue is HELD and nothing goes out until the person sends it
  (`chat.sendQueued`, **Send queued**), because an error should be seen
  before anything else goes; a message sent to the idle chat meanwhile goes
  out on its own and leaves the queue held, and a queue emptied is held no
  more. `chat.unqueue` takes one out by `queued`, its id — never `id`, which
  is the envelope's own. At most `QUEUE_MAX` (fifty) wait; one more is refused
  `limit` in words. **Stop** is `session/cancel`; an agent that has not
  answered within fifteen seconds (`cancelGraceMs`, where a test gives
  another) is ended, and what waits then goes to a fresh process, as any
  message after an agent has gone does. A Stop that lands while a queued
  message is on its way — out of the queue, its agent still starting —
  withdraws that message before any agent hears it, its turn ends
  `cancelled`, and the next goes on: nothing is sent twice, and the message
  stays in the chat as the turn that was stopped. Switching agent mid-turn is
  refused — Stop first — and a switch on a held chat re-targets it and mints
  nothing.
- **Send now** (`chat.sendNow`, by `queued`) sends one queued message ahead
  of the rest: the turn running is stopped exactly as Stop stops it — the
  same cancel, the same grace, one `session/cancel` however often it is
  pressed — and that message goes out the moment the turn has ended; with no
  turn running, a queue held after a red end or a restart included, it goes
  at once. The rest go on after it, one a turn, held or not: the person asked
  by hand. Which message goes next is the chat's `next`, IN MEMORY: the queue
  itself is never reordered, so it stays in the order every window draws it,
  and a restart forgets the pick and holds the queue as it was queued. A turn
  already ending on its own when Send now arrives ends as it was ending, and
  the pick still goes next; a turn that ends red holds the queue with the
  pick kept for Send queued. A message no longer waiting — sent already, or
  taken out — is `not_found` and stops nothing, so a second press after the
  message went never stops the turn it started. The message goes with the
  words and the page on screen it was queued with.
- **Permission is answered, never shown**: `allow_always`, else `allow_once`.
- **The light is the server's**: amber while working, green for ten minutes
  after `end_turn` (`GREEN_MS`), none after `cancelled`, red after a refusal,
  `max_tokens`, `max_turn_requests` or a crash — **and red stays until the
  chat's next turn starts.** It is computed from the last turn's end, so it
  survives a restart, and a green read back after one goes out when the rest of
  its ten minutes does.
- **A chat is named once**, from the first line of its first message, and its
  name's face picked once. An agent's `session_info_update` title does not
  rename it.
- **The page on screen goes with a message, and the person never sees it**
  (`server/domain/pagenote.ts`). A message sent while a page is on screen
  carries, after the person's words and as a text block of its own in
  `session/prompt`, Biom's note: the page's name, where its folder is, which
  of its screens — the page, its Instructions or its Automations — and that it
  is background that may or may not be what the message is about, wrapped in
  `<biom-context>`, a tag only Biom writes. **Which page** is read by the
  composition root off the sending window's context the moment `chat.send` or
  `chat.new` is answered (`history.contextOf`, then the page's head for its
  name and folder — never its body), and the window makes that exact: it sends
  a message only once every report it made before it is answered, and reports
  nothing after it until the message is. A message held or queued keeps the
  page it was SENT from — what the person was looking at when they wrote it —
  in the queue's log record too. **When**: the note goes unless the chat's
  session was last told that very page (same page, name, folder and screen) —
  so with the first such message, again only for another page, and again to a
  session that never heard it, a new one after a switch or after a restart on
  an agent that cannot reopen its own. What was told, and to which session, is
  a `told` record in the chat's log, kept only once the agent has answered the
  turn that carried it. **Never** on a `/` command, whose slash has to lead,
  and never with no page on screen — the full Agent screen, Design, the Map.
  **The page's name is neutralised** — one line, no angle bracket left to
  close the note or forge another, bounded — and no page's code can add to the
  note: the address is the host's own report and the name is the page's head
  on disk, which no inner kind writes. **The person never sees it** because
  nothing of Biom's own holds it: the `prompt` update, the chat's name, Jev's
  signals, the queue and the history are made from the words as typed.
  `withoutNotes` is the one strip for text an agent says back — the handoff
  reads each reply through it — and `user_message_chunk`, the person's words
  replayed, is never read.
- **The / menu** is the agent's `available_commands_update` — the probe's until
  the chat's own session sends one — and then every workspace skill it did not
  list, read fresh from `.agents/skills/`. A message naming a skill the agent
  did not list goes out as a sentence pointing at its `SKILL.md`, never as a
  `/name` that agent would not know.
- **Config** is the session's config options, an older agent's `modes` read as
  one `mode` option. A value picked with no agent running, or mid-turn, is kept
  and applied before the next message.
- **The choices are kept**, in the workspace's `.biom/settings.json`
  (`settings.ts`), by the server when they are made — so they hold whichever
  window made them, and across a restart. `chat.new` with an agent and
  `chat.switchAgent` keep the agent (`picked`); a picker set in a chat, or on
  the start screen for the chat a first message makes, keeps that agent's
  value BY CATEGORY (`chose`) — never an option that is no picker, and never a
  value the list does not offer. A new chat, and a switch, start on the
  agent's kept values (`saved`), laid under whatever the person set for that
  chat, on each picker the agent's list STILL offers them on — a model the
  agent has dropped is skipped without a word (`offeredChoices` in
  `choices.ts`). They are laid on at once against the probe's list, so the
  pickers show them before anything starts. No window sets a choice: each
  is kept by the server as the chat makes it, and `settings.read` is the one
  settings kind. A file that will not read is said once in the log, put
  aside as `settings.json.bad`, and the defaults are used: no agent, nothing
  kept. A file that still names a `view`, kept when a chat had three, reads
  as it is and without it, and the next write drops it.
- **Each chat keeps its own choices too** (`choices`, a record in its kept
  log): what the person picked in it, what it started on, and what the agent
  switched itself to while it ran (a `config_option_update` or
  `current_mode_update` naming a value it was not on — never one replayed by
  `session/load`). **Every session the chat's agent opens is brought back to
  them** (`restore`): a NEW one — after a restart or an idle end, on an agent
  that cannot resume or load, or after a switch — and a resumed or reloaded
  one that comes back on other values. Bringing a resumed session back undoes
  nothing the agent meant, because a change it made itself is already one of
  the chat's choices. A new session then takes the workspace's kept values
  for anything the chat never chose, and those become the chat's. A value the
  agent no longer offers is skipped and kept, in case it offers it again; one
  it is on already asks it for nothing; one it refuses is dropped. A switch
  starts the chat's choices again for the new agent. A log from before the
  chat kept choices of its own reads them back from the config it kept for its
  agent since it last changed.

## 7. The files, and every write reported once

**An agent's `fs/read_text_file` and `fs/write_text_file` are confined to the
vault** — both spellings of a root reached through a symlink tried, `..` and a
symlink out refused, nothing written inside `.git/` or `.biom/` — and the write
is `Files.write`, the atomic one, **over a `Files` built WITHOUT the vault's
`Seen`**, so the watcher takes it for what it is, a change this process did not
make on the person's behalf, and the page redraws.

**The vault is committed once per turn, before the turn's first write Biom
carries out** — the framework's rule that the server commits before an agent
writes, at the grain of a turn. What an agent writes with its own tools or its
own shell, Biom neither carries out nor sees coming, so nothing of Biom's is
committed before it.

**Every write Biom can see is reported once, through `ChatsDeps.onEdit` and
nothing else**, stamped with the agent's id and the turn (`edits.ts`):

- `fs` — a write Biom carried out. Exact.
- `tool` — a tool call of kind `edit`, `delete` or `move` once `completed`, by
  the paths in its diffs and locations. The agent's word for it.
- `shell` — the writes `shellwrites.ts` reads off a completed `execute` call's
  command line: `sed -i`, `>`, `>>`, `tee`, `mv`, `cp`, `rm`, `touch`, through
  quotes, `&&`, `;`, pipes and a literal `bash -c`. **Anything not read
  confidently is ignored, never guessed** — a `$(`, a variable, a glob, a loop
  yields nothing for the whole line — because a wrong name on an edit moves
  somebody's screen for a write that did not happen.

A path outside the vault, the root itself, and anything under `.git/` or
`.biom/` are nobody's edit. An `fs` write and the tool call that made it are
one edit. At the turn's end a **`changed`** update is kept: every file the turn
changed, its place — by `history.placeOf`, the history's own lookup, so the
two name a page the same way — what happened, and lines added and removed.
Runs and agents outside Biom are not recorded: they wait for the door.

## 8. The kept log, reopening, and the idle end

**Every chat's stream is appended as it arrives to `.biom/chats/<id>.jsonl`**
— under `.biom/`, which ignores itself in git and which the watcher skips: a
header, the chat's agent, its session, the config kept for the next start,
the chat's own choices, its queue, the page its session was last told, and
every update. At construction every log is scanned for its summary
(`Chats.loaded`; `chat.list` awaits it), and a chat's updates are read into
memory only when somebody reads or writes it. A turn the server died in is
ended `crashed` on the scan, and a line torn by a crash spoils only itself.

**A tool line is compacted**: its newer state replaces its older one IN PLACE,
carrying the newer `seq`, and the file is rewritten compact at a turn's end
once enough of it is superseded. So the stream keeps the order lines first
appeared in, and **`seq` rises across everything except a compacted tool
line** — a reader tracks the highest `seq` it has seen, reads `since` that, and
replaces a tool line by its id.

**A chat whose agent is gone** — closed, crashed, reaped, the server restarted
— starts it again on its next message and reopens the session by
`session/resume`, else `session/load` (whose replay is not news and is
dropped), where the agent offers them. Otherwise, and on every switch of
agent, the new session's first message is handed the chat so far, oldest
dropped past a bound and each reply without any note it quoted — and a
handoff a refused message was carrying stays owed to the session reopened for
its retry. What is owed is kept in memory, so a server restart in between
loses it.

**An idle agent is ended.** `reap()` ends a chat's agent that is at rest — its
session open, no turn held, starting, running or stopping — whose chat no
window has open (the history's `windows()`, handed down as `openIn`), with no
turn for thirty minutes (`IDLE_MS`), counted from the later of its last turn's
end and its process's start. The composition root asks once a minute. The chat
is untouched; its summary's `agentId` is null until the next message starts a
new one.

**A chat can be deleted** (`chat.delete`, *Chat*, `history`), and only after
the person's yes in Biom's own dialog. `delete` takes it out of every list and
every call at once, ends its turn and its agent as `close` does, removes its
kept log — after every write already asked of it, and writing nothing after —
and tells every window with a push saying `deleted`, which the stream's
gathering keeps as the last word on that chat. **Where the agent offers
`session/delete`** (`AgentFacts.deleteSession` in the one reading of the
protocol, which the probe reads too), it is asked to delete its own record of
the chat's session, so the chat is gone from the agent's own history as well:
over the chat's own process where it is at rest with that session open, else
— after that process has gone, so two never hold one session — over a process
started for it and ended after. It is best effort, in the background and
bounded (`FORGET_MS` a step), and a failure is said in the log in words of
Biom's own and undoes nothing. The kept choices and the history are left
alone: the history is history.

**No agent outlives its chat or the server.** `close` ends a chat's agent;
`endAll` ends every one TERM–grace–KILL, each turn in flight ended `crashed`
and its log flushed, and runs on `SIGINT`, `SIGTERM` and the shell's stdin pipe
closing, bounded at ten seconds (`AGENTS_ENDING_MS` in `main.ts`); `killAll`
is the synchronous KILL for the `exit` handler — a deleted chat's agent still
on its way out, and a process started to delete a session, among them. **The composition root also
keeps its own set of every connection it opened and has not seen close**, and
the exit handler KILLs those too: an agent still on its way out after a switch
is no longer any chat's, and only that set reaches it.

## 9. Jev — the faces

**Jev classifies; it never writes a word.** Each message the person sent
carries a face for what the agent makes of it, and each chat's name carries a
topic. `jev.ts` is three pieces in one file, each testable alone: `makeJev`
speaks the Jev API, `makeJevTurn` is one chat's schedule, and `makeJevStatus`
is the loop between them.

- **The state** is the person's message and the agent's thinking where it
  streams any, else its reply and its tools' titles — bounded, head and tail.
- **The schedule**: ten seconds into a turn, then every thirty, then once when
  it ends. The face flips only when the answer changes; `other` keeps the face
  there is; a closed chat is never written to.
- **The name's face** is one question on the name alone, asked once — after the
  login environment has landed, because that is where the key is.
- **The key is the login shell's `TYPESAFE_API_KEY`**, read on every ask and
  **never logged, sent to a client, written or put in an error**. No key, no
  call: Jev is off and no face appears. **The endpoint** is `BIOM_JEV_ENDPOINT`
  from the server's own environment, else TypeSafe's — https, or http on this
  machine only, because a bearer key is never sent in the clear. An outage is
  four backed-off retries and then a minute in which no chat asks.
- **The faces are vendored**, Google's animated Noto emoji for the two lists
  only, converted and credited — `vendor/README.md` and `NOTICE` — and served at
  `/vendor/noto/<code>.webp` as `image/webp`. Nothing is fetched while Biom runs.

## 10. The wire, the stream, and who may say any of it

**Every `agents.*`, `chat.*` and `settings.*` kind is outer ring** (`ChatRequest`,
narrowed by `isChatRequest`) and answered only on a vault's own route. `chatAnswer` in
`routes.ts` reads no field the guard did not check and makes one module call
per kind. A refusal a module throws with one of the closed codes is said in its
own sentence — written for a person, naming an agent or a chat and never a
path, a command or a value — and anything else is `internal`, logged by the
error's NAME only, because an agent's own words can be anywhere in a message.
**Nothing waits on an agent**: every kind answers the state as it stands, and a
verdict, a reply and a light arrive on the stream.

**The stream carries two events for this**, `chat` (a `ChatPush`) and `agents`
(the whole list), beside the history's. Each stream gathers for `GATHER_MS`
before it writes — a chat's pushes merged in order with a tool line's newer
state in place of its older, the agents list the latest only — so a streaming
reply is a push a frame and not a push a token. **Bun gives a streamed response
no backpressure**, so a stream is closed once it has written `STREAM_MAX_BYTES`
(32 MB); the client's `EventSource` reconnects. **Nothing is replayed**: after
any open a client reads again — `chat.read` from the highest `seq` it holds,
`agents.list` — which the protocol requires anyway.

**Every one of these kinds, and the stream, answers only this machine's own
window, in every build**: a loopback peer, a Host that is a loopback name on
this server's port, an Origin that is this server's own where one is sent, a
`Sec-Fetch-Site` of `same-origin` or `none` where one is sent, and the
per-launch `HttpOnly; SameSite=Strict` capability cookie — `localRefusal` in
`server/main.ts`, spent by `route`'s gate for every `isLocalKind` kind and
refused as `identity` in a sentence that names no check. **Talking to an agent
is command execution**: an agent answered `allow_always` does what it is told.
In a source run the page proxy can forge Host and Origin from a loopback peer,
and it can never present the cookie; a page on ANOTHER localhost port is sent
the cookie — a site ignores the port — and is refused by its Origin or its
`Sec-Fetch-Site`, which a browser never lets a page forge.
`tests/local-gate.test.ts` holds both on a real server.

## 11. The Agent screen: the look in the box, the input box in the host

**The Agent screen is a box on `@agent`, and everything in it but the input
box is a plugin a workspace can replace.** `page.read("@agent")` answers a bare
plugin page — no directory, no sections — drawn by `biom-agent`'s document,
which is one node; `guest/plugins/biom-agent/agent.js` mounts into it the
plugin its `look` variable names, `biom-agent-look` by default, and refuses in
words a look it cannot mount. A workspace names a look of its own in
`plugins/biom-agent/extensions.yaml`. Every write addressed to `@agent` is
refused by `pageDir`, no page may embed it, and a page route naming it — or any
`@` id — is refused by the shell, which never reads it and says *There is no
page called …*.

**What the look draws arrives, and it never fetches.** The host posts
`look.state` whole and `look.patch` for what moved, ONLY through the Agent
view's own `Frame.post` — `broadcast` throws on either — and the shim folds the
patches by the contract's rule and hands the look the state as it stands
through `biom.onLook(fn)`. The look is handed `names`, uid to page, because it
cannot resolve a `uid`; it draws in a shadow root of its own, an agent's words
only ever as text; it draws incrementally, the latest forty turns with more on
a press, a diff, an output and a block of thinking bounded where they are
drawn.

**A chat is drawn one way, and nothing draws a wall of tool calls**: the
words; the thinking FOLDED to one line — *Thinking* while it streams, then
*Thought for 4s* — which opens to the whole of it, bounded as an output is,
and shuts again; each RUN of tool calls — every call with no thinking and no
reply between them, the transcript's `acts` block — as ONE line, *Used 3
tools ›* (*Used 1 tool*), which opens to the calls one by one, each opening to
its diff or its output; and the pages the turn changed. There is no view to
pick: the owner chose one simple view (the sixteenth contracts edit took out
the three the thirteenth and fifteenth had made, and the ⋯ that picked them).
While the turn runs, its current run reads *Using 3 tools* with the call under
way after it, muted, and a run holding a failed call carries its red mark and
*1 failed* on the shut line, so a failure is never folded out of sight. The
thinking's line, the run line and each call line are buttons, reached by Tab
and worked by Enter and Space, and each keeps whether it is open while the
turn streams: a call joining an open run leaves it open, one joining a shut
run leaves it shut (`runWords` in `model.js`).

**What the look may say is eight things, and none of them is text**:
`look.open` a chat, `look.new`, `look.list` open or shut, `look.panel` to the
screen, beside the page or closed, `look.delete` from a row's three dots —
which asks for Biom's own dialog and deletes nothing — `look.unqueue` from a
queued message's ×, and `look.sendNow` from its Send now — each strictly
guarded, ids and words from a closed list — and `open` for a page a turn
changed. **Every one is honoured only just after a touch from that same box**,
as any box's `open` is: the `look.*` kinds move what is on screen, redraw the
look whole, put a question to the person or stop a turn to send what the
person queued, so a look on a loop can do none of them. `look.sendNow` names a
message by ids and carries none of its words: what goes out is the person's
own, typed in Biom's input box. The bridge refuses the
`look.*` kinds `identity` unless the
asking box is on `@agent` and the Agent screen has registered its answer
(`answerLook`), and the answer refuses every box but the one it mounted, by the
identity of that box's context. A page opened from the look comes up with the
chat in the panel beside it. **The input box is Biom's, in the host, over the
box**, so what reaches an agent is what the person types there and Biom's own
note of the page on screen (§6), and never a word a box says: the one line of
the eleventh contracts edit that may never move, which `boundary-guide` states
in full.

## 12. The host side: one box, and Biom's input box over it

**The window's copy of the chats, `client/store/chats.js`**, is the list of
chats — a union, but for a chat deleted, which is dropped and never taken
back: by a push saying `deleted`, by this window's own delete, or by the list
read on the stream's reopening leaving out a chat held before it was asked
for — what agents this machine
has, and **only the open chat's stream**, folded by the contract's rule and
held small: a tool line replaced where it first stood, a reply or a thought
arriving a few characters at a time held as one update per run, and a
`config`, `commands`, `usage` or `plan` kept as the last of each. A chat in the
background is its summary. **Nothing is replayed**, so `resync` runs on every
open of the stream and reads the list, the agents and the open chat from the
highest `seq` held, with what the stream brings meanwhile folded after it;
`epoch` moves whenever a chat's stream is read from the start, which is how the
view knows to hand the look that chat whole again. `lastSent(chat)` is when THIS
window last sent in that chat, by its own clock — the switcher's `lastSent`.
**Which chat a window has open is the ui store's `chat`**, kept with `panel` per
folder for the session in `sessionStorage` by `client/boot.js`, and an address
of `#/agent/<chat>` wins over it.

**One box serves the full screen and the panel, and it is never moved**, because
moving an iframe reloads it. `client/views/agent.js` builds ONE element, the
slot, which the shell puts in the bed beside the canvas once; its three shapes —
the whole screen on `#/agent`, the panel beside whatever else is on screen while
`panel` is set, nowhere — are the bed's `data-agent`, and shut it keeps running.
The box is mounted under `LOOK_KEY`, `@agent:screen` — not `@agent` itself, the
key a page of that id would be mounted under: the shell refuses `#/page/@agent`,
and a box ever mounted there would be one of its own that is never fed — with
ONE context object, whose identity is what `answer` checks. The look is posted
`look.state` when its box says hello and whenever the shape moves — the mode,
the list, the chat, the epoch — and `look.patch` for the rest, one a frame (a
timer flushes a hidden window's), and a patch that would carry more than
`PATCH_MAX` updates is posted as a state instead. It is handed `names`, the
pages its places name — from the window's directory, a page it does not know
asked for by id or `uid` and named in a patch once the answer lands; `input`,
where the input box sits; and `beside`, the page the panel sits beside, or the
last page this window's history shows, which is where the full screen minimises
to. The look's document is read again when the workspace changes on disk,
because a rung may have named another look. The panel's width is the grip's,
kept per browser.

**The input box is `client/views/agent-input.js`, host DOM over the look's box,
and the one place a chat's agent is handed words**: the text area's own value,
sent by Enter or Send as `chat.new` or `chat.send` — in line with the window's
reports (the history store's `inLine`), so the server adds the page that was
on screen when it was sent (§6). Under it the agent, model, mode and effort,
each the agent's own list, five shown and the rest behind
**More models** — the agent's own choices and nothing else, so nothing there
reads as how the chat is shown. **The start screen
starts where the person left off**: the agent chip defaults to the agent the
workspace kept as last picked while it is on this machine — this window's own
pick, or the last chat's agent, before it — and the pickers show that agent's
kept values its list still offers (`keptValues`), which is what the server
lays on the chat the first message makes; the store reads the kept choices on
every open of the stream, after this window makes a chat, sets a picker or
switches agent, and whenever the dock comes back to the start screen. **The
text area stays open while a turn runs**: with words in it the button is Send,
and sends them — or queues them behind the turn — and with none while a turn
runs it is **Stop**, as Escape is, which ends the turn and lets what waits go
on; **Send queued** shows under it while the chat's queue is held, after an
error or a restart. The look draws what waits: a muted bubble a message
under the running turn, *Queued* (*Queued · held*), each with **Send now**
saying `look.sendNow` and a × saying `look.unqueue`, which the Agent view
answers with `chat.sendNow` and `chat.unqueue`. Send now draws nothing ahead
of the answer — the message moves when the stream says it went — and a
refusal because it had gone already says nothing, while any other says
*Not sent now* on the line under the input (`AgentInput.say`). **A queued
message is sent when it goes out**, not when it was queued: the store's
`lastSent` moves when the stream's `unqueued` says this window's message left
the queue for its turn, so queueing never hands the screen over early — and a
message this window pressed Send now on is this window's, whichever window
queued it. **Go to *page*** is drawn
above it from the switcher's offer; the / menu lists the agent's commands and
the workspace's skills. **The whole dock carries `NOT_TOUCH`**: typing to an
agent is not a touch. A first message with no agent ready is sent all the same
and held by the server; More agents opens over it, saying so, when it was this
window that sent it a moment ago.

**Deleting a chat is asked in Biom's own dialog, never the look's.** Every
chat's row, in the history and in the panel's list, carries three dots — a
button beside the row, shown on hover and on focus and always reached by Tab —
whose one item, Delete, says `look.delete`. The Agent view answers it with
`confirm` — *Delete this chat? It can’t be undone.*, Cancel holding the caret,
Escape, a press outside and another question over it each no — and only the
Delete there says `chat.delete`. So a replaced look can never delete by
itself: asked on a loop, it raises questions. A window whose open chat is
deleted, here or elsewhere, goes to the start screen on the full screen and
shuts the panel beside a page.

**More agents and More models are `client/views/agent-dialogs.js`**: this
machine's agents then the registry's, filtered as the person types, each
Inactive agent with its one button — **Sign in** or **Start Gateway** — and a
registry agent with **Install**. Sign in runs the method the person picks: an
agent's own, a terminal one in the sign-in pop-up from the ticket, and an
`env_var` one named and never asked for. `client/css/agent.css` dresses all of
it, on the palette's tokens and its four lamps.

**The shell's half**: a window whose address names no screen opens on the Agent
screen, routed and drawn before the rail's first level is read, because nothing
on it waits for the tree; the rail's **Agent** row, in Dashboard's old slot,
counts the chats working and returns to the chat last open; **Home** is the page
tree's own heading; **Edit**, amber on the page bar, opens the panel beside the
page on a new thread with the caret at the end of the input
(`AgentInput.forPage`) — nothing is typed for the person, and a draft they had
typed on the start screen is kept, so with none the input is empty — and the
chat it makes when sent is that page's, the page going to the agent with that
first message as Biom's note (§6); the crumbs name the open chat with its
lamp, and the strip counts the chats and the Active agents.

## 13. Testing it with an agent

**No test runs an agent of the person's unless it is asked to by name.** The
agent every test talks to is `tests/fake-acp-agent.ts`: a real process speaking
ACP over stdio, driven by a scenario in `FAKE_ACP_SCENARIO`, steered and
echoed by the person's words — a prompt's first block — with every message it
heard, every block of a prompt included, in the scenario's `log`; which
`installFakeAgent` puts on a PATH under `claude-agent-acp` — a command name the
known-agents table already lists, so the server finds it by its real path and no
environment variable changes how anything loads.

**An end-to-end server finds no agent of the person's.** A window opens on the
Agent screen, and its first `agents.list` looks through the login shell, so a
server started with a developer's own environment found their real Claude
Code, Codex and OpenCode, fetched adapters with npx and left processes running.
`withoutAgents()` in `tests/e2e/harness.ts` gives a server bun, `/usr/bin`,
`/bin` and `/bin/sh`, and a walk that wants an agent puts the scripted one first
on that PATH. `tests/e2e/real-agent.e2e.ts` is the one walk against the person's
own Claude Code, on their login and subscription, and it runs only by name with
`BIOM_REAL_AGENT=1`: it is in no Makefile list and never in CI.

**The end-to-end targets run each file in a `bun test` process of its own** —
`make e2e` and CI's `make e2e-server` alike, over the one `E2E_SERVER` list.
Every file drives a Playwright of its own, and a browser launched after another
file in the same runner broke at the boundary: the chat walk then the Agent
screen walk failed three runs in three with *Target page, context or browser
has been closed* and a Stop that never ended, which `--isolate` fixed, and the
Agent screen walk then the startup walk still failed eleven in eleven with
`--isolate` — the startup file's first browser lost its pipe as it launched —
and passed three in three as two processes. A new file goes in `E2E_SERVER`
and gets a process of its own.

**A step that means to start a turn waits for the window's own Send.** A walk
that waited for a turn to end on the server's word can type before the window
has heard it — the chat gathers its pushes and the stream gathers them again.
What is typed then is no longer lost: the server sends it to an idle chat at
once, or queues it behind a turn still running. But a step that means a new
turn waits until the window agrees there is none, so its message is never
taken for one queued: the chat walk's `send()` waits for Send, and its
`typeAndEnter()` is for a message meant for the queue; the Agent screen walk's
step 10 waits too.

## 14. What is deliberately not built

- **The door**: no MCP server is handed to an agent; runs and agents outside
  Biom are not in the history; a write the watcher sees from no nameable writer
  is not an edit.
- Drawing `plan` and `usage` updates, which are kept and sent.
- A permission asked of the person: every request is answered.
- An agent reached anywhere but this machine: OpenClaw's Gateway on this
  machine only, and the local gate on every kind.

## Key files

```
server/platform/acp.ts          one connection: framing, settling, stderr tail, the group, kill
server/platform/acp-wire.ts     THE reading of ACP: handshake, session, pickers, commands, tools, WIRE_BOUNDS
server/platform/loginenv.ts     the login shell's environment, once per server until forget(), never logged
server/domain/agents-known.ts   KNOWN_AGENTS: which command is which agent, adapters, the Gateway
server/domain/agents-auth.ts    an agent's sign-in methods, and what a pop-up would run
server/domain/agents-registry.ts  the registry read as untrusted, and the install plans
server/domain/agents-archive.ts   an archive's table of contents judged before it is unpacked
server/domain/edits.ts          which action is an edit, vault paths, the bounded tool line
server/domain/shellwrites.ts    a command line's writes, conservatively
server/domain/jev.ts            STATUS_FACES, NAME_FACES, makeJev, makeJevTurn, makeJevStatus
server/domain/choices.ts        the kept choices read and written, PICKERS, offeredChoices, pickerCategoryOf
server/domain/pagenote.ts       PageOnScreen, noteOf, noteFor, isCommand, readOnScreen, withoutNotes: the page on screen as Biom's note
server/workspace/agents.ts      makeAgents: find, probe, install and its lock, sign in, tickets, AUTH_EVERY_PROCESS, TIMING
server/workspace/chats.ts       makeChats, readSkills: turns, light, files, onEdit, the kept log, reap, the kept choices laid on, the note and `told`
server/workspace/settings.ts    makeSettings: `.biom/settings.json`, read once, written whole, a broken one put aside
server/api/routes.ts            chatAnswer, CHAT_SENTENCES, pageOnScreen, the gate and `own` on route
server/main.ts                  LOGIN, jev, connections, the reaper, build()'s wiring and onScreen, events(),
                                localRefusal, the exit handler, endAgentsWithin
guest/plugins/biom-agent/       the Agent screen's document and mount; plugin.yaml's `look`
guest/plugins/biom-agent-look/  the default look: look.js (nodes, the row menu's togglePopup), model.js (decisions, runWords, request), sheet.js (the one way a chat is drawn)
guest/biom.js                   the look.state / look.patch fold and biom.onLook
client/store/chats.js           makeChatStore (a message sent through `inLine`; sendNow), fold, agentMode, showChat, freshThread, the pickers' rules
client/views/agent.js           makeAgentView: the one slot, LOOK_KEY, LOOK_THREADS, LOOK_HEAD, PATCH_MAX, answer (look.sendNow sent on here)
client/views/agent-input.js     makeAgentInput: the dock, measure(), Send and Stop, Go to page, say(), forPage (Edit's), NOT_TOUCH
client/views/agent-dialogs.js   makeAgentDialogs: More agents, More models, sign-in, confirm (Biom's own question)
client/css/agent.css            the slot's three shapes, the dock, the pop-ups, the lamps
client/bridge/bridge.js         answerLook, and the look.* case: @agent only, touch-gated
client/boot.js                  the chat store, the Agent screen, the context kept per session, the cold start
tests/fake-acp-agent.ts         a scripted ACP agent, a real process; installFakeAgent for a PATH
tests/acp.test.ts  acp-wire.test.ts  agents-wire.test.ts  agents.test.ts  agents-install.test.ts
tests/chats.test.ts  edits.test.ts  shellwrites.test.ts  jev.test.ts  jev-faces.test.ts  pagenote.test.ts
tests/loginenv.test.ts  chat-guards.test.ts  chat-route.test.ts  chat-host.test.ts
tests/local-gate.test.ts  stream-feeds.test.ts  reserved-screens.test.ts  agent-look.test.js
tests/settings.test.ts          the kept choices: the shape, the bounds, the file, a broken one put aside
tests/agent-host.test.js        the store, the pickers' rules, the bridge's answer, the Agent view against a double
tests/agent-input.test.js       the agent menu and More agents: two states, one button, Check again
tests/e2e/chat-server.e2e.ts    the chats, agents and history over HTTP and the stream, assembled
tests/e2e/agent-look.e2e.ts     the look in a real box in a real browser
tests/e2e/agent-screen.e2e.ts   the host side on a screen, against the scripted agent
tests/e2e/chat.e2e.ts           both specs on a screen: a turn, the lights, Edit and the note it hands the agent, the switcher on the window's clock
tests/e2e/real-agent.e2e.ts     the person's own Claude Code, opt-in: BIOM_REAL_AGENT=1, never in CI
tests/e2e/harness.ts            withoutAgents: a server's PATH with no agent of the person's on it
```

## This is a living document

This skill is the single source of truth for chat and the agents. Whenever
either genuinely changes — a protocol method read or sent, a bound, what makes
an agent Active, how one is installed or signed in, what a turn keeps or
reports, the light, the log, the look's contract — **update this skill in the
same change**. If a rule here is what diverged, fix the rule; if the
divergence is a mistake, fix the code. Either way they agree when you are done.
