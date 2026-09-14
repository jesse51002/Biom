// Types for the vendored markdown-it, hand-written and DELIBERATELY PARTIAL.
//
// Upstream ships `dist/markdown-it.d.mts`, and it is not usable here: its first
// three lines import `mdurl`, `uc.micro` and `linkify-it`, none of which are
// installed and none of which should be — the framework has no runtime dependencies and
// it is typescript. Vendoring the real declarations would mean vendoring a
// dependency tree to typecheck a file nobody edits.
//
// So this covers exactly the surface `client/platform/markdown.js` touches and
// nothing else. Reaching for a method that is not here is the signal to add it
// deliberately, having read what it does — not to widen this to `any`.
//
// TypeScript finds this because it sits beside `markdown-it.mjs` and shares its
// name; `tsconfig.json` `paths` points at the .mjs and the resolver picks this
// up for types. Bun ignores it and loads the real file.

/** One token in markdown-it's stream. Partial: the renderer rules below read
 *  `info` and `content`, and pass the rest straight back to `renderToken`. */
export interface Token {
  type: string;
  tag: string;
  info: string;
  content: string;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
  attrJoin(name: string, value: string): void;
}

export interface Options {
  /** FALSE here, always. It is the safety property: raw HTML in the source is
   *  ESCAPED rather than passed through, which is what keeps a vault's stored
   *  markdown from becoming script in the host realm. */
  html?: boolean;
  linkify?: boolean;
  typographer?: boolean;
  breaks?: boolean;
  langPrefix?: string;
  xhtmlOut?: boolean;
}

/** A renderer rule. Returning a string replaces the default output for that
 *  token type; `self.renderToken` is the default, for the cases you only want
 *  to decorate. */
export type Rule = (
  tokens: Token[],
  idx: number,
  options: Options,
  env: unknown,
  self: Renderer,
) => string;

export interface Renderer {
  rules: Record<string, Rule | undefined>;
  renderToken(tokens: Token[], idx: number, options: Options): string;
}

/** A rule in the core chain, which runs over the whole token stream after the
 *  block and inline passes. `numericColumns` uses it to mark table columns that
 *  are entirely figures, which cannot be decided one token at a time. */
export interface Core {
  ruler: {
    push(name: string, rule: (state: { tokens: Token[] }) => void): void;
    before(beforeName: string, name: string, rule: (state: { tokens: Token[] }) => void): void;
  };
}

export default class MarkdownIt {
  constructor(options?: Options);
  renderer: Renderer;
  /** DECLARED BECAUSE IT IS USED. This file was unreachable to TypeScript until
   *  its extension was fixed — an extensionless `paths` entry offers five
   *  candidates and `.d.mts` is not one — so `markdown-it` was an implicit `any`
   *  and this member's absence went unnoticed for as long as nothing checked. */
  core: Core;
  /** Block-level: the whole document. */
  render(src: string, env?: unknown): string;
  /** Inline only: no paragraph wrapper. */
  renderInline(src: string, env?: unknown): string;
  /** The href gate. markdown-it calls it for every link and image URL and drops
   *  the link when it answers false. Overriding it is how a scheme gets refused
   *  at the source rather than post-processed out of a string. */
  validateLink(url: string): boolean;
  normalizeLink(url: string): string;
  use(plugin: unknown, ...params: unknown[]): this;
}
