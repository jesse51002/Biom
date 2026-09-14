// SPDX-License-Identifier: AGPL-3.0-only
// The start page: which folder this workspace IS. Layer 14.
//
// ─────────────────────────────────────────────────────────────────────────────
// PICKING A FOLDER IS THE WHOLE OF GETTING STARTED
// ─────────────────────────────────────────────────────────────────────────────
//
// WITH NO WORKSPACE OPEN THIS IS THE APPLICATION, and it is written as the first
// ten seconds rather than as a settings screen. The mark, the project's one line
// — `HEADLINE` below, which is the site's own headline word for word — and two
// buttons. NOTHING ON IT EXPLAINS THE PRODUCT: a person who has just launched it
// is one click from the folder dialog, and a sentence in the way is a sentence
// they have to read before they are allowed to start. So there is no tagline, no
// note under a group, and no heading over a block with nothing in it — `Recent`
// is absent when nothing has been opened, and a first launch says nothing at all
// about there being no workspace.
//
// IT USED TO BE SETTINGS AS WELL, reached from the rail's foot with a folder
// already open and drawn inside the chrome — the same screen with an `Open now`
// block over `Recent` and the open folder kept out of the list. The owner
// decided (2026-09-14) that it does exactly what this screen does and looks five
// times worse, so that screen went and the act stayed: `Close workspace` in the
// rail's foot navigates to `closeHref` below, which is this window's address
// minus the folder, and the window comes back HERE. Nothing is open while this
// is up — so there is no folder to name, nothing to keep out of `Recent`, and
// `vault.info` is not asked. `.vstart` on the sheet is whether there is a native
// dialog; `is-step` is the name step standing in place of the actions.
//
// The workspace used to be wherever an environment variable said, which is a
// thing somebody has to be told. It is chosen here instead, and opening an EMPTY
// folder sets it up — the root page, the vault's `AGENTS.md` and skills,
// `design/`, `base/` and the theme — so there is no second step called "seed it".
// A folder that already holds anything is refused rather than set up, and the
// refusal says so where it happens — the served listing still carries the note
// saying both halves, because promising only the first sent people to open
// folders that then would not open.
//
// THERE ARE TWO CHOOSERS AND THE SCREEN PICKS ONE BY ASKING WHAT IT IS RUNNING
// IN. In the built application `window.biomShell.chooseFolder` is there — the
// shell's one injected function, the operating system's own folder dialog — and
// it is what Open and Create's parent both go through. In a browser it is not
// there, and the fallback is the Browse group: the server walking its own
// filesystem and drawing a directory listing.
//
// THE FALLBACK NEEDS SAYING RATHER THAN HIDING. A browser cannot hand out an
// absolute path, and the vault lives on disk beside the agent that edits it, so
// in `make dev` the path has to be the server's. It is only reasonable because
// this framework is local and unsecured BY DECISION, and the production server
// refuses `vault.browse` outright — see NATIVE_DIALOG below. The product's
// answer is a workspace on a server and looks nothing like either of these —
// none of this screen is a pattern to carry forward.
//
// MAKING ONE IS A PARENT AND A NAME, and it is deliberately not a path field.
// The person picks a folder they already have — with the dialog, or with Browse
// where there is no dialog — and types a name; the app makes that folder inside
// it. There is no default path and no `~/Biom`: a prefilled absolute path is a
// decision made for somebody about a folder they have not looked at.
//
// A FIRST LAUNCH IS WHAT THIS SCREEN IS FOR. With nothing remembered and no
// `VAULT`, the server mounts nothing, the client routes here, and this is the
// only thing on the screen that can produce a workspace. The name step is a
// STATE of it rather than a group drawn beside the actions: the dialog answering
// is what opens the step, and until it has there is nothing for a name field to
// be a name inside.
//
// It is built once and kept. Opening a vault emits from the store twice, which
// repaints the shell — and a new tree here would take the list out from under
// the click that is still resolving.

/** @import { DirEntry, DirListing, UiStore, VaultInfo, WorkspaceStore } from "../../contracts/types.ts" */

import { ROOT_PAGE } from "../store/workspace.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

