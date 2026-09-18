# Variables

**A variable is a value the page states once and the words read.** A rate, a
multiplier, a threshold, a currency symbol, a season, a list of stages. It is a
thing somebody types into a field, and the prose reaches it with `{{name}}`.

```yaml
name: Rates
plugin: doc
variables:
  rate: 62
  currency: "£"
contents:
  - name: opening
    parts:
      body: |
        The base rate is {{currency}}{{rate}} an hour.
```

## What a variable may be

**A scalar, or a list of scalars, and nothing else.** A string, a number, `true`
or `false`, or an array of those. There is no nested map: there is no field for
one and no `{{name}}` that could name a leaf of one, so the reader refuses it at
the door rather than letting something try to draw it.

**Anything tabular is parallel lists** sharing a stem and the same length:

```yaml
variables:
  access:  [Ground, Stairs, Scaffold]
  factors: [1, 1.15, 1.35]
```

Read them defensively — the shorter list decides — because a hand-edited document
is the normal case.

## The three scopes, nearest wins

A page's variables nest three deep, and **`{{rate}}` inside a part resolves
against that part's own `variables` first, the section's second, and the page's
third.** A bare name is always the closest one and never a surprise.

```yaml
name: Tones
plugin: doc
variables:
  tone: house                 # the page's
contents:
  - name: hero
    data: hero.html
    variables:
      tone: loud              # the section's — wins inside this section
    parts:
      headline: "# The section says {{tone}}"
      body:
        type: markdown
        variables:
          tone: quiet         # the part's — wins inside this part
        data: "And this part says {{tone}}."
```

The heading draws *loud* and the paragraph draws *quiet*; a part anywhere else on
the page would draw *house*.

All three scopes are merged, nearest last, before anything is drawn. Code mounted
in a section reads the merged result as `ctx.vars` ([`code.md`](./code.md)).

## Where `{{name}}` is resolved, and where it is not

**Interpolation happens where the part is drawn, never where it is stored.** The
server hands back raw text with the braces still in it. That is load-bearing:
prose is edited in place and writes back, so resolving early would round-trip `62`
over the top of `{{rate}}` and destroy the variable the first time somebody edited
the paragraph it sits in. It is also why the slot under the caret shows `{{rate}}`
rather than the value.

**A section's markup is interpolated too, as text, before it is parsed** — which
is what lets `<img alt="{{caption}}">` and `data-g-table="{{table}}"` work at all.
See [`sections.md`](./sections.md).

**A name nothing answers is left on the page verbatim** rather than blanked,
because a visible `{{tota1}}` is a typo somebody can fix and an empty space is
not.

**There is no cross-slot form and no cross-page form.** Scopes nest; that is the
whole mechanism. Reaching another page is a call and never a template —
`biom.variables(pageId)` — because prose has to be readable without chasing it
across the workspace.

## The name grammar, and the two traps in it

A variable's name matches `^[A-Za-z][A-Za-z0-9._-]*$`. **A slot id and a section
name are narrower** — lowercase only, `^[a-z][a-z0-9_-]*$` — so the two are not
the same shape and `labelArea` is a fine variable and an illegal slot id.

**Write a variable as one lowercase word where one will do, and camelCase where
two are needed. Never a dash.** A variable is reached from a script as
`ctx.vars.name`, and `ctx.vars.label-area` is a subtraction — a dashed name can
only be read as `ctx.vars["label-area"]`, and every section that touches it has to
remember.

**Never put a dot in a variable you intend to read with `{{}}`.** The name is
legal and the template reader stops at the dot, so `{{brand.name}}` draws on the
page with its braces on and nothing anywhere says why. A dotted name is reachable
only from code, through `biom.variables()`.

**Every name describes the role, never the position.** `labelArea`, never
`label2`: a page gets reordered, and a number in a name is wrong the first time
somebody does it. **Names are stable across rewrites** — renaming one orphans an
edit somebody made. If a region's meaning genuinely changes, add a name and leave
the old one.

## Variables and `input:` are different doors

A page drawn by a plugin other than the document carries that plugin's
configuration, and there are two places it can go. **`input:` is read as
`biom.input`; `variables:` is read as `biom.data()`.** Which one a plugin uses is
that plugin's own choice and it documents it — writing the configuration under the
wrong key draws an empty page and says nothing about why. See
[`plugins.md`](./plugins.md).

Both are nested under a key of their own rather than written beside `name:` and
`plugin:`, so the host's keys and a plugin's can never collide: a board wants to
title its cards by a column, and the obvious key for that is `name`, which the
page has already spent.

## A comment beside a variable does not survive

The server does not patch the file it parsed — it builds a fresh document from the
values and writes that — so **every `#` comment and every blank line between
sections is gone the first time anybody finishes typing a sentence in the app.**

That matters most for the thing you will most want to explain: the note saying why
that number is 6 cannot sit beside it. Put the explanation where it survives — in
the page's own words, in a markdown part, where a reader can also read it and
change it — or in a comment in the section's HTML file, which nothing ever
rewrites. **A section file is the only durable home for a comment in a page
directory.**

---

**Which values are worth making variables at all** — the arguable-number rule, and
the split between a variable and a `parts` entry — is
[`../.agents/skills/biom-pages/SKILL.md`](../.agents/skills/biom-pages/SKILL.md).
