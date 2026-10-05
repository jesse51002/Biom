// The first demo: a lead list. A prompt asks for Series A fintechs hiring
// engineers, the agent narrows 146 companies down, and a Fintech leads page
// appears under Leads.
//
// NOTHING HERE IS REAL. Every company, person, count and role is invented.
//
// Two variants. `scheduled` is the brief as written. `accurate` says only what
// this build does: the workspace has no scheduler ("there is no clock in this
// workspace", server/domain/pages.ts), so a weekly run would be the agent's own
// scheduling and not Biom's.

import { seg, show, esc } from "../clock.js";

const T = { typeFrom: 0.15, typeTo: 1.05, send: 1.2, sent: 1.5, result: 4.1 };
const R = T.result;

const PAGE = {
  facts: "20 companies · Series A · Hiring engineers",
  head: ["Company", "Hiring signal", "Contacts"],
  rows: [
    { company: "Ledgerline", stage: "Series A · $18M", signal: "6 backend roles",
      people: [["Priya Shah", "CTO"], ["Daniel Okafor", "Head of Engineering"]] },
    { company: "Kestrel Pay", stage: "Series A · $12M", signal: "4 platform roles",
      people: [["Marcus Lee", "VP Engineering"]] },
    { company: "Tallyforge", stage: "Series A · $21M", signal: "3 data roles",
      people: [["Aisha Bello", "CTO"], ["Tom Varga", "Engineering Manager"]] },
  ],
};

const VARIANTS = {
  scheduled: {
    head: "Every Monday, find 20 Series A fintechs hiring engineers. Add their CTOs and engineering leads ",
    tail: "to my leads.",
    cadence: "Every Monday",
    reply: "20 companies are on Fintech leads, under Leads. The automation runs every Monday.",
    alt: "Biom, with an agent chat beside a page. The request — every Monday, find 20 Series A fintechs hiring engineers and add their CTOs and engineering leads to my leads — is sent; the agent researches 146 companies, narrows them to 38 Series A and 24 hiring engineers, finds the decision makers, and a page called Fintech leads appears under Leads with the companies, their hiring signals and contacts, saved as an automation for every Monday. Illustrative demo, time compressed.",
  },
  accurate: {
    head: "Find 20 Series A fintechs hiring engineers. Add their CTOs and engineering leads to my leads, ",
    tail: "and save it as an automation.",
    cadence: "Run again from Automations",
    reply: "20 companies are on Fintech leads, under Leads, saved as an automation you can run again.",
    alt: "Biom, with an agent chat beside a page. The request — find 20 Series A fintechs hiring engineers, add their CTOs and engineering leads to my leads, and save it as an automation — is sent; the agent researches 146 companies, narrows them to 38 Series A and 24 hiring engineers, finds the decision makers, and a page called Fintech leads appears under Leads with the companies, their hiring signals and contacts, saved as an automation to run again. Illustrative demo, time compressed.",
  },
};

const CSS = `
  .lsheet{position:absolute; inset:0; padding:46px 52px 40px}
  .mob .lsheet{padding:24px 16px 0; background:var(--paper)}
  .h1{margin:0; font:700 42px/1.08 var(--sheet-face); letter-spacing:-.01em; color:var(--ink)}
  .mob .h1{font-size:32px}
  .lede{margin:12px 0 0; font:18px/1.45 var(--sheet-face); color:var(--ink-2)}
  .mob .lede{font-size:16px; margin-top:8px}
  .empty{margin-top:34px; padding:18px 20px; border:1px dashed var(--stock-edge); font:13px var(--gauge-face); color:var(--ink-3); max-width:420px}
  .chips{display:flex; flex-wrap:wrap; gap:8px; margin-top:18px}
  .mob .chips{margin-top:14px; gap:6px}
  .chipx{display:inline-flex; align-items:center; gap:8px; height:28px; padding:0 11px; border:1px solid var(--stock-edge); background:var(--stock); font:12px var(--gauge-face); letter-spacing:.02em; color:var(--ink)}
  .mob .chipx{height:26px; padding:0 9px; font-size:11.5px}
  .chipx .glyph{width:13px; height:13px}
  .chipx.ok .glyph{color:var(--led-green)}
  .chipx.auto .glyph{color:var(--led)}
  .chipx .dim{color:var(--ink-3)}
  .board{margin-top:26px; border:1px solid var(--stock-edge); background:var(--stock)}
  .bhead,.brow{display:grid; grid-template-columns:minmax(0,9fr) minmax(0,9fr) minmax(0,13fr)}
  .bhead > div{padding:9px 14px; font:10.5px var(--gauge-face); letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); border-bottom:1px solid var(--stock-edge)}
  .bhead > div + div, .brow > div + div{border-left:1px solid var(--stock-edge)}
  .brow > div{padding:11px 14px 12px; font:15px/1.4 var(--sheet-face); color:var(--ink)}
  .brow + .brow{border-top:1px solid var(--stock-edge)}
  .co b{display:block; font-weight:700}
  .co span{display:block; font:11.5px/1.6 var(--gauge-face); color:var(--ink-3); letter-spacing:.02em}
  .ppl div + div{margin-top:3px}
  .ppl em, .card em{font-style:normal; color:var(--ink-2)}
  .more{padding:10px 14px; border-top:1px solid var(--stock-edge); font:12px var(--gauge-face); color:var(--ink-3); letter-spacing:.02em}
  .mob .more{border:0; padding:12px 2px 0}
  .cards{display:flex; flex-direction:column; gap:10px; margin-top:18px}
  .card{border:1px solid var(--stock-edge); background:var(--stock); padding:13px 14px 12px}
  .card .ctop{display:flex; justify-content:space-between; align-items:baseline; gap:10px}
  .card .cn{font:700 18px var(--sheet-face)}
  .card .cs{font:11px var(--gauge-face); color:var(--ink-3); letter-spacing:.02em; white-space:nowrap}
  .card .csig{margin-top:4px; font:15px var(--sheet-face); color:var(--ink-2)}
  .card .cppl{margin-top:10px; padding-top:9px; border-top:1px solid var(--stock-edge); font:15px/1.5 var(--sheet-face)}
`;

