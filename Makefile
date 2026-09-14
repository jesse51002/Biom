# The Biom framework — the development framework whose developers are agents.
# Run from anywhere: make dev

MAKEFLAGS += --no-print-directory
SHELL := /bin/bash
HERE  := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
PORT  ?= 4400

# THIS MAKEFILE NAMES NO VAULT, and the omission is deliberate. It used to
# default `VAULT` to a folder beside the checkout, which made every unqualified
# `make dev` serve whatever workspace happened to be there — and made
# `make fresh`, whose help line promises a throwaway seeded folder, delete it. A
# fresh clone has no such folder at all, and a compiled binary has no repository
# around it.
#
# So the server decides: VAULT if it is named, else the last vault opened in the
# UI, else a vault in this machine's own data directory. Naming one is how a
# particular workspace is served, and it has to be explicit:
#
#   make dev VAULT=/some/workspace
#
# `VAULT=` is passed through only when it is set, so an empty one is the server's
# choice rather than an empty string it has to interpret — and QUOTED, because a
# workspace called `My Notes` is an entirely ordinary thing to have and an
# unquoted one would reach the server as two arguments and neither would be it.
VAULT_ENV = $(if $(strip $(VAULT)),VAULT="$(VAULT)",)
VAULT_SAID = $(if $(strip $(VAULT)),  →  $(VAULT),)

# HOW A BACKGROUND SERVER IS DETACHED, decided per machine rather than assumed.
# `setsid` is util-linux and is NOT on macOS, where `make up` failed on a missing
# command and then reported "it did not come up", which points at the server and
# not at the tool. `nohup` is POSIX, is everywhere, and buys the half that
# matters here — the server ignores the hangup when the make that started it
# exits. What it does not buy is a session of its own, so on a machine without
# `setsid` a Ctrl-C in that terminal during the few seconds `up` runs would
# reach the server too.
DETACH := $(shell command -v setsid >/dev/null 2>&1 && echo setsid || echo nohup)

.DEFAULT_GOAL := help

## help: list the targets
help:
	@echo "Biom framework"
	@sed -n 's/^## //p' $(MAKEFILE_LIST) | awk -F': ' '{printf "  \033[1m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  WHICH WORKSPACE. Nothing here names one: the server opens VAULT if you"
	@echo "  name it, otherwise the folder you last opened in the app, otherwise a"
	@echo "  vault of its own under your data directory. Nothing is ever written"
	@echo "  beside this checkout."
	@echo ""
	@echo "      make dev VAULT=/some/workspace"

## dev: serve the framework on PORT (default 4400), on the vault the server resolves
#
# CHECKS THE PORT FIRST, because the failure it prevents is unreadable: bun
# answers `EADDRINUSE` with a stack trace into `Bun.serve`, which says nothing
# about what is holding the port or what to do. `make up` leaves a detached
# server behind on purpose, so the two targets collide by design and the answer
# is one command.
#
# NO `install` PREREQUISITE, because the server needs none of it. What
# `bun install` fetches is Playwright, TypeScript and two type packages — 38MB
# that `types`, `browser` and `test` are for and that nothing the server runs
# touches. The only bare specifiers under server/, client/, guest/ and
# contracts/ are `markdown-it` and `yaml`, both vendored in `vendor/` and
# resolved by bun and by tsc through the same `paths` entry. So a stranger's
# first `make dev` fetches nothing at all.
dev:
	@if curl -sS -m 2 -o /dev/null http://localhost:$(PORT)/ 2>/dev/null; then 	  echo "  something is already serving http://localhost:$(PORT)" >&2; 	  echo "  stop it with:  make down PORT=$(PORT)" >&2; 	  echo "  or serve elsewhere:  make dev PORT=4401" >&2; 	  exit 1; 	fi
	@PORT=$(PORT) $(VAULT_ENV) bun run "$(HERE)server/main.ts"

