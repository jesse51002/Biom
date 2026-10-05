// The landing page demo's whole script: the words, the sample data and the
// clock, in one place, so any moment of the GIF can be rendered and checked.
//
// NOTHING HERE IS REAL. Every company, person, count and role below is invented
// for the demo, and the GIF says so in its corner ("Illustrative demo · time
// compressed"). Time is compressed: a real research turn takes minutes.
//
// The stage (`stage.html`) reads this file and nothing else for its content.
// `renderAt(t)` there is a pure function of `t` and of what is below — no CSS
// transition, no animation, no timer — so `render.mjs` can step it frame by
// frame and the same `t` always draws the same pixels.

export const FPS = 15;
export const DURATION = 8; // seconds; the GIF loops on this

/** The beats, in seconds. The table in the brief, as numbers. */
export const T = {
  typeFrom: 0.15,   // the prompt's last phrase starts typing
  typeTo: 1.05,     // ... and is finished
  send: 1.2,        // Send lights and is pressed
  sent: 1.5,        // the prompt is a chat message
  research: 1.5,    // "Researching 146 companies…"
  seriesA: 2.3,     // "38 Series A"
  hiring: 2.7,      // "24 hiring engineers"
  people: 3.1,      // "Finding decision makers…"
  result: 4.1,      // the finished page appears in the workspace
  settled: 5.0,     // everything is drawn; the hold starts
  loopFrom: 7.8,    // cross-fade back to the opening composition
};

/** Two scripts, one switch. `scheduled` is the brief as written. `accurate`
 *  says only what this build does: an automation is saved on the page and
 *  started from its Automations screen — the workspace has no scheduler
 *  ("there is no clock in this workspace", server/domain/pages.ts), so a
 *  weekly run would be the agent's own scheduling, not Biom's. */
export const VARIANTS = {
  scheduled: {
    promptHead: "Every Monday, find 20 Series A fintechs hiring engineers. Add their CTOs and engineering leads ",
    promptTail: "to my leads.",
    cadence: "Every Monday",
    automation: "Automation saved",
    reply: "20 companies are on Fintech leads, under Leads. The automation runs every Monday.",
    alt: "Biom, with an agent chat beside a page. The request — every Monday, find 20 Series A fintechs hiring engineers and add their CTOs and engineering leads to my leads — is sent; the agent researches 146 companies, narrows them to 38 Series A and 24 hiring engineers, finds the decision makers, and a page called Fintech leads appears under Leads with the companies, their hiring signals and contacts, saved as an automation for every Monday. Illustrative demo, time compressed.",
  },
  accurate: {
    promptHead: "Find 20 Series A fintechs hiring engineers. Add their CTOs and engineering leads to my leads, ",
    promptTail: "and save it as an automation.",
    cadence: "Run again from Automations",
    automation: "Automation saved",
    reply: "20 companies are on Fintech leads, under Leads, saved as an automation you can run again.",
    alt: "Biom, with an agent chat beside a page. The request — find 20 Series A fintechs hiring engineers, add their CTOs and engineering leads to my leads, and save it as an automation — is sent; the agent researches 146 companies, narrows them to 38 Series A and 24 hiring engineers, finds the decision makers, and a page called Fintech leads appears under Leads with the companies, their hiring signals and contacts, saved as an automation to run again. Illustrative demo, time compressed.",
  },
};

export const AGENT = "Claude Code";
export const WORKSPACE = "Sales";

/** What the agent says it is doing. A step is `live` from `at` until `done`,
 *  and stays on screen afterwards with its finished words, so a count the
 *  reader has seen is never taken away. */
export const STEPS = [
  { at: T.research, done: T.seriesA, live: "Researching 146 companies…", finished: "Researched 146 companies" },
  { at: T.seriesA, done: T.seriesA, finished: "38 Series A" },
  { at: T.hiring, done: T.hiring, finished: "24 hiring engineers" },
  { at: T.people, done: T.result, live: "Finding decision makers…", finished: "Found 47 decision makers" },
];

/** What the turn changed, as the chat's "pages changed" lines. */
export const CHANGED = [
  { at: T.result + 0.15, verb: "Created", what: "Fintech leads" },
  { at: T.result + 0.3, verb: "Saved", what: "automation · fintech-leads" },
];

export const PAGE = {
  parent: "Leads",
  parentLede: "Everyone worth a conversation.",
  parentEmpty: "No lists yet.",
  title: "Fintech leads",
  facts: "20 companies · Series A · Hiring engineers",
  added: "Added to Leads",
  more: "+ 17 more companies",
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

export const LABEL = "Illustrative demo · time compressed";

/* ── the clock's arithmetic ──────────────────────────────────────────────── */

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** 0 before `a`, 1 after `b`, eased between. */
export const seg = (t, a, b) => {
  const x = clamp((t - a) / (b - a));
  return 1 - Math.pow(1 - x, 3);
};
/** How much of the prompt's last phrase is typed at `t`. */
export const typed = (t, tail) => {
  const x = clamp((t - T.typeFrom) / (T.typeTo - T.typeFrom));
  return tail.slice(0, Math.round(x * tail.length));
};
