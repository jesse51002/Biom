// SPDX-License-Identifier: AGPL-3.0-only
// THE PAGE'S AUTOMATIONS SCREEN, which takes the canvas from the page bar.
//
// The first thing on it, on every screen, is one line to hand your agent, with
// Copy — because asking an agent is the path this workspace is built for and
// every form under it is the by-hand path. This page's automations run across
// the top with New beside them; New offers a template per harness the
// framework ships, and picking one copies it under the page and opens it.
// Under the automation selected is a bar of three screens, each filling the
// canvas on its own:
//
//   MANIFEST  a form and never a file on screen — what it runs with, its
//             name, its command, the env NAMES it needs picked from what the
//             server holds, and its inputs as rows. The server writes the yaml.
//   FILES     the folder drawn the way a file browser draws one — the kickoff,
//             the instructions, skills/ and code/, never the manifest, which
//             is the Manifest screen — with the workspace's own skills as a
//             second root, greyed until opened, and a text editor beside the
//             tree. ＋ on skills/ and code/.
//   RUNS      the inputs as they will be asked, Run, and this automation's
//             runs — status, clock, exit, the last line of stdout raw, the
//             whole log on a click, Kill.
//
// Every change is written a moment after it is made and a word says so. There
// is no Save. What the framework knows about a run is what a row shows here:
// its status, its times, its exit, and a file it serves and never reads.

/** @import { Automation, AutomationInput, AutomationManifest, Page, RunRow, Template, VaultFile, VarScalar, WorkspaceStore, UiStore } from "../../contracts/types.ts" */
import { askLine, editor, fileTree, nameField, followLog, clock, lastLine, SAVE_AFTER, WORDS } from "../widgets/runsui.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

export const ASK_NEW = "Make an automation on page `{page}`. It is an automation that ___";
export const ASK_EDIT = "Modify the `{name}` automation on page `{page}` to ___";
export const SUBS = /** @type {const} */ (["manifest", "files", "runs"]);
export const SUB_WORDS = Object.freeze({ manifest: "Manifest", files: "Files", runs: "Runs of this automation" });
/** How often a live run's row is re-read while the screen is open. */
export const FOLLOW_EVERY = 1000;

/**
 * @typedef {object} AutomationViewDeps
 * @property {H} h
 * @property {WorkspaceStore} ws
 * @property {UiStore} ui
 * @property {{ on: (hear: () => void) => () => void }} [events] the vault's
 *   stream: a run starting or ending anywhere is one event, and the runs
 *   screen rereads on it.
 */

/**
 * @param {AutomationViewDeps} deps
 * @returns {(page: Page) => HTMLElement}
 */
