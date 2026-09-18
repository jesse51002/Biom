// SPDX-License-Identifier: AGPL-3.0-only
// THE AUTOMATIONS OVERVIEW, from the rail's foot. By default it is one thing:
// what is running now across the workspace — a lamp, the name, the page as a
// link, the clock, Kill, and the last line of stdout labelled as exactly that,
// with the whole log a click away — with the finished runs under it, and one
// Start control. Start walks three steps in the same place: pick an automation
// from every page that holds one; set its inputs; Start. An automation that
// already has a run alive says so before Start, and Start goes ahead anyway.
//
// THAT IS EVERYTHING THE FRAMEWORK KNOWS ABOUT A RUN: its status, its times,
// the page that holds it, its exit, and a file it serves and never reads. A
// line that means something is the page's to draw from what the run wrote.
// Every page named here is a link to the page, because the page is where an
// automation is made and where what it wrote is drawn; this is only where it
// is watched.

/** @import { Automation, RunRow, VarScalar, WorkspaceStore, UiStore } from "../../contracts/types.ts" */
import { clock, followLog, lastLine } from "../widgets/runsui.js";

/** @typedef {(spec: string, props?: any, ...kids: any[]) => HTMLElement} H */

export const WORDS = Object.freeze({
  title: "Automations",
  start: "Start an automation",
  running: "Running now",
  finished: "Finished",
  pick: "Pick one",
  inputs: "Set it up",
  back: "Back",
  go: "Start",
  kill: "Kill",
  logLabel: "stdout · last line",
  logOpen: "whole log",
  logClose: "close",
  alive: "alive",
  alreadyRunning: "{n} already running — this starts another beside it.",
  nothing: "Nothing is running.",
  none: "No page holds an automation yet. Ask your agent to make one on a page.",
  orphan: "the page is gone",
});
/** How often live rows are re-read while the screen is open. */
export const FOLLOW_EVERY = 1000;

/**
 * @typedef {object} RunsViewDeps
 * @property {H} h
 * @property {WorkspaceStore} ws
 * @property {UiStore} ui
 * @property {{ on: (hear: () => void) => () => void }} [events]
 */

/**
 * @param {RunsViewDeps} deps
 * @returns {() => HTMLElement}
 */
