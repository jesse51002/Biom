// SPDX-License-Identifier: AGPL-3.0-only
/* guest/plugins/markdown.js — prose in a slot. A classic script sharing
 * globals; see `guest/runtime/registry.js` for why there are no imports in here.
 *
 * MOST OF WHAT A SLOT HOLDS IS PROSE, which is why a bare string in a section's
 * `parts` is markdown and needs no wrapper. This plugin is what that string
 * becomes.
 *
 * IT READS THE UMD BUILD, NOT THE MODULE ONE. `window.markdownit` comes from
 * `/vendor/markdown-it.min.js`, loaded by the document as a CLASSIC script,
 * because the box has an opaque origin: a module `<script src>` is CORS-gated
 * and blocked in here, and `fetch` is blocked too. That is measured rather than
 * assumed — `vendor/README.md` records the run, including the control that
 * failed. There are two copies of markdown-it on disk for exactly this reason
 * and they must stay the same version, because the host and the box render the
 * same prose and may not disagree about it.
 *
 * A MISSING LIBRARY DRAWS THE WORDS ANYWAY. A page whose text vanished because a
 * 200KB script did not arrive is worse than a page with visible asterisks in it,
 * and the difference is one branch.
 *
 * `{{name}}` IS RESOLVED HERE AND NOWHERE EARLIER. `ctx.text` fills it from the
 * three scopes already merged for this slot — the part's own variables, then the
 * section's, then the page's. The stored markdown keeps its braces: prose is
 * edited in place and writes back, so resolving before an edit would round-trip
 * `62` over the top of `{{rate}}` and destroy the variable.
 */
