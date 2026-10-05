// The second demo: customer feedback into the roadmap. The founder is on their
// Roadmap board and asks the agent to read this week's customer calls; the
// agent reads the call pages already in the workspace, groups what was asked
// for, ranks it by the revenue behind it, and updates the board they are
// looking at: two cards gain customers, one new card lands in Next with who
// asked and a quote.
//
// NOTHING HERE IS REAL. Fernway, every account, person, quote and figure is
// invented, and the GIF says so in its corner.
//
// WHAT IT CLAIMS WAS CHECKED AGAINST THE BUILD (2026-10-05): a board is the
// shipped `biom-kanban` page type, lanes drawn from a categories column of a
// workspace table, and its look below is that plugin's (lane heads, the lit
// rule under each, labelled fields on a card); an agent writes its rows with
// `row.insert`/`row.update`, which redraws the board; call notes are ordinary
// pages an agent reads from the folder; and a page the agent writes is brought
// up beside the chat. Nothing here needs a scheduler or a connector.

import { seg, show, esc } from "../clock.js";

const T = { typeFrom: 0.15, typeTo: 1.05, send: 1.2, sent: 1.5, result: 4.1 };
const R = T.result;

/** The board, before and after. A card's `before` is what the opening frame
 *  shows; `after` is what the turn wrote; `added` marks the new card. */
const LANES = [
  { label: "Now", tone: "now", cards: [
    { id: "billing", title: "Usage-based billing",
      before: { customers: 2, arr: "$24k", asked: "Halcyon, Brightwell" },
      after: { customers: 4, arr: "$41k", asked: "Halcyon, Brightwell +2" }, delta: "+2" },
    { id: "slack", title: "Slack alerts",
      before: { customers: 1, arr: "$6k", asked: "Kestrel Pay" } },
  ] },
  { label: "Next", tone: "next", cards: [
    { id: "sso", title: "SSO for teams", added: true,
      after: { customers: 4, arr: "$38k", asked: "Northwind, Ledgerline +2" },
      quote: "We can't roll out past 20 seats without SSO.", who: "Northwind call · Oct 6" },
    { id: "csv", title: "CSV export",
      before: { customers: 3, arr: "$15k", asked: "Oakmere, Halcyon" },
      after: { customers: 5, arr: "$27k", asked: "Oakmere, Halcyon +3" }, delta: "+2" },
  ] },
  { label: "Later", tone: "later", cards: [
    { id: "audit", title: "Audit log",
      before: { customers: 1, arr: "$9k", asked: "Northwind" } },
  ] },
];

const CSS = `
  .rm{position:absolute; inset:0; padding:22px 20px 40px}
  .rmhead{display:flex; align-items:center; justify-content:space-between}
  .rmt{margin:0; font:700 26px/1.2 var(--sheet-face); color:var(--ink)}
  .rmtools{display:flex; gap:6px}
  .rmtools span{padding:5px 10px; border:1px solid var(--stock-edge); font:10.5px var(--ui-face); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-2)}
  .rmsub{display:flex; align-items:center; gap:8px; height:22px; margin:6px 0 10px; font:12px var(--gauge-face); letter-spacing:.02em; color:var(--ink-3)}
  .rmsub b{font-weight:400; color:var(--ink-2)}
  .lanes{display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:10px; align-items:start}
  .lane{border:1px solid var(--stock-edge); background:var(--stock); padding:0 8px 8px; min-height:470px}
  .lh{display:flex; justify-content:space-between; align-items:center; height:36px; padding:0 3px; margin-bottom:8px; border-bottom:2px solid var(--nonrepro-t); font:600 11px var(--ui-face); letter-spacing:.08em; text-transform:uppercase; color:var(--ink)}
  .lh.now{border-bottom-color:var(--led)} .lh.next{border-bottom-color:var(--magenta)}
  .lh .n{font:400 11px var(--gauge-face); color:var(--ink-3)}
  .slot{overflow:hidden}
  .kc{position:relative; border:1px solid var(--stock-edge); background:var(--paper); padding:10px 11px 10px; margin-bottom:8px; overflow:hidden}
  .kc.added{border-color:var(--led); box-shadow:0 0 0 1px var(--led), 0 0 18px -6px var(--glow)}
  .kt{display:flex; align-items:baseline; justify-content:space-between; gap:6px; font:16px/1.3 var(--sheet-face); color:var(--ink); margin-bottom:6px}
  .tag{flex:none; font:600 9.5px var(--gauge-face); letter-spacing:.12em; padding:2px 5px; background:var(--led); color:var(--on-spot)}
  .kf{display:grid; grid-template-columns:66px minmax(0,1fr); column-gap:6px; align-items:baseline; font:13.5px/1.45 var(--sheet-face); color:var(--ink)}
  .kf > span:first-child{font:9.5px var(--ui-face); letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3)}
  .kf .v{display:inline-flex; align-items:baseline; gap:6px}
  .delta{font:600 10.5px var(--gauge-face); color:var(--led)}
  .kq{margin-top:8px; padding-top:7px; border-top:1px solid var(--stock-edge); font:italic 13.5px/1.4 var(--sheet-face); color:var(--ink-2)}
  .kq small{display:block; margin-top:3px; font:normal 10.5px var(--gauge-face); letter-spacing:.02em; color:var(--ink-3)}
  .kq small u{text-decoration-color:color-mix(in srgb, var(--ink-3) 60%, transparent); text-underline-offset:2px}

  .mob .rm{padding:20px 14px 0; background:var(--paper)}
  .mob .rmt{font-size:30px}
  .mob .rmtools{display:none}
  .mob .lane{min-height:0; padding:0 8px 2px}
  .mob .lh{height:34px}
  .mob .kt{font-size:18px}
  .mob .kf{font-size:15px; grid-template-columns:78px minmax(0,1fr)}
  .mob .kf > span:first-child{font-size:10px}
  .mob .kq{font-size:15px}
  .mob .kq small{font-size:11px}
  .others{display:flex; gap:8px; margin-top:10px}
  .others span{flex:1; display:flex; justify-content:space-between; align-items:center; height:34px; padding:0 10px; border:1px solid var(--stock-edge); border-bottom-width:2px; background:var(--stock); font:600 11px var(--ui-face); letter-spacing:.08em; text-transform:uppercase}
  .others .now{border-bottom-color:var(--led)} .others .later{border-bottom-color:var(--nonrepro-t)}
  .others i{font:400 11px var(--gauge-face); font-style:normal; color:var(--ink-3)}
  .others .delta{margin-left:auto; margin-right:8px}
`;

