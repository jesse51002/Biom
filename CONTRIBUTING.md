# Contributing

Short, because most of what you need is in [`AGENTS.md`](AGENTS.md) — the
conventions this code is written under — and in `.agents/skills/*-guide/`, one
guide per subsystem.

## Running it

```
make dev        # http://localhost:4400
make app        # build the application and install it where this desktop finds it
make help       # the rest
```

Bun and git are the only prerequisites. `make dev` fetches nothing: the server's
only third-party code is vendored in `vendor/` and served as it sits. The vault
it opens is `VAULT=` if you name one, otherwise the folder you last opened in
the app, otherwise nothing at all — a first launch shows the picker.

## The gates

Run these before you propose a change. They are the same three CI runs.

```
make check      # layering, then types, then every client module parses
make test       # the unit suite. Eleven seconds, and the gate before every commit
make e2e        # the program, assembled, on a screen. Needs a browser; minutes
```

**`make check` starts with the layering gate, which is the one that surprises
people.** A module may import only from a strictly lower layer, plus layer 0.
No sibling imports, ever. The layer of a module **is** the directory it sits in
— `layers.json` is the whole map and `tools/layers.mjs` is the gate — so there
is no per-file judgement and no exceptions list. When two modules in a layer
need each other, the shared thing moves down a layer; that is the entire
conflict-resolution procedure. Imports are static, one per line, at the top of
the file, because that is what lets the gate be a regex instead of a parser.

`make e2e` is not a prerequisite of `make test` and does not become one. It is
where a fault that is only visible in the assembled program gets caught, and it
is run for real before a release.

## `contracts/` is frozen

Changing it is the one edit that touches every module, so it happens at a
barrier and never while parallel work is in flight. If a type is wrong, say so
rather than widening it locally. `AGENTS.md` records each edit that has been
taken and the argument for it.

## Commits

One commit per coherent change, and the message is a sentence saying what
changed and why — not a conventional-commit prefix. The body is where the
reasoning goes, including what was tried and rejected; this repository's
history is meant to be read.

## The `AGENTS.md` files are living documents

There is one here and one in `vault/`, and each is authoritative for its own
directory. **When the code and one of them diverge, fix both in the same
change** — a stale rule produces false violations in review and misleads
whoever reads it next. The same is true of the subsystem guides: each is
updated in the change that alters the code it describes.
