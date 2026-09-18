// Types for the vendored yaml, hand-written and DELIBERATELY PARTIAL.
//
// Upstream ships 78 .d.ts files under dist/, and they describe the whole
// library: the CST, the visitor, the 1.1 schema, the custom-tag machinery.
// server/platform/yaml.ts touches five names out of that, and vendoring the
// rest would mean vendoring a tree to typecheck a file nobody edits.
//
// So this covers exactly the surface the codec uses and nothing else. Reaching
// for something that is not here is the signal to add it deliberately, having
// read what it does upstream — not to widen this to `any`.
//
// TypeScript finds this because it sits beside `yaml.mjs` and shares its name;
// `tsconfig.json` `paths` points at `./vendor/yaml` WITHOUT an extension, so
// the resolver picks this up for types. Bun ignores it and loads the real file.
//
// `.d.ts` AND NOT `.d.mts`, WHICH IS THE WHOLE REASON THIS RESOLVES. An
// extensionless specifier gives TypeScript five candidates — .ts, .tsx, .d.ts,
// .js, .jsx — and .d.mts is not among them. `markdown-it.d.mts` beside this
// file is never found for that reason; it goes unnoticed because its one
// importer is a .js file, where an unresolved import is silent instead of
// TS2307. Renaming this to .d.mts breaks the server build.

/** Where a parse error is, 1-based. Present because `prettyErrors` defaults on. */
export interface LinePos {
  line: number;
  col: number;
}

/** What lands in `Document.errors`. The real class is `YAMLParseError`; the
 *  codec only ever reads these three fields off it, and reading rather than
 *  catching is what keeps the vendored class out of our `instanceof` checks. */
export interface YamlDiagnostic {
  name: string;
  /** An upstream enum — "DUPLICATE_KEY", "TAB_AS_INDENT", "MISSING_CHAR". Read
   *  as an opaque string; nothing here switches on it. */
  code: string;
  /** Multi-line: a sentence, then a blank line, then the offending source with
   *  a caret under it. The codec keeps the first line only. */
  message: string;
  linePos?: [LinePos, LinePos];
}

/** One leaf value, and the only node the codec ever mutates: setting `type` to
 *  `Scalar.BLOCK_LITERAL` is how markdown comes back out as `data: |` rather
 *  than as a quoted string with \n in it. */
export declare class Scalar<T = unknown> {
  static readonly BLOCK_LITERAL: "BLOCK_LITERAL";
  static readonly BLOCK_FOLDED: "BLOCK_FOLDED";
  static readonly PLAIN: "PLAIN";
  static readonly QUOTE_DOUBLE: "QUOTE_DOUBLE";
  static readonly QUOTE_SINGLE: "QUOTE_SINGLE";
  value: T;
  /** Requested, not guaranteed: the stringifier falls back to a quoted form
   *  when the value has no legal block spelling. The codec verifies the round
   *  trip rather than trusting the request. */
  type?: string;
}

export declare class YAMLMap {
  items: unknown[];
  get(key: unknown, keepScalar?: boolean): unknown;
}

export declare class YAMLSeq {
  items: unknown[];
  get(key: unknown, keepScalar?: boolean): unknown;
  /** Requested flow style, `[a, b]` on one line rather than one `- ` per item.
   *  The codec asks it of a grid's rows and of nothing else. */
  flow?: boolean;
}

export interface ParseOptions {
  /** "1.2" is the core schema: `no` stays a string and `007` is not octal. */
  version?: "1.1" | "1.2" | "next";
  /** Report a repeated mapping key rather than letting the last one win. */
  uniqueKeys?: boolean;
  prettyErrors?: boolean;
}

export interface ToJsOptions {
  /** How many times one anchor may be expanded before the parser calls it a
   *  bomb. The default is 100 and the codec keeps it. */
  maxAliasCount?: number;
}

export interface ToStringOptions {
  /** 0 disables folding entirely. A folded line is legal YAML and reads back
   *  the same, but it turns one edited sentence into a reflowed paragraph in
   *  the diff. */
  lineWidth?: number;
  indent?: number;
  nullStr?: string;
  singleQuote?: boolean;
  /** Allow `|` and `>` forms at all. True by default; named here because it is
   *  the switch the whole prose-stays-readable requirement rests on. */
  blockQuote?: boolean;
  /** `[a, b]` rather than `[ a, b ]` for a flow collection. Only a grid's rows
   *  are written in flow style, so this reaches nothing else. */
  flowCollectionPadding?: boolean;
}

export declare class Document<T = unknown> {
  constructor(value?: unknown, options?: ParseOptions);
  contents: unknown;
  errors: YamlDiagnostic[];
  warnings: YamlDiagnostic[];
  get(key: unknown, keepScalar?: boolean): unknown;
  toJS(options?: ToJsOptions): T;
  toString(options?: ToStringOptions): string;
}

/** Parse one document, collecting errors instead of throwing them. Errors that
 *  are recoverable still leave a usable tree, which is why `errors` has to be
 *  checked rather than assumed empty. */
export declare function parseDocument(source: string, options?: ParseOptions): Document;

export declare function isMap(value: unknown): value is YAMLMap;
export declare function isSeq(value: unknown): value is YAMLSeq;
export declare function isScalar(value: unknown): value is Scalar;