export function makeRunsView(deps) {
  const { h, ws, ui } = deps;

  const state = {
    step: /** @type {"none" | "pick" | "inputs"} */ ("none"),
    chosen: /** @type {Automation | null} */ (null),
    open: new Set(),
  };
  const tails = new Map();
  /** Read whatever a run has printed since the last read, to the end. */
  const follow = (/** @type {RunRow} */ r) => followLog((id, stream, from) => ws.readRun(id, stream, from), tails, r.id);

  return function overview() {
    const head = h("div.ov-head", h("span.title", WORDS.title), h("span.count"), h("span.step"), h("span.grow"),
      h("button.back", { type: "button", onclick: () => { state.step = state.step === "inputs" ? "pick" : "none"; void draw(); } }, WORDS.back),
      h("button.start", { type: "button", onclick: () => { state.step = "pick"; void draw(); } }, WORDS.start));
    const body = h("div.ov-body");
    const screen = h("div.overview", { "data-step": state.step }, head, body);

    let timer = /** @type {ReturnType<typeof setInterval> | null} */ (null);
    let off = /** @type {(() => void) | null} */ (null);
    /** Has the screen been on the canvas yet. The first draw runs before the
     *  shell has appended it, so *not connected* means *gone* only after it
     *  was once there. */
    let shown = false;
    const stop = () => { if (timer !== null) clearInterval(timer); timer = null; if (off !== null) off(); off = null; };

    async function draw() {
      if (screen.isConnected) shown = true;
      else if (shown) { stop(); return; }
      screen.setAttribute("data-step", state.step);
      const stepWord = /** @type {HTMLElement} */ (head.querySelector(".step"));
      stepWord.textContent = state.step === "pick" ? "· " + WORDS.pick : state.step === "inputs" ? "· " + WORDS.inputs : "";
      if (state.step === "pick") { body.replaceChildren(await pickList()); return; }
      if (state.step === "inputs" && state.chosen !== null) { body.replaceChildren(await inputsForm(state.chosen)); return; }
      let list;
      try {
        list = await ws.runs();
      } catch (e) {
        body.replaceChildren(h("p.hold", e instanceof Error ? e.message : "the runs could not be listed"));
        return;
      }
      await Promise.all(list.map(follow));
      const running = list.filter((r) => r.status === "running");
      const finished = list.filter((r) => r.status !== "running");
      /** @type {HTMLElement} */ (head.querySelector(".count")).textContent = running.length > 0 ? String(running.length) : "";
      body.replaceChildren(
        h("div.group", h("h3", WORDS.running), ...running.map((r) => row(r)), running.length === 0 ? h("p.dim", WORDS.nothing) : null),
        h("div.group", h("h3", WORDS.finished), ...finished.map((r) => row(r)), finished.length === 0 ? h("p.dim", "") : null));
      if (running.length > 0 && timer === null) timer = setInterval(() => void draw(), FOLLOW_EVERY);
      if (running.length === 0 && timer !== null) { clearInterval(timer); timer = null; }
    }

    async function pickList() {
      let autos;
      let runs;
      try {
        [autos, runs] = await Promise.all([ws.automations(), ws.runs()]);
      } catch (e) {
        return h("p.hold", e instanceof Error ? e.message : "the automations could not be listed");
      }
      const live = (/** @type {Automation} */ a) => runs.filter((r) => r.status === "running" && r.page === a.page && r.automation === a.folder).length;
      const rows = autos.filter((a) => a.manifest !== null).map((a) => {
        const n = live(a);
        const el = h("div.auto", { role: "button", tabindex: "0", "data-live": n > 0 ? "" : null },
          h("span.n", a.manifest?.name ?? a.folder),
          h("span.live", n > 0 ? `${n} ${WORDS.alive}` : ""),
          h("span.p", pageLink(a.page), " · " + (a.manifest?.agent || "custom")),
          h("span.d", a.manifest?.description ?? ""));
        const choose = () => { state.chosen = a; state.step = "inputs"; void draw(); };
        el.addEventListener("click", choose);
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
        return el;
      });
      return h("div.pick", ...rows, rows.length === 0 ? h("p.dim", WORDS.none) : null);
    }

    /** @param {Automation} a */
    async function inputsForm(a) {
      const m = a.manifest;
      if (m === null) return h("p.hold", a.trouble ?? "");
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
      let alive = 0;
      try {
        alive = (await ws.runs({ page: a.page, automation: a.folder })).filter((r) => r.status === "running").length;
      } catch {
        alive = 0;
      }
      const said = h("p.said");
      return h("div.inputs", { "data-live": alive > 0 ? "" : null },
        h("div.chosen", h("div.n", m.name), h("div.p", pageLink(a.page), " · " + (m.agent || "custom"))),
        h("div.fields", ...fields),
        alive > 0 ? h("p.warn", WORDS.alreadyRunning.replace("{n}", String(alive))) : null,
        h("button.go", { type: "button", onclick: () => {
          void ws.startRun(a.page, a.folder, values).then(() => { state.step = "none"; void draw(); }, (e) => { said.textContent = e instanceof Error ? e.message : "that could not be started"; });
        } }, WORDS.go),
        said);
    }

    /** @param {RunRow} r */
    function row(r) {
      const tail = tails.get(r.id)?.text ?? "";
      const isOpen = state.open.has(r.id);
      const verdict = r.status === "exited" ? `exited ${r.exit ?? "?"}` : r.status === "killed" ? `killed${r.endedBy ? " · " + r.endedBy : ""}` : r.status === "lost" ? "lost" : "";
      return h("div.run-row", { "data-state": r.status, "data-run": r.id },
        h("span.lamp", { "aria-hidden": "true" }),
        h("div", h("div.run-name", r.automation), h("div.run-id", r.id)),
        h("div.clock", clock((r.ended ?? Date.now()) - r.started)),
        h("div.by", pageLink(r.page)),
        h("div.tail", h("span.lbl", WORDS.logLabel), h("span.line", lastLine(tail)), isOpen ? h("pre.all", tail) : null,
          h("button.open", { type: "button", onclick: () => { if (isOpen) state.open.delete(r.id); else state.open.add(r.id); void draw(); } }, isOpen ? WORDS.logClose : WORDS.logOpen)),
        h("div.actions", r.status === "running"
          ? h("button.kill", { type: "button", onclick: () => void ws.killRun(r.id).then(() => void draw()) }, WORDS.kill)
          : h("span.verdict", { "data-verdict": r.status }, verdict)));
    }

    /** The page's id, as a link to the page — or, for a run whose page is
     *  gone, the id dimmed with a word beside it. */
    function pageLink(/** @type {string} */ id) {
      const there = ws.get().pages.some((p) => p.id === id);
      if (!there) return h("span.pagelink.gone", id, " · " + WORDS.orphan);
      return h("a.pagelink", { href: "#", onclick: (/** @type {Event} */ e) => { e.preventDefault(); e.stopPropagation(); ui.go("page", id); } }, id);
    }

    if (deps.events) off = deps.events.on(() => void draw());
    const gone = setInterval(() => { if (shown && !screen.isConnected) { stop(); clearInterval(gone); } }, 5000);
    void draw();
    return screen;
  };
}
