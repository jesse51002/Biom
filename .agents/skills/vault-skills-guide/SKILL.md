---
name: vault-skills-guide
description: >-
  The single source of truth for WRITING THE USER-FACING SKILLS — everything
  under `vault/`, which is copied into every workspace and is the only
  instruction an agent building a page ever reads. A guide to the craft: who you
  are writing for and what that reader does with ambiguity, what a skill is
  actually for, THE PAVED PATH and why pointing at it matters more than any
  rule, the method for writing one (start from the decision it settles, lead
  with the shape that works, turn principles into questions with answers, name
  the boundary, write the reason into the rule, put it where the reader is
  standing, run every example), how to know it worked — generate a page from it
  with a brief that says almost nothing — how to keep it true as the code moves
  past it, and a watch-list of the ways these files go wrong. Load this before
  editing anything under `vault/`, before adding or changing a checker
  rule a skill has to explain, and before designing the brief that tests either.
  Trigger on "the vault skills", "SKILL.md", "the skill an agent reads",
  "vault/AGENTS.md", "base/", "starter section", "the paved path", "rule index",
  "retired rule", "the skill and the checker disagree", "regenerate a page",
  "test the skill", or any change to what a workspace teaches.
---

# Writing what a workspace teaches

`vault/` is the vault root as it ships. It is copied into every
workspace, and **its `AGENTS.md`, `docs/` and `.agents/skills/` are the only instruction an agent
building a page ever reads.** Nothing else in this repo reaches that agent. If a
rule is not in there, for that agent it does not exist.

This guide is about writing those files well. The other guides in
`.agents/skills/` explain mechanism to somebody who can read the code; these
files have to produce good work from somebody who cannot.

**`vault/docs/` is the third thing under here and it is NOT a skill.** It is how
the format WORKS, written for the person whose workspace this is, and written so
that a website could one day render the same files out of a public checkout —
**no such build exists yet**, which is why the constraint on these files is a
layout rule rather than a pipeline. **Check the line before adding a passage
to a skill**, because the easiest mistake in this folder is typing a mechanical
fact into a skill that already has a doc: would this sentence become wrong because
the CODE changed, or because WE changed our minds? Code is a doc; a decision is a
skill; **a numbered rule is a skill whatever it is about**, because the number is
the join between the prose and `check.ts` and moving half of that join breaks the
pair. A passage lives in exactly one of the two and each links the other in a
clause. `vault/.agents/skills/docs/SKILL.md` states that line for the vault and is
the file to read before moving anything between them.

**A doc's examples run against the build, and that is checkable rather than
believed.** Write one from the CODE, never from a skill: a passage copied out of a
skill and checked against nothing carries every error the skill had. Plain
markdown, relative links only, and no path that exists only inside a workspace —
a website that renders them is a later build, and these files are written for it
in advance.

---

## 1. Who you are writing for

Everything else follows from this, so settle it before writing a line.

**They cannot see the framework.** No source, no types, no comments in the runtime.
If a behaviour is not described in the vault it does not exist for them — and
they will not go looking, because there is nowhere to look.

**They will do exactly what the file says.** Not approximately. A sentence
written loosely becomes a decision made loosely.

**They resolve ambiguity in whichever direction is easier**, and so would you.
Where a file offers a rule and an exit, they take whichever fits the pressure
they are under. That is not laziness; it is what any reasonable reader does with
an under-specified instruction.

**They read once, mostly at the start.** A rule at line 400 is read before the
work begins and recalled — imperfectly — three decisions later. Position is not
cosmetic.

**They are competent and will invent.** Given a gap they fill it, plausibly and
confidently, and **the gap is invisible in the result**: the page looks
considered, and nothing marks the place where the file failed to say something.

**They cannot ask.** There is no round trip. Anything left to be clarified is
left to be guessed.

---

## 2. What a skill is for

Not a reference. A reference answers a question somebody already knows to ask; a
skill has to produce good work from somebody who does not yet know what the
questions are.

Three jobs, in this order of value:

1. **Settle the decisions that would otherwise be made badly.** Naming them is
   most of the work — §3.
2. **Point at the paved path**, so the good result is the one that takes the
   least effort — §4.
3. **Keep a page from being wrong**, which is what the rules and the checker are
   for. Last, smallest, and the part that grows on its own if you let it.

