// SPDX-License-Identifier: AGPL-3.0-only
// The markdown type scale, as a format.
//
// `contracts/scale.ts` is what a `markdown.yaml` means, and it is shared by the
// page reader, the design reader and the checker so that all three agree about a
// file somebody wrote. These tests are about the narrowing itself: what gets
// through, what is dropped, and what is SAID about what was dropped — because
// the reader drops silently on purpose and the checker is the only thing that
// tells anybody.

import { test, expect } from "bun:test";
import { SCALE_ELEMENTS, SCALE_PROPS, scaleOf } from "../contracts/scale.ts";
import type { ScaleFault } from "../contracts/scale.ts";

/* ── what gets through ─────────────────────────────────────────────────── */

test("the file becomes custom properties, and the measure is the page's rather than an element's", () => {
  expect(scaleOf({
    measure: "34rem",
    h1: { size: "2.5rem", weight: "600", leading: "1.04", tracking: "-0.02em" },
    p: { size: "1rem", above: "0", below: "1rem" },
  })).toEqual({
    "--md-measure": "34rem",
    "--md-h1-size": "2.5rem",
    "--md-h1-weight": "600",
    "--md-h1-leading": "1.04",
    "--md-h1-tracking": "-0.02em",
    "--md-p-size": "1rem",
    "--md-p-above": "0",
    "--md-p-below": "1rem",
  });
});

test("a scale is written the way somebody thinks about type, not the way CSS spells it", () => {
  // `case: upper` rather than `text-transform: uppercase`, and the translation
  // lives in one place instead of in every file anybody writes.
  expect(scaleOf({ h3: { case: "upper" } })).toEqual({ "--md-h3-case": "uppercase" });
  expect(scaleOf({ h3: { case: "title" } })).toEqual({ "--md-h3-case": "capitalize" });
});

test("`face` takes a ROLE and resolves through the palette, so it can never name a font", () => {
  expect(scaleOf({ code: { face: "gauge" } })).toEqual({ "--md-code-face": "var(--gauge-face)" });
  // A font name is not a role, and a page that pinned itself to a family the
  // workspace does not use is the failure this shape exists to prevent.
  expect(scaleOf({ code: { face: "Cascadia Code" } })).toEqual({});
  expect(scaleOf({ code: { face: "serif" } })).toEqual({});
});

/* ── what cannot get in ────────────────────────────────────────────────── */

test("A COLOUR CANNOT GET IN, by having nowhere to go", () => {
  // Colour resolves to a palette token and belongs to the WORKSPACE, not to one
  // page's type scale. There is no property for it, so this is not a filter that
  // could be got wrong — it is an absence.
  expect(scaleOf({ p: { color: "#E8341C", background: "red", size: "1rem" } }))
    .toEqual({ "--md-p-size": "1rem" });
  expect(Object.keys(SCALE_PROPS)).not.toContain("color");
});

test("a value that is not the kind of value that property takes is dropped", () => {
  // Everything here reaches the box and is declared straight onto an element's
  // style, so "validated on the way in" is the whole reason a person edits a
  // scale rather than a stylesheet.
  expect(scaleOf({ p: { size: "big" } })).toEqual({});
  expect(scaleOf({ p: { size: "16" } })).toEqual({});           // a length needs a unit
  expect(scaleOf({ p: { leading: "1.6rem" } })).toEqual({});    // line height is unitless
  expect(scaleOf({ p: { size: "1rem; color: red" } })).toEqual({});
  expect(scaleOf({ p: { weight: "600" } })).toEqual({ "--md-p-weight": "600" });
  expect(scaleOf({ p: { weight: "650" } })).toEqual({});
});

test("an element nobody draws and a property nobody defined are both dropped", () => {
  expect(scaleOf({ marquee: { size: "2rem" } })).toEqual({});
  expect(scaleOf({ p: { kerning: "tight" } })).toEqual({});
  expect(SCALE_ELEMENTS).toContain("blockquote");
  expect(SCALE_ELEMENTS).not.toContain("div");
});

/* ── dropping quietly, and saying so anyway ────────────────────────────── */

test("nothing throws, and everything thrown away is reported to whoever asked", () => {
  // The reader drops in silence BECAUSE a typo in a type scale must not be the
  // thing that stops a document opening. That is only defensible because the
  // checker collects the same faults and prints them.
  const faults: ScaleFault[] = [];
  const out = scaleOf({
    measure: "wide",
    marquee: { size: "2rem" },
    p: { size: "1rem", kerning: "tight", leading: "loose" },
  }, faults);

  expect(out).toEqual({ "--md-p-size": "1rem" });
  expect(faults.map((f) => f.where).sort()).toEqual(["marquee", "measure", "p.kerning", "p.leading"]);
  // Written for a person: the complaint says what to try instead.
  expect(faults.find((f) => f.where === "p.kerning")?.says).toContain("tracking");
});

test("a file that is not a map at all is one complaint rather than a crash", () => {
  const faults: ScaleFault[] = [];
  expect(scaleOf("34rem", faults)).toEqual({});
  expect(faults).toHaveLength(1);
  // An absent file is not a fault. It is the ordinary state of a workspace that
  // has not needed one.
  expect(scaleOf(null)).toEqual({});
  expect(scaleOf(undefined, faults)).toEqual({});
  expect(faults).toHaveLength(1);
});

test("the measure is the PAGE's, and an element asking for one is a fault", () => {
  // It sat in the shared property table, so `h1: { measure: 20rem }` was
  // accepted, flattened to `--md-h1-measure`, read by nothing and reported by
  // nothing — a line somebody could write, watch pass the checker, and never see
  // take effect. The top-level measure is still offered.
  const faults: ScaleFault[] = [];
  expect(scaleOf({ measure: "34rem", h1: { measure: "20rem", size: "2rem" } }, faults))
    .toEqual({ "--md-measure": "34rem", "--md-h1-size": "2rem" });
  expect(faults.map((f) => f.where)).toEqual(["h1.measure"]);
});