/**
 * @typedef {object} VaultViewDeps
 * @property {H} h
 * @property {WorkspaceStore} ws
 * @property {UiStore} ui
 * @property {boolean} [production] which build this is; absent means
 *   development. It decides one thing here — whether the Browse listing may be
 *   drawn at all — and NATIVE_DIALOG below is why.
 * @property {(() => Promise<string>) | null} [logo] THE MARK, as a data url. It
 *   is `window.biomShell.logo` — `app/` is not a served directory, so the one
 *   committed picture of the mark reaches the window over the bridge and nowhere
 *   else. Absent means "ask the shell"; null is a browser, where the screen
 *   wears the word alone rather than a broken image.
 * @property {(() => Promise<string | null>) | null} [chooseFolder] the operating
 *   system's folder dialog, answering an absolute path or null for a cancel.
 *   Absent means "ask the shell", which is `window.biomShell.chooseFolder` when
 *   there is a shell and nothing at all in a browser; a test hands in a fake, or
 *   null to be a browser.
 * @property {(url: string) => void} [navigate] how to leave for another
 *   workspace. Defaults to the browser's own. A test hands in a fake, because
 *   this is the one view whose job ends with the document being replaced.
 * @property {string} [search] THE QUERY THIS WINDOW WAS OPENED WITH, which every
 *   address this screen builds carries forward. Defaults to the real one. A test
 *   hands in a string, because a window this module did not open is the only way
 *   to state what it must keep.
 */

/** WHETHER THE NATIVE DIRECTORY DIALOG IS BUILT. It is, so this is true.
 *
 *  The Browse group is the server walking its own filesystem and drawing a
 *  directory listing, which is a developer's screen and belongs on the
 *  production hide list. It was the one item on that list that could not go
 *  alone: Browse is not only how a parent folder is chosen, it is the only way
 *  to reach a workspace that is already on disk and not in `Recent`, so hiding
 *  it before something else served Open as well as Create would have left a
 *  built application that could not reach a folder at all. `app/preload.js` is
 *  that something else, and this constant is what released the hide.
 *
 *  IT IS ABOUT PRODUCTION, NOT ABOUT ELECTRON. The listing goes on being drawn
 *  wherever there is no dialog and the server will still answer — which is
 *  `make dev` in a browser, and nothing else. Its twin is
 *  `NATIVE_DIALOG` in `server/api/routes.ts`, which refuses `vault.browse` on
 *  the same condition; the two cannot be one constant, because `contracts/` is
 *  the only file both could import from and it is frozen, and a test holds the
 *  two literals equal. */
const NATIVE_DIALOG = true;

/** The shell's one injected function, or null when there is no shell. Read
 *  through a lookup rather than destructured at load, so a module that is
 *  imported before the preload has run still sees it. */
function shellChooser() {
  const shell = /** @type {{ biomShell?: { chooseFolder?: unknown } }} */
    (/** @type {unknown} */ (globalThis)).biomShell;
  if (shell === undefined || typeof shell.chooseFolder !== "function") return null;
  const chooseFolder = /** @type {() => Promise<string | null>} */ (shell.chooseFolder);
  // Called off the object it lives on, because `contextBridge` hands back a
  // frozen proxy and a bare reference to a method on one is not guaranteed to
  // carry its receiver.
  return () => Promise.resolve(shell.chooseFolder === chooseFolder ? chooseFolder.call(shell) : null);
}

/** The same lookup for the mark. Null in a browser, which is every `make dev`
 *  run: `app/` is not served, so there is no picture to ask for and the screen
 *  sets the word alone. */
function shellLogo() {
  const shell = /** @type {{ biomShell?: { logo?: unknown } }} */
    (/** @type {unknown} */ (globalThis)).biomShell;
  if (shell === undefined || typeof shell.logo !== "function") return null;
  const logo = /** @type {() => Promise<string>} */ (shell.logo);
  return () => Promise.resolve(shell.logo === logo ? logo.call(shell) : "");
}

/** THE PROJECT'S OWN HEADLINE, and the one real line on this screen. It is the
 *  sentence the project's site leads with, word for word, so the program a
 *  person downloads says what the page they downloaded it from said. It is
 *  written here rather than imported because the site is a separate thing that
 *  this framework does not depend on; when the headline changes it changes in
 *  both, and nowhere else on this screen is there a sentence to keep in step. */
const HEADLINE = "Visual Workspace for AI Automations";

/** THE FOLDER, DRAWN. One span and its two pseudo-elements in `currentColor` —
 *  the tab across the top left and the body under it — because the chrome is
 *  built through `h()` and an `<svg>` made that way is not an SVG. Both actions
 *  open the same folder dialog, so both wear it; the plus inside is the whole
 *  difference between them.
 *  @param {H} h @param {boolean} [plus] */
