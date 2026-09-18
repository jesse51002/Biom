# How do I run something from here?

This is the page for that question. An **automation** is a folder under a page
that says what to run; a **run** is the workspace starting it, as a process on
this machine, in a directory of its own, with a row and a log that outlive it.

The workspace runs no model of its own and owns no agent. It presses the button
on a command you already have — your own harness, your own login — and watches.
What it knows about a run is the row: what started, when, how it ended. What the
run *meant* is the page's to draw from what the run wrote. The judgement half —
how to write an automation well, how a page reads what its runs wrote — is in
[`../.agents/skills/`](../.agents/skills/), which this file does not repeat.

## An automation is a folder

A page holds its automations under `automations/` in its directory, one folder
each, and a page may hold several — a pull and a digest, a run and its answer.

```
pages/home/children/Socials/
  content.yaml               the page, which draws what its runs wrote
  INSTRUCTIONS.md            the page's instructions, read by every run under it
  automations/
    pull/
      automation.yaml        the manifest: what to run, and what it needs
      kickoff.md             the prompt, with {input} placeholders
      INSTRUCTIONS.md        this automation's own instructions, on top of the page's
      skills/                this automation's skills
      code/                  scripts the command runs, by relative path
```

A folder is an automation when it holds `automation.yaml`. The manifest is thin
on purpose — it says only what the workspace has to know:

```yaml
name: Pull
description: Pull the week's posts and what came back.
agent: python               # a label for people; nothing reads it
env: [APIFY_TOKEN]          # names the run needs, checked present, never a value
command: [python3, code/main.py, --window, "{window}"]
inputs:
  - { name: window, type: number, default: 7 }
  - { name: dry, type: boolean, default: false }
```

`command` is a **list**, never a shell string, so an input cannot become a second
command. In it and in `kickoff.md`, `{window}` is an input, `{vault}` is the
workspace's absolute path, `{run}` is the run's own directory and `{kickoff}` is
the substituted prompt file. `env` is **names only**: each is checked present in
the environment the server was started with, and the run is refused by name when
one is missing. A value is never read from a file in the workspace and never
shown on a screen.

An agent-run automation names its harness's command with the flag that grants it
the workspace, because a harness sandbox does not follow a symlink on its own:

```yaml
name: Write the skills
agent: claude
command: [claude, -p, "@{kickoff}", --add-dir, "{vault}", --permission-mode, acceptEdits]
inputs:
  - { name: tag, type: text, required: true }
```

## Three files of instructions, and one that is not yours

`INSTRUCTIONS.md` is yours, at three levels, and each outranks the one above it:

| Where | Whose | Read by |
|---|---|---|
| `INSTRUCTIONS.md` at the workspace root | the workspace's | every agent opened anywhere in the folder, first |
| `INSTRUCTIONS.md` beside a page's `content.yaml` | the page's | every run under that page, and an agent pointed at the page |
| `INSTRUCTIONS.md` beside a manifest | the automation's | that automation's runs |

`AGENTS.md` is **the framework's**, at every level: the one at the workspace root
is seeded by the app, and the one in a run directory is written fresh for every
run. Neither is a file you edit. The run's `AGENTS.md` is what a harness finds on
its own, because it is in the working directory, and it names the three
`INSTRUCTIONS.md` files in the order they are read — so nothing is prepended to
your prompt, and your kickoff is your file, substituted and nothing more.

## Where a run lives, and what it leaves

Every run gets a directory of its own under `.biom/runs/<id>/`, and the process
starts there:

```
.biom/runs/r1k7x2m9a4bc/
  automation.yaml            a copy — the record of what ran
  kickoff.md                 a copy, with the inputs written in
  INSTRUCTIONS.md            a copy of the automation's
  skills/         →  the automation's skills/
  code/           →  the automation's code/
  page/INSTRUCTIONS.md  →  the page's
  vault/          →  the workspace root
  AGENTS.md                  written by the framework: where everything is, what to read
  CLAUDE.md       →  AGENTS.md
  .agents/skills/ →  skills/            .claude/skills/ → skills/
  .claude/settings.json  .codex/config.toml  opencode.json  .gemini/settings.json  .cursor/cli.json
  stdout.log                 what the process printed
  stderr.log
```

The copies are the record; the links are what an environment built later would
belong to, and the workspace's own history already records their version.
Scratch written here stays here — only what goes through `vault/` or the API is
real. The process gets `BIOM_VAULT`, `BIOM_RUN` and `BIOM_API` in its
environment, the names it asked for, and the floor every process needs (`PATH`,
`HOME` and their kin) — nothing else of the server's. Rows go to the workspace's
tables through the API at `BIOM_API`, never by opening `workspace.db`.

**`.biom/` is the framework's folder inside your workspace and it ignores
itself**: the registry `runs.db` and every run directory are this machine's, and
never in git.

## What a row says

| | |
|---|---|
| `running` | alive now. Kill ends it: the whole process group, TERM, a short grace, KILL |
| `exited` | ended on its own, with its exit code |
| `killed` | ended by a page, by the overview, or by the application closing |
| `lost` | the server started again and found no process behind a row still marked running |

Two runs of one automation at once are allowed and warned about. A finished run
keeps its directory and its row until deleted. **Closing the application over a
live run asks**: yes ends every run and closes, no keeps both. A server ended
without the question — Ctrl-C, a crash — ends every run it can on the way out,
and what it could not update reads `lost` on the next open.

## The two screens

**Instructions** and **Automations** are the two controls on a page's bar. The
first is one editor over the page's `INSTRUCTIONS.md`. The second is this page's
automations: **Manifest** as a form (the server writes the yaml, so a file edited
by hand and one edited by the form are the same file), **Files** as a tree of everything else in the folder — never the manifest,
which the Manifest screen is — with a text editor beside it and the workspace's
own skills greyed under it, and
**Runs** with the inputs as they will be asked, Run, and every run of this
automation with its last line of output raw and the whole log a click away.
Every change is written a moment after it is made; there is nothing to press.

The rail's foot has the same two words for the workspace: **Instructions** is the
workspace's `INSTRUCTIONS.md` and its own skills under `.agents/skills/` in one
tree, and **Automations** is what is running now across every page, what has
finished, and Start.

**The first thing on every one of those screens is a line to hand your agent,
with Copy.** Asking is the path this workspace is built for; the forms are the
by-hand path under it.

## From a page's own code

A page may list every automation, start one, follow any run's log and end one —
`biom.automations`, `biom.start`, `biom.runs`, `biom.run`, `biom.readRun` and
`biom.kill`, which [`code.md`](./code.md) lists with the rest and walks through. `run.read` hands back bytes from an offset and the next offset, so a page
follows a live log by asking again and stops when the answer says the run has
ended. A run a page starts is stamped with that page's identity as *started by*,
whatever the page said.

## What is deliberately not here

No agent is known by name: there are no adapters, no session, no resume. A page
that wants to pick up where a harness left off reads the run's log and does it.
No line of a log is parsed by the framework: it serves the bytes and the meaning
is the page's. No dependencies are built: a command runs on this machine with the
server's own `PATH`, and a folder that only works on the machine it was written
on is, for now, your problem to notice. No scheduler: a run is a button, pressed
by a person or by a page.