const field = (label, value, key) =>
  `<div class="kf"><span>${esc(label)}</span><span class="v" ${key ? `data-k="${key}"` : ""}>${esc(value)}</span></div>`;

/** One card as the opening frame shows it, or, with `final`, as the turn left
 *  it — which is how the narrow composition, which never shows the before,
 *  draws it. */
function card(c, final = false) {
  const s = final ? (c.after || c.before) : (c.before || c.after);
  const id = c.id;
  const delta = final && c.delta ? ` <span class="delta">${esc(c.delta)}</span>` : "";
  const wrap = c.added && !final;
  return `${wrap ? `<div class="slot" data-k="slot-${id}">` : ""}<div class="kc${c.added ? " added" : ""}" data-k="card-${id}">
    <div class="kt"><span>${esc(c.title)}</span>${c.added ? `<span class="tag">NEW</span>` : ""}</div>
    ${field("Customers", String(s.customers), c.delta && !final ? `${id}-customers` : "").replace("</span></div>", delta + "</span></div>")}
    ${field("ARR", s.arr, c.delta ? `${id}-arr` : "")}
    ${field("Asked by", s.asked, c.delta ? `${id}-asked` : "")}
    ${c.quote ? `<div class="kq">“${esc(c.quote)}”<small>${esc(c.who)}</small><small><u>4 calls linked</u></small></div>` : ""}
  </div>${wrap ? "</div>" : ""}`;
}

const laneCount = (lane, after) => lane.cards.filter((c) => after || !c.added).length;

function desktop() {
  return `<section class="rm">
    <div class="rmhead"><h1 class="rmt">Roadmap</h1><span class="rmtools"><span>View table</span><span>Settings</span></span></div>
    <div class="rmsub" data-k="sub"><span data-k="subBefore">Fernway · this quarter</span></div>
    <div class="lanes">${LANES.map((l) => `<div class="lane">
      <div class="lh ${l.tone}"><span>${esc(l.label)}</span><span class="n" data-k="count-${l.tone}">${laneCount(l, false)}</span></div>
      ${l.cards.map((c) => card(c)).join("")}
    </div>`).join("")}</div>
  </section>`;
}

function mobile() {
  const next = LANES[1];
  return `<section class="rm" data-k="resultSheet">
    <h1 class="rmt">Roadmap</h1>
    <div class="rmsub"><i class="led lit"></i><span>Updated by <b>Claude Code</b> · 3 cards</span></div>
    <div class="lane"><div class="lh next"><span>Next</span><span class="n">${laneCount(next, true)}</span></div>
      ${next.cards.map((c) => card(c, true)).join("")}
    </div>
    <div class="others"><span class="now">Now<i>2</i></span><span class="later">Later<i>1</i></span></div>
  </section>`;
}