const folderMark = (h, plus) =>
  h("span.vk", { "aria-hidden": "true" }, plus === true ? h("i") : null);

/**
 * @param {VaultViewDeps} deps
 * @returns {() => HTMLElement}
 */
export function makeVaultView(deps) {
  const { h, ws } = deps;
  /** THE CHOOSER, AND WHICH ONE THIS SCREEN HAS. `chooseFolder` present is the
   *  built application: the dialog is Open and it is Create's parent, and the
   *  served listing is not drawn even where the server would answer it.
   *  @type {(() => Promise<string | null>) | null} */
  const chooseFolder = deps.chooseFolder === undefined ? shellChooser() : deps.chooseFolder;
  const native = chooseFolder !== null;
  /** The mark, where there is one to ask for. @type {(() => Promise<string>) | null} */
  const logo = deps.logo === undefined ? shellLogo() : deps.logo;
  /** Whether the served listing is on offer at all. In production the server
   *  refuses the kind, so asking for it would be a screen that says one thing
   *  and does another. */
  const browsable = !(deps.production === true && NATIVE_DIALOG) && !native;
  // Create's parent comes from one of the two, and there is always one of the
  // two except in the build nobody ships: a production server opened in a plain
  // browser, which has no dialog and no listing and therefore nothing to make a
  // workspace in.
  const canCreate = native || browsable;
  // Going somewhere, as a dependency. The picker is the one screen that leaves
  // the page it is on, and a bare `location.assign` here would make this module
  // untestable without a browser — which is the same reasoning that put the
  // transport's base url in an argument.
  const navigate = deps.navigate ?? ((url) => { location.assign(url); });
  // WHAT THIS WINDOW WAS OPENED WITH, read once and carried into every address
  // this screen builds. `hrefFor` is why.
  const search = deps.search ?? (typeof location === "undefined" ? "" : location.search);

  /** @type {HTMLElement | null} */
  let live = null;

  return function vaultView() {
    if (!live) live = build();
    return live;
  };

  function build() {
    const recents = h("div.vlist.vrecent");
    const recentGroup = h("section.pgroup.vgrecent", { hidden: true }, h("h2", "Recent"), recents);
    const parent = h("span.vparent");
    const name = /** @type {HTMLInputElement} */ (h("input.vnew", {
      type: "text", placeholder: "Name of the new folder", spellcheck: false, autocomplete: "off",
    }));
    /** The refusal, in the one place every refusal about a name lands. The dot
     *  beside it is the only thing on this screen that is a mark rather than a
     *  word, and it is there so a sentence that arrives while somebody is typing
     *  reads as an answer rather than as a label that was always sitting there. */
    const whySay = h("span.vsay");
    const nameWhy = h("p.vwhy", { hidden: true }, h("span.vdot", { "aria-hidden": "true" }), whySay);
    /** The label, apart from the button, because the button also wears the key
     *  that presses it — and swapping the whole button's text for "Creating…"
     *  would take the ↵ with it. */
    const makeLabel = h("span.vlabel", "Create");
    const make = /** @type {HTMLButtonElement} */ (h("button.vmake", { type: "button", disabled: true },
      makeLabel, h("span.vkbd", { "aria-hidden": "true" }, "↵")));
    const where = h("div.vwhere");
    const dirs = h("div.vlist.vdirs");
    const oops = h("p.oops", { hidden: true });

    /** THE SCREEN ITSELF, built first because two of the things on it are said
     *  by a class on it rather than by a control of their own: `is-step` is the
     *  name step standing in place of the two actions, and `is-bad` is a name
     *  the screen has just refused. */
    const sheet = h("div.ports.vault" + (native ? ".vstart" : ""));

    /* The composed path, which exists only where the dialog does — in a browser
       the parent is the Browse listing's own `.vwhere` bar and there is nothing
       for this to compose. */
    const pathHead = native ? h("span.vhead") : null;
    const pathSep = native ? h("span.vsep", { hidden: true }, "/") : null;
    const pathTail = native ? h("span.vtail") : null;
    const under = native ? h("span.vunder", { "aria-hidden": "true" }) : null;

    /** Where the browser is standing, so a successful open can rebuild the same
     *  listing rather than leave a disabled button behind. @type {string | undefined} */
    let at = undefined;
    /** The listing itself, because the create group checks a typed name against
     *  it as it is typed. It is always A MOMENT OLD — which is why the server
     *  checks again before it writes anything, and why this one is a courtesy
     *  rather than the guard. @type {DirListing | null} */
    let here = null;
    let busy = false;

    /** @param {unknown} err */
    const fail = (err) => {
      oops.textContent = message(err);
      oops.hidden = false;
      oops.removeAttribute("hidden");
    };
    const clear = () => { oops.textContent = ""; oops.hidden = true; oops.setAttribute("hidden", ""); };

    /* ── the two reads ───────────────────────────────────────────────────── */

    /* WHICH FOLDER IS OPEN IS NOT A QUESTION THIS SCREEN ASKS ANY MORE. It used
       to, and the answer was drawn as an `Open now` block at the top with the
       open workspace filtered out of `Recent` underneath it. That was Settings:
       this same view reached from the rail with a folder mounted behind it, and
       the owner decided (2026-09-14) that it does exactly what the start page
       does and looks five times worse. There is one screen now, it is the start
       page, and it is what `Close workspace` returns the window to — so nothing
       is open while it is on screen and the folder just closed is simply the
       head of `Recent`, which is where the person who just left it will look. */

    function readRecent() {
      ws.recentVaults().then((list) => {
        // One click each, because that is the common case: you are moving
        // between two or three folders, not walking a filesystem every time.
        const rows = list.map(recentRow);
        recents.replaceChildren(...rows);
        // NOTHING REMEMBERED DRAWS NOTHING. `None yet.` under a heading is the
        // screen reporting on itself to somebody who has been here ten seconds.
        show(recentGroup, rows.length > 0);
      }).catch(fail);
    }

    /** @param {HTMLElement} el @param {boolean} on */
    function show(el, on) {
      el.hidden = !on;
      if (on) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    }

    /** @param {string} [path] */
    function walk(path) {
      ws.browseVault(path).then((listing) => {
        at = listing.at;
        here = listing;
        sayParent();
        where.replaceChildren(
          h("code.vpath", listing.at),
          h("span.vwhereacts",
            listing.up === null
              ? null
              : h("button.vup", { type: "button", onclick: () => walk(listing.up ?? undefined) }, "↑ Up"),
            openButton("Open this folder", listing.at)));
        const rows = listing.dirs.map(dirRow);
        dirs.replaceChildren(...(rows.length ? rows : [h("p.hold", "Nothing in here.")]));
      }).catch(fail);
    }

    /* ── the rows ────────────────────────────────────────────────────────── */

    /** A folder opened before, as ONE clickable row: the name over the path it
     *  is at, and nothing beside it. The `Open` button that used to sit at the
     *  end went because the row already says what clicking it does, and a
     *  control that appears under the pointer on a list of three is a control
     *  somebody has to find. The row is still the anchor, so every word of what
     *  `openButton` says about addresses holds — middle-click opens a second
     *  workspace in a second tab.
     *  @param {VaultInfo} v */
    const recentRow = (v) => {
      const nm = h("span.nm", v.name);
      return openLink(
        v.path, nm, v.name, "vrow",
        h("span.vwho", h("span.vfold", { "aria-hidden": "true" }),
          h("span", nm, h("code.vpath", v.path))),
        h("span.vgoarrow", { "aria-hidden": "true" }, "→"));
    };

    /** A directory. Marked when it already holds a workspace, because a column
     *  of folders that all look alike is the thing that makes this screen hard
     *  to use: the one you want is almost always one you have used before.
     *  @param {DirEntry} d */
    const dirRow = (d) =>
      h("div.vrow" + (d.vault ? ".is" : ""),
        h("button.vwalk", { type: "button", onclick: () => walk(d.path) },
          h("span.nm", d.name),
          h("span.vtag", d.vault ? "workspace" : "new")),
        openButton("Open", d.path));

    /** Where a folder LIVES, as an address. It is a real `href` and not a
     *  handler on a div, which is the whole point: a workspace has a url now, so
     *  middle-click and ⌘-click open a second folder in a second tab and the
     *  browser does it for free. That is the multi-tasking this change exists
     *  for, and it costs one element.
     *  @param {string} path */
    const vaultHref = (path) => hrefFor(search, path);

    /** @param {string} label @param {string} path */
    function openButton(label, path) {
      const go = h("a.vgo", { href: vaultHref(path) }, label);
      return wire(go, path, go, label);
    }

    /** The same anchor with something else inside it. `says` is the element
     *  whose words become "Opening…" and come back on a refusal — the whole
     *  label where the link IS the label, and the name alone on a row that is
     *  also carrying a path.
     *  @param {string} path @param {HTMLElement} says @param {string} label
     *  @param {string} extra further classes for the anchor
     *  @param {...any} kids */
    function openLink(path, says, label, extra, ...kids) {
      const go = h("a.vgo" + (extra ? "." + extra : ""), { href: vaultHref(path) }, ...kids);
      return wire(go, path, says, label);
    }

    /** @param {HTMLElement} go @param {string} path @param {HTMLElement} says @param {string} label */
    function wire(go, path, says, label) {
      go.addEventListener("click", (ev) => {
        // An ordinary click is checked first and then followed. A modified one —
        // a new tab, a new window — is left entirely to the browser: the check
        // would be a second mount of a folder this tab is not going to, and the
        // tab that opens does its own checking anyway.
        const e = /** @type {MouseEvent} */ (ev);
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // `button` only when there is one. A real browser always sends it; a
        // synthesised click may not, and a guard that read `undefined !== 0` as
        // "middle-click" would swallow every programmatic open.
        if (typeof e.button === "number" && e.button !== 0) return;
        e.preventDefault();
        void open(path, says, label);
      });
      return go;
    }

    /* ── the native chooser, where there is one ──────────────────────────── */

    /** The operating system's dialog, for OPENING. It is the built application's
     *  whole answer to *a folder that is on disk and not in Recent* — the thing
     *  the Browse listing used to be the only way to reach.
     *  @param {HTMLElement} el */
    async function openChosen(el) {
      if (busy || chooseFolder === null) return;
      clear();
      const path = await chooseFolder().catch((err) => { fail(err); return null; });
      // A CANCEL IS AN ANSWER. Nothing is said and nothing is left mid-flight,
      // because closing a chooser without picking is a thing people do on
      // purpose.
      if (path === null || path === "") return;
      await open(path, el, el.textContent ?? "Open");
    }

    /** The same dialog, for the parent a new workspace is made in. It sets the
     *  parent and nothing else: what may be made there is the server's answer,
     *  and it is asked when Create is pressed. */
    async function chooseParent() {
      if (busy || chooseFolder === null) return;
      clear();
      const path = await chooseFolder().catch((err) => { fail(err); return null; });
      if (path === null || path === "") return;
      at = path;
      // NO LISTING STANDS BEHIND THIS PARENT, so the taken-name half of the
      // live refusal has nothing to read and stays quiet. The server checks the
      // same thing before it writes, which is where it always counted.
      here = null;
      sayParent();
      // THE DIALOG ANSWERING IS WHAT OPENS THE STEP. It is a state of this view
      // rather than a group that is permanently on screen: until a parent is
      // chosen there is nothing for a name field to be a name inside, and a
      // field that cannot be used yet is a field somebody has to work out.
      step(true);
    }

    /** Into the name step, or back out of it to the two actions. The step and
     *  the start screen are the same view, so this is one class on the root and
     *  the stylesheet does the rest.
     *  @param {boolean} on */
    function step(on) {
      if (!native) return;
      if (on) sheet.classList.add("is-step");
      else sheet.classList.remove("is-step");
      if (on) {
        name.focus();
      } else {
        // BACK IS A FULL RESET, because the parent came from a dialog and the
        // only way to have one again is to open it again. Leaving the last
        // answer behind would make Create a button that silently remembers a
        // folder from a minute ago.
        at = undefined;
        here = null;
        name.value = "";
        clear();
        sayParent();
      }
    }

    /** Redraw whatever the parent came from, after a refusal. There is a listing
     *  to rebuild only where one was drawn; a chosen parent is still chosen. */
    const relist = () => { if (browsable) walk(at); else sayParent(); };

    /* ── making one ──────────────────────────────────────────────────────── */

    /** Where the new folder would go, drawn as the parent's own absolute path so
     *  the person is looking at the answer rather than at a promise about it. */
    function sayParent() {
      parent.replaceChildren(
        at === undefined
          ? h("span.hold", native
            ? "Choose the folder you want it in."
            : "Browse to the folder you want it in.")
          : h("code.vpath", at));
      sayName();
    }

    /** The refusal under the name field, live. */
    function sayName() {
      // NO PARENT IS ITS OWN REFUSAL, and it reads as one rather than leaving
      // an enabled button over a question that has not been answered. It comes
      // first because it is about where, and everything `whyNot` says is about
      // what to call it.
      const why = at === undefined
        ? (native ? "Choose the folder it goes in first." : "Browse to the folder it goes in first.")
        : whyNot(name.value, here === null ? [] : here.dirs);
      whySay.textContent = why ?? "";
      show(nameWhy, why !== null);
      compose(why);
      // THE REFUSAL IS THE DISABLE, which is why there is one expression here
      // and not two. `whyNot` answers null when there is nothing to say, and
      // nothing to say is exactly the state in which a folder can be made — a
      // second condition beside it would be a second opinion about the same
      // question, and the one that got forgotten would be this one.
      //
      // It is the client's half of a rule the server holds as well: `creatable`
      // in `server/workspace/vault.ts` refuses everything this does and more —
      // a parent inside a workspace, a name taken since the listing was read.
      // This is so the answer arrives while somebody is typing, never so the
      // server can trust it.
      make.disabled = why !== null;
    }

    /** What has been drawn into the tail of the composed path, so a keystroke
     *  adds one character rather than rebuilding the line. @type {string} */
    let shown = "";

    /**
     * THE PATH, COMPOSED. The chosen parent is settled ink and every character
     * of the name arrives beside it as it is typed — which is the one authored
     * moment on this screen and the only thing on it carrying an argument: you
     * are not filling in a field, you are writing a folder's address.
     *
     * IT IS NOT AN ANIMATION AND NOTHING HERE IS ON A TIMER. Each character is
     * its own element so the stylesheet can give a REAL keystroke a keyframe;
     * what is already on screen is left exactly where it is, which is why this
     * walks the common prefix instead of replacing the line. A paste of twenty
     * characters arrives as twenty elements in one frame and reads as a paste.
     * @param {string | null} why the refusal standing, if any
     */
    function compose(why) {
      if (pathHead === null || pathTail === null || pathSep === null || under === null) return;
      pathHead.textContent = at ?? "";
      const want = name.value;
      show(pathSep, want !== "");
      let same = 0;
      while (same < shown.length && same < want.length && shown[same] === want[same]) same += 1;
      while (pathTail.children.length > same) {
        const last = pathTail.children[pathTail.children.length - 1];
        if (last === undefined) break;
        last.remove();
      }
      for (let i = same; i < want.length; i += 1) pathTail.append(h("i", want[i]));
      shown = want;
      // The rule under the field fills as the name does, and it is the accent
      // until there is something to refuse.
      const filled = want === "" ? 0 : Math.min(100, 18 + (want.length / Math.max(want.length, 12)) * 82);
      under.style.width = filled + "%";
      if (why !== null && want !== "") sheet.classList.add("is-bad");
      else sheet.classList.remove("is-bad");
    }

    /* ── the one write ───────────────────────────────────────────────────── */

    /**
     * Check it, then GO THERE. Checking first is what keeps a refusal inside the
     * picker, with the server's own sentence under the button, rather than
     * loading a tab that turns out to be nothing.
     *
     * Then it navigates rather than swapping in place, and that is the design
     * rather than a shortcut. The vault a tab is on is in its url and settled
     * before anything is constructed, so there is no half-swapped state to get
     * wrong — the store, the frames, the palette and the route all come from the
     * folder in the address bar, and the only way to change all of them at once
     * and consistently is to load them all again.
     * @param {string} path
     * @param {HTMLElement} el
     * @param {string} label
     */
    async function open(path, el, label) {
      if (busy) return;
      busy = true;
      clear();
      el.textContent = "Opening…";
      try {
        await ws.openVault(path);
        navigate(vaultHref(path));
      } catch (err) {
        fail(err);
        busy = false;
        el.textContent = label;
        readRecent();
        relist();
      }
    }

    /**
     * MAKE ONE, THEN GO THERE — the same second half `open` has, for the same
     * reason: the folder a tab is on is in its url and settled before anything
     * is constructed, so arriving in a new workspace is a navigation rather than
     * a swap. What is different is only the first half, and it is one call: the
     * server makes the folder, seeds it exactly as it seeds any empty one it is
     * pointed at, and answers with the vault.
     */
    async function create() {
      if (busy) return;
      const at0 = at;
      if (at0 === undefined) return;
      busy = true;
      clear();
      const was = makeLabel.textContent;
      make.disabled = true;
      makeLabel.textContent = "Creating…";
      try {
        const info = await ws.createVault(at0, name.value.trim());
        navigate(vaultHref(info.path));
      } catch (err) {
        // The server's own sentence, in the same place every other refusal on
        // this screen lands. A name that was free when the listing was read and
        // is not any more comes back through here rather than through `whyNot`,
        // which is looking at a listing that is now old.
        fail(err);
        busy = false;
        makeLabel.textContent = was;
        readRecent();
        relist();
      }
    }

    /* ── the sheet ───────────────────────────────────────────────────────── */

    name.addEventListener("input", sayName);
    // ↵ IS ON THE BUTTON, so it has to work. A field with one button under it is
    // a field people press Return in, and a Return that did nothing would be the
    // screen printing a key that is a lie.
    name.addEventListener("keydown", (ev) => {
      const e = /** @type {KeyboardEvent} */ (ev);
      if (e.key !== "Enter" || make.disabled) return;
      e.preventDefault();
      void create();
    });
    make.addEventListener("click", () => void create());

    readRecent();
    // The listing is not even asked for when the group is not drawn: a screen
    // that hides a control and still makes its request is a screen that says one
    // thing and does another — and in production the server refuses the kind
    // anyway.
    if (browsable) {
      walk(undefined);
      sayParent();
    } else if (canCreate) {
      sayParent();
    }

    /* ── the mark ────────────────────────────────────────────────────────── */

    // THE PICTURE ARRIVES A BEAT AFTER THE SCREEN DOES, and the word does not
    // wait for it. `logo()` is an IPC round trip, so an <img> built with no src
    // and filled in when the answer lands is the only shape that never shows a
    // broken picture — and in a browser, where there is no shell at all, the
    // wordmark stands alone and nothing is ever asked for.
    const brand = h("div.vbrand", h("span.vword", "Biom"));
    if (logo !== null) {
      logo().then((url) => {
        if (typeof url !== "string" || !url) return;
        brand.insertBefore(h("img.vmark", { src: url, alt: "" }), brand.firstChild);
      }).catch(() => { /* the screen wears the word alone; it is not a fault */ });
    }

    /* ── the two actions, which are the screen ───────────────────────────── */

    const openLabel = h("span.vlabel", "Open");
    const toOpen = /** @type {HTMLButtonElement} */ (h("button.vact", { type: "button" },
      folderMark(h), openLabel));
    toOpen.addEventListener("click", () => void openChosen(openLabel));
    const toMake = /** @type {HTMLButtonElement} */ (h("button.vact.spot", { type: "button" },
      folderMark(h, true), h("span.vlabel", "Create a vault")));
    toMake.addEventListener("click", () => void chooseParent());

    /* ── the name step, which is a STATE of this screen ──────────────────── */

    const back = h("button.vback", { type: "button", onclick: () => step(false) }, "← Back");
    const swap = h("button.vswap", { type: "button", onclick: () => void chooseParent() },
      "Choose a different folder");

    if (native) {
      sheet.append(
        oops,
        h("div.vbed",
          brand,
          // THE ONE REAL LINE. Nothing else on this screen explains the product:
          // a person who has just launched it is one click from the folder
          // dialog, and a sentence in the way is a sentence they have to read
          // before they are allowed to start.
          h("h1.vline", HEADLINE),
          h("div.vacts", toMake, toOpen),
          h("div.vstep",
            back,
            h("p.vin", parent, swap),
            h("div.vfieldwrap", name, under),
            h("p.vcompose", pathHead, pathSep, pathTail),
            nameWhy,
            h("div.vmakebar", make)),
          recentGroup));
      return sheet;
    }

    // A BROWSER, WHICH IS `make dev` AND NOTHING ELSE. There is no
    // dialog to open, so the two actions have nothing to call and the served
    // listing is the whole chooser — drawn plainly, under the same mark, because
    // it is a developer's screen and dressing it as the product's first ten
    // seconds would be dressing up a thing that is not shipped.
    sheet.append(
      oops,
      h("div.vbed",
        brand,
        h("h1.vline", HEADLINE),
        recentGroup,

        !canCreate ? null : h("section.pgroup",
          h("h2", "Create"),
          h("p.portsnote", "A new workspace is a new folder. Browse to where you want it, then name it."),
          parent,
          h("div.vmakebar", name, make),
          nameWhy),

        !browsable ? null : h("section.pgroup",
          h("h2", "Browse"),
          where,
          dirs,
          h("p.portsnote", "An empty folder is set up as a workspace when you open it. A folder that already holds other files is left alone and will not open."))));
    return sheet;
  }
}