A skill that does only the third produces work that passes every check and is
still poor.

---

## 3. Start from the decision it settles

Before writing, finish this sentence: **"this file exists so that nobody has to
work out ___ for themselves."** That is the subject, and it is what tells you
whether a new paragraph belongs in this file or another one.

| | Settles |
|---|---|
| `pages/` | How a page is written well, and the complete rule index |
| `sections/` | What one section may do, and what it owes the reader |
| `plugins/` | How code reaches a slot |
| `children/` | What it means for a page to hold pages |
| `tables/` | How data is read and written |
| `diagrams/` | When a drawing is worth making |
| `design/` | Whose taste wins |
| `markdown/` | How prose is sized |
| `docs/` | Where a passage goes: the line between `docs/` and this folder |

**`vault/AGENTS.md` sits above them and holds almost nothing**, on purpose. It
says what the folder is, that `docs/` explains how the format works and the skills
say how to write in it, that the skills are read before anything is written and
again whenever the work changes shape, that the checker wins where it and a skill
disagree, and that nobody using this touches git. **Everything else that used to
be there is in a skill now** — it had grown into a second copy of the format,
which is the failure this whole guide is about. Do not put a rule there because it
feels important; put it where the person doing that job is standing.

**`vault/base/` is documentation that gets copied.** A starter becomes somebody's
page and its patterns spread to every page copied from that one, so a pattern
there outranks a paragraph anywhere else.

---

## 4. The paved path

**Most of what makes a generated page good is not a rule anybody enforced.** It
is a set of choices that already fit together — worked out once, made to work
with each other, and cheap to take. Someone who follows them gets a page that
behaves like every other page in the workspace without designing any of that
behaviour.

**Pointing at it is the most valuable thing a skill does.** Rules stop a page
being wrong. The path is what makes it good.

### Why it outranks the rules

- **Prohibitions leave the positive answer to be invented**, and it will be — by
  every author, differently. Ten pages that each break no rule and each solve one
  problem their own way is a worse workspace than ten that share an answer,
  because **the inconsistency is what the person using it actually feels.**
- **Consistency across pages IS the user experience.** Nobody should have to work
  out how to add a row twice.
- **It is the combination that has been made to work.** Its parts were built
  against each other; a path assembled fresh from the same primitives meets the
  sharp edges one at a time.
- **It is the cheapest route**, and that decides it. Someone under pressure takes
  the shortest path, so the shortest path had better be the good one.

### State it as a default, never as law

Both failures are real and pull opposite ways:

- **As law it becomes a cage.** It gets followed where it does not fit, the
  format loses the freedom it exists to give, and the one page that genuinely
  needed something else is fought instead of served.
- **Unstated it becomes a different invention per page** — each defensible, none
  consistent.

So: **the shape that works, what it buys, when to leave it, and what leaving it
costs.** Enough to follow without thinking, and enough to leave deliberately.

### Where it lives

**Not here.** The paved path is the product's design direction and it moves;
recording it in this guide would create a second copy to go stale.
each skill holds the shape that works for its own subject, and `vault/AGENTS.md`
holds none of it.

**When the direction moves, the path moves and every rule around it is
re-checked.** A rule left over from a previous path is the most convincing kind
of wrong: it was right once.

---

## 5. The method

### Lead with the shape that works

The first thing a reader meets should be **what to do**, with a worked example,
before any prohibition. Order the file so that following it top to bottom
produces the right page, and so that a reader who stops halfway still has the
good default.

### Write the reason into the rule

A bare rule loses to whatever the reader is trying to do. A rule carrying its
reason survives contact with a hard case, because they can weigh it. **State what
breaks without it**, concretely.

### Turn a principle into a question with an answer

An adjective is not a rule. *Modular*, *editable*, *expressive* — none of them
tell anybody what to do.

> Not "prefer X". Instead: **"ask this; if the answer is yes, it is X."**

A question can be answered while looking at the thing being built. An adjective
can only be agreed with.

### Name the boundary

A rule with no stated other side is unusable, so the reader invents one — and
their invention becomes the exit. **Name the cases where it does not apply**,
concretely, in the same breath as the rule. This is what stops a default becoming
a cage and stops a rule being reasoned around.

### Prefer a measurement to an adjective

"It moved a heading's computed width by 32px" beats "it can cause layout issues".
The specific version is checkable, memorable, and cannot be argued with.