/** The board updating in place: the new card opens a slot in Next and arrives
 *  lit, then the two cards that gained customers change their numbers, each
 *  with its delta. Nothing else on the board moves. */
function draw(t, k, layout) {
  if (layout === "mobile") {
    const o = seg(t, R + 0.15, R + 0.55);
    show(k.resultSheet, o, (1 - o) * 8);
    return;
  }
  const after = t >= R;

  // the line under the title says who changed the board, and when
  const subAt = R + 0.9;
  if (k.sub) k.sub.innerHTML = t >= subAt
    ? `<i class="led lit"></i><span>Updated by <b>Claude Code</b> · 3 cards · Mon 9:04</span>`
    : `<span>Fernway · this quarter</span>`;
  if (t >= subAt) show(k.sub, seg(t, subAt, subAt + 0.3));
  else show(k.sub, 1);

  // the new card: its slot opens, then it fades in
  const slot = k["slot-sso"], sso = k["card-sso"];
  if (slot && sso) {
    const open = seg(t, R, R + 0.35);
    const h = sso.offsetHeight + 8; // the card and the gap under it
    slot.style.height = open >= 1 ? "" : (h * open).toFixed(2) + "px";
    show(sso, seg(t, R + 0.25, R + 0.6));
  }
  if (k["count-next"]) k["count-next"].textContent = String(after ? 2 : 1);

  // the cards that gained customers
  for (const lane of LANES) for (const c of lane.cards) {
    if (!c.delta) continue;
    const at = R + (c.id === "csv" ? 0.55 : 0.7);
    const now = t >= at ? c.after : c.before;
    const cust = k[`${c.id}-customers`], arr = k[`${c.id}-arr`], asked = k[`${c.id}-asked`];
    if (cust) cust.innerHTML = esc(String(now.customers)) + (t >= at ? ` <span class="delta">${esc(c.delta)}</span>` : "");
    if (arr) arr.textContent = now.arr;
    if (asked) asked.textContent = now.asked;
    const flash = t >= at ? 1 - seg(t, at, at + 0.6) : 0;
    const el = k[`card-${c.id}`];
    if (el) el.style.boxShadow = flash > 0.01 ? `0 0 0 1px color-mix(in srgb, var(--led) ${(flash * 100).toFixed(0)}%, transparent)` : "";
  }
}

export const roadmap = {
  title: "Roadmap",
  workspace: "Fernway",
  T,
  prompt: {
    head: "Read this week's customer calls and turn the top requests into roadmap items, ",
    tail: "with who asked.",
  },
  thread: "Customer requests",
  crumbs: [{ text: "Fernway" }, { text: "Roadmap" }],
  rail: [
    { name: "Customer calls" },
    { name: "Northwind · Oct 6", depth: 1, read: 1.6 },
    { name: "Ledgerline · Oct 7", depth: 1, read: 1.75 },
    { name: "Tallyforge · Oct 7", depth: 1, read: 1.9 },
    { name: "Oakmere · Oct 8", depth: 1, read: 2.05 },
    { name: "+ 8 more", depth: 1, read: 2.2, plain: true },
    { name: "Roadmap", here: [0, 99] },
    { name: "Feedback · week 41", depth: 1, appear: R + 0.15 },
    { name: "Pipeline" },
    { name: "Hiring" },
    { name: "Investor updates" },
  ],
  steps: [
    { at: 1.5, done: 2.3, live: "Reading 12 customer calls…", finished: "Read 12 customer calls" },
    { at: 2.3, finished: "31 requests in 5 themes" },
    { at: 2.7, finished: "Top 3 by ARR: SSO, billing, CSV" },
    { at: 3.1, done: R, live: "Checking the roadmap…", finished: "2 already planned, 1 new" },
  ],
  changed: [
    { at: R + 0.15, verb: "Updated", what: "Roadmap · 3 cards" },
    { at: R + 0.3, verb: "Created", what: "Feedback · week 41" },
  ],
  reply: "SSO came up on 4 calls, with $38k ARR waiting on it. It's in Next, with the calls linked.",
  css: CSS,
  canvas: { desktop: desktop(), mobile: mobile() },
  draw,
  alt: "Biom, with a Roadmap board and an agent chat beside it. The request — read this week's customer calls and turn the top requests into roadmap items, with who asked — is sent; the agent reads twelve customer call pages in the workspace, finds 31 requests in 5 themes, ranks the top three by revenue, and updates the board in place: a new card, SSO for teams, lands in Next with four customers, $38k ARR, who asked and a quote from a call, and two existing cards gain customers. Illustrative demo, time compressed.",
};
