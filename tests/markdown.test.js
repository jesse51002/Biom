// SPDX-License-Identifier: AGPL-3.0-only
// The prose render's markdown, and mostly its safety property.
//
// `client/platform/markdown.js` runs in the HOST realm and its output goes
// straight into the host document — there is no frame, no opaque origin and no
// sandbox between the two. The vault names stored cross-site scripting in the
// shared path as an OPEN risk, so the file that turns somebody else's text into
// host markup is the last place it may be made concrete.
//
// The security block below is therefore not a smoke test. It pins the upstream
// defaults this module depends on — `html: false` and markdown-it's own
// `validateLink` — so a version bump that loosened either one FAILS HERE rather
// than shipping. The capability and regression blocks come after, because a
// documents product with no tables and no links has a hole in it too.

import { test, expect } from "bun:test";
import { md, inline, escapeHtml } from "../client/platform/markdown.js";

/* ── the safety property ───────────────────────────────────────────────── */

test("a <script> in the source comes out escaped and inert", () => {
  const out = md("<script>alert(1)</script>\n\nafter");
  expect(out).not.toContain("<script");
  expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  // and the document around it still renders
  expect(out).toContain("<p>after</p>");
});

test("an onerror= in the source never becomes an attribute", () => {
  const out = md('text <img src=x onerror="alert(1)"> more');
  expect(out).not.toContain("<img");
  expect(out).not.toMatch(/onerror\s*=\s*["']/);
  expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("an <img src=x onerror=…> is text, in every position it can be written", () => {
  for (const source of [
    "<img src=x onerror=alert(1)>",
    "- <img src=x onerror=alert(1)>",
    "> <img src=x onerror=alert(1)>",
    "# <img src=x onerror=alert(1)>",
    "| a |\n|---|\n| <img src=x onerror=alert(1)> |",
  ]) {
    const out = md(source);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  }
});

test("a javascript: link does not survive — it is left as the text somebody typed", () => {
  const out = md("[click](javascript:alert(1))");
  expect(out).not.toContain("<a");
  expect(out).not.toContain("href=");
  // it survives as TEXT, which is the honest outcome: the reader sees what was
  // written and nothing in the document points anywhere
  expect(out).toContain("[click](javascript:alert(1))");
});

test("the refusal is not case- or whitespace-sensitive, and covers the other shapes", () => {
  for (const href of [
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "java\nscript:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    expect(md(`[x](${href})`)).not.toContain('<a href="' + href);
  }
  // an autolink and an image are the same destination by another spelling
  expect(md("<javascript:alert(1)>")).not.toContain("<a ");
  expect(md("![alt](javascript:alert(1))")).not.toContain("<img");
});

test("a data:text/html link does not survive; a data: image does", () => {
  expect(md("[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"))
    .not.toContain("<a ");
  // svg is a document with scripting, so it is refused with the rest
  expect(md("[x](data:image/svg+xml;base64,PHN2Zy8+)")).not.toContain("<a ");
  // the four raster types upstream allows are the whole of what gets through
  expect(md("![dot](data:image/png;base64,iVBORw0KGgo=)")).toContain("<img");
});

test("an entity-encoded scheme is decoded before it is judged, not after", () => {
  // `&#106;` is `j`. A check that ran on the raw source would let this through.
  expect(md("[x](&#106;avascript&#58;alert(1))")).not.toContain("<a href=\"javascript");
});

test("a link title cannot break out of the attribute it is written into", () => {
  const out = md('[x](https://a.example "ti\\"tle onmouseover=alert(1)")');
  // the quote that would have closed the attribute is escaped, so everything
  // after it stays inside the title value instead of becoming a handler
  expect(out).toContain('title="ti&quot;tle onmouseover=alert(1)"');
});

test("a fence's info string cannot escape the class attribute", () => {
  const out = md('```js" onload="alert(1)\nvar a = 1;\n```');
  expect(out).toContain('<code class="language-js">');
  expect(out).not.toContain("onload");
});

test("escapeHtml is still exported, because dom.js cannot have it", () => {
  expect(escapeHtml('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  expect(escapeHtml(42)).toBe("42");
});

test("inline runs the same escaping, without the paragraph around it", () => {
  expect(inline("a **b** <i>c</i>")).toBe("a <strong>b</strong> &lt;i&gt;c&lt;/i&gt;");
  expect(inline("[x](javascript:alert(1))")).not.toContain("<a ");
});

/* ── the links a workspace should have ─────────────────────────────────── */

test("an external link carries rel and never a target", () => {
  const out = md("[z](https://a.example/p)");
  expect(out).toContain('<a href="https://a.example/p" rel="noopener noreferrer">z</a>');
  expect(out).not.toContain("target=");
});

test("a link that cannot leave the workspace is left alone", () => {
  expect(md("[w](#anchor)")).toContain('<a href="#anchor">w</a>');
  expect(md("[v](./rates.md)")).toContain('<a href="./rates.md">v</a>');
});

test("a bare URL in prose is a link, because nobody types the brackets", () => {
  const out = md("see https://example.com/a?b=1 for the rates");
  expect(out).toContain('<a href="https://example.com/a?b=1"');
  expect(out).toContain('rel="noopener noreferrer"');
});

/* ── what the 92 lines could not do ────────────────────────────────────── */

test("a table, wrapped so the block scrolls and never the page (R28)", () => {
  const out = md("| Item | Qty |\n|---|---|\n| Nails | 120 |\n");
  expect(out).toContain('<div class="mdscroll">');
  expect(out).toContain('<table class="mdtable">');
  expect(out).toContain("<th>Item</th>");
  expect(out).toContain("<td>Nails</td>");
});

test("a column of figures is found and marked, so the sheet can right-align it", () => {
  const out = md("| Item | Qty | Price | Note |\n|---|---|---|---|\n" +
    "| Nails | 120 | $12.50 | ok |\n| Screws | 8 | 1,200 | fine |\n");
  expect(out).toContain('<th class="num">Qty</th>');
  expect(out).toContain('<td class="num">120</td>');
  expect(out).toContain('<td class="num">$12.50</td>');
  // a column of words is not a column of numbers
  expect(out).toContain("<td>ok</td>");
  expect(out).toContain("<th>Item</th>");
});

test("a fence keeps its source verbatim and names its language", () => {
  const out = md("```js\nvar a = 1 < 2;\n```");
  expect(out).toContain('<pre><code class="language-js">');
  expect(out).toContain("var a = 1 &lt; 2;");
});

test("a fence with no info string is still a fence", () => {
  expect(md("```\nplain\n```")).toContain("<pre><code>plain\n</code></pre>");
});

test("an indented block takes the same shape, so one selector finds both", () => {
  expect(md("    indented\n")).toContain("<pre><code>indented\n</code></pre>");
});

test("THE JOINT — a fence is pre > code.language-<info>, source intact", () => {
  // THIS IS WHAT THE BOX'S MARKDOWN PLUGIN DISPATCHES ON. A fence whose info
  // string names a plugin the workspace carries is handed to that plugin and
  // stops being a code block; `tests/vault-plugins.test.js` holds that half.
  // What this module owes it is the shape: one selector finds the block, and the
  // `<pre>`'s text is the source verbatim, with nothing invented around it.
  const source = 'flow TD\n  A["one"] --> B';
  const out = md("```flow\n" + source + "\n```");
  expect(out).toContain('<pre><code class="language-flow">');
  // What the other module reads back off the element is escaped for transport
  // and nothing more.
  expect(out).toContain('A[&quot;one&quot;] --&gt; B');
  // And this module knows nothing about drawings: no library, no mount, no tag,
  // and no language named anywhere in it.
  expect(out).not.toContain("<figure");
  expect(out).not.toContain("script");
});

test("a nested list, and an ordered one", () => {
  const out = md("1. one\n   - inner\n2. two\n");
  expect(out).toContain("<ol>");
  expect(out).toContain("<ul>");
  expect(out).toContain("<li>inner</li>");
});

test("a blockquote, an image and a horizontal rule", () => {
  expect(md("> quoted")).toContain("<blockquote>");
  expect(md("![alt](https://x.example/i.png)"))
    .toContain('<img src="https://x.example/i.png" alt="alt">');
  expect(md("---")).toContain("<hr>");
});

test("typographer is off: nobody's punctuation is silently rewritten", () => {
  const out = md(`He said "no" -- and it's 1/2 ...`);
  expect(out).toContain(`&quot;no&quot;`);
  expect(out).toContain("--");
  expect(out).toContain("...");
  expect(out).not.toContain("&hellip;");
  expect(out).not.toContain("&rdquo;");
});

test("breaks is off: a wrapped paragraph is one paragraph", () => {
  const out = md("one line\nwrapped here");
  expect(out).not.toContain("<br");
  expect(out).toBe("<p>one line\nwrapped here</p>\n");
});

/* ── the regressions: every page in every vault is written against these ── */

test("headings, one through three, exactly as the 92 lines drew them", () => {
  expect(md("# One")).toContain("<h1>One</h1>");
  expect(md("## Two")).toContain("<h2>Two</h2>");
  expect(md("### Three")).toContain("<h3>Three</h3>");
});

test("paragraphs, split on the blank line", () => {
  const out = md("first\n\nsecond");
  expect(out).toContain("<p>first</p>");
  expect(out).toContain("<p>second</p>");
});

test("a bullet list, written with either mark", () => {
  for (const mark of ["-", "*"]) {
    const out = md(`${mark} a\n${mark} b\n`);
    expect(out).toContain("<ul>");
    expect(out).toContain("<li>a</li>");
    expect(out).toContain("<li>b</li>");
  }
});

test("inline bold, italic and code, in a heading and in a list item too", () => {
  const out = md("# a **b** _c_ `d`\n\n- e **f** _g_ `h`\n");
  expect(out).toContain("<strong>b</strong>");
  expect(out).toContain("<em>c</em>");
  expect(out).toContain("<code>d</code>");
  expect(out).toContain("<strong>f</strong>");
  expect(out).toContain("<em>g</em>");
  expect(out).toContain("<code>h</code>");
});

test("a lone italic line is still a lone italic line — plain.js reads it as a dek", () => {
  // `isDek` in client/render/plain.js needs exactly <p><em>…</em></p>
  expect(md("_a standfirst_")).toBe("<p><em>a standfirst</em></p>\n");
});

test("inline code survives the escaping with its contents intact", () => {
  expect(md("`a < b && c`")).toContain("<code>a &lt; b &amp;&amp; c</code>");
});

test("empty, blank and non-string input all answer with a string", () => {
  expect(md("")).toBe("");
  expect(md("\n\n  \n")).toBe("");
  expect(md(undefined)).toContain("undefined");
});