export function makeAutomationView(deps) {
  const { h, ws } = deps;

  /** What the screen is showing, kept across repaints, per page. */
  const state = {
    page: /** @type {string | null} */ (null),
    folder: /** @type {string | null} */ (null),
    sub: /** @type {"manifest" | "files" | "runs"} */ ("manifest"),
    file: /** @type {string | null} */ (null),
    picking: false,
    /** The whole-log flaps that are open, by run id. */
    open: new Set(),
  };
  /** Each run's log tail as read so far, by id: the text kept and the offset to read next. */
  const tails = new Map();
  /** Read whatever a run has printed since the last read, to the end. Declared
   *  HERE, above the `return`: the screens below are hoisted functions and run
   *  after this factory has returned, so a `const` under that return is one
   *  they can name and never reach. */
  const follow = (/** @type {RunRow} */ r) => followLog((id, stream, from) => ws.readRun(id, stream, from), tails, r.id);

  const hold = (/** @type {string} */ m) => h("p.hold", m);

  /** @param {Page} page @returns {HTMLElement} */
  return function automationScreen(page) {
    if (state.page !== page.id) {
      state.page = page.id; state.folder = null; state.sub = "manifest"; state.file = null; state.picking = false;
    }
    const plate = h("div.autoscreen", hold("Opening…"));
    void redraw(plate, page);
    return plate;
  };

  /** @param {HTMLElement} plate @param {Page} page */
  async function redraw(plate, page) {
    let autos;
    try {
      autos = await ws.automations(page.id);
    } catch (e) {
      plate.replaceChildren(hold(e instanceof Error ? e.message : "the page's automations could not be listed"));
      return;
    }
    if (state.folder !== null && !autos.some((a) => a.folder === state.folder)) state.folder = null;
    if (state.folder === null && autos.length > 0 && !state.picking) state.folder = autos[0]?.folder ?? null;
    const current = autos.find((a) => a.folder === state.folder) ?? null;
    const name = current === null ? "" : current.manifest?.name ?? current.folder;

    const strip = h("div.strip",
      ...autos.map((a) => h("button.auto" + (a.folder === state.folder && !state.picking ? ".is-on" : ""), {
        type: "button",
        "aria-pressed": String(a.folder === state.folder && !state.picking),
        onclick: () => { state.folder = a.folder; state.picking = false; state.file = null; void redraw(plate, page); },
      }, h("span.lamp", { "data-state": a.trouble === null ? "ok" : "bad" }), h("span.nm", a.manifest?.name ?? a.folder))),
      h("button.new" + (state.picking || autos.length === 0 ? ".is-on" : ""), {
        type: "button", onclick: () => { state.picking = !state.picking; void redraw(plate, page); },
      }, "＋ New"));

    const ask = askLine(h, current === null || state.picking
      ? ASK_NEW.replace("{page}", page.id)
      : ASK_EDIT.replace("{name}", name).replace("{page}", page.id));

    /** @type {HTMLElement} */
    let body;
    if (state.picking || current === null) {
      body = await pickTemplate(plate, page);
    } else if (current.trouble !== null) {
      body = h("div.trouble", h("b", "This automation's manifest will not read."), h("p", current.trouble),
        h("p.dim", "Open it under Files and repair it, or ask your agent."),
        subBar(plate, page), state.sub === "files" ? await filesScreen(plate, page, current) : h("p.hold", ""));
    } else {
      body = h("div.autobody", subBar(plate, page),
        state.sub === "manifest" ? await manifestScreen(page, current)
        : state.sub === "files" ? await filesScreen(plate, page, current)
        : await runsScreen(plate, page, current));
    }
    plate.replaceChildren(strip, ask, body);
  }

  /** @param {HTMLElement} plate @param {Page} page */
  function subBar(plate, page) {
    return h("div.subbar", ...SUBS.map((sub) => h("button.sub", {
      type: "button", "aria-pressed": String(state.sub === sub), "data-sub": sub,
      onclick: () => { state.sub = sub; void redraw(plate, page); },
    }, SUB_WORDS[sub])));
  }

  /* ── New: a template per harness ───────────────────────────────────── */

  /** @param {HTMLElement} plate @param {Page} page */
  async function pickTemplate(plate, page) {
    /** @type {Template[]} */
    let templates = [];
    try {
      templates = await ws.templates();
    } catch {
      templates = [];
    }
    // A TILE OPENS A NAME FIELD UNDER THE TILES rather than a dialog: the
    // template's own name is offered and selected, Enter makes the copy, and
    // a refusal — a name already taken on this page — is said beside it.
    const naming = h("div.naming");
    const tiles = templates.map((t) => h("button.tpl", {
      type: "button", "data-template": t.id,
      onclick: () => {
        for (const b of plate.querySelectorAll("button.tpl")) b.setAttribute("aria-pressed", String(b.getAttribute("data-template") === t.id));
        naming.replaceChildren(nameField(h, {
          label: `The new automation's name, on ${page.id}, from ${t.name}`,
          value: t.name,
          ok: "Make it",
          take: async (name) => {
            const made = await ws.createAutomation(page.id, name, t.id);
            state.folder = made.folder; state.picking = false; state.sub = "manifest";
            void redraw(plate, page);
          },
          cancel: () => { naming.replaceChildren(); for (const b of plate.querySelectorAll("button.tpl")) b.removeAttribute("aria-pressed"); },
        }));
      },
    }, h("span.kind", t.agent || t.id), h("span.nm", t.name)));
    return h("div.pick",
      h("p.lead", "Or start from a template, one per harness the framework ships. The copy is this page's from the moment it is made."),
      h("div.tiles", ...tiles),
      naming,
      templates.length === 0 ? h("p.dim", "This build ships no templates.") : null);
  }

  /* ── Manifest: a form, never a file ───────────────────────────────── */

  /** @param {Page} page @param {Automation} auto */
  async function manifestScreen(page, auto) {
    const m = /** @type {AutomationManifest} */ (JSON.parse(JSON.stringify(auto.manifest)));
    let names = /** @type {string[]} */ ([]);
    let templates = /** @type {Template[]} */ ([]);
    try {
      [names, templates] = await Promise.all([ws.envNames(), ws.templates()]);
    } catch {
      /* the form still draws; the picker offers nothing */
    }
    const state = h("span.saved", WORDS.saved);
    let pending = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
    // ONE COMMIT AS THE FORM OPENS, then every save is quiet — see the
    // editors: a pause in typing is not a version.
    void ws.commitVault(`Before the manifest of ${auto.folder} on ${page.id} was edited`).catch(() => {});
    const save = () => {
      state.textContent = WORDS.saving; state.setAttribute("data-pending", ""); state.removeAttribute("data-failed");
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(async () => {
        pending = null;
        try {
          await ws.setManifest(page.id, auto.folder, m, true);
          state.textContent = WORDS.saved; state.removeAttribute("data-pending");
        } catch (e) {
          state.textContent = WORDS.failed + (e instanceof Error && e.message ? ": " + e.message : ""); state.setAttribute("data-failed", "");
        }
      }, SAVE_AFTER);
    };

    /** @param {string} label @param {HTMLElement} field @param {string} [hint] */
    const row = (label, field, hint) => h("label.frow", h("span.lbl", label), field, hint ? h("span.hint", hint) : null);
    /** @param {string} value @param {(v: string) => void} set @param {string} [placeholder] */
    const text = (value, set, placeholder) => {
      const inp = /** @type {HTMLInputElement} */ (h("input", { type: "text", value, placeholder: placeholder ?? null }));
      inp.addEventListener("input", () => { set(inp.value); save(); });
      return inp;
    };

    // RUNS WITH: a harness the templates know, or Custom. The choice is the
    // `agent` label — a word for people, which the framework reads nothing off
    // — and the command beneath is always the person's to edit.
    const harnesses = [...templates.map((t) => ({ id: t.id, name: t.name })), { id: "", name: "Custom" }];
    const runsWith = h("div.choices", ...harnesses.map((x) => {
      const on = (m.agent === x.id) || (x.id === "" && !templates.some((t) => t.id === m.agent));
      return h("button.choice", { type: "button", "aria-pressed": String(on), "data-agent": x.id, onclick: () => { m.agent = x.id; save(); rebuildChoices(); } }, x.name);
    }));
    const rebuildChoices = () => {
      for (const b of runsWith.querySelectorAll("button.choice")) {
        const id = b.getAttribute("data-agent") ?? "";
        b.setAttribute("aria-pressed", String(m.agent === id || (id === "" && !templates.some((t) => t.id === m.agent))));
      }
    };

    const command = /** @type {HTMLTextAreaElement} */ (h("textarea.cmd", { rows: String(Math.max(3, m.command.length)), spellcheck: "false", "aria-label": "Command" }));
    command.value = m.command.join("\n");
    command.addEventListener("input", () => { m.command = command.value.split("\n").filter((l) => l !== ""); save(); });

    // ENV: names as tags, picked from the names the server's environment
    // holds — never typed, never a value.
    const tags = h("div.tags");
    const drawTags = () => {
      tags.replaceChildren(
        ...m.env.map((n) => h("span.tag", n, h("button.x", { type: "button", "aria-label": "Remove " + n, onclick: () => { m.env = m.env.filter((e) => e !== n); save(); drawTags(); } }, "✕"))),
        (() => {
          const sel = /** @type {HTMLSelectElement} */ (h("select.addenv", { "aria-label": "Add an env name" },
            h("option", { value: "" }, "＋ Env"),
            ...names.filter((n) => !m.env.includes(n)).map((n) => h("option", { value: n }, n))));
          sel.addEventListener("change", () => { if (sel.value !== "") { m.env = [...m.env, sel.value]; save(); drawTags(); } });
          return sel;
        })());
    };
    drawTags();

    // INPUTS: one row each — name, type, default, required — with add and
    // remove, written as the form is edited.
    const inputs = h("div.inputs");
    const drawInputs = () => {
      inputs.replaceChildren(
        h("div.irow.head", h("span", "name"), h("span", "type"), h("span", "default"), h("span", "required"), h("span", "")),
        ...m.inputs.map((inp, i) => {
          const nm = text(inp.name, (v) => { inp.name = v; }, "name");
          const ty = /** @type {HTMLSelectElement} */ (h("select", ...["text", "number", "boolean"].map((t) => h("option", { value: t, selected: inp.type === t ? "" : null }, t))));
          ty.addEventListener("change", () => { inp.type = /** @type {AutomationInput["type"]} */ (ty.value); save(); });
          const df = text(inp.default === undefined || inp.default === null ? "" : String(inp.default), (v) => {
            inp.default = v === "" ? undefined : inp.type === "number" ? Number(v) : inp.type === "boolean" ? (v === "true" || v === "yes") : v;
            if (inp.default === undefined) delete inp.default;
          }, "none");
          const rq = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", checked: inp.required ? "" : null, "aria-label": "Required" }));
          rq.addEventListener("change", () => { if (rq.checked) inp.required = true; else delete inp.required; save(); });
          const rm = h("button.x", { type: "button", "aria-label": "Remove input", onclick: () => { m.inputs.splice(i, 1); save(); drawInputs(); } }, "✕");
          return h("div.irow", nm, ty, df, rq, rm);
        }),
        h("button.add", { type: "button", onclick: () => { m.inputs.push({ name: "", type: "text" }); save(); drawInputs(); } }, "＋ Input"));
    };
    drawInputs();

    return h("div.manifest",
      h("div.ed-head", h("span.name", "automation.yaml"), h("span.where", `${page.id} · automations/${auto.folder}/`), state),
      h("div.form",
        row("Runs with", runsWith, "A label for people. The framework reads nothing off it; the command below is what runs."),
        row("Name", text(m.name, (v) => { m.name = v; })),
        row("Description", text(m.description, (v) => { m.description = v; }, "One line, for the overview.")),
        row("Command", command, "One argument per line, never a shell string. {vault} is the workspace's path, {run} this run's directory, {kickoff} the substituted prompt, {name} an input."),
        row("Env", tags, "Names the run needs, checked present in the server's environment when it starts. A value never crosses the wire."),
        row("Inputs", inputs, "Asked as a form before every run, and substituted into the kickoff and the command by name.")));
  }

  /* ── Files: the folder, and the workspace's own skills greyed ─────── */

  /** @param {HTMLElement} plate @param {Page} page @param {Automation} auto */
  async function filesScreen(plate, page, auto) {
    const prefix = `automations/${auto.folder}/`;
    /** @type {VaultFile[]} */
    let pageFiles = [];
    /** @type {VaultFile[]} */
    let vaultFiles = [];
    try {
      [pageFiles, vaultFiles] = await Promise.all([ws.pageFiles(page.id), ws.vaultFiles()]);
    } catch (e) {
      return hold(e instanceof Error ? e.message : "the files could not be listed");
    }
    // THE MANIFEST IS NOT IN THE TREE. The Manifest screen is that file as a
    // form and the server writes the yaml, so listing it here would be the
    // same file twice with two ways to edit it. Everything else in the folder
    // is a file a person writes by hand.
    const own = pageFiles.map((f) => f.path).filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)).filter((p) => p !== "automation.yaml");
    const skills = vaultFiles.filter((f) => !f.seeded).map((f) => f.path).filter((p) => p.startsWith(".agents/skills/")).map((p) => p.slice(".agents/skills/".length));
    // Which root the open file is in: the automation's, or the workspace's skills.
    const inVault = state.file !== null && state.file.startsWith("@vault/");
    if (state.file === null || (!inVault && !own.includes(state.file)) || (inVault && !skills.includes(state.file.slice(7)))) {
      state.file = own.includes("kickoff.md") ? "kickoff.md" : own[0] ?? null;
    }
    const pane = h("div.pane", hold("Opening…"));
    const pickAndDraw = (/** @type {string} */ f) => { state.file = f; void redraw(plate, page); };
    // + ON A FOLDER OPENS A NAME FIELD IN THE EDITOR'S PLACE, with the path a
    // file there usually has offered; Enter makes it empty and opens it.
    const addFile = (/** @type {string} */ folder) => {
      pane.replaceChildren(nameField(h, {
        label: `The new file's name under ${folder}/`,
        value: folder === "skills" ? "my-skill/SKILL.md" : "main.py",
        ok: "Make it",
        take: async (name) => {
          const rel = `${prefix}${folder}/${name.replace(/^\/+/, "")}`;
          await ws.writeFile(page.id, rel, "");
          state.file = rel.slice(prefix.length);
          void redraw(plate, page);
        },
        cancel: () => void redraw(plate, page),
      }));
    };
    const ownTree = fileTree(h, {
      root: `${page.id} · automations/${auto.folder}/`,
      files: own, open: inVault ? null : state.file, pick: pickAndDraw, adds: ["skills", "code"], add: addFile,
    });
    const vaultTree = fileTree(h, {
      root: ".agents/skills/ (the workspace's own)",
      files: skills, open: inVault && state.file !== null ? state.file.slice(7) : null,
      pick: (f) => pickAndDraw("@vault/" + f), dim: !inVault,
    });
    if (state.file !== null) {
      const file = state.file;
      const vaultPath = inVault ? `.agents/skills/${file.slice(7)}` : null;
      void (async () => {
        try {
          const text = vaultPath !== null ? (await ws.readVaultFile(vaultPath)) ?? "" : (await ws.readPageFile(page.id, prefix + file)) ?? "";
          const shown = vaultPath ?? file;
          void ws.commitVault(`Before ${vaultPath ?? prefix + file} was edited`).catch(() => {});
          const ed = editor(h, {
            name: shown.slice(shown.lastIndexOf("/") + 1),
            where: vaultPath !== null ? "the workspace's skills" : `${page.id} · automations/${auto.folder}/${shown.includes("/") ? shown.slice(0, shown.lastIndexOf("/")) + "/" : ""}`,
            text,
            foot: vaultPath !== null
              ? "The workspace's own skill: every automation and every agent in the workspace reads it."
              : shown === "kickoff.md" ? "The prompt, with {input} placeholders. Substituted per run and nothing prepended: the run's AGENTS.md says where things are."
              : shown === "INSTRUCTIONS.md" ? "This automation's instructions, on top of the page's and the workspace's."
              : "",
            save: (next) => vaultPath !== null ? ws.writeVaultFile(vaultPath, next, true) : ws.writeFile(page.id, prefix + file, next, true),
          });
          pane.replaceChildren(ed.el);
        } catch (e) {
          pane.replaceChildren(hold(e instanceof Error ? e.message : "the file could not be read"));
        }
      })();
    } else {
      pane.replaceChildren(hold("Nothing in this folder yet. Add a file with ＋."));
    }
    return h("div.split.files", h("div.trees", ownTree, vaultTree), pane);
  }

  /* ── Runs: the inputs, Run, and this automation's runs ────────────── */

  /** @param {HTMLElement} plate @param {Page} page @param {Automation} auto */
  async function runsScreen(plate, page, auto) {
    const m = /** @type {AutomationManifest} */ (auto.manifest);
    /** @type {Record<string, VarScalar>} */
    const values = {};
    const fields = m.inputs.map((inp) => {
      if (inp.type === "boolean") {
        const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", checked: inp.default === true ? "" : null }));
        values[inp.name] = inp.default === true;
        box.addEventListener("change", () => { values[inp.name] = box.checked; });
        return h("label.field", h("span", inp.name), box);
      }
      const input = /** @type {HTMLInputElement} */ (h("input", { type: inp.type === "number" ? "number" : "text", value: inp.default === undefined || inp.default === null ? "" : String(inp.default), placeholder: inp.required ? "required" : null }));
      if (inp.default !== undefined) values[inp.name] = inp.default;
      input.addEventListener("input", () => { values[inp.name] = input.value; });
      return h("label.field", h("span", inp.name + (inp.required ? " *" : "")), input);
    });
    const said = h("p.said");
    const run = h("button.run", { type: "button", onclick: () => {
      said.textContent = "";
      void ws.startRun(page.id, auto.folder, values).then(() => void draw(), (e) => { said.textContent = e instanceof Error ? e.message : "that could not be started"; });
    } }, "Run");
    const rows = h("div.runrows");
    const screen = h("div.runs",
      h("div.launch", h("div.fields", ...fields), run, said),
      h("div.rows-head", SUB_WORDS.runs),
      rows);

    let timer = /** @type {ReturnType<typeof setInterval> | null} */ (null);
    let off = /** @type {(() => void) | null} */ (null);
    /** Has the screen been on the canvas yet — see the overview for why. */
    let shown = false;
    const stop = () => { if (timer !== null) clearInterval(timer); timer = null; if (off !== null) off(); off = null; };
    const draw = async () => {
      // The screen has gone: a repaint replaced it, or the person left.
      if (screen.isConnected) shown = true;
      else if (shown) { stop(); return; }
      let list;
      try {
        list = await ws.runs({ page: page.id, automation: auto.folder });
      } catch {
        return;
      }
      await Promise.all(list.map((r) => follow(r)));
      rows.replaceChildren(...list.map((r) => runRow(r, () => void draw())), ...(list.length === 0 ? [h("p.dim", "Nothing has run yet.")] : []));
      const alive = list.some((r) => r.status === "running");
      if (alive && timer === null) timer = setInterval(() => void draw(), FOLLOW_EVERY);
      if (!alive && timer !== null) { clearInterval(timer); timer = null; }
    };
    if (deps.events) off = deps.events.on(() => void draw());
    // Arm a check so a screen replaced while nothing was alive still lets go
    // of its stream subscription.
    const gone = setInterval(() => { if (shown && !screen.isConnected) { stop(); clearInterval(gone); } }, 5000);
    await draw();
    return screen;
  }

  /** @param {RunRow} r @param {() => void} again */
  function runRow(r, again) {
    const tail = tails.get(r.id)?.text ?? "";
    const isOpen = state.open.has(r.id);
    const flap = h("button.open", { type: "button", onclick: () => { if (isOpen) state.open.delete(r.id); else state.open.add(r.id); again(); } }, isOpen ? "close" : "whole log");
    const verdict = r.status === "running" ? ""
      : r.status === "exited" ? `exited ${r.exit ?? "?"}`
      : r.status === "killed" ? `killed${r.endedBy ? " · " + r.endedBy : ""}`
      : "lost";
    return h("div.runrow", { "data-state": r.status, "data-run": r.id },
      h("span.lamp", { "aria-hidden": "true" }),
      h("div.who", h("div.run-name", r.automation), h("div.run-id", r.id)),
      h("div.clock", clock((r.ended ?? Date.now()) - r.started)),
      h("div.tail",
        h("span.lbl", "stdout · last line"),
        h("span.line", lastLine(tail)),
        isOpen ? h("pre.all", tail) : null,
        flap),
      h("div.actions",
        r.status === "running"
          ? h("button.kill", { type: "button", onclick: () => void ws.killRun(r.id).then(again) }, "Kill")
          : h("span.verdict", { "data-verdict": r.status }, verdict)));
  }
}
