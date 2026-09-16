**This folder is a workspace.** Every page, every word on one, the design language and the theme are files in here — there is no export step and no API to go through, so **editing a file IS editing the workspace.**

# If somebody else might use it, it is a plugin

**Anything you draw or code that has even a small chance of being used by another page, or by another person, is written as a PUBLIC PLUGIN from the start — never as a copy inside a section.** It goes in `plugins/<id>.js`, it registers an id, and every page in the workspace can reach it by name. The route is real and it needs nothing from you but the file: the server reads `plugins/` and the page is handed every `.js` in it.

**The threshold is deliberately low, because the failure is not hypothetical.** In the workspace this framework was built alongside, one drawing became **176** copies, another **162**, and a third **88** — and that third one had drifted into **eleven different shapes**, differing in the teardown, the empty-list case and the observer. Nobody decided any of that. Each copy was one reasonable "just this once", and the eleventh shape was written by somebody who had no way to know the other ten existed.

**A copy is not cheaper than a plugin. It is the same work, plus the drift.** The only question worth asking is *could anything else want this*, and where the answer is "probably not, but maybe" the answer to the real question is still yes.

**What a plugin owes a page in return** — the whole bar is in [.agents/skills/plugins/](.agents/skills/plugins/SKILL.md) §3, and it is short: refuse in words where its node is misplaced, touch only the slot it was named, ink nothing, and tear down what it started.

# Every page is drawn, not merely written

**We are not a plain markdown framework, for a reason.** Every doc page gets its figures **without being asked**. Plain prose is an unfinished page: the format exists so a page can carry a drawing, a board, a figure, a live table, and a page that is only paragraphs has used none of it and could have been a markdown file in a folder.

**What that obliges on every page: a figure, a board or a drawn section wherever the content has a shape** — a count, a sequence, a flow, a comparison, a boundary, a cycle. Look for the shape before writing the prose, not after.

**Chosen deliberately for THAT subject, and never decorative.** A figure that says nothing the prose does not is an ornament, and an ornament is worse than nothing because a reader stops to read it. The shape is picked per subject, against `design/` — [.agents/skills/design/](.agents/skills/design/SKILL.md) is whose taste wins — and never off a template.

**And a figure is DRAWN IN HTML and MOVES.** Elements in the section's own markup, laid out with grid and flex, inked with borders and backgrounds on the palette's tokens, and animated once when the section is first seen — a reveal behind the `--motion` switch, never a loop. **Its words come out of the section's `variables`**, so editing the document edits the picture. A raster pasted in is a picture OF a figure and takes neither the palette nor the width it is given; a figure that only sits there has spent the one thing it had over the sentence beside it; and a page of unbroken prose has drawn nothing at all. **A diagram of relationships is no exception** — [.agents/skills/diagrams/](.agents/skills/diagrams/SKILL.md). How a section holds a drawing and an animation without tripping the checker is [.agents/skills/sections/](.agents/skills/sections/SKILL.md).

# Two folders explain this workspace, and they are not the same folder

**[docs/](docs/README.md) is how the format WORKS**, one file per question — where a page lives, what draws it, where a value goes, what a page's code can do, where a plugin comes from, where data lives, how any of it is sized and coloured, when a change appears. It is written for a person reading to understand their own folder, and **every example in it runs against this build.** Read `docs/README.md` first and it will send you to the one file you need.

**[.agents/skills/](.agents/skills/) is how we WRITE in it** — the paved path, the judgement calls, whose taste wins, and every numbered rule the checker reports. One subject per directory: **list it.** A table of them written down here would be wrong the first time one was added.

**A passage is in exactly one of the two, and each links the other.** The line between them, and the test that settles where a new one goes, is [.agents/skills/docs/](.agents/skills/docs/SKILL.md).

**Read the skills before you write anything in here, and again whenever the work changes shape.** Nothing announces that change: a task that started as a paragraph becomes a layout, a layout becomes a table, and the skill that was right for the first one is not the one for the third.

**Do not write the format from memory.** A page built on a remembered rule looks exactly like a page built on the real one, right up to the point somebody tries to edit it.

**A skill and the checker are one statement in two places.** When you are done: `bun run .agents/skills/check.ts pages/<id>`. It is a report and not a gate — a page that fails every rule still draws, and its raw-YAML fallback still opens. Answer or note every warning rather than silencing it, and **where the checker and a skill disagree the checker wins**, with both fixed in the same change.

# You write the file. It appears on their screen.

**There is no model call inside the app.** The running workspace never asks you anything, so what you wrote is what somebody gets, cold, with no chance to explain it. What that requires of a page is in [.agents/skills/pages/](.agents/skills/pages/SKILL.md), and when a change actually reaches the screen is [docs/changes.md](docs/changes.md).

**And they see it without being told to do anything.** The server watches this folder and re-reads what changes, so a file you save is drawn a moment later — cold, from disk, with the box torn down and built again, and put back where the reader was scrolled to. **Do not tell anybody to press Reload**; the button is still there for rereading on demand, and it is not the loop. What that means while somebody is typing is that **disk wins**: the page redraws from the file you wrote, the slot under their caret included, and whatever their editor had not yet saved is gone. It is another reason a page has to be right cold.

**Nobody using this touches git, and that includes telling them to.** The server commits before every write you make, so undo already exists without an undo feature — but reverting is a sentence they hand you, like everything else here. Do not print a `git` command, do not suggest one, and do not run one on their behalf as part of ordinary work.

# Ask before you invent

**A new workspace is empty on purpose.** Build what the person asked for and no more; a page nobody asked for is something they have to delete before they can start.
