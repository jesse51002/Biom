# When does a change appear?

## A file that changes on disk is redrawn

**The server watches this folder while it runs.** Save a `content.yaml` or a
section's HTML file in any editor and the page it belongs to is re-read and drawn
again, a moment later, without anybody pressing anything.

What it watches is the workspace's **authored input** — the files a person or an
agent writes. A burst of writes is coalesced into one redraw, so saving four files
at once is one redraw and not four.

**The redraw is cold.** There is no hot patch and no diff on the wire: the box is
torn down and built again from what is on disk, exactly as the Reload button does
it. That is what makes it trustworthy — the page you are looking at after a change
is the page a stranger would get opening the file fresh.

**The app's own writes do not trigger it.** A write through the app lands in
`pages/` and looks exactly like an agent's, so the server keeps the hash of what it
last wrote into or last read out of every file. Equal, and the notification is
dropped; different, and the page redraws. A file re-read in the middle of somebody
else's save — so it does not parse yet — leaves the drawn page alone **and** leaves
the baseline where it was, so the completed write reads as changed on the next
notification.

## The Reload button is still there

It re-reads the page on demand and does exactly what the watcher's redraw does. It
is for when you want to be certain, not for the ordinary loop.

## Disk wins over an unsaved edit

**When the watcher fires, the page redraws from disk — the slot under the caret
included.** A paragraph somebody was typing into, whose debounced save had not yet
landed, is replaced by what the file says. The pending save is dropped rather than
written.

That is the deliberate answer rather than an accident: the alternative is a
person's stale text landing on top of a change somebody else just made, which is
invisible until it has happened. **It is another reason a page has to be right
cold.**

## Every write is committed first

**The workspace is a git repository, and the server commits before every write it
makes.** So every version is kept and undo exists without an undo mechanism having
been built — which is also what makes the change somebody asked for a readable
diff.

**Nobody using this has to touch git**, and that is the point rather than an
omission: reverting is a sentence you hand the agent, like everything else here.
Snapshot and rollback are deliberately not features.

A workspace whose `git init` failed still works completely — pages read and write,
the seed lands, the mirror rebuilds. The only thing missing is undo.

## Two failures worth recognising

**A `content.yaml` that will not parse loses the page's words as well as its
shape.** That is the cost of everything being in one file, stated rather than
hidden — and the answers to it are the commit before every write, and the raw-YAML
fallback, which still opens the file for repair by hand.

**A key the reader does not know refuses the whole page** rather than being
dropped. A key silently dropped is a page that half-draws and never says why.

## `_markdown/` — the projection, and its one limit

`<vault>/_markdown/` holds **one `.md` per page**, derived and read-only, with a
note inside it saying so. It exists because tools that read a folder of markdown —
an editor, a search index, anything that builds a knowledge base — cannot see a
workspace whose prose lives in `content.yaml`.

**Nothing is ever authored by editing a file in there.** It is rewritten from the
pages, and an edit made in it is lost.

**Nothing watches it into existence, so it is written at three moments:**

- on mount, when a workspace is opened;
- in the same request as a write through the app;
- when a page reports its own markdown after being drawn.

**The one thing that cannot be projected without being drawn is a page a plugin
draws.** Only the code that draws a board can say what that board says in words,
so **a board's markdown is as fresh as the last time somebody opened that page.**
A doc page is projected from its data either way, which is why no page is ever
blank in the mirror.

---

**What the loop asks of a page** — that it must be correct from a cold start, that
it must draw before the host answers, and that a page is patched rather than
regenerated — is
[`../.agents/skills/pages/SKILL.md`](../.agents/skills/pages/SKILL.md).