### Write for somebody who cannot see the code

No paths into the framework, no type names they cannot open, no "as the runtime
does" — **say what happens**. If a claim is about the browser, check it in a
browser rather than reasoning from the spec: the box is a sandboxed frame at an
opaque origin, and several ordinary web behaviours differ inside it.

### Put it where the reader is standing

`vault/AGENTS.md` is read once by everybody, which is exactly why it carries no
rules: a rule everybody reads and nobody is acting on is a rule that goes stale
unwatched. A skill is read by whoever is doing that job. **Choose the smallest
place that reaches the person who needs it**, and cross-reference rather than
duplicate — duplicated prose is two things to keep true, and one of them will
rot. That is not a guess: the guide grew a copy of the section rules, the words
rule and the folder layout, and every one of them had to be reconciled by hand
when the format moved.

### Point at where, not at how many

Never write a pointer that has to be re-counted or re-listed to stay true: not
"the four rules below", not a copied tree of a directory's contents. Write the
location and the rule for finding the thing. The full statement is in
the repo's root `AGENTS.md` and binds every file here.

### Run every example

An example is the part people copy, so a wrong one is wrong with authority — and
it is followed further than a wrong sentence, because it looks like it was run.

```bash
mkdir -p /tmp/ex/pages/home && cd /tmp/ex
# write content.yaml and the section file from your example, then:
bun run <repo>/skill/check.ts pages/home
```

Especially the example that demonstrates a rule: a file that warns about a trap
and then commits it in its own opening example is a specific and very believable
kind of wrong.

---

## 6. How to know it worked

**A skill cannot be reviewed by reading it.** Whoever wrote it knows what it
meant, so reading it back confirms the intention rather than the text.

**Generate a page from it, with a brief that says almost nothing.**

```
You are writing a <kind> document.
That is the only thing I am telling you about what to make.
Pick your own subject and decide everything else yourself.
Read <workspace>/AGENTS.md, then the skills — they are the authority
rather than this prompt.
```

**Say nothing about sections, structure, or what to demonstrate.** Every hint you
add is a gap in the skill that your brief is now covering, and the page comes out
well while the skill stays broken. Logistics are not hints and should be exact:
where the page goes, the gate command, the server, do not commit.

**Ask for the criticism explicitly, and say it matters more than the page:**

> Tell me precisely where the skills let you down — anything unclear, wrong, or
> that you had to work out for yourself because it was not written down,
> including what you got wrong on the first attempt and had to fix.

**Then read the page, not only the report.** A report covers what its author
noticed; the faults that matter are the ones they did not, and they turn up
routinely in work whose own report says it went well. Open the result and try to
*use* it the way the person it is for would.

### The loop

1. Brief one agent, minimally. **One page at a time** — a change tested against
   three pages tells you the skill moved, not which sentence moved it.
2. Read the page. Use it.
3. Find **where the skill let it happen**, not what the author did wrong.
   Somebody who followed the file and produced the wrong thing is evidence about
   the file.
4. Fix the skill. **Delete the page.**
5. Rebuild from the same brief, so the skill is the only thing that changed.

**Delete rather than patch.** A page corrected by hand tells you nothing about
whether the skill works, and a workspace holding both corrected and generated
pages teaches two standards at once.

---

## 7. Keeping it true

### The three copies

```
vault/…                               what ships
        │  copied file by file, on first open
        ▼
<workspace>/…                         what an agent actually reads
<workspace>/.agents/skills/check.ts   what the documented gate command runs
```

**The skills and the checker are the framework's inside a workspace, and they
are REWRITTEN WHOLE on every open.** `rewriteSkills` in
`server/workspace/framework.ts` runs off the mount path once a vault is up:
every `.agents/skills/<skill>/` the framework ships, `check.ts` and `_lib/` are
compared with what `vault/.agents/skills/` and `skill/` hold and rewritten where
they differ, committed once naming the framework version. So a skill you edit
here reaches every workspace on its next open, and **a change made to a
framework skill inside a workspace is gone on that workspace's next open** —
what is wanted everywhere goes here, and what is wanted in one workspace goes
into a skill under a name of that workspace's own, which the rewrite never
touches. Nothing is removed: a skill this repository stops shipping stays where
it is in every workspace that had it.

