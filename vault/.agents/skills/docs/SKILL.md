---
name: biom-docs
description: "THE LINE BETWEEN `docs/` AND `.agents/skills/`, and where a passage goes when you have one and no obvious home for it. A doc says how the thing WORKS; a skill says how we WRITE with it and what the checker will say about it, and a passage belongs to exactly one of them. Use whenever you are about to add a passage to a skill, write or change a file under `docs/`, or find the same fact stated in both — and before answering a question about the format by writing a new paragraph anywhere. Carries THE TEST that settles it without a judgement call every time — would this sentence become wrong because the CODE changed, or because WE changed our minds — with the third arrow that stops it being arguable: every numbered rule stays with its skill whatever it is about, because the number is the join between the prose and `.agents/skills/check.ts`. Carries where the two live and how both arrive in a workspace, that a doc changes in the same change as the code it describes, that every example in a doc runs against this build, that a doc is written to be read twice — once in a folder and once on a web page, so plain markdown and relative links and nothing that assumes a file manager — and that each links the other and neither restates it, which is the failure this whole split exists to remove and the easiest thing in the world to do by accident."
---

# Docs and skills

Two folders sit at the root of this workspace and both explain the format. This
file is the line between them, and it exists so that the split is not
re-litigated every time somebody has a passage and nowhere obvious to put it.

## The line

| | |
|---|---|
| **[`../../../docs/`](../../../docs/README.md)** | **How the thing WORKS.** Where a page lives, what draws it, where a value goes, what a page's code can do, where a plugin comes from, where data lives, how it is sized and coloured, when a change appears. Written for a person reading to understand their own folder |
| **`.agents/skills/`** | **How we WRITE with it, and what the checker will say.** The paved path, the judgement calls, whose taste wins, and every numbered rule. Written for a reader who cannot ask and is about to generate something |

**A passage belongs to exactly one of them.**

## The test

> **Would this sentence become wrong because the CODE changed, or because WE
> changed our minds?**

Code is a doc. A decision is a skill.

**And the third arrow, which is what stops this being a judgement call every
time: a numbered rule is a skill, whatever it is about.** The number is the join
between the prose and `.agents/skills/check.ts`, and moving half of that join
breaks the pair. **A doc may say what the code does and may link the rule; it
never states a rule number as its own.**

The rule index in [`../pages/SKILL.md`](../pages/SKILL.md) stays the authority on
which number means what.

## Where they live, and how they got here

**Both are at the root of this workspace, and both were copied in when it was
first opened.** A copy is made file by file and only where nothing is at that
path, so **a workspace made before a file existed gains it on the next start, and
anything you edited stays exactly as you left it.** That is also the cost, stated
rather than solved: a doc improved in the framework never reaches a workspace that
already has its own copy.

`.agents/skills/check.ts` is the one exception — it is code, its whole job is to
agree with a format that keeps moving, and it is rewritten on every start.

**The framework's own guides are a third thing and are not here.** They explain
the code to somebody who can read the code, they live beside it, and nothing in
this workspace points at them.

## A doc changes with its code

**When the behaviour moves, the doc moves in the same change.** It is the rule the
framework's own guides already live under, written for a workspace.

**A stale doc is worse than no doc**, because a reader with no doc goes and looks,
and a reader with a confidently wrong one does not.

## Every example runs

**Against this build, checked rather than believed.** A yaml example is a
`content.yaml` that opens; an html example is a section that draws; a `biom.*` call
is one the shim actually exports.

That is the one property a doc has that memory does not, and it is what makes
writing these worth more than assembling them. **An example is the part people
copy, so a wrong one is wrong with authority** — it is followed further than a
wrong sentence, because it looks like it was run.

**So write a doc from the CODE, never from a skill.** A passage copied out of a
skill and checked against nothing carries every error the skill had.

## Written to be read twice

Once in this folder, and once — when a site that renders them is built — on a
web page. Nothing renders them that way today; the layout is written for it in
advance, because retrofitting it over a folder of docs is the expensive version.
So:

- **Plain markdown.** No front matter a renderer has to know about.
- **Relative links only** — `./sections.md`, `../AGENTS.md`. Never an absolute
  path, never a `file://`, never a path that exists only inside a workspace.
- **Nothing that assumes a file manager.** *"the folder beside this one"* reads as
  nothing on a web page.
- **`README.md` is the index** and is the one file that links every other.

## Each links the other, and neither restates it

**One clause and a link, in both directions.**

> The mechanism is [`../../../docs/pages.md`](../../../docs/pages.md); the rules it
> produces are here.

**A duplicated passage is the failure this whole split exists to remove, and
duplicating it back is the easiest thing in the world to do.** It happens the
moment somebody writing a skill wants one fact from a doc and types it out rather
than linking it — and then there are two statements of it and only one of them
gets fixed.

**Before adding a passage to a skill, ask the test.** If the answer is *the code*,
it goes in the doc and the skill gets a clause.

---

**This is a skill and not a doc, by its own test**: every line of it is a decision
we made about our own files.
