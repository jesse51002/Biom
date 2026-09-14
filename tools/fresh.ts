// SPDX-License-Identifier: AGPL-3.0-only
// `make fresh` — drop a vault so opening it again sets it up again.
//
// IT DELETES ONLY INSIDE THE PER-USER DATA DIRECTORY, and that confinement is
// the whole reason this is a program rather than a line of `rm -rf` in the
// Makefile. The rule used to be `rm -rf $(VAULT)` with `VAULT` defaulting to a
// workspace beside the checkout — so `make fresh`, typed by somebody who had
// read the help and expected a throwaway seeded folder to go, deleted every
// page and every board in a real one, with no prompt and no way back.
//
// Which folder counts as this framework's to delete is not a question a Makefile
// can answer: the data directory is XDG on Linux, `Application Support` on
// macOS and `%LOCALAPPDATA%` on Windows, and `server/workspace/vault.ts` is the
// one place that is worked out. So the decision is made there and this is the
// command around it.
//
//   bun run tools/fresh.ts                 the default vault
//   bun run tools/fresh.ts <path>          any vault inside the data directory
//
// Anything else is refused by name, with the reason, and a non-zero exit.

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { dataHome, defaultVault, insideDataHome } from "../server/workspace/vault.ts";

const named = process.argv[2]?.trim();
const target = resolve(named !== undefined && named !== "" ? named : defaultVault());

if (!insideDataHome(target)) {
  console.error(`  fresh refuses to delete ${target}`);
  console.error(`  it drops only a vault inside ${dataHome()} — a workspace anywhere else`);
  console.error(`  is somebody's work, and this command has no way of telling which.`);
  console.error(`  Delete it yourself if that is genuinely what you meant.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
console.log(`vault dropped — ${target}`);
console.log("opening that folder again sets it up from scratch");
