// Triage: every new demo request goes through four steps, and each step writes
// what it found back to the `inbound` table through Biom's API — which is how
// the Inbound page draws the run while it happens. Started from the page's own
// Run button (biom.start), or from the page's Automations screen.
//
//   research  who the company is            → people, funding
//   enrich    what they already run          → stack
//   score     how well they fit, and why     → fit, why
//   draft     a reply, for the hot ones only → reply; the rest are nurture
//
// THE RESEARCH IS CANNED. In a real workspace the research step is where the
// agent looks each company up; this demo reads invented answers from
// fixtures.json so the run is the same every time it is filmed.

const API = process.env.BIOM_API;
if (!API) throw new Error("BIOM_API is not set: start this from Biom, as an automation");

let seq = 0;
async function call(kind: string, body: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(API!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: `t${++seq}`, g: 1, kind, ...body }),
  });
  const answer = await res.json();
  if (!answer.ok) throw new Error(`${kind}: ${answer.error?.message ?? res.status}`);
  return answer.value;
}

const facts: Record<string, any> = await Bun.file("code/fixtures.json").json();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** One line of the log per step, for the page and for whoever reads the run. */
const say = (row: any, step: string, detail = "") =>
  console.log(JSON.stringify({ row: row.id, company: row.cells.Company, step, detail }));

const HOT = 80;
/** How long each step takes. The page draws whatever the table says, so these
 *  are the only clock the demo has. */
const PACE = { research: 380, enrich: 280, score: 220, draft: 380 };
const LANES = 3;

const view = await call("table.get", { name: "inbound" });
const queue: any[] = view.rows.filter((r: any) => r.cells.Status === "new");

async function triage(row: any) {
  const f = facts[row.cells.Company];
  if (!f) { say(row, "skipped", "no research found"); return; }
  const set = (patch: Record<string, unknown>) => call("row.update", { name: "inbound", row: row.id, patch });

  await set({ Status: "research" }); say(row, "research");
  await sleep(PACE.research);
  await set({ Status: "enrich", People: f.people, Funding: f.funding });

  say(row, "enrich", `${f.people} people · ${f.funding}`);
  await sleep(PACE.enrich);
  await set({ Status: "score", Stack: f.stack });

  say(row, "score", f.stack);
  await sleep(PACE.score);
  const hot = f.fit >= HOT;
  await set({ Status: hot ? "draft" : "nurture", Fit: f.fit, Why: f.why });

  if (!hot) { say(row, "nurture", `fit ${f.fit}`); return; }
  say(row, "draft", `fit ${f.fit}`);
  await sleep(PACE.draft);
  await set({ Status: "ready", Reply: f.reply });
  say(row, "ready");
}

// three lanes, each taking the next request as it frees up
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  while (next < queue.length) await triage(queue[next++]);
}));
console.log(JSON.stringify({ done: queue.length }));
