// SPDX-License-Identifier: AGPL-3.0-only
// The sandboxed box and the message plumbing. Layer 11.
//
// Everything DOM-shaped about the artifact boundary lives here, so that
// bridge.js below it can stay DOM-free and guest/biom.js beyond it can
// stay import-free. Replacing this file swaps iframe for shadow DOM or for a
// real webview host without either of the other two changing a line.
//
// FOUR THINGS IN HERE ARE LOAD-BEARING.
//
// `sandbox="allow-scripts"` with NO `allow-same-origin`. The box gets an opaque
// origin, so nothing inside it can reach the server directly even though the
// server is right there on localhost, and every path to workspace data is forced
// through a port. The browser enforces the chokepoint for free. The one
// permission delegated back over that wall is `allow="clipboard-write"`, and the
// argument for it is beside the attribute in `for()`.
//
// Its consequence: THE HOST CAN NEVER READ WHAT IS IN THE BOX. The section count
// is self-reported by the runtime as a `ready` notice. There is nothing to
// scrape and no way to scrape it. When the host needs a new fact about a page,
// that is a new notice, not a query.
//
// ONE BOX PER PAGE, AND IT ALWAYS FILLS. There is no longer a box per block:
// a page is a stack of sections drawn by a runtime that lives inside one box,
// and that box takes the whole canvas, scrolls inside itself and NEVER REPORTS
// A HEIGHT.
//
// That is a mechanism and not a simplification. If the box sized itself to its
// content and the HOST page scrolled, the scroll container would be outside the
// box — `animation-timeline: scroll()` and `view()` would find no scroller,
// `position: sticky` would never stick, `100vh` would be meaningless and an
// `IntersectionObserver` would have no root. FILLING IS WHAT MAKES THE BOX ITS
// OWN VIEWPORT, and being its own viewport is the entire reason a section can
// drive a scroll effect at all. A box that measured itself would take every one
// of those away, which is why `GuestNotice` has no `size` and this file has no
// height to apply.
//
// TWO PORTS, GRANTED TOGETHER. The runtime has to read the page and write its
// shape back; a section must never be able to. So the handshake transfers a
// privileged port speaking `RuntimeRequest` and an ordinary one speaking
// `HostRequest`, and WHICH PORT A MESSAGE ARRIVED ON IS THE WHOLE OF THE
// AUTHORISATION — it selects the half of the bridge that answers it, and that
// half narrows with a type guard rather than an allow-list.
//
// SAY WHAT THAT IS AND IS NOT. Inside the box, the runtime/section split is a
// CLOSURE, NOT A BROWSER GUARANTEE: section code shares a realm with the runtime
// and could interfere with it. The browser-enforced wall is between THE BOX AND
// THE APP — no fetch, no cookies, no host DOM — and that is the boundary
// protecting the files, the server and every other page. Nothing in this
// repository may describe the in-box split as a security boundary.
//
// FRAMES ARE KEYED AND REUSED. `for(key, html, ctx)` hands back the same element
// when the html has not changed. Without that, an artifact writing its own
// document emits from the store, redraws the view and destroys the box the user
// is typing in — the difference between a working demo and one that flickers on
// every keystroke. Only a changed html, `drop` and `reloadPage` tear one down.
//
// A REDRAW KEEPS THE READER'S PLACE, AND THE MOUNT IS WHAT CARRIES IT. The box
// scrolls inside itself and the host cannot read where to, so the shim reports
// it — a `position` notice, the latest kept on the mount — and the mount
// outlives the realm a redraw tears down. The shell says `keep(key)` before it
// reloads, `ready` from the new realm is when it is handed back as a `place`
// event, and the box clamps it to its new run. Nothing is measured here and
// nothing loops: one notice per frame while scrolling, one event per redraw.
//
// A BOX MAY DRAW ANOTHER PAGE INSIDE ITSELF, and the session for that is minted
// here too. `page.embed` on the guest port is answered by the bridge with the
// target page's woven document; this file reads that answer, opens two fresh
// channels for the TARGET page, and adds their far ends to the answer's transfer
// list. The box puts the document in a nested iframe and relays the handshake —
// the nested frame's `parent` is the box, so its `hello` never reaches this
// window — and everything the nested runtime then says arrives on ports wired
// exactly like a mount's, with the target page as context. The sandbox is
// inherited, so the nested frame is as opaque as the box; what it holds is two
// ports the host minted for one page, which is all a box of its own ever holds.
// An embedded session dies with its parent, and a `unembed` notice closes one
// sooner.

