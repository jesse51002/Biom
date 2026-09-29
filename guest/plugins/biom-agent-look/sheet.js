// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/biom-agent-look/sheet.js — THE DEFAULT LOOK'S STYLESHEET, as a
 * string on a global that `look.js` puts inside its own shadow root when it
 * mounts. A classic script; see registry.js for why there are no imports.
 *
 * IT IS THE MOCKUP'S, ON THE BOX'S TOKENS. The owner designed the Agent screen
 * as a clickable mockup (Specs/2026-09-24-Chat/Mockup) and this is its look,
 * ported rule by rule: a departures board — near-black stock, cream ink, ONE
 * amber LED for whatever is lit, red and green only as verdicts, hairlines,
 * square corners everywhere (the one circle is a dot), the display face in
 * capitals, the gauge face for labels and the sheet face for anything read.
 *
 * NO COLOUR IS WRITTEN HERE. The mockup's `:root` block of hex is not copied:
 * every colour is a token the shim re-declares in the box, or a `color-mix` of
 * two. The LED tokens are the Dot matrix palette's — `--led`, `--led-red`,
 * `--led-green`, `--dot-off` — and the palette every workspace is seeded with
 * carries them too, and the server fills them into a workspace's theme where
 * its `theme.json` names none, so a verdict is red or green everywhere. The
 * fallback to the nearest token every palette has is for a box handed a theme
 * some other way, each named once below as a `--l-` property so it is one line
 * to change. The type is the theme's three roles:
 * the mockup's system face is the sheet face here, because the box has no
 * face of that role and the sheet face is the one meant for reading.
 *
 * EVERY ANIMATION IS BEHIND `--motion`, and the look also marks its root
 * `data-still` when the reader asked for stillness, which stops every
 * animation and transition outright — a duration multiplied by zero is a
 * resting frame, and an infinite animation of no length is none. */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  glob.__gAgentLookSheet = `
:host { display: block; position: absolute; inset: 0; }
.g-look {
  --l-led: var(--led, var(--cyan));
  --l-red: var(--led-red, var(--magenta));
  --l-green: var(--led-green, var(--ink-2));
  --l-off: var(--dot-off, var(--rule-soft));
  --l-glow: color-mix(in srgb, var(--l-led) 50%, transparent);
  --l-field-2: color-mix(in srgb, var(--ink) 5%, var(--stock-hi));
  --l-field-3: color-mix(in srgb, var(--ink) 9%, var(--stock-hi));
  --l-wash: color-mix(in srgb, var(--ink) 5%, transparent);
  --l-small: color-mix(in srgb, var(--ink-2) 72%, var(--ink-3));
  --l-sheet: var(--sheet-face, system-ui, sans-serif);
  --l-gauge: var(--gauge-face, ui-monospace, monospace);
  --l-threads: 268px;
  --l-col: 720px;
  --l-head: 46px;
  --l-in: 0px;
  --l-mid: 0px;
  --l-m: var(--motion, 1);
  --l-ease: cubic-bezier(.16, 1, .3, 1);
  position: absolute; inset: 0;
  display: grid;
  grid-template-areas: "threads head" "threads stage";
  grid-template-columns: 0px minmax(0, 1fr);
  grid-template-rows: 0px minmax(0, 1fr);
  background: var(--stock); color: var(--ink);
  font: 14px/1.4 var(--l-sheet);
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
  transition: grid-template-columns calc(.6s * var(--l-m)) var(--l-ease), grid-template-rows calc(.45s * var(--l-m)) var(--l-ease);
}
.g-look[data-threads] { grid-template-columns: var(--l-threads) minmax(0, 1fr); }
.g-look[data-mode=panel] { grid-template-columns: 0px minmax(0, 1fr); grid-template-rows: var(--l-head) minmax(0, 1fr); }
.g-look[data-still] *, .g-look[data-still] *::before, .g-look[data-still] *::after, .g-look[data-still] { animation: none !important; transition: none !important; }
*, *::before, *::after { box-sizing: border-box; }
* { scrollbar-width: thin; scrollbar-color: var(--rule) transparent; }
::selection { background: color-mix(in srgb, var(--l-led) 34%, transparent); color: var(--ink); }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--l-led); outline-offset: 2px; }
svg { display: block; flex: none; }
.ico { width: 16px; height: 16px; }
[hidden] { display: none !important; }
.bw { display: contents; }

/* ─────────── the history, down the left on the full screen ─────────── */
.threads { grid-area: threads; min-width: 0; overflow: hidden; border-right: 1px solid transparent; transition: border-color calc(.3s * var(--l-m)); }
.g-look[data-threads] .threads { border-right-color: var(--stock-edge); }
.g-look[data-mode=panel] .threads { visibility: hidden; }
.threads .inner { width: var(--l-threads); height: 100%; display: flex; flex-direction: column; padding: 10px 8px 8px; }
.thead { display: flex; align-items: center; justify-content: space-between; height: 30px; margin: 0 -2px 8px 2px; font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); }
.newthread { display: flex; align-items: center; gap: 9px; height: 36px; padding: 0 10px 0 11px; border: 1px solid var(--stock-edge); color: var(--ink); font: 600 14px var(--l-sheet); transition: background calc(.12s * var(--l-m)), border-color calc(.12s * var(--l-m)); }
.newthread .ico { width: 14px; height: 14px; color: var(--ink-2); }
.newthread:hover { background: var(--l-wash); border-color: var(--ink-3); }
.newthread[aria-current=true] { border-color: var(--ink-3); background: var(--l-field-2); }
kbd { font: 11px var(--l-gauge); color: var(--ink-3); letter-spacing: .02em; }
.newthread kbd { margin-left: auto; }
.tlist { flex: 1; min-height: 0; overflow: auto; margin: 10px -4px 0; padding: 0 4px; }
.tgroup { font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); padding: 18px 10px 7px; }
.tgroup:first-child { padding-top: 6px; }
.trow { position: relative; display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 6px 6px 6px 10px; cursor: pointer; transition: background calc(.12s * var(--l-m)); }
.trow:hover { background: var(--l-wash); }
.trow[aria-selected=true] { background: var(--l-field-2); }
.trow .tt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.trow .t { font: 14.5px/1.35 var(--l-sheet); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trow[aria-selected=true] .t { color: var(--ink); }
.trow .s { font: 11.5px/1.4 var(--l-gauge); letter-spacing: .02em; color: var(--l-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.trow .s .w { color: var(--ink-2); }
.trow .led { margin: 0 4px 0 0; align-self: center; }
.trow.enter { animation: rowin calc(.5s * var(--l-m)) var(--l-ease); }

/* a chat's three dots, beside its row: shown on hover and on focus */
.trowbox, .mirow { position: relative; }
.tmore { position: absolute; top: 50%; right: 3px; transform: translateY(-50%); width: 26px; height: 26px; display: grid; place-items: center; color: var(--ink-3); opacity: 0; transition: opacity calc(.12s * var(--l-m)), background calc(.12s * var(--l-m)), color calc(.12s * var(--l-m)); }
.tmore .ico { width: 15px; height: 15px; }
.trowbox:hover .tmore, .trowbox:focus-within .tmore, .mirow:hover .tmore, .mirow:focus-within .tmore, .tmore[aria-expanded=true] { opacity: 1; }
.tmore:hover, .tmore[aria-expanded=true] { background: var(--l-field-3); color: var(--ink); }
.trow > .led, .mi > .led, .mi > .check { transition: opacity calc(.12s * var(--l-m)); }
.trowbox:hover .trow > .led, .trowbox:focus-within .trow > .led, .mirow:hover .mi > .led, .mirow:focus-within .mi > .led, .mirow:hover .mi > .check, .mirow:focus-within .mi > .check { opacity: 0; }
.rowmenu .del { color: color-mix(in srgb, var(--l-red) 70%, var(--ink)); }
@keyframes rowin { from { opacity: 0; transform: translateY(-6px); } }
.emo { flex: none; width: 20px; overflow: hidden; display: inline-flex; justify-content: center; font-size: 15px; line-height: 1; font-family: "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; transform-origin: 50% 50%; }
.emo .dm { transform: scale(.8); }
.tnone { padding: 18px 10px; font: 13.5px/1.5 var(--l-sheet); color: var(--ink-3); }

/* ─────────── the panel's head, beside a page ─────────── */
.panelhead { grid-area: head; min-width: 0; display: none; align-items: center; gap: 2px; padding: 0 6px; border-bottom: 1px solid var(--stock-edge); overflow: hidden; }
.g-look[data-mode=panel] .panelhead { display: flex; }
.tswitch { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; height: 32px; padding: 0 8px 0 10px; font: 600 14px var(--l-sheet); color: var(--ink); }
.tswitch .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tswitch .ico { width: 12px; height: 12px; color: var(--ink-3); }
.tswitch .emo { width: auto; }
.tswitch .emo:empty { display: none; }
.tswitch:hover, .tswitch[aria-expanded=true] { background: var(--field); }
.iconbtn { width: 30px; height: 30px; display: grid; place-items: center; color: var(--ink-2); flex: none; transition: background calc(.12s * var(--l-m)), color calc(.12s * var(--l-m)); }
.iconbtn .ico { width: 15px; height: 15px; }
.iconbtn:hover { background: var(--field); color: var(--ink); }

/* a menu hung from a button — a row's three dots — kept inside the look */
.popmenu { position: absolute; z-index: 70; min-width: 150px; max-width: calc(100% - 12px); background: var(--stock-hi); border: 1px solid var(--stock-edge); box-shadow: 0 1px 0 var(--stock-lo); padding: 4px; animation: menuin calc(.18s * var(--l-m)) var(--l-ease); transform-origin: top right; }

/* the history as a dropdown, in the panel */
.menu { position: absolute; z-index: 60; top: calc(var(--l-head) - 2px); left: 6px; width: min(340px, calc(100% - 12px)); max-height: calc(100% - var(--l-head) - 12px); overflow: auto; background: var(--stock-hi); border: 1px solid var(--stock-edge); box-shadow: 0 1px 0 var(--stock-lo); padding: 4px; animation: menuin calc(.18s * var(--l-m)) var(--l-ease); transform-origin: top left; }
@keyframes menuin { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
.mlabel { font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); padding: 9px 10px 6px; }
.mi { display: flex; align-items: center; gap: 11px; width: 100%; padding: 8px 10px; font: 14px/1.35 var(--l-sheet); color: var(--ink); text-align: left; }
.mi .ico { width: 14px; height: 14px; color: var(--ink-2); }
.mi .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.mi .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mi .emo { margin-right: -2px; }
.mi:hover, .mi:focus-visible { background: var(--l-field-3); outline: none; }
.mi .check { margin-left: auto; color: var(--l-led); width: 15px; height: 15px; }

/* ─────────── the stage ─────────── */
.stage { grid-area: stage; position: relative; min-height: 0; min-width: 0; overflow: hidden; container-type: inline-size; }
.fx { position: absolute; inset: 0; z-index: 0; transition: opacity calc(.5s * var(--l-m)) var(--l-ease); }
.fx canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; transition: opacity calc(.5s * var(--l-m)) var(--l-ease); }
.fx canvas.gone { opacity: 0; }
.g-look[data-state=live] .fx { opacity: 0; }
.hero { position: absolute; z-index: 1; left: 50%; width: min(var(--l-col), calc(100% - 48px)); transform: translateX(-50%); }
.hero-top { bottom: calc(50% + var(--l-mid) / 2 + 40px); }
.hero-bot { top: calc(50% + var(--l-mid) / 2 + 22px); }
.g-look[data-state=live] .hero:not(.leaving) { display: none; }
.hero.leaving { pointer-events: none; opacity: 0; transform: translate(-50%, -14px); filter: blur(2px); transition: opacity calc(.34s * var(--l-m)) var(--l-ease), transform calc(.5s * var(--l-m)) var(--l-ease), filter calc(.34s * var(--l-m)); }
.hero.arriving { animation: heroin calc(.7s * var(--l-m)) var(--l-ease) both; animation-delay: calc(.12s * var(--l-m)); }
@keyframes heroin { from { opacity: 0; transform: translate(-50%, 10px); filter: blur(3px); } }
.line { margin: 0; text-shadow: 0 0 18px var(--stock), 0 0 5px var(--stock); font: 500 2.75rem/1.15 var(--l-sheet); letter-spacing: -.015em; color: var(--ink); text-align: center; white-space: nowrap; }
.swap { display: inline-grid; grid-template-columns: minmax(0, 1fr); text-align: center; vertical-align: bottom; white-space: nowrap; color: var(--l-led); transition: width calc(.5s * var(--l-m)) var(--l-ease); }
/* each word its own width, centred in the swap: the two of a turn share one
   centre while the swap's width moves, and the wider never hangs off one side */
.swap span { grid-area: 1 / 1; justify-self: center; min-width: 0; transition: transform calc(.45s * var(--l-m)) var(--l-ease), opacity calc(.3s * var(--l-m)) ease, filter calc(.3s * var(--l-m)) ease; }
/* the word's two states are named for the word: this sheet's rules are bare
   classes, and a word called \`out\` took the tool output's padding and wrapping */
.swap .word-out { transform: translateY(-.3em); opacity: 0; filter: blur(3px); }
.swap .word-in { transform: translateY(.3em); opacity: 0; filter: blur(3px); }
.histwrap { display: flex; justify-content: center; }
.histlink { display: inline-flex; align-items: center; gap: 8px; padding: 4px 2px; font: 15px var(--l-sheet); color: var(--ink-2); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ink-2) 40%, transparent); text-underline-offset: 4px; text-shadow: 0 0 12px var(--stock), 0 0 4px var(--stock); transition: color calc(.15s * var(--l-m)), text-decoration-color calc(.15s * var(--l-m)); }
.histlink:hover, .histlink[aria-expanded=true] { color: var(--ink); text-decoration-color: var(--ink); }
.histlink .hl-dot:not(.led) { display: none; }
@container (max-width: 619px) {
  .line { font-size: 1.75rem; }
  .col { gap: 22px; }
}

/* the thread, which ends where Biom's own input box begins */
.log { position: absolute; z-index: 1; left: 0; right: 0; top: 0; bottom: var(--l-in); overflow: auto; padding: 30px 24px 18px; overscroll-behavior: contain; }
.g-look[data-state=empty] .log, .g-look[data-state=empty] .fade, .g-look[data-state=empty] .jump { display: none; }
.fade { position: absolute; z-index: 2; left: 0; right: 0; bottom: var(--l-in); height: 28px; background: linear-gradient(to bottom, transparent, var(--stock)); pointer-events: none; }
.jump { position: absolute; z-index: 3; left: 50%; bottom: calc(var(--l-in) + 12px); transform: translateX(-50%); display: none; align-items: center; gap: 7px; height: 28px; padding: 0 11px; border: 1px solid var(--stock-edge); background: var(--stock-hi); font: 11.5px var(--l-gauge); color: var(--ink-2); }
.jump.on { display: inline-flex; }
.jump:hover { color: var(--ink); border-color: var(--ink-3); }
.jump .ico { width: 12px; height: 12px; }
/* the full screen's top bar: Minimize, at its right. In a chat it is a bar
   the height of the panel's head, with its hairline, and the thread starts
   under it, so nothing scrolled ever runs under its button; on the start
   screen it is only Minimize, over nothing that moves. */
.chatbar { position: absolute; z-index: 4; top: 0; left: 0; right: 0; height: var(--l-head); display: flex; align-items: center; justify-content: flex-end; gap: 2px; padding: 0 10px; pointer-events: none; }
.chatbar > * { pointer-events: auto; }
.g-look[data-mode=screen][data-state=live] .chatbar { background: var(--stock); border-bottom: 1px solid var(--stock-edge); }
.g-look[data-mode=screen][data-state=live] .log { top: var(--l-head); }
.g-look[data-mode=panel] .chatbar { display: none; }
.col { max-width: var(--l-col); margin: 0 auto; display: flex; flex-direction: column; gap: 26px; }
.earlier { align-self: center; font: 11.5px var(--l-gauge); color: var(--ink-2); border: 1px solid var(--stock-edge); padding: 5px 11px; letter-spacing: .02em; }
.earlier:hover { color: var(--ink); border-color: var(--ink-3); }
.turnw { display: flex; flex-direction: column; gap: 12px; content-visibility: auto; contain-intrinsic-size: auto 240px; }

/* the person's message, and the agent's status on it */
.uw { align-self: flex-end; display: flex; flex-direction: column; align-items: flex-end; max-width: min(84%, 560px); margin-bottom: 22px; }
.u { position: relative; max-width: 100%; background: var(--l-field-2); border: 1px solid var(--stock-edge); padding: 10px 15px 11px; font: 15.5px/1.55 var(--l-sheet); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }

/* what waits in the chat's queue, under the running turn */
.queue { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.qitem { max-width: min(84%, 560px); border: 1px dashed var(--stock-edge); background: color-mix(in srgb, var(--l-field-2) 55%, transparent); padding: 6px 8px 9px 14px; color: var(--ink-3); animation: fadein calc(.3s * var(--l-m)) var(--l-ease); }
.qhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.qlabel { font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); }
.qtext { font: 15px/1.5 var(--l-sheet); white-space: pre-wrap; overflow-wrap: anywhere; }
.qx { width: 22px; height: 22px; display: grid; place-items: center; color: var(--ink-3); transition: background calc(.12s * var(--l-m)), color calc(.12s * var(--l-m)); }
.qx .ico { width: 12px; height: 12px; }
.qx:hover { color: var(--ink); background: var(--l-wash); }
.u.enter { animation: uin calc(.55s * var(--l-m)) var(--l-ease) calc(.14s * var(--l-m)) both; }
@keyframes uin { from { opacity: 0; transform: translateY(22px) scale(.98); } }
.mood { position: absolute; left: 10px; top: calc(100% - 9px); display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 30px; padding: 0; background: var(--stock-hi); border: 1px solid var(--stock-edge); white-space: nowrap; }
.mood:empty { display: none; }
.mood .face { width: 26px; height: 26px; display: grid; place-items: center; font: 19px/1 "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif; transform-origin: 50% 50%; }
.mood .face img { width: 26px; height: 26px; display: block; }
.dm { display: grid; grid-template-columns: repeat(3, 5px); grid-auto-rows: 5px; gap: 2px; }
.dm i { width: 5px; height: 5px; border-radius: 50%; background: var(--l-off); animation: dmrun calc(.8s * var(--l-m)) linear infinite; }
.dm i:nth-child(1) { animation-delay: calc(-.8s * var(--l-m)); } .dm i:nth-child(2) { animation-delay: calc(-.7s * var(--l-m)); } .dm i:nth-child(3) { animation-delay: calc(-.6s * var(--l-m)); }
.dm i:nth-child(6) { animation-delay: calc(-.5s * var(--l-m)); } .dm i:nth-child(9) { animation-delay: calc(-.4s * var(--l-m)); } .dm i:nth-child(8) { animation-delay: calc(-.3s * var(--l-m)); }
.dm i:nth-child(7) { animation-delay: calc(-.2s * var(--l-m)); } .dm i:nth-child(4) { animation-delay: calc(-.1s * var(--l-m)); }
.dm i:nth-child(5) { animation: dmcore calc(1.6s * var(--l-m)) ease-in-out infinite; }
@keyframes dmrun { 0% { background: var(--l-led); box-shadow: 0 0 6px var(--l-glow); } 35% { background: color-mix(in srgb, var(--l-led) 30%, var(--l-off)); box-shadow: none; } 100% { background: var(--l-off); } }
@keyframes dmcore { 50% { background: color-mix(in srgb, var(--l-led) 45%, var(--l-off)); } }

/* the agent's turn */
.turn { display: flex; flex-direction: column; gap: 12px; animation: fadein calc(.4s * var(--l-m)) var(--l-ease); }
@keyframes fadein { from { opacity: 0; } }
.who { display: flex; align-items: center; gap: 9px; font: 11px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-3); }
.think { display: inline-flex; align-items: center; gap: 9px; align-self: flex-start; font: 14px var(--l-sheet); color: var(--l-small); padding: 3px 7px 3px 1px; }
.think.done:hover { color: var(--ink-2); background: var(--l-wash); }
.think .ico { width: 11px; height: 11px; transition: transform calc(.2s * var(--l-m)) var(--l-ease); }
.think[aria-expanded=true] .ico { transform: rotate(90deg); }
.thought { display: none; margin: -4px 0 2px 1px; padding: 2px 0 2px 14px; border-left: 1px dotted var(--ink-3); font: italic 14px/1.6 var(--l-sheet); color: var(--ink-3); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; }
.thinkw[data-open] .thought { display: block; animation: fadein calc(.25s * var(--l-m)); }
.thought .more { display: block; margin-top: 6px; font: normal 11.5px var(--l-gauge); letter-spacing: .02em; color: var(--l-small); white-space: normal; }

/* a run of tool calls: one line that opens to them */
.acts { display: flex; flex-direction: column; gap: 1px; }
.grp { display: inline-flex; align-items: center; gap: 8px; align-self: flex-start; max-width: 100%; min-height: 26px; padding: 2px 7px 2px 1px; font: 14px var(--l-sheet); color: var(--l-small); text-align: left; transition: color calc(.12s * var(--l-m)), background calc(.12s * var(--l-m)); }
.grp:hover { color: var(--ink-2); background: var(--l-wash); }
.grp[data-state=live] .glabel { color: var(--ink-2); }
.grp .led.none { display: none; }
.grp .glabel { white-space: nowrap; }
.grp .gcur { min-width: 0; font: 12.5px var(--l-gauge); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grp .gfail { display: inline-flex; align-items: center; gap: 6px; font: 12px var(--l-gauge); color: color-mix(in srgb, var(--l-red) 55%, var(--ink)); white-space: nowrap; }
.grp .ico { width: 11px; height: 11px; transition: transform calc(.2s * var(--l-m)) var(--l-ease); }
.grp[aria-expanded=true] .ico { transform: rotate(90deg); }
.grplist { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 4px 3px; padding-left: 12px; border-left: 1px dotted var(--ink-3); animation: fadein calc(.25s * var(--l-m)); }
.act { display: grid; grid-template-columns: 7px auto minmax(0, 1fr) auto 12px; align-items: center; column-gap: 9px; width: 100%; min-height: 29px; padding: 3px 7px 3px 2px; font: 14px var(--l-sheet); color: var(--ink-2); text-align: left; transition: background calc(.12s * var(--l-m)); animation: actin calc(.35s * var(--l-m)) var(--l-ease); }
@keyframes actin { from { opacity: 0; transform: translateX(-4px); } }
.act:hover { background: var(--l-wash); }
.act .verb { color: var(--ink-2); white-space: nowrap; }
.act[data-state=live] .verb { color: var(--ink); }
.act .obj { font: 12.5px var(--l-gauge); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.act .meta { font: 12px var(--l-gauge); color: var(--ink-3); white-space: nowrap; }
.act .ico { width: 11px; height: 11px; color: var(--ink-3); transition: transform calc(.2s * var(--l-m)) var(--l-ease); opacity: 0; }
.act:hover .ico, .act[aria-expanded=true] .ico, .act:focus-visible .ico { opacity: 1; }
.act[aria-expanded=true] .ico { transform: rotate(90deg); }
.detail { margin: 2px 0 8px 18px; border: 1px solid var(--rule-soft); background: var(--stock-lo); font: 12px/1.65 var(--l-gauge); overflow: auto; max-height: 230px; padding: 8px 0; animation: fadein calc(.25s * var(--l-m)); }
.dl { padding: 0 14px; white-space: pre; color: var(--ink-2); }
.dl.add { background: color-mix(in srgb, var(--l-green) 8%, transparent); color: color-mix(in srgb, var(--l-green) 55%, var(--ink)); }
.dl.del { background: color-mix(in srgb, var(--l-red) 9%, transparent); color: color-mix(in srgb, var(--l-red) 55%, var(--ink)); }
.dl.dim, .dl.gap { color: var(--ink-3); }
.dl.path { color: var(--ink-2); padding-bottom: 4px; }
.dl + .dl.path { margin-top: 8px; }
.out { margin: 0; padding: 0 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink-2); font: inherit; }

/* the reply, as words: markdown read safely, never markup */
.prose { font: 15.5px/1.64 var(--l-sheet); color: var(--ink); max-width: 66ch; overflow-wrap: anywhere; }
.prose p, .prose ul, .prose ol, .prose blockquote, .prose pre, .prose table, .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { margin: 0 0 .75em; }
.prose > :last-child, .prose .tail > :last-child { margin-bottom: 0; }
.prose .tail:empty { display: none; }
.prose p.pre { white-space: pre-wrap; }
.prose strong { font-weight: 700; }
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 { font: 700 1em/1.4 var(--l-sheet); }
.prose h1 { font-size: 1.2em; } .prose h2 { font-size: 1.1em; }
.prose ul, .prose ol { padding-left: 1.4em; }
.prose li + li { margin-top: .2em; }
.prose blockquote { padding-left: 14px; border-left: 1px solid var(--rule); color: var(--ink-2); }
.prose hr { border: 0; border-top: 1px solid var(--rule); margin: 1em 0; }
.prose code { font: 13.5px var(--l-gauge); background: var(--l-field-2); border: 1px solid var(--rule-soft); padding: 0 5px; }
.prose pre { background: var(--stock-lo); border: 1px solid var(--rule-soft); padding: 10px 14px; overflow: auto; max-height: 420px; }
.prose pre code { background: none; border: 0; padding: 0; font: 12.5px/1.6 var(--l-gauge); white-space: pre; }
.prose table { border-collapse: collapse; font-size: 14px; display: block; overflow: auto; max-width: 100%; }
.prose th, .prose td { border: 1px solid var(--rule); padding: 4px 10px; text-align: left; vertical-align: top; }
.prose th { font-weight: 700; background: var(--l-field-2); }
.prose .al-c { text-align: center; } .prose .al-r { text-align: right; }
.prose .lk { color: var(--ink); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ink) 35%, transparent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
.prose .img { color: var(--ink-3); font-style: italic; }
.caret { display: inline-block; width: .52em; height: 1.08em; margin-left: 2px; vertical-align: -.17em; background: var(--l-led); box-shadow: 0 0 9px var(--l-glow); animation: blink calc(1.05s * var(--l-m)) steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
.tfoot { display: flex; align-items: center; gap: 6px; margin-top: -2px; font: 11.5px var(--l-gauge); color: var(--l-small); letter-spacing: .02em; }
.note { display: flex; align-items: flex-start; gap: 10px; padding: 11px 13px; border: 1px solid var(--stock-edge); background: var(--stock-hi); font: 14.5px/1.5 var(--l-sheet); color: var(--ink-2); overflow-wrap: anywhere; }
.note .led { margin-top: 6px; }
.note b { color: var(--ink); font-weight: 600; }
.stopped { display: inline-flex; align-items: center; gap: 8px; font: 11.5px var(--l-gauge); color: var(--l-small); letter-spacing: .03em; }
.handover { display: flex; align-items: center; gap: 14px; font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); }
.handover::before, .handover::after { content: ""; flex: 1; height: 1px; background: var(--rule); }
.handover .lit-dot { display: inline-block; margin-right: 8px; vertical-align: 1px; }

/* the pages the turn changed */
.changes { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 4px 0 6px; }
.chead { font: 10.5px var(--l-gauge); letter-spacing: .14em; text-transform: uppercase; color: var(--l-small); padding: 8px 2px 4px; }
.crow { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto auto auto; align-items: center; column-gap: 10px; min-height: 32px; padding: 0 2px; }
.crow .ico { width: 13px; height: 13px; color: var(--ink-3); }
.crow .pg { font: 12.5px var(--l-gauge); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.crow span.pg { color: var(--ink-2); }
.crow .cverb { font: 13.5px var(--l-sheet); color: var(--ink-2); }
.crow .cmeta { font: 12px var(--l-gauge); color: var(--ink-3); }
.pg { color: var(--ink); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--ink) 35%, transparent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
button.pg:hover { text-decoration-color: var(--ink); }
span.pg { text-decoration: none; }
.copen { font: 11.5px var(--l-gauge); color: var(--ink); border: 1px solid var(--stock-edge); padding: 3px 9px; }
.copen:hover { background: var(--l-field-3); }

/* LEDs: lit is true, off is not; red and green are verdicts */
.led { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--l-off); flex: none; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 6%, transparent); }
.led.lit { background: var(--l-led); box-shadow: 0 0 0 3px color-mix(in srgb, var(--l-led) 13%, transparent), 0 0 10px var(--l-glow); }
.led.red { background: var(--l-red); box-shadow: 0 0 0 3px color-mix(in srgb, var(--l-red) 14%, transparent), 0 0 9px color-mix(in srgb, var(--l-red) 45%, transparent); }
.led.green { background: var(--l-green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--l-green) 12%, transparent), 0 0 9px color-mix(in srgb, var(--l-green) 40%, transparent); }
.led.none { background: transparent; box-shadow: none; }
.led.pulse { animation: ledpulse calc(1.3s * var(--l-m)) ease-in-out infinite; }
@keyframes ledpulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--l-led) 0%, transparent), 0 0 16px var(--l-glow); filter: brightness(1.15); } }
.lit-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--l-led); box-shadow: 0 0 8px var(--l-glow); }
.leds3 { display: inline-flex; gap: 4px; }
.leds3 i { width: 5px; height: 5px; border-radius: 50%; background: var(--l-off); animation: seq calc(1.05s * var(--l-m)) infinite; }
.leds3 i:nth-child(2) { animation-delay: calc(.15s * var(--l-m)); }
.leds3 i:nth-child(3) { animation-delay: calc(.3s * var(--l-m)); }
@keyframes seq { 0%, 60%, 100% { background: var(--l-off); box-shadow: none; } 20% { background: var(--l-led); box-shadow: 0 0 7px var(--l-glow); } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
})();
