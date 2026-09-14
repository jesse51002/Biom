# `_lib/`

**One import spelling that resolves in both places `check.ts` runs.** In this
repo these files re-export the real modules; in a vault the seeder overwrites
them with verbatim copies, because a vault has no `contracts/`.

**Nothing in here may reach further than this directory once it is copied.** A
vault has no `vendor/`, no `node_modules/` and — when it matters most — no
network, so a file that lands here carrying a bare specifier turns
`bun run .agents/skills/check.ts` into an unpinned install off npm that fails offline.
That is why `yaml.ts` is gone: `server/platform/yaml.ts` imports `yaml`, and
`check.ts` reads the page document itself rather than borrowing a parser it
cannot take with it. A test runs both readers over every `content.yaml` in the
repo and demands the same answer, which is what keeps one implementation from
becoming two opinions.

**Everything in here imports nothing at all, and that is the bar for landing.**
`contracts/wire.js`, `contracts/types.ts` and `contracts/scale.ts` each meet it.
`scale.ts` is here because the checker has to report what the page reader threw
away out of a `markdown.yaml`, and it can only do that honestly by calling the
same walk the reader calls — a second opinion about the grammar is the one that
sends somebody to fix a line that draws perfectly well.