/** THE ADDRESS OF A WORKSPACE, BUILT OUT OF THE ONE THIS WINDOW IS ALREADY AT.
 *
 *  EVERY OTHER PARAMETER SURVIVES, and that is the whole of this function. It
 *  used to be `"?vault=" + path`, which writes a WHOLE new query — and in the
 *  built application the query is where the per-launch token lives. So opening
 *  an existing workspace loaded a document with no token, the server answered
 *  401 to every call the new page made, and what a person saw was a workspace
 *  that would not open with no sign of what had refused it. `client/boot.js` had
 *  already learnt this at its own `history.replaceState`; this half had not.
 *
 *  It is a plain function over a string rather than a read of `location`,
 *  because the claim — nothing else in the query is dropped — is only testable
 *  if the query can be handed in.
 *
 *  @param {string} search the query this window was opened with, leading `?`
 *    and all, or "" for none
 *  @param {string} path the workspace's absolute path
 *  @returns {string} */
export function hrefFor(search, path) {
  const query = new URLSearchParams(search);
  query.set("vault", path);
  return "?" + query.toString() + "#/" + "page/" + encodeURIComponent(ROOT_PAGE);
}

/** THE ADDRESS OF THE START PAGE: the one this window is at, with the folder
 *  taken out of it and the hash naming the picker.
 *
 *  It is `hrefFor` backwards, and it lives beside it for that reason — going
 *  into a workspace and coming back out of it are one move in two directions,
 *  and an address built in two files is an address that drops the per-launch
 *  token in one of them. Everything else in the query survives.
 *
 *  THE HASH IS NOT DECORATION. `client/boot.js` opens the folder last used when
 *  the address names none — which is what makes a second launch land in the
 *  workspace rather than on the picker — so an address with the folder merely
 *  removed would reopen the workspace that had just been closed. `#/vault` is
 *  this window saying it means no workspace, and boot reads it before it asks
 *  what was open last.
 *
 *  @param {string} search the query this window was opened with, leading `?`
 *    and all, or "" for none
 *  @returns {string} */