/** @import { BridgeContext, Frame, FrameHost, GuestNotice, HostEvent, HostRequest, RuntimeRequest } from "../../contracts/types.ts" */
/** @import { PageBridge } from "../bridge/bridge.js" */

import { isGuestNotice } from "../../contracts/guards.js";
import { ERRORS, PROTOCOL, fail } from "../../contracts/wire.js";

/** How deep a box may nest — a page that embeds itself stops here rather than
 *  drawing forever — and how many sessions one realm may hold open at once.
 *  Caps, not judgements: whether a box may say `page.embed` at all was settled
 *  by the guard in the bridge. */
const MAX_EMBED_DEPTH = 4;
const MAX_EMBEDS = 8;

const HEAD = /<head\b[^>]*>/i;
const HTML = /<html\b[^>]*>/i;

/** THE DOCUMENT'S OWN INK, DECLARED FOR EVERY BOX AND NOT FOR THE DOC PLUGIN'S
 *  PAGES ALONE.
 *
 *  The shim writes the vault's palette onto `:root` as custom properties and
 *  nothing else, and a browser's default text colour is black — invisible while
 *  every palette was dark ink on light stock, and an unreadable page the moment
 *  a workspace ships light ink on a dark board, which the shipped brand palette
 *  does. `guest/plugins/doc/index.html` said this for itself, so a `doc` page
 *  read correctly and nothing else in the same workspace did: the design doc,
 *  whose box is woven with NO document at all, drew its title and its whole
 *  shipped-default band in black on charcoal, and so does any page an author
 *  wrote that did not think to say `color: var(--ink)`. The default ink is a
 *  fact about wearing the palette rather than about which plugin drew the page,
 *  so it is declared here, once, for every realm the host weaves.
 *
 *  A LINK TAKES THE PALETTE'S SPOT for the same reason: the browser's blue is a
 *  colour no palette chose.
 *
 *  IN A LAYER, WHICH IS WHAT MAKES IT A DEFAULT AND NEVER A CEILING. An
 *  unlayered author rule beats every layered one whatever its specificity, so a
 *  section's own `<style>`, a plugin document's own stylesheet and a page an
 *  author wrote all win by existing — the same bargain the figure frame and the
 *  type scale already make. It is woven FIRST, ahead of the document's own
 *  `@layer biom.scale, biom.frame`, which is what keeps it the lowest of them.
 *
 *  It names no colour: `--ink` and `--cyan` are tokens, and `CanvasText` and
 *  `LinkText` are the system's own, which is what paints in the moment before
 *  `theme.get` answers. */
const INK = "<style>@layer biom.ink{:root{color:var(--ink,CanvasText)}a{color:var(--cyan,LinkText)}}</style>";

/**
 * Put the shim ahead of the document's own markup, and tell the document where
 * its own workspace's files are.
 *
 * THE DOCUMENT IS THE RUNTIME'S. It is not an artifact somebody wrote: the host
 * builds a document that loads the section runtime, the plugins and the page's
 * sections, and this is where the shim is threaded in front of all of it. The
 * host still renders a document that is malformed rather than refusing it,
 * because a blank rectangle during a session reads as "the product is broken".
 *
 * THE `<base>` IS WHAT MAKES `<img src="kitchen.jpg">` WORK, and it was measured
 * rather than assumed. A srcdoc document INHERITS ITS PARENT'S BASE URL — which
 * here is the app's own address, `/?vault=…` — so without one a bare filename
 * asks the server for `/kitchen.jpg` and a leading slash asks for `/asset/…`,
 * and both miss the workspace entirely. Pointing the base at this vault's asset
 * folder fixes every relative url in the document at once.
 *
 * It does not disturb `/vendor/`: an absolute path resolves against the base's
 * ORIGIN, so `<script src="/vendor/three.min.js">` is unchanged. Verified in a
 * browser, because this is a url-resolution rule inside an opaque origin and
 * neither half of that is worth guessing at.
 *
 * @param {string} shim
 * @param {string} html
 * @param {string} [assets] absolute url of this vault's asset folder. Omitted
 *   when there is no workspace to point at, in which case nothing is written and
 *   the document keeps the base it would have had.
 * @param {string} [faces] the `@font-face` rules for the box, with ABSOLUTE urls
 *   back to the host's `/fonts/`. The host's own stylesheet does not exist on
 *   the box's opaque origin, so the faces are declared a second time in here —
 *   `client/theme/faces.js` writes them and boot.js hands them over. Omitted,
 *   nothing is written and every role's generic fallback is what renders.
 * @returns {string}
 */
