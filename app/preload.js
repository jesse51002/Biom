// SPDX-License-Identifier: AGPL-3.0-only
// THE ONE WAY IN, AND THIS FILE IS THE WHOLE LIST OF IT.
//
// The shell used to inject nothing at all, and the comment beside the window
// said so: no preload, no bridge, no second way in. That held until the picker
// needed a folder, which is the one thing a web page cannot give. A browser
// cannot hand out an absolute path — by design, and no amount of client code
// changes it — so the built application's chooser has to be the operating
// system's own dialog, and a dialog lives in Electron's main process.
//
// IT IS NO LONGER ONE FUNCTION, AND THE REASON IS THE TITLE BAR. The owner
// decided on 2026-09-14 that the application draws its own, the way VS Code,
// Discord and Slack do: the desktop's bar is not the same bar twice — GNOME
// hides the maximise button by default and offers no full-screen button at all
// — and a window whose controls are drawn by the page has the same controls on
// every machine, in the product's own type. A page that draws the controls has
// to be able to WORK them, and minimising a window is as far outside a web
// page's reach as an absolute path is.
//
// SO THE BRIDGE IS THREE THINGS AND THE LIST IS CLOSED.
//
//   · `chooseFolder()` — the operating system's folder dialog, answering one
//     absolute path or null.
//   · `logo()` — the one committed picture of the mark, as a data URL, because
//     `app/` is not a served directory and a copy of the logo under `client/`
//     would be a second copy of the logo.
//   · `windowControls` — THIS window: minimise it, maximise or restore it, full
//     screen it, close it, read which of those it currently is, and hear when
//     that changed because something other than our button did it. Plus the two
//     facts the bar cannot work out for itself: whether the platform draws its
//     own controls (macOS does — the traffic lights ARE the controls, and a Mac
//     window that drew three dots of its own would be wrong in a way every Mac
//     user can see) and how much room to leave them.
//
// Nothing else crosses. No node, no `fs`, no `shell.openExternal`, no
// `ipcRenderer` handed through, and no channel that takes a window id — there
// is one window, and a channel that took an id would be a channel a page could
// aim somewhere else. Every act is a call, so what the page holds is the
// ability to ask rather than the ability to reach.
//
// WHAT KEEPS `make dev` AND THE BUILT APPLICATION ONE PROGRAM is that the
// absence of all of it is a supported state rather than a broken one. A plain
// browser has no `window.biomShell`: the picker sees that and draws the served
// Browse listing instead, and the shell sees it and draws no title bar at all —
// the page in a browser tab is exactly the page it was before any of this.
//
// contextIsolation is on and nodeIntegration is off in `app/main.js`, so this
// runs in its own world and `contextBridge` is the only thing that crosses.

const { contextBridge, ipcRenderer } = require("electron");

/** What `app/main.js` answers on. Named here and there, and nowhere else. */
const CHOOSE = "biom:choose-folder";
const LOGO = "biom:logo";
const MINIMIZE = "biom:window-minimize";
const MAXIMIZE = "biom:window-maximize";
const FULLSCREEN = "biom:window-fullscreen";
const CLOSE = "biom:window-close";
const STATE = "biom:window-state";
/** The only channel carrying something the page did not ask for. */
const CHANGED = "biom:window-changed";

/** DOES THE PLATFORM DRAW THE WINDOW'S OWN CONTROLS. macOS does: the window is
 *  made `hiddenInset`, so the traffic lights are still there, sitting inside
 *  our bar. Everywhere else the bar is empty and ours to fill. */
const LIGHTS = process.platform === "darwin";

/** How much room the lights need at the left of the bar, in CSS pixels. The
 *  `hiddenInset` style reports no number to read, and 78 is the width of the
 *  three lights plus their margins at the standard inset. Zero where we draw
 *  them ourselves. */
const INSET = LIGHTS ? 78 : 0;

contextBridge.exposeInMainWorld("biomShell", {
  /** The operating system's folder dialog. Resolves to an absolute path, or to
   *  null when the person cancelled — which is an ordinary answer and not an
   *  error, because cancelling a chooser is a thing people do.
   *  @returns {Promise<string | null>} */
  chooseFolder: () => ipcRenderer.invoke(CHOOSE),

  /** The mark, as `data:image/png;base64,…`, or an empty string when the file
   *  could not be read — in which case the bar draws its name and no mark,
   *  which is better than a broken image in the corner of the window.
   *  @returns {Promise<string>} */
  logo: () => ipcRenderer.invoke(LOGO),

  /** THIS WINDOW. Its presence is what tells the client to draw a title bar at
   *  all, so it is one object rather than six loose keys: the client tests for
   *  the object, and a browser that has none draws nothing. */
  windowControls: {
    /** @returns {Promise<void>} */
    minimize: () => ipcRenderer.invoke(MINIMIZE),
    /** Maximise it, or restore it if it is already maximised. One act, because
     *  the button is one button and it knows which it is from `state`.
     *  @returns {Promise<void>} */
    toggleMaximize: () => ipcRenderer.invoke(MAXIMIZE),
    /** @returns {Promise<void>} */
    toggleFullScreen: () => ipcRenderer.invoke(FULLSCREEN),
    /** `close`, not destroy: it goes through the same path the desktop's own
     *  button went through, so the server is stopped with the window.
     *  @returns {Promise<void>} */
    close: () => ipcRenderer.invoke(CLOSE),
    /** Which of those the window currently is.
     *  @returns {Promise<{ maximized: boolean, fullScreen: boolean }>} */
    state: () => ipcRenderer.invoke(STATE),
    /** IT CHANGED WITHOUT OUR BUTTON. F11, a double-click on the bar, a drag to
     *  the top of the screen, a tiling window manager. Answers the way to stop
     *  listening, so a listener is never a thing this file leaks.
     *  @param {(state: { maximized: boolean, fullScreen: boolean }) => void} hear
     *  @returns {() => void} */
    onChange: (hear) => {
      const on = (/** @type {unknown} */ _event, /** @type {any} */ state) => hear(state);
      ipcRenderer.on(CHANGED, on);
      return () => ipcRenderer.removeListener(CHANGED, on);
    },
    /** True where the platform draws close, minimise and zoom itself, which is
     *  macOS and only macOS. The bar draws those three where this is false,
     *  and draws full screen either way. */
    lights: LIGHTS,
    /** CSS pixels to leave clear at the left of the bar for them. */
    inset: INSET,
  },
});