export function closeHref(search) {
  const query = new URLSearchParams(search);
  query.delete("vault");
  return "?" + query.toString() + "#/vault";
}

/** THE NAME RULE, SAID ON BOTH SIDES. `checkName` in
 *  `server/workspace/vault.ts` is the one that counts — this is what makes the
 *  refusal arrive as you type rather than after a round trip, and the two are
 *  held in step by `tests/new-vault.test.ts`, which walks the strings the server
 *  refuses and asserts this half refuses every one of them.
 *
 *  THAT TEST IS WHY THIS IS OUT HERE rather than closed over the listing it
 *  reads. The claim that the two halves agree was written down and not held to,
 *  and they had already drifted: the server refuses every control character,
 *  NUL among them, and this refused none — so a pasted name with one in it read
 *  as fine under the field and was turned away by the server a moment later.
 *
 *  @param {string} name what has been typed
 *  @param {DirEntry[]} dirs the listing on screen, which is a moment old — so the
 *    taken-name half is a courtesy and the server asks again before it writes.
 *  @returns {string | null} the refusal, or null */
export function whyNot(name, dirs) {
  const trimmed = name.trim();
  if (trimmed === "") return "Type a name for the new workspace.";
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return "That is a name, not a path — the workspace is made inside the folder above.";
  }
  if (trimmed === "." || trimmed === "..") return "That is not a name a folder can have.";
  if (trimmed.startsWith(".")) {
    return "A name starting with a dot is hidden — the picker would never show it again.";
  }
  // A NUL truncates the path at the system call, so what is checked and what is
  // created would be two different paths. The other control characters go with
  // it rather than one at a time: none of them is a name anybody meant to type,
  // and a pasted one is invisible in the field. Spelled with escapes and the
  // same range the server uses, because a literal control character in a
  // source file is a character nobody reviewing this can see.
  if (/[\u0000-\u001f]/.test(trimmed)) return "That is not a name a folder can have.";
  const taken = dirs.find((d) => d.name === trimmed);
  if (taken !== undefined) {
    return taken.vault
      ? "There is already a workspace with that name — open it instead."
      : "There is already a folder with that name.";
  }
  return null;
}

/** @param {unknown} err */
const message = (err) =>
  err instanceof Error && err.message ? err.message : "that folder did not open";