const people = (r) => r.people.map(([n, role]) => `<div>${esc(n)} <em>· ${esc(role)}</em></div>`).join("");

function chips(v) {
  return `<div class="chips" data-k="chips">
    <span class="chipx ok"><i class="glyph check"></i>Added to Leads</span>
    <span class="chipx auto"><i class="glyph loop"></i>${esc(v.cadence)}<span class="dim">·</span><span class="dim">Automation saved</span></span>
  </div>`;
}

function desktop(v) {
  return `
  <section class="lsheet" data-k="parentSheet">
    <h1 class="h1">Leads</h1>
    <p class="lede">Everyone worth a conversation.</p>
    <div class="empty">No lists yet.</div>
  </section>
  <section class="lsheet" data-k="resultSheet">
    <h1 class="h1">Fintech leads</h1>
    <p class="lede">${esc(PAGE.facts)}</p>
    ${chips(v)}
    <div class="board" data-k="board">
      <div class="bhead">${PAGE.head.map((h) => `<div>${esc(h)}</div>`).join("")}</div>
      ${PAGE.rows.map((r) => `<div class="brow">
        <div class="co"><b>${esc(r.company)}</b><span>${esc(r.stage)}</span></div>
        <div>${esc(r.signal)}</div>
        <div class="ppl">${people(r)}</div>
      </div>`).join("")}
      <div class="more">+ 17 more companies</div>
    </div>
  </section>`;
}

function mobile(v) {
  return `
  <section class="lsheet" data-k="resultSheet">
    <h1 class="h1">Fintech leads</h1>
    <p class="lede">${esc(PAGE.facts)}</p>
    ${chips(v)}
    <div class="cards">${PAGE.rows.slice(0, 2).map((r) => `<div class="card" data-k="card">
      <div class="ctop"><span class="cn">${esc(r.company)}</span><span class="cs">${esc(r.stage)}</span></div>
      <div class="csig">${esc(r.signal)}</div>
      <div class="cppl">${people(r)}</div>
    </div>`).join("")}</div>
    <div class="more" data-k="more">+ 18 more companies</div>
  </section>`;
}

/** The canvas's own motion. `k` holds every [data-k] in the window, the
 *  repeated ones as arrays under `k.all`. */
function draw(t, k) {
  show(k.parentSheet, 1 - seg(t, R, R + 0.25));
  const inO = seg(t, R + 0.15, R + 0.55);
  show(k.resultSheet, inO, (1 - inO) * 8);
  show(k.chips, seg(t, R + 0.6, R + 0.85));
  if (k.board) { // the board draws down, row by row, rather than standing empty
    const o = seg(t, R + 0.3, R + 0.9);
    show(k.board, o > 0 ? 1 : 0);
    k.board.style.clipPath = o >= 1 ? "" : `inset(0 0 ${((1 - o) * 100).toFixed(2)}% 0)`;
  }
  (k.all.card || []).forEach((c, i) => { const o = seg(t, R + 0.35 + i * 0.15, R + 0.65 + i * 0.15); show(c, o, (1 - o) * 6); });
  show(k.more, seg(t, R + 0.75, R + 0.95));
}

function scenario(name) {
  const v = VARIANTS[name];
  return {
    title: `Leads · ${name}`,
    workspace: "Sales",
    T,
    prompt: { head: v.head, tail: v.tail },
    thread: "Fintech leads",
    crumbs: [{ text: "Sales" }, { text: "Leads" }, { text: "Fintech leads", at: R }],
    rail: [
      { name: "Leads", here: [0, R] },
      { name: "Fintech leads", depth: 1, appear: R, here: [R, 99] },
      { name: "Pipeline" },
      { name: "Meeting notes" },
      { name: "Reading list" },
    ],
    steps: [
      { at: 1.5, done: 2.3, live: "Researching 146 companies…", finished: "Researched 146 companies" },
      { at: 2.3, finished: "38 Series A" },
      { at: 2.7, finished: "24 hiring engineers" },
      { at: 3.1, done: R, live: "Finding decision makers…", finished: "Found 47 decision makers" },
    ],
    changed: [
      { at: R + 0.15, verb: "Created", what: "Fintech leads" },
      { at: R + 0.3, verb: "Saved", what: "automation · fintech-leads" },
    ],
    reply: v.reply,
    css: CSS,
    canvas: { desktop: desktop(v), mobile: mobile(v) },
    draw,
    alt: v.alt,
  };
}

export const leadsScheduled = scenario("scheduled");
export const leadsAccurate = scenario("accurate");
