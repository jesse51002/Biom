// SPDX-License-Identifier: AGPL-3.0-only
// contracts/scale.ts — the markdown type scale, as a format rather than a
// stylesheet. Layer 0, so the page reader, the design reader and the checker all
// narrow the same file the same way.
//
// WHY A DECLARATIVE FILE AND NOT CSS. Once every visible word on a page is a
// markdown part, how big a heading is stops being one section's business and
// becomes the page's. A stylesheet would say it with more freedom and three
// things would be lost: nothing could validate it, a colour could get into it
// (colour is the palette's job and belongs to no page), and no control in the
// app could ever drive it — a slider cannot write arbitrary CSS back. What a
// scale can say is deliberately knowable.
//
// The freedom is not gone, it moved: a section's own `<style>` is still
// arbitrary CSS and still wins, because it comes later in the document. The
// scale is the default every markdown region starts from.
//
// TWO FILES, MERGED ONE PROPERTY AT A TIME. `markdown.yaml` at the vault root is
// the house scale; the same file in a page's directory is that page's. A page
// states only what differs, so a workspace's pages match without anybody keeping
// eight copies in step.

/** Custom property name → value, exactly as the runtime declares it on the page
 *  root. Flat and stringly on purpose: what crosses into the box is declared
 *  straight onto an element's style, so it is validated here, where the file is,
 *  rather than trusted there. */
export type MarkdownScale = Record<string, string>;

/** The elements a scale may speak about. A closed list rather than "any tag",
 *  because the point of a declarative scale over a stylesheet is that what it
 *  can say is knowable — by the checker, and by a panel in the app that has to
 *  draw one control per line. */
export const SCALE_ELEMENTS: readonly string[] = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "blockquote", "code", "pre", "hr", "a", "strong", "em", "table",
];

const LENGTH = /^(?:0|-?(?:\d+|\d*\.\d+)(?:rem|em|px|ch|ex|vw|vh|%))$/;
const NUMBER = /^(?:\d+|\d*\.\d+)$/;
const WEIGHT = /^(?:[1-9]00|normal|bold|lighter|bolder)$/;
const STYLE = new Set(["normal", "italic", "oblique"]);
/** Written the way somebody thinks about it, not the way CSS spells it. */
const CASE: Record<string, string> = {
  none: "none", upper: "uppercase", lower: "lowercase", title: "capitalize",
};
/** A type ROLE, never a font name — the same reason nothing here may name a
 *  colour. The role resolves through the palette the shim declares, so a scale
 *  cannot pin a page to a font the workspace does not use. */
const FACE = new Set(["sheet", "furniture", "gauge"]);

/** Property → the CSS value it becomes, or null when it is not one this may say.
 *  Every value is checked against a grammar rather than passed through. */
export const SCALE_PROPS: Record<string, (raw: string) => string | null> = {
  size: (v) => (LENGTH.test(v) ? v : null),
  leading: (v) => (NUMBER.test(v) ? v : null),
  tracking: (v) => (LENGTH.test(v) ? v : null),
  above: (v) => (LENGTH.test(v) ? v : null),
  below: (v) => (LENGTH.test(v) ? v : null),
  measure: (v) => (LENGTH.test(v) ? v : null),
  weight: (v) => (WEIGHT.test(v) ? v : null),
  style: (v) => (STYLE.has(v) ? v : null),
  case: (v) => CASE[v] ?? null,
  face: (v) => (FACE.has(v) ? `var(--${v}-face)` : null),
};

/** One complaint about a scale, for the checker to print. The reader drops what
 *  it cannot use and says nothing; this is the same walk, keeping what it
 *  dropped and why. */
export interface ScaleFault {
  where: string;
  says: string;
}

/**
 * THE FILE, FLATTENED TO CUSTOM PROPERTIES.
 *
 * Anything unknown — an element nobody listed, a property nobody defined, a size
 * that is not a length — is DROPPED rather than thrown. A page is the unit of a
 * fault everywhere else in this format, and a typo in a type scale must not be
 * the thing that stops a document opening. The checker is what says so, out
 * loud, where somebody can act on it: pass a `faults` array to collect what this
 * threw away.
 */
export function scaleOf(value: unknown, faults?: ScaleFault[]): MarkdownScale {
  const out: MarkdownScale = {};
  const drop = (where: string, says: string) => { if (faults) faults.push({ where, says }); };

  if (value === null || value === undefined) return out;
  if (typeof value !== "object" || Array.isArray(value)) {
    drop("the file", "a type scale is a map of elements, one per line");
    return out;
  }

  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    // The reading measure is the PAGE's, not one element's, so it sits at the
    // top level where somebody looking for it will look.
    if (key === "measure") {
      const width = SCALE_PROPS.measure!(String(held));
      if (width === null) drop("measure", `"${String(held)}" is not a length`);
      else out["--md-measure"] = width;
      continue;
    }
    if (!SCALE_ELEMENTS.includes(key)) {
      drop(key, `nothing draws "${key}" — the scale speaks about ${SCALE_ELEMENTS.join(", ")}`);
      continue;
    }
    if (held === null || typeof held !== "object" || Array.isArray(held)) {
      drop(key, `"${key}" holds properties, one per line`);
      continue;
    }
    for (const [prop, raw] of Object.entries(held as Record<string, unknown>)) {
      const check = prop === "measure" ? undefined : SCALE_PROPS[prop];
      // THE MEASURE IS THE PAGE'S, NEVER AN ELEMENT'S. Left in the shared table
      // it was accepted per element, flattened to `--md-h1-measure`, read by
      // nothing and reported by nothing — a line somebody could write, see
      // pass the checker, and never see take effect.
      if (check === undefined) {
        drop(`${key}.${prop}`, `there is no "${prop}" — try ${Object.keys(SCALE_PROPS).join(", ")}`);
        continue;
      }
      const made = check(String(raw));
      if (made === null) drop(`${key}.${prop}`, `"${String(raw)}" is not a value "${prop}" can take`);
      else out[`--md-${key}-${prop}`] = made;
    }
  }
  return out;
}