## up: serve on PORT in the background, or say so if something already is
#
# `dev` holds the terminal, which is right when you are watching it and wrong
# when you just need a server up — before a `make brain`, or because a page has
# to be opened for a board to report its markdown.
#
# IDEMPOTENT, and it checks the PORT rather than the process list: what matters
# is whether something is answering, and a stale `bun` process that lost its
# socket is not. Detached with whichever of `setsid` or `nohup` this machine
# has (see DETACH), so it outlives the make that started it; its log is where
# the recipe says.
# No `install` prerequisite, for the reason `dev` gives above.
up:
	@if curl -sS -m 2 -o /dev/null http://localhost:$(PORT)/ 2>/dev/null; then 	  echo "  already up on http://localhost:$(PORT)"; 	else 	  mkdir -p "$(HERE).run"; 	  $(DETACH) env PORT=$(PORT) $(VAULT_ENV) bun run "$(HERE)server/main.ts" 	    > "$(HERE).run/server.log" 2>&1 < /dev/null & 	  for i in $$(seq 1 40); do 	    sleep 0.25; 	    curl -sS -m 2 -o /dev/null http://localhost:$(PORT)/ 2>/dev/null && break; 	  done; 	  if curl -sS -m 2 -o /dev/null http://localhost:$(PORT)/ 2>/dev/null; then 	    echo "  up on http://localhost:$(PORT)$(VAULT_SAID)"; 	  else 	    echo "  it did not come up; the log is $(HERE).run/server.log" >&2; 	    tail -5 "$(HERE).run/server.log" >&2; exit 1; 	  fi; 	fi

## down: stop the server on PORT
#
# ASKS THE PORT WHO IS HOLDING IT, rather than matching a process list, for
# the same reason `up` checks the port: what matters is what is answering. Two
# tools because neither is everywhere — `ss` is iproute2 and absent on macOS,
# `lsof` is not always installed on a slim Linux — so it tries the Linux-native
# one and falls back. Silence from both is reported as nothing on the port,
# which is also what a machine with neither tool would say.
down:
	@pid=$$(ss -lptnH "sport = :$(PORT)" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2); 	if [ -z "$$pid" ]; then pid=$$(lsof -ti tcp:$(PORT) -sTCP:LISTEN 2>/dev/null | head -1); fi; 	if [ -n "$$pid" ]; then kill $$pid && echo "  stopped $$pid"; else echo "  nothing on $(PORT)"; fi

## browser: fetch the Chromium the browser tools in .mcp.json drive, once per machine
#
# Lands in ~/.cache/ms-playwright. The revision is keyed to the playwright that
# @playwright/mcp bundles, which is why that package is PINNED EXACTLY in
# package.json: a caret bump would ask for a build nobody installed and fail
# with "Executable doesn't exist". Re-run this after bumping it.
browser: install
	@cd "$(HERE)" && bunx playwright install chromium

## install: fetch dependencies
#
# THE STALENESS CHECK IS IN THE RECIPE RATHER THAN IN A PREREQUISITE, and that is
# the same spaced-path bug one level up. A prerequisite is make syntax, where
# whitespace separates one name from the next and quotes are not a thing — so
# `install: $(HERE)node_modules` on a checkout called `My Framework` asked for
# two files, `/home/me/My` and `Framework/node_modules`, and the rule underneath
# built neither. Nothing can be quoted to fix it, so the condition moves into the
# shell, which can say it. It is the condition make was applying: fetch when
# there is no `node_modules`, or when `package.json` is newer than it.
install:
	@if [ ! -d "$(HERE)node_modules" ] || [ "$(HERE)package.json" -nt "$(HERE)node_modules" ]; then 	  cd "$(HERE)" && bun install && touch node_modules; 	fi

## app: build the application and install it where this desktop can find it
#
# ONE LINE, CALLING A SCRIPT, and that is the point of it. `bun run app` builds
# the same application with no make on the path, which is what the Windows runner
# types — so the build cannot live in a recipe only two of the three systems can
# execute. `tools/app.ts` carries all of it.
#
# `install` IS a prerequisite here, and it is the only build target where that is
# not a contradiction of `dev` fetching nothing. Electron and @electron/packager
# are build-time devDependencies exactly as TypeScript and Playwright are: the
# target that builds fetches them and no other does. `make dev` still
# costs a stranger nothing, and it is by far the largest thing bun install pulls
# into this repository.
#
#   make app                      the machine you are on
#   make app TARGET=windows-x64   one of the four
#   make app ARGS=--no-install    package it and stop — what CI runs
app: install
	@bun run "$(HERE)tools/app.ts" $(ARGS)

## uninstall: remove the installed application, its launcher entry and its icons
#
# THE REVERSE OF `app`'s LAST STEP AND NOTHING ELSE. It removes what the install
# wrote — the bundle, the `.desktop` entry, the icons it put in the theme — and
# no path above any of them. The vaults, the remembered list and everything else
# under this machine's data directory are not its to touch, and `tools/install.ts`
# is where that list is decided rather than here.
uninstall:
	@bun run "$(HERE)tools/install.ts" --uninstall