**`docs/` is still filled once and never overwritten**, with `AGENTS.md`,
`base/` and `design/`: those are the person's from the moment they land. So a
doc improved here reaches new workspaces only, and an existing workspace's copy
is checked by hand:

```bash
diff -q vault/docs/<name>.md  <vault>/docs/<name>.md
```

**Testing a change from inside a workspace is honest now for the skills and
the checker** — the running server rewrote them when it opened the folder — and
still not for a doc. When you want certainty about which checker ran, invoke
`skill/check.ts` by path.

### A rule is one statement in two places

A skill explains what `skill/check.ts` enforces, and either can move without the
other. **The checker wins, and both are fixed in the same change.**

`tests/skill.test.ts` holds the mechanical half — every rule the checker cites
has prose somewhere, every rule named in a skill is live or retired. **It cannot
check that the prose is true.** So when you touch a rule, grep its number across
`vault/` and read every hit: a rule is usually described in more than one
place and only one of them is the one you remember. Numbers are retired and
burned, never reused, so grep when you retire one too — including starter
READMEs, which often explain why they trip a particular rule.

### When the code moves

Whenever the box, the runtime or the reader changes behaviour, grep
`vault/` for the mechanism by name. Prose describing mechanism the code
no longer has is the most damaging kind of wrong, because it is confidently
specific and still reads well.

Run the checker over `base/` when a rule changes, and read the starters against
any new rule as though they were submissions.

---

## 8. Watch-list

Short, because these are things to notice rather than the substance of the job.
When a new one appears, add it as a class rather than as an incident.

| The failure | The tell |
|---|---|
| **All guardrail, no direction** | Read it as somebody who has never built one: if the answer to "what would I do now" is "avoid several things" rather than "follow this shape", the direction is missing. Usually because rules accreted, each added in response to something going wrong |
| **A principle with an escape hatch** | An adjective with no test attached; a "where appropriate" clause that does not say who decides; two competent readers could follow it and build opposite things |
| **Prose and enforcement disagree** | A rule was tightened in code and the paragraph still reads sensibly, which is why nobody noticed |
| **An example that fails the gate** | Never run — especially the one demonstrating the rule |
| **A retired number still explained** | The text reads fine and describes a finding that can no longer appear |
| **A category invented in the brief** | The brief names a kind of thing the skills do not define, so the reader invents a definition and it is invisible in the result. Check first whether it is a property of every case — then it is a baseline to state once, not a kind to choose between |
| **A starter contradicting a skill** | `base/` is copied, so the pattern outranks the paragraph |
| **A stale copy** | §7. It will catch you while you are investigating something else |
| **A mechanical fact typed into a skill** | It reads fine, and the same fact is already in `docs/`. Apply the test before adding any passage: code is a doc, a decision is a skill, a numbered rule is a skill |

---

## Key files

- **What ships, and the subject of this guide:** `vault/` — `AGENTS.md`
  (what is settled before a page is designed), `docs/` (how the format works, for
  the person whose folder it is), `.agents/skills/` (one directory per subject),
  `base/` (starters, held to the same standard), `design/`, and the
  workspace-level `markdown.yaml` and `theme.json`.
- **The enforcing half:** `skill/check.ts` — the rules, their numbers and
  the sentence each prints. `skill/_lib/` is how it resolves both here
  and inside a vault.
- **The agreement test:** `tests/skill.test.ts` — every cited rule has
  prose, every documented rule is cited or retired, no number is both.
- **The seeder, and the additive rule for what is the person's** — `AGENTS.md`,
  `docs/`, `base/`, `design/`: `server/workspace/presets.ts`. **The rewrite of
  what is the framework's** — the skills, the checker, its `_lib/`:
  `rewriteSkills` in `server/workspace/framework.ts`, run by `afterMount` in
  `server/main.ts`.
- **Siblings, for the mechanism a skill describes:** the section runtime →
  `section-runtime-guide`; the format on disk → `page-format-guide`; the plugin
  registry → `plugin-guide`; the box and its ports → `boundary-guide`.

---

## This is a living document

This skill is the single source of truth for writing what a workspace teaches.
When the paved path moves, when a method turns out to produce better files than
the one written here, or when a new way for these files to go wrong appears —
**update this skill in the same change, written as the practice rather than as
the incident.** If a rule here is what diverged, fix the rule; if the divergence
is a mistake, fix the practice. Either way they agree when you are done.
