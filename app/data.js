// SPDX-License-Identifier: AGPL-3.0-only
// WHERE THIS MACHINE KEEPS ITS BIOM DATA, as the SHELL has to answer it.
//
// The server already answers this — `dataHome()` in `server/workspace/vault.ts`
// — and the shell cannot ask it: the server is a compiled binary the shell has
// not started yet at the moment this is needed, and the module behind it is
// TypeScript in a tier the Electron main process is not on. So the rule is
// mirrored here, in the plainest JavaScript, and `tests/app.test.ts` holds the
// two answers equal rather than trusting that they were written the same.
//
// It is one function and it is deliberately the whole of this file. A shell that
// grew a second idea about where the person's data lives would be a second place
// the product is described, which is the thing `app/main.js` exists not to be.
//
// WHAT THE SHELL WANTS IT FOR is a cache directory of the application's own —
// see `ownFontCache()` in `app/main.js`. Nothing else here reads it.

const { homedir } = require("node:os");
const { isAbsolute, join } = require("node:path");

/** The folder this machine keeps its Biom data in. The same rule the server
 *  applies, including the XDG one that a RELATIVE `XDG_DATA_HOME` is ignored —
 *  the spec defines the variable as an absolute path, so a relative one is a
 *  misconfigured environment rather than a folder to create under whatever
 *  directory the application happened to be launched from.
 *  @returns {string} */
function dataHome() {
  const home = homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    return local !== undefined && local.trim() !== "" ? join(local, "Biom") : join(home, "AppData", "Local", "Biom");
  }
  if (process.platform === "darwin") return join(home, "Library", "Application Support", "Biom");
  const xdg = process.env.XDG_DATA_HOME;
  return xdg !== undefined && isAbsolute(xdg) ? join(xdg, "biom") : join(home, ".local", "share", "biom");
}

module.exports = { dataHome };
