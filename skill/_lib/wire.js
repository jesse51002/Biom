// SPDX-License-Identifier: AGPL-3.0-only
// A shim, and it exists so `check.ts` has ONE import spelling that resolves in
// both places it runs. In this repo it re-exports the real module. In a vault
// the seeder overwrites it with a verbatim copy of that module, because a vault
// has no `contracts/` to reach back to. One source of truth either way — the
// copy is mechanical, so it cannot drift into saying something different.
export * from "../../contracts/wire.js";