## check: the whole gate — layering, then types, then every client module parses
check: layers types parse
	@echo "check ok"

## layers: a module may import only from a strictly lower layer, plus contracts
layers:
	@bun run "$(HERE)tools/layers.mjs" "$(HERE)"

## graph: print the dependency diagram derived from the real imports
graph:
	@bun run "$(HERE)tools/layers.mjs" "$(HERE)" --graph

## manifest: write dist/embedded.ts, the generated module the compiled server carries its files through
manifest:
	@bun run "$(HERE)tools/app.ts" --manifest

## manifest-stub: write an EMPTY dist/embedded.ts, which is all tsc needs to resolve the composition root's import
#
# A STUB AND NOT THE REAL MANIFEST, for two reasons. The generated module opens
# with `@ts-nocheck`, so copying every carried file into `dist/files/` bought the
# typecheck nothing and cost a hundred-odd copies on every `make check`. And what
# a real one leaves behind in a development clone is a map of those copies, which
# is a thing a server run from source then has to be careful not to read.
manifest-stub:
	@bun run "$(HERE)tools/app.ts" --stub

## types: typecheck the server outright and the client through its JSDoc. Needs a manifest, because main.ts imports one
types: install manifest-stub
	@cd "$(HERE)" && bun x tsc --noEmit

## parse: parse every module the browser loads. No build step, so this is the floor.
parse:
	@bun run "$(HERE)tools/parse.mjs" "$(HERE)"

## test: server-side unit tests, weighted to yaml.ts and bridge.js
test: install
	@cd "$(HERE)" && bun test

## e2e: the program, assembled, on a screen. Not part of `test` — it needs a browser and takes minutes
#
# THE OWNER'S DECISION, ON 2026-09-14: *"we need end-to-end testing; every issue
# I found could have been found by just running it, especially the startup
# flow."* Every one of those was invisible to the unit suite and obvious in the
# first ten seconds of a real run — a remembered vault opening instead of the
# picker, a stack trace on every launch, Electron's own menu bar, no way to full
# screen, a rail row that was in the source and not in the build.
#
# TWO LAYERS AND ONE COMMAND. `server.e2e.ts` runs `server/main.ts` the way `dev`
# does and drives it in a headless Chromium; `app.e2e.ts` starts the PACKAGED
# application and asks the window it opened. The second SKIPS, with a named
# reason, where there is no bundle or no screen — build one with `make app`, and
# on Linux it takes a display of its own through `xvfb-run` where there is one.
#
# NAMED EXPLICITLY, WITH A `./` IN FRONT, and both halves are load-bearing. The
# files end in `.e2e.ts` rather than `.test.ts` so `bun test`'s own discovery —
# `.test.`, `_test_`, `.spec.`, `_spec_` and nothing else — walks straight past
# this directory and `make test` stays the eleven-second gate it is. And bun
# reads a BARE path as a filter against that same glob, which matches nothing at
# all; a path with a `./` in front is a file to run.
#
# `browser` rather than `install`, because layer one needs the Chromium as well
# as the packages, and that target fetches it once per machine.
#
#   make e2e                              both layers
#   make app && make e2e     including the packaged one
#   E2E_NO_SANDBOX=1 make e2e             a container with no user namespaces
e2e: browser
	@echo "  screenshots        →  $(HERE)dist/e2e/"
	@cd "$(HERE)" && bun test ./tests/e2e/server.e2e.ts ./tests/e2e/startup.e2e.ts ./tests/e2e/app.e2e.ts

## fresh: drop a vault in the per-user data directory so opening it sets it up again
#
# CONFINED TO THE PER-USER DATA DIRECTORY, and pointed anywhere else it refuses,
# says which path and why, and exits non-zero. This was `rm -rf $(VAULT)` with
# `VAULT` defaulting to a workspace beside the checkout — so the command whose
# help line promises a throwaway folder deleted every page and every board in a
# real one. `tools/fresh.ts` carries the rule, because which folder is this
# machine's is a platform question a Makefile cannot answer.
fresh:
	@bun run "$(HERE)tools/fresh.ts" "$(VAULT)"

## clean: drop dependencies
clean:
	@rm -rf "$(HERE)node_modules"
	@echo "cleaned"

.PHONY: help dev up down install browser app uninstall check layers graph manifest manifest-stub types parse test e2e fresh clean