export function weave(shim, html, assets, faces) {
  const base = assets ? '<base href="' + assets.replace(/"/g, "&quot;") + '">' : "";
  const style = faces ? "<style>" + faces + "</style>" : "";
  // BEFORE the shim, and the order is load-bearing: the shim is host code that
  // runs immediately, and a base declared after a script has already resolved a
  // url is a base that arrived too late. The faces ride after the base so their
  // absolute urls are untouched by it and before the shim so the first paint
  // already has them. `INK` rides ahead of both so its layer is declared before
  // any the document names, which is what keeps it the lowest one.
  const tag = base + INK + style + "<script>" + shim + "</script>";
  if (HEAD.test(html)) return html.replace(HEAD, (m) => m + tag);
  if (HTML.test(html)) return html.replace(HTML, (m) => m + "<head>" + tag + "</head>");
  return '<!doctype html><html><head><meta charset="utf-8">' + tag + "</head><body>" + html + "</body></html>";
}

/** One box is one page, so a context is one field and this is one comparison.
 *  It stays a function because the thing it guards — reusing an element whose
 *  context moved — is what keeps the user's typing alive across a redraw.
 *  @param {BridgeContext} a @param {BridgeContext} b */
const sameCtx = (a, b) => a.page === b.page;

/**
 * @param {PageBridge} bridge both halves of the chokepoint. Which one answers a
 *   message is decided by the port it arrived on, here and nowhere else.
 * @param {string} [assets] absolute url of this workspace's asset folder, given
 *   to every box as its `<base>` so a page can write `src="kitchen.jpg"` and
 *   mean the file in its own vault. Optional so a caller that has no workspace —
 *   a test, or a tab that has not chosen a folder — still builds one.
 * @param {string} [faces] the box's `@font-face` rules, from `faces.js` via
 *   boot.js. Optional for the same reason `assets` is.
 * @returns {FrameHost}
 */
export function makeFrameHost(bridge, assets, faces) {
  /**
   * ONE REALM THE HOST TALKS TO — a box of its own, or a page drawn inside one.
   * The two differ in how they were opened and in nothing the ports care about.
   * @typedef {object} Session
   * @property {HTMLIFrameElement} el the box this session is drawn in. For an
   *   embedded session that is the outermost box, which is where a notice can
   *   still be dispatched from.
   * @property {BridgeContext} ctx
   * @property {MessagePort | null} runtime  speaks RuntimeRequest. The runtime
   *   takes this into a closure and never hands it on.
   * @property {MessagePort | null} guest    speaks HostRequest. What `biom.*`
   *   wraps, and everything a section may say.
   * @property {number | null} sections self-reported by the runtime; null until
   *   it says. The host cannot count them — it cannot read the box's DOM.
   * @property {number | null} scroll where the box is scrolled to, in pixels,
   *   as its shim last reported it — self-reported for the same reason the
   *   count is. Kept through `shut`, because the realm that reported it is the
   *   one a redraw is about to replace, and null until a realm says.
   * @property {number | null} restore the `scroll` the shell asked to keep
   *   through the rebuild that follows (`keep`); handed to the next realm on its
   *   `ready` as a `place` event and cleared. Null means the next realm starts
   *   at the top, which is what a page opened afresh does.
   * @property {HostEvent[]} queued    events posted before the ports opened
   * @property {number} depth 0 for a box; one more for each nesting
   * @property {Map<string, Session>} embeds the sessions this realm opened,
   *   by the token its `page.embed` answer carried. Closed with it.
   */

  /**
   * @typedef {Session & {
   *   html: string,
   *   frame: Frame,
   * }} Mount a box of its own, keyed and reused by `for`
   */

  /** @type {Map<string, Mount>} */
  const mounts = new Map();

  /** Every realm there is: the boxes and, under each, what they embedded.
   *  @returns {Session[]} */
  function sessions() {
    /** @type {Session[]} */
    const out = [];
    /** @param {Session} s */
    const walk = (s) => { out.push(s); for (const e of s.embeds.values()) walk(e); };
    for (const m of mounts.values()) walk(m);
    return out;
  }

  let embedSeq = 0;

  /** The last edit and theme event, replayed to a box as it becomes ready, so
   *  a page mounted while edit mode is on comes up in edit mode. The host owns
   *  the toggle and a box born after the toggle never heard it.
   *  @type {Map<string, HostEvent>} */
  const sticky = new Map();

  let shim = "";

  /** BOTH PORTS SEE EVERY HOST EVENT. `edit` reaches the runtime, which owns
   *  editing a section's prose, AND the guest port, where a plugin that draws
   *  something richer than text takes it over. `theme` and `refresh` are wanted
   *  by both for the same reason, and `place` goes the same way — the shim acts
   *  on it and the runtime lets it pass. A host event is an announcement, not a
   *  capability: the asymmetry between the ports is entirely in what may be
   *  SENT, and inventing a second asymmetry in what may be HEARD would only
   *  give one side a stale picture.
   *  @param {Session} m @param {HostEvent} ev */
  function send(m, ev) {
    if (m.runtime) m.runtime.postMessage(ev);
    if (m.guest) m.guest.postMessage(ev);
    if (!m.runtime && !m.guest) m.queued.push(ev);
  }

  /** Notices are the only thing the host ever learns about a box. Nothing
   *  listens to this DOM event yet; it is here because a failure inside an
   *  opaque-origin frame is otherwise a blank rectangle and no console line.
   *  @param {Session} m @param {GuestNotice} notice */
  function notify(m, notice) {
    if (notice.kind === "error") console.warn("[artifact" + (m.depth ? ":" + m.ctx.page : "") + "] " + notice.message, notice.stack ?? "");
    // AN EMBEDDED REALM'S `ready` STAYS WITH ITS SESSION. The shell repaints the
    // status strip on every `ready` it hears and reads the mount's own count,
    // so a nested page announcing its sections would repaint the strip for a
    // number it does not show. Its errors still surface, prefixed with the page.
    if (m.depth > 0 && notice.kind !== "error") return;
    m.el.dispatchEvent(new CustomEvent("biom:notice", { detail: notice, bubbles: true }));
  }

  /**
   * One message off one of a mount's two ports.
   *
   * THE PORT IS THE PERMISSION. Nothing here inspects the message to decide what
   * it may be — it hands the message to the bridge entry that port is wired to,
   * and that entry narrows with `isRuntimeRequest` or `isHostRequest`. A branch
   * here that read `msg.kind` and decided would be a second copy of the
   * judgement, and two copies of a judgement are two things to get out of step.
   *
   * @param {Session} m
   * @param {"runtime" | "guest"} which
   * @param {unknown} data
   */
  function fromGuest(m, which, data) {
    if (!data || typeof data !== "object") return;
    const msg = /** @type {Record<string, unknown>} */ (data);

    if (isGuestNotice(msg)) {
      // `hello` is a window message and never arrives here. `ready` is the
      // runtime's alone: it carries the number of sections it drew, which is the
      // one fact about the box the host wants and cannot see. A `ready` on the
      // guest port is a section claiming to be the runtime, and is ignored.
      if (msg.kind === "ready" && which === "runtime") {
        m.sections = msg.sections;
        // THE READER'S PLACE, HANDED TO THE REALM THAT REPLACED THE ONE THAT
        // HAD IT. Only when the shell asked (`keep`), only once, and only now:
        // `ready` is the one moment the host knows the new realm has drawn,
        // and a `place` posted before it would land on a document with no run
        // to clamp against. The box does the clamping and the settling.
        if (m.restore !== null) {
          send(m, { kind: "place", top: m.restore });
          m.restore = null;
        }
      }
      // Where the box is scrolled to. The latest is all that is kept: the one
      // use of it is the redraw that follows, and that wants where the reader
      // IS, not where they have been.
      if (msg.kind === "position") { m.scroll = msg.top; return; }
      // A realm letting go of a page it embedded. Only its own: the token is
      // looked up in this session's map, so a box cannot close a sibling's.
      if (msg.kind === "unembed") { closeEmbed(m, msg.embed); return; }
      notify(m, msg);
      return;
    }

    // An unknown major is dropped silently rather than answered: that is what
    // lets a major-2 host and a major-1 page share a channel later. A message
    // with no correlation id cannot be answered at all, so it goes the same way.
    if (msg.g !== PROTOCOL || typeof msg.id !== "string" || msg.id === "") return;

    // Cast, do not check. The bridge re-narrows and answers `unknown_kind` for
    // anything the sender may not say — a second copy of that judgement here is
    // how the two drift apart.
    const port = which === "runtime" ? m.runtime : m.guest;

    // THE CAP ON NESTING IS ANSWERED HERE, before the bridge is asked, because
    // depth is a fact about sessions and the bridge has none. `limit` rather
    // than a refusal: the request was well-formed, there is simply no room.
    const embedding = msg.kind === "page.embed";
    if (embedding && (m.depth >= MAX_EMBED_DEPTH || m.embeds.size >= MAX_EMBEDS)) {
      if (port) port.postMessage({ id: msg.id, g: PROTOCOL, ok: false, error: fail(ERRORS.LIMIT, "too many pages drawn inside this one") });
      return;
    }

    const answer = which === "runtime"
      ? bridge.runtime(/** @type {RuntimeRequest} */ (/** @type {unknown} */ (msg)), m.ctx)
      : bridge.resolve(/** @type {HostRequest} */ (/** @type {unknown} */ (msg)), m.ctx);

    // AN IN-FLIGHT CALL IS BOUND TO THE PORT IT WAS MADE ON, and an answer whose
    // port is no longer the current one is dropped rather than delivered.
    //
    // A realm can be replaced while its own question is still being answered —
    // the html changed, or it said hello twice — and correlation ids restart with
    // it, because the id space belongs to the guest and a fresh document counts
    // from the beginning again. So posting to whatever the mount holds when the
    // promise settles does not merely deliver a stale answer: it can RESOLVE A
    // DIFFERENT PENDING CALL in the new realm, which is a page being handed the
    // answer to a question it never asked.
    //
    // Dropping is the whole remedy and it is safe: the realm that asked is gone,
    // so there is nobody left who wanted this.
    answer.then((res) => {
      const now = which === "runtime" ? m.runtime : m.guest;
      if (now === null || now !== port) return;
      if (embedding && res.ok) grant(m, now, res);
      else now.postMessage(res);
    });
  }

  /** ANOTHER PAGE, DRAWN INSIDE THIS REALM. The bridge answered `page.embed`
   *  with the target's runtime-woven document; this opens a session for that
   *  page — two channels wired like a mount's, the target page as context — and
   *  posts the answer with the shim woven in and the two far ends transferred,
   *  PRIVILEGED FIRST, ORDINARY SECOND, the order the shim reads at a handshake.
   *  The realm relays them to the nested frame when it says hello.
   *  @param {Session} parent @param {MessagePort} port
   *  @param {{ id: string, g: number, ok: true, value: unknown }} res */
  function grant(parent, port, res) {
    const value = /** @type {{ page: string, html: string }} */ (res.value);
    const token = "e" + (++embedSeq);
    const runtime = new MessageChannel();
    const guest = new MessageChannel();
    /** @type {Session} */
    const e = {
      el: parent.el,
      ctx: { page: value.page },
      runtime: runtime.port1,
      guest: guest.port1,
      sections: null,
      // A nested realm never reports a position and is never asked to keep
      // one: its embedder holds it level over `window`, in fractions (§9).
      scroll: null,
      restore: null,
      queued: [],
      depth: parent.depth + 1,
      embeds: new Map(),
    };
    runtime.port1.onmessage = (pev) => fromGuest(e, "runtime", pev.data);
    guest.port1.onmessage = (pev) => fromGuest(e, "guest", pev.data);
    parent.embeds.set(token, e);

    const html = weave(shim, value.html, assets, faces);
    port.postMessage({ ...res, value: { page: value.page, embed: token, html } }, [runtime.port2, guest.port2]);
    // A realm born after the theme was set never heard it, same as a box.
    for (const held of sticky.values()) send(e, held);
  }

  /** @param {Session} s @param {unknown} token */
  function closeEmbed(s, token) {
    if (typeof token !== "string") return;
    const e = s.embeds.get(token);
    if (!e) return;
    shut(e);
    s.embeds.delete(token);
  }

  /** The handshake, and it is in two halves on purpose.
   *
   *  The box speaks first — `hello`, over window.postMessage, because it has no
   *  port yet — and the host answers exactly once, to that one frame, with
   *  `ports` and TWO transferred ports. `ready` comes later and over the
   *  privileged port, once the runtime has actually drawn something.
   *
   *  Splitting it is what stops a top-level `await` deadlocking the page: a
   *  `<script type="module">` is deferred and `DOMContentLoaded` fires only
   *  after deferred scripts finish, so a handshake that waited for a drawn DOM
   *  before granting the port would be waiting on the very script that is
   *  waiting on the port.
   *  @param {MessageEvent} ev */
  function hello(ev) {
    if (!ev.source) return;
    const m = [...mounts.values()].find((x) => x.el.contentWindow === ev.source);
    if (!m) return;

    const data = ev.data;
    if (!isGuestNotice(data) || data.kind !== "hello" || data.g !== PROTOCOL) return;

    // A hello from a box that already holds ports revokes them and takes new
    // ones. That is not politeness: assigning srcdoc while the previous realm is
    // still loading means its hello can arrive AFTER the rebuild, take the
    // ports, and die with them — leaving the realm the user is looking at with
    // no channel and no way to ask for one. Possession is the grant, so
    // re-granting is close() and two fresh channels, and a box that spams hello
    // can only starve itself.
    if (m.runtime || m.guest) shut(m);

    const runtime = new MessageChannel();
    const guest = new MessageChannel();
    m.runtime = runtime.port1;
    m.guest = guest.port1;
    m.runtime.onmessage = (pev) => fromGuest(m, "runtime", pev.data);
    m.guest.onmessage = (pev) => fromGuest(m, "guest", pev.data);
    // The section count no longer arrives here — `hello` predates the drawing.
    // It comes over the runtime port as `ready`, and fromGuest records it there.
    m.sections = null;

    // WHICH PAGE travels with the ports rather than as an event of its own. The
    // bootstrap needs it synchronously, in the same message that gives it the
    // ports, because it publishes both together as `window.__g` and the runtime
    // reads that object once. An event carrying the same fact a moment later
    // would be a second statement of it, and the two could disagree.
    const ports = { kind: "ports", g: PROTOCOL, page: m.ctx.page };

    // Identity is object identity against a frame this host created, checked
    // above — not an origin string. A sandboxed frame HAS no origin to target,
    // which is why this is "*" and why that must not be "fixed" later. The
    // payload is two ports delivered to one window, not a broadcast.
    //
    // THE ORDER IS THE PROTOCOL: privileged first, ordinary second. The
    // bootstrap reads `ev.ports[0]` as the runtime port and `ev.ports[1]` as the
    // guest port, and there is no field naming them because a transfer list is
    // positional and a name beside it could only ever contradict the position.
    /** @type {Window} */ (ev.source).postMessage(ports, "*", [runtime.port2, guest.port2]);

    notify(m, data);
    for (const held of sticky.values()) send(m, held);
    for (const q of m.queued.splice(0)) send(m, q);
  }

  window.addEventListener("message", hello);

  /** Close a realm's ports — and everything it embedded, because a session
   *  drawn inside a realm that is going away has nobody left to relay for it.
   *  @param {Session} m */
  function shut(m) {
    for (const e of m.embeds.values()) shut(e);
    m.embeds.clear();
    for (const p of [m.runtime, m.guest]) {
      if (!p) continue;
      p.onmessage = null;
      p.close();
    }
    m.runtime = null;
    m.guest = null;
    m.sections = null;
    m.queued.length = 0;
    // `scroll` and `restore` deliberately survive: the realm going away is
    // exactly the one whose place a redraw is about to put back.
  }

  return {
    setShim(source) {
      // A `</script>` inside the shim would end the tag it is inlined in. The
      // shim is host code and contains none, which is why this is one line
      // rather than a build step.
      shim = source.replace(/<\/script/gi, "<\\/script");
    },

    for(key, html, ctx) {
      const had = mounts.get(key);
      if (had && had.html === html && sameCtx(had.ctx, ctx)) return had.frame;

      const el = had ? had.el : document.createElement("iframe");
      if (!had) {
        // No allow-same-origin, deliberately. No popups and no modals either.
        el.setAttribute("sandbox", "allow-scripts");
        el.setAttribute("referrerpolicy", "no-referrer");
        // ONE PERMISSION IS DELEGATED, AND IT IS THE CLIPBOARD'S WRITING HALF.
        // The box has an opaque origin, so permissions policy reads it as a
        // cross-origin child and its `clipboard-write` allowlist is empty unless
        // the container says otherwise. Measured: `navigator.clipboard
        // .writeText` in here fails with *blocked because of a permissions
        // policy applied to the current document*, and the refusal lands in a
        // console nobody reads — so a page carrying a path or a prompt could
        // only offer a Copy control that selected the text and hoped.
        // WRITING ONLY, and `clipboard-read` is deliberately absent: reading the
        // clipboard is taking something nobody offered, and no page needs it.
        // The browser still wants a real gesture before a write, so what this
        // delegates is an act a person has to make.
        el.setAttribute("allow", "clipboard-write");
        // NO `scrolling="no"`, and its absence is load-bearing. The box is the
        // page's viewport: it takes the canvas and the SECTIONS SCROLL INSIDE
        // IT. Suppressing the scrollbar here would leave the content clipped at
        // the fold with no way to reach the rest of it, and would take the
        // scroller a `scroll()` timeline needs with it.
        el.setAttribute("scrolling", "auto");
      }
      // It always fills, because there is one box and it is the page. There is
      // no self-sizing mode left to choose between.
      el.className = "artifact";
      el.style.height = "100%";
      el.title = ctx.page;

      /** @type {Mount} */
      const m = had ?? {
        el,
        ctx,
        html,
        runtime: null,
        guest: null,
        sections: null,
        scroll: null,
        restore: null,
        queued: [],
        depth: 0,
        embeds: new Map(),
        // Closes over `m` itself; both bodies run long after it is assigned.
        frame: {
          el,
          post: (ev) => send(m, ev),
          drop: () => { shut(m); el.remove(); mounts.delete(key); },
        },
      };
      if (had) shut(m); // the html changed, so the old realm is going away
      m.ctx = ctx;
      m.html = html;
      mounts.set(key, m);

      // Assigning srcdoc navigates the frame, which is the only reload there is:
      // the shim runs again, says hello again, and is given a fresh pair.
      el.srcdoc = weave(shim, html, assets, faces);
      return m.frame;
    },

    drop(key) {
      const m = mounts.get(key);
      if (!m) return;
      shut(m);
      m.el.remove();
      mounts.delete(key);
    },

    broadcast(ev) {
      // Only `edit` and `theme` are broadcast. `mounted` belongs to one box and
      // is not an announcement — the `ports` message is what says which page a
      // box is on, and it says it in the same breath as granting the channel
      // that makes the answer usable.
      if (ev.kind !== "mounted") sticky.set(ev.kind, ev);
      for (const s of sessions()) send(s, ev);
    },

    refresh(change) {
      // Deliberately not a broadcast, and not sticky either.
      //
      // A box is told only about a change that can actually reach it: one to the
      // page it is mounted on, or one to any table — because two pages are
      // routinely two views of the same table, and a box cannot say which tables
      // it reads. Sending every change to every box would be two lines shorter
      // and would make each page re-read on every keystroke somewhere else in
      // the workspace.
      //
      // Not sticky because it describes a moment rather than a state: replaying
      // it to a box that mounts later would tell it to re-read data it has just
      // this second read for the first time.
      const wide = Array.isArray(change.tables) && change.tables.length > 0;
      if (!wide && change.page === undefined) return;

      /** @type {HostEvent} */
      const ev = { kind: "refresh", change };
      // Every realm, embedded ones included: a page drawn inside another is
      // told about its own page moving, and redraws there as it would anywhere.
      for (const s of sessions()) {
        if (wide || s.ctx.page === change.page) send(s, ev);
      }
    },

    compliance(key) {
      const m = mounts.get(key);
      return m && m.sections !== null ? { sections: m.sections } : null;
    },

    keep(key) {
      // Said by the shell just before a redraw, and it is the whole of what
      // makes the restore a REDRAW's and not a navigation's: the mount outlives
      // its realm either way, so without this a page come back to from the
      // rail would land where the reader last left it rather than at the top.
      // A box that never reported a position has nothing to keep, and the
      // next realm starts at the top.
      const m = mounts.get(key);
      if (m) m.restore = m.scroll;
    },
  };
}
