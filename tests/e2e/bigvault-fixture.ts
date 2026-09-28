// SPDX-License-Identifier: AGPL-3.0-only
// A WORKSPACE THE SIZE OF A REAL ONE, INVENTED — every page, word, table and
// id this writes is made up here, and none of it is anybody's.
//
// Not a test: a fixture the big-vault walk and the scale work's unit tests
// import, so each of them reads the same workspace rather than writing a
// generator of its own (named without `.test.` or `.e2e.`, so no runner picks
// it up).
//
// WHAT IT WRITES is shaped like the workspace the scale work was measured on,
// about two thousand pages:
//
//   - nested as a real one is — eight top-level pages, eleven under each, then
//     three, three and one, the two deepest levels dated notes, as a folder of
//     decisions is kept: 1,944 pages and the root;
//   - one WIDE level, a ninth top-level page holding 228 dated notes flat, as
//     the owner's Historic does — the level a rail has to open whole;
//   - every page a plain `content.yaml` of about twelve kilobytes, between the
//     median page of the measured workspace (nine) and its mean (sixteen), with
//     an identity already in it;
//   - twenty-five tables an agent made with its own SQL, in `workspace.db`,
//     as the measured workspace holds twenty-six.
//
// IT IS DETERMINISTIC: the same folder, byte for byte, every run. Every word
// and every uid is a function of the page's place in the walk.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

/** How many pages each level holds under every page of the one above it. */
export const SHAPE = [8, 11, 3, 3, 1] as const;
/** The top-level pages SHAPE's first level is, by name. */
export const TOPS = ["Ledger", "Harbour", "Orchard", "Foundry", "Almanac", "Lantern", "Quarry", "Meadow"] as const;
/** The wide level: one more top-level page, and how many notes it holds flat. */
export const WIDE = { name: "Historic", count: 228 } as const;
/** Agent-made tables. */
export const TABLES = 25;
export const WORDS = "amber basalt cedar delta ember fjord granite harbour indigo juniper kestrel lantern meadow nimbus orchard pebble quartz river saffron thistle umber willow yarrow zephyr".split(" ");

const word = (i: number): string => WORDS[i % WORDS.length] as string;
const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const words = (seed: number, n: number): string => Array.from({ length: n }, (_, i) => word(seed * 7 + i * 3)).join(" ");

/** A page's folder, relative to the vault: `home/A/B` is
 *  `pages/home/children/A/children/B`. */
export const dirOf = (id: string): string =>
  join("pages", ...id.split("/").flatMap((s, i) => (i === 0 ? [s] : ["children", s])));

/** One page's document: a name, an identity, a doc page with a summary, a
 *  list of notes and one section. `n` is the page's place in the walk, and
 *  every word and the uid are made from it. */
export function docOf(name: string, n: number): string {
  const notes = Array.from({ length: 40 }, (_, i) => `    - ${JSON.stringify(words(n + i, 40))}`).join("\n");
  return [
    `name: ${name}`,
    `uid: invented${String(n).padStart(6, "0")}`,
    "plugin: biom-doc",
    "variables:",
    `  summary: ${JSON.stringify(words(n, 24))}`,
    "  notes:",
    notes,
    "contents:",
    "  - name: body",
    "    parts:",
    `      body: ${JSON.stringify(`# ${name}\n\n${words(n, 80)}`)}`,
    "",
  ].join("\n");
}

/** One page the fixture wrote. `depth` is 1 for a top-level page. */
export interface InventedPage {
  id: string;
  name: string;
  depth: number;
}

export interface Invented {
  /** How many pages, the root included. */
  pages: number;
  /** A page two levels down, the first one written, to make a page under. */
  under: string;
  /** The wide level's page. */
  wide: string;
  /** Every page, in the order written: parents before their children. */
  all: InventedPage[];
}

/** WRITE THE WORKSPACE into `vault`, which should not exist yet or be empty.
 *  `tables: false` leaves the database out, for a test that opens no server. */
export function invent(vault: string, opts: { tables?: boolean } = {}): Invented {
  let n = 0;
  let under = "";
  const all: InventedPage[] = [];
  const put = (id: string, name: string, depth: number): void => {
    const dir = join(vault, dirOf(id));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "content.yaml"), docOf(name, n++), "utf8");
    all.push({ id, name, depth });
  };
  const down = (id: string, depth: number): void => {
    const count = SHAPE[depth];
    if (count === undefined) return;
    for (let i = 0; i < count; i++) {
      // Top-level pages by name; the two levels below by a word and a number;
      // below those, dated notes.
      const name = depth === 0 ? (TOPS[i] as string)
        : depth < 3 ? `${title(word(n))} ${i + 1}`
        : `2026-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 28) + 1).padStart(2, "0")} ${title(word(n))} ${title(word(n + 5))} ${i + 1}`;
      const child = `${id}/${name.replace(/ /g, "_")}`;
      put(child, name, depth + 1);
      if (depth === 1 && under === "") under = child;
      down(child, depth + 1);
    }
  };
  put("home", "Home", 0);
  down("home", 0);

  // THE WIDE LEVEL: a record kept a day at a time, every note flat under it.
  const wide = `home/${WIDE.name}`;
  put(wide, WIDE.name, 1);
  for (let i = 0; i < WIDE.count; i++) {
    const day = new Date(Date.UTC(2025, 4, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const name = `${day} ${title(word(n))} ${title(word(n + 11))}`;
    put(`${wide}/${name.replace(/ /g, "_")}`, name, 2);
  }

  // THE TABLES AN AGENT MADE WITH ITS OWN SQL, in the workspace's database
  // before any server has opened it; the server lists them as the agent's.
  if (opts.tables !== false) {
    const db = new Database(join(vault, "workspace.db"));
    try {
      for (let t = 0; t < TABLES; t++) {
        const name = `invented_${word(t)}_${t}`;
        db.run(`CREATE TABLE "${name}" (id INTEGER PRIMARY KEY, label TEXT, amount REAL)`);
        const row = db.prepare(`INSERT INTO "${name}" (label, amount) VALUES (?, ?)`);
        db.transaction(() => {
          for (let i = 0; i < 200; i++) row.run(`${word(t + i)} ${i}`, i * 1.5);
        })();
      }
    } finally {
      db.close();
    }
  }
  return { pages: n, under, wide, all };
}