(function () {
  "use strict";

  /** @type {any} */
  const glob = /** @type {any} */ (globalThis);

  /** @type {any} */
  let renderer = null;
  let complained = false;

  function md() {
    if (renderer) return renderer;
    const factory = glob.markdownit;
    if (typeof factory !== "function") return null;
    // `html: true` because a section's prose is the page author's own writing in
    // their own box, and `<figure>` in the middle of a paragraph is an ordinary
    // thing to want. `typographer` stays off: rewriting (c) as © surprises
    // somebody documenting a keyboard shortcut, and smart quotes are not worth
    // a rule nobody was told about.
    renderer = factory({ html: true, linkify: true, breaks: false });
    // BEFORE `link`, so `[[a]]` is read as a wikilink rather than as a link
    // label wrapping a second one. It is a parser rule and not a pass over the
    // rendered DOM, which is what keeps `[[a]]` inside a code span or a fence
    // exactly as it was typed: those are decided by earlier rules and this one
    // never sees the text.
    renderer.inline.ruler.before("link", "wikilink", wikilink);
    return renderer;
  }

  /** `[[target]]` and `[[target|label]]`, as a link the runtime can follow.
   *
   *  IT CARRIES THE RAW TARGET AND RESOLVES NOTHING. A box has no page list, so
   *  what a link names is a question for the host — asked when the link is
   *  followed, through `link.resolve`. The `href` is a fragment because an
   *  anchor with no `href` is not focusable and cannot be tabbed to, and because
   *  the edit wave leaves `a[href]` alone: without one, clicking a reference
   *  would open the paragraph around it for editing instead of following it.
   *
   *  @param {any} state @param {boolean} silent */
  function wikilink(state, silent) {
    const src = state.src;
    const from = state.pos;
    if (src.charCodeAt(from) !== 0x5b || src.charCodeAt(from + 1) !== 0x5b) return false;
    // NOT INSIDE A REAL LINK'S LABEL, and this is two rules rather than one.
    //
    // `silent` is markdown-it VALIDATING a label, and returning true there is
    // what broke ordinary links: `parseLinkLabel` counts a nested `[` only when
    // the rule it asked advanced by EXACTLY ONE character, so jumping past `]]`
    // made it abandon the whole `link` rule — and
    // `[read the [[Pricing]] note](https://…)` came out as literal brackets with
    // the url linkified separately. Refusing in silent mode makes the label
    // parse exactly as vanilla markdown-it parses it.
    //
    // `linkLevel` is then the render pass: markdown-it's own `link` and
    // `linkify` rules refuse inside one for the same reason, because an `<a>`
    // inside an `<a>` is not a thing HTML has.
    if (silent || state.linkLevel > 0) return false;
    const end = src.indexOf("]]", from + 2);
    if (end < 0) return false;
    const body = src.slice(from + 2, end);
    // A bracket or a newline inside means this is not one link — it is markdown
    // that happens to start with two brackets, and markdown-it's own rules are
    // the ones that should read it.
    if (body === "" || /[[\]\n]/.test(body)) return false;
    const bar = body.indexOf("|");
    const target = (bar < 0 ? body : body.slice(0, bar)).trim();
    const label = (bar < 0 ? body : body.slice(bar + 1)).trim();
    if (target === "") return false;

    const open = state.push("link_open", "a", 1);
    open.attrs = [["href", "#"], ["data-g-link", target]];
    const text = state.push("text", "", 0);
    // A link with an empty alias reads as its target, which is what Obsidian
    // shows and what somebody writing `[[Airtable]]` meant.
    text.content = label === "" ? target : label;
    state.push("link_close", "a", -1);
    state.pos = end + 2;
    return true;
  }

  glob.biom.plugins.register({
    id: "markdown",

    /** `edit: true` DECLARES that this content is editable; it grants nothing.
     *  The runtime holds the only port that can call `section.write`, and
     *  nothing on `ctx` can write a file.
     *
     *
     *  IT COMES WITH `blocks` BELOW, and the pair is what the edit wave needs:
     *  `edit` says the words in here can be typed into, `blocks` says where one
     *  of them ends and the next begins. */
    edit: true,

    /**
     * @param {Element} node the slot, filled in place
     * @param {any} content the resolved `Part`, or null for a `data-g-plugin`
     *   node — which has no stored content and takes its source from
     *   `data-g-text` or from whatever the section wrote inside it
     * @param {any} ctx
     */
    mount(node, content, ctx) {
      const stored =
        content && content.kind === "markdown" && typeof content.md === "string"
          ? content.md
          : typeof ctx.options.text === "string"
            ? ctx.options.text
            : node.textContent || "";

      const source = ctx.text(stored);
      const renderTo = md();

      if (!renderTo) {
        node.setAttribute("data-g-md", "");
        if (!complained) {
          complained = true;
          console.error("[biom] markdown-it is not loaded in this box; prose is drawn as plain text");
        }
        node.textContent = source;
        return;
      }

      // WHAT THE PAGE'S TYPE SCALE ATTACHES TO. `guest/runtime/scale.js` styles
      // `[data-g-md] h1` and the rest from the custom properties the server
      // narrowed out of `markdown.yaml`, so a region has to say that is what it
      // is. Set here rather than inferred from the slot, because this plugin is
      // also mounted into places that are not slots — a table cell reaching for
      // it through `ctx.use` gets the page's scale for free.
      node.setAttribute("data-g-md", "");
      node.innerHTML = renderTo.render(source);
      upgradeFences(node, ctx);
    },

    /** WHERE ONE BLOCK ENDS AND THE NEXT BEGINS, as character ranges into the
     *  stored source, each carrying the TAG the renderer would draw it as. The
     *  edit wave opens the whole slot as raw markdown and draws every block in
     *  it at its own type — a heading's lines at heading size, a paragraph at
     *  body size — and re-reads this on every keystroke, so it has to agree with
     *  the renderer about what a block IS and what it is drawn as.
     *
     *  IT ASKS THE PARSER RATHER THAN THE TEXT. Splitting on a blank line is
     *  right until the first fenced code block containing a blank line, the
     *  first loose list, the first HTML block — and each of those is a paragraph
     *  that silently tears in half while somebody is typing in it. markdown-it
     *  already knows, and `token.map` is the answer: every TOP-LEVEL token
     *  carries the half-open line range it came from. Nesting is tracked so a
     *  list is one block rather than one block per item, which is what makes
     *  editing a list feel like editing a list.
     *
     *  `tag` IS markdown-it's OWN `token.tag` — `h1`, `p`, `ul`, `blockquote` —
     *  with a fence or an indented code block read as `pre`, because that is the
     *  element its raw source belongs in. An html block has no tag of its own
     *  and answers `""`; the editor draws that as a paragraph.
     *
     *  THE RANGES DO NOT COVER THE STRING, deliberately. The blank lines between
     *  blocks belong to no block, so they are outside every range — which is
     *  what lets the editor draw them as gaps rather than as part of the
     *  heading above them, and what keeps a person's own spacing theirs.
     *
     *  @param {string} source @returns {{start: number, end: number, tag: string}[]} */
    blocks(source) {
      // Nothing to edit is NO blocks, not one empty one — and that is the answer
      // in the fallback cases too, so "the library is missing" and "the source
      // is blank" do not arrive as the same shape. An empty slot is drawn from
      // the absence of ranges rather than from a range covering nothing.
      const whole = source.trim() === "" ? [] : [{ start: 0, end: source.length, tag: "" }];
      const renderTo = md();
      if (!renderTo) return whole;

      /** Offset of the first character of line `n`, clamped. A line PAST the end
       *  is the end, which is what a token whose range runs to the last line of
       *  the string reports. */
      const lineAt = [0];
      for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineAt.push(i + 1);
      /** @param {number} n */
      const at = (n) => (n >= lineAt.length ? source.length : lineAt[n] ?? source.length);

      /** @type {any[]} */
      let tokens;
      try {
        tokens = renderTo.parse(source, {});
      } catch {
        // Somebody is mid-sentence and the source does not parse yet. One block
        // is a worse edit surface than five and a far better one than none.
        return whole;
      }

      /** @type {{start: number, end: number, tag: string}[]} */
      const out = [];
      let depth = 0;
      for (const token of tokens) {
        if (depth === 0 && token.map) {
          const start = at(token.map[0]);
          // The trailing newline and any blank lines after it are spacing, not
          // content: they belong to the gap, and the gap is drawn as a gap.
          const raw = source.slice(start, at(token.map[1]));
          const end = start + raw.replace(/\s+$/, "").length;
          const tag =
            token.type === "fence" || token.type === "code_block"
              ? "pre"
              : typeof token.tag === "string" ? token.tag : "";
          if (end > start) out.push({ start: start, end: end, tag: tag });
        }
        depth += token.nesting;
      }

      return out.length ? out : whole;
    },

  });

  /** THE PART KINDS, which a fence may NEVER be handed to. `html`, `markdown`
   *  and `table` are ordinary things to write a fence in — somebody documenting
   *  their own section markup writes ```html and means it — and each of them is
   *  also a registered plugin, so without this list a code sample would be
   *  executed as the page rather than shown as a sample. It is `PART_KINDS` in
   *  `guest/runtime/registry.js`, said again here because the box has no import
   *  graph to reach it through.
   *  @type {Set<string>} */
  const PART_KINDS = new Set(["markdown", "html", "table", "child"]);

  /** A FENCE THAT NAMES A REGISTERED PLUGIN IS HANDED TO IT, and stops being a
   *  code block here.
   *
   *  There is no `diagram` part kind and there should not be one: a file type
   *  was a mechanism invented for a case that already had one. A fence inside
   *  prose is where a drawing naturally goes, and this is the upgrade in place
   *  — so a workspace that writes `plugins/flow.js` gets ```flow blocks drawn
   *  by it with nothing else to wire up, and a workspace that keeps a copy of
   *  some older diagram plugin goes on getting that plugin's fences drawn.
   *  THE FRAMEWORK NAMES NO LANGUAGE HERE, deliberately: this vault's
   *  `plugins/` folder is the whole of the list, which is what makes a drawing
   *  the workspace's own rather than one the framework picked for everybody.
   *
   *  IT IS THE WORKED EXAMPLE OF `ctx.use`. There are no imports in the box, so
   *  one plugin reaching another is a lookup by name and nothing else — and
   *  because every one of these is optional by construction, the dependency is
   *  asked about with `ctx.has` before it is taken with `ctx.use`. Where the
   *  name is not registered the fence stays an ordinary code block, which is
   *  the correct reading of a fence naming a language this workspace has no
   *  drawing for.
   *
   *  The source travels as an OPTION rather than as content, because `content`
   *  means "the stored Part for this slot" and a fence has no Part of its own —
   *  it lives inside somebody else's prose. That is the same bargain a
   *  `data-g-plugin` node makes.
   *  @param {Element} node @param {any} ctx */
  function upgradeFences(node, ctx) {
    for (const code of Array.from(node.querySelectorAll("pre > code[class]"))) {
      const found = /(?:^|\s)language-([a-z][a-z0-9-]*)(?:\s|$)/.exec(code.className);
      const id = found ? found[1] : "";
      if (!id || PART_KINDS.has(id) || !ctx.has(id)) continue;
      const pre = code.parentElement;
      if (!pre) continue;
      const holder = document.createElement("div");
      holder.setAttribute("data-g-fence", id);
      pre.replaceWith(holder);
      ctx.use(id).mount(holder, null, { source: code.textContent || "" });
    }
  }
})();
