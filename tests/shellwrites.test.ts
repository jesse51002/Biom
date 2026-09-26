// SPDX-License-Identifier: AGPL-3.0-only
// Which files a shell command line writes, read conservatively: a table of
// lines an agent might run, each with exactly the writes it makes — and the
// many it must answer nothing for, because anything not read confidently is
// ignored, never guessed. The folder `/v` and every file name are invented.

import { test, expect } from "bun:test";

import { shellWrites } from "../server/domain/shellwrites.ts";
import type { ShellWrite } from "../server/domain/shellwrites.ts";

const W = (path: string): ShellWrite => ({ path, op: "write" });
const A = (path: string): ShellWrite => ({ path, op: "append" });
const E = (path: string): ShellWrite => ({ path, op: "edit" });
const D = (path: string): ShellWrite => ({ path, op: "delete" });
const M = (path: string): ShellWrite => ({ path, op: "move" });
const C = (path: string): ShellWrite => ({ path, op: "copy" });
const T = (path: string): ShellWrite => ({ path, op: "touch" });

/** [the command line, run in /v, and exactly what it writes] */
const CASES: [string, ShellWrite[]][] = [
  // Redirections.
  ["echo hi > out.txt", [W("/v/out.txt")]],
  ["echo hi >out.txt", [W("/v/out.txt")]],
  ["echo hi >> log.txt", [A("/v/log.txt")]],
  ["printf 'a\\n' >| forced.txt", [W("/v/forced.txt")]],
  ["make 2> err.log", [W("/v/err.log")]],
  ["make 2>>err.log", [A("/v/err.log")]],
  ["make &> all.log", [W("/v/all.log")]],
  ["make &>> all.log", [A("/v/all.log")]],
  ["echo hi 2>&1 > z.txt", [W("/v/z.txt")]],
  ["echo hi > /dev/null", []],
  ["echo hi 2>/dev/null", []],
  [": > empty.md", [W("/v/empty.md")]],
  ["> bare.md", [W("/v/bare.md")]],
  ["echo 'a > b' ", []],
  ['echo "x" > "name with spaces.md"', [W("/v/name with spaces.md")]],
  ["echo x > sub/deep/file.md", [W("/v/sub/deep/file.md")]],
  ["echo x > /tmp/elsewhere.txt", [W("/tmp/elsewhere.txt")]],
  ["cat < in.txt", []],
  ["wc -l <<< 'text'", []],

  // sed -i.
  ["sed -i 's/a/b/' notes.md", [E("/v/notes.md")]],
  ["sed -i 's/a/b/' one.md two.md", [E("/v/one.md"), E("/v/two.md")]],
  ["sed -i.bak 's/a/b/' notes.md", [E("/v/notes.md")]],
  ["sed -i -e 's/a/b/' -e 's/c/d/' notes.md", [E("/v/notes.md")]],
  ["sed -Ei 's/(a)/b/' notes.md", [E("/v/notes.md")]],
  ["sed -n -i 's/a/b/p' notes.md", [E("/v/notes.md")]],
  ["sed --in-place 's/a/b/' notes.md", [E("/v/notes.md")]],
  ["sed --in-place=.orig --expression='s/a/b/' notes.md", [E("/v/notes.md")]],
  ["sed -i '' 's/a/b/' notes.md", [E("/v/notes.md")]],
  ["sed -i .bak 's/a/b/' notes.md", []],
  ["sed 's/a/b/' notes.md", []],
  ["sed 's/a/b/' notes.md > copy.md", [W("/v/copy.md")]],
  ["sed -i \"s/$OLD/new/\" notes.md", [E("/v/notes.md")]],
  ["sed --unknown-flag -i 's/a/b/' notes.md", []],

  // tee.
  ["echo hi | tee out.md", [W("/v/out.md")]],
  ["echo hi | tee -a log.md", [A("/v/log.md")]],
  ["echo hi | tee --append log.md other.md", [A("/v/log.md"), A("/v/other.md")]],
  ["echo hi | tee out.md > /dev/null", [W("/v/out.md")]],
  ["echo hi | tee -x out.md", []],

  // mv and cp: the destination; mv also the source.
  ["mv a.md b.md", [M("/v/a.md"), M("/v/b.md")]],
  ["mv a.md dir/", [M("/v/a.md"), M("/v/dir/a.md")]],
  ["mv a.md b.md dir", [M("/v/a.md"), M("/v/dir/a.md"), M("/v/b.md"), M("/v/dir/b.md")]],
  ["mv -t dir a.md", [M("/v/a.md"), M("/v/dir/a.md")]],
  ["mv -f old.md new.md", [M("/v/old.md"), M("/v/new.md")]],
  ["cp a.md b.md", [C("/v/b.md")]],
  ["cp -r src dst", [C("/v/dst")]],
  ["cp a.md b.md dir/", [C("/v/dir/a.md"), C("/v/dir/b.md")]],
  ["cp --target-directory=dir a.md", [C("/v/dir/a.md")]],
  ["cp --parents a/b.md dir", []],
  ["cp only-one.md", []],

  // rm and touch.
  ["rm notes.md", [D("/v/notes.md")]],
  ["rm -rf pages/old", [D("/v/pages/old")]],
  ["rm -f -- -odd-name.md", [D("/v/-odd-name.md")]],
  ["touch a.md b.md", [T("/v/a.md"), T("/v/b.md")]],
  ["touch -d '2020-01-01' a.md", [T("/v/a.md")]],
  ["touch -r ref.md a.md", [T("/v/a.md")]],

  // Lists, pipes, cd.
  ["cd pages && sed -i 's/a/b/' x.md", [E("/v/pages/x.md")]],
  ["cd pages; echo hi > x.md; cd ..; echo hi > y.md", [W("/v/pages/x.md"), W("/v/y.md")]],
  ["cd /elsewhere && touch a", [T("/elsewhere/a")]],
  ["mkdir -p out && echo x > out/a.md", [W("/v/out/a.md")]],
  ["cd -P pages && touch x", [T("/v/pages/x")]],
  ["touch a; cd -; touch b", [T("/v/a")]],
  ["touch a && cd $DIR && touch b", [T("/v/a")]],
  ["cd; touch a", []],
  ["touch a | cd sub && touch b", [T("/v/a")]],
  ["[ -f x.md ] && touch x.md", [T("/v/x.md")]],
  ["[ -f x.md ] || touch x.md", []],
  ["false || touch x.md; touch y.md", [T("/v/y.md")]],
  ["make & echo done > done.txt", [W("/v/done.txt")]],
  ["echo a\necho b > b.md", [W("/v/b.md")]],
  ["echo a \\\n  > b.md", [W("/v/b.md")]],
  ["FOO=1 BAR='x y' touch a.md", [T("/v/a.md")]],
  ["command touch a.md", [T("/v/a.md")]],
  ["/usr/bin/sed -i 's/a/b/' x.md", [E("/v/x.md")]],
  ["echo hi > a.md # and a comment > b.md", [W("/v/a.md")]],
  ["touch a.md a.md", [T("/v/a.md")]],

  // Heredocs.
  ["cat > notes.md <<'EOF'\nhello $(not run)\nEOF", [W("/v/notes.md")]],
  ["cat <<EOF > notes.md\nplain text\nEOF", [W("/v/notes.md")]],
  ["cat > notes.md <<-EOF\n\tindented\n\tEOF\necho x > after.md", [W("/v/notes.md"), W("/v/after.md")]],
  ["cat > notes.md <<EOF\nhello $(rm -rf x)\nEOF", []],
  ["cat > notes.md <<EOF\nnever ends", []],
  ["cat > notes.md <<EOF", []],

  // A shell around a literal script.
  ["bash -c 'echo x > y.md'", [W("/v/y.md")]],
  ["sh -lc \"cd pages && touch z.md\"", [T("/v/pages/z.md")]],
  ["bash -c \"$SCRIPT\"", []],

  // What is never guessed.
  ["echo $(date) > x.md", []],
  ["echo `date` > x.md", []],
  ["echo hi > $OUT", []],
  ["echo hi > \"$HOME/x.md\"", []],
  ["echo hi > ${DIR}/x.md", []],
  ["rm *.tmp", []],
  ["rm -rf build/*", []],
  ["touch file{1,2}.md", []],
  ["touch ~/x.md", []],
  ["echo hi > file?.md", []],
  ["for f in a b; do touch $f; done", []],
  ["while read l; do echo $l >> out.md; done < in.md", []],
  ["if true; then touch a; fi", []],
  ["{ echo a; } > out.md", []],
  ["(cd sub && touch a)", []],
  ["eval 'touch a.md'", []],
  ["exec > log.md", []],
  ["diff <(sort a) <(sort b) > d.md", []],
  ["! touch a.md", []],
  ["echo 'unterminated > a.md", []],
  ["touch a.md && echo $(whoami) > b.md", []],
  ["case x in x) touch a;; esac", []],
  ["[[ a > b ]] && touch c", []],
  ["&& touch a", []],
  ["", []],
  ["python3 script.py", []],
  ["npm install", []],
];

test(`the table holds at least sixty cases, positive and negative (${CASES.length})`, () => {
  expect(CASES.length).toBeGreaterThanOrEqual(60);
  expect(CASES.filter(([, w]) => w.length > 0).length).toBeGreaterThanOrEqual(30);
  expect(CASES.filter(([, w]) => w.length === 0).length).toBeGreaterThanOrEqual(30);
});

for (const [line, want] of CASES) {
  test(`reads ${JSON.stringify(line)}`, () => {
    expect(shellWrites(line, "/v")).toEqual(want);
  });
}

test("a relative cwd reads nothing — the folder a command ran in must be known", () => {
  expect(shellWrites("touch a", "relative/dir")).toEqual([]);
});

test("nothing a line can hold throws", () => {
  const junk = ["'", '"', "\\", "<<", "> ", "|", "&&&", ";;", "$(", "`", "cat <<'", "a=\"$(\"", "\u0000", "echo \\"];
  for (const j of junk) expect(() => shellWrites(j, "/v")).not.toThrow();
});
