// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — WHICH FILES A SHELL COMMAND LINE WRITES, read conservatively.
//
// Until the door is built, an agent's plain shell writes are one of the three
// ways Biom sees an edit (*History and View Switcher*, `door`): `sed -i`, `>`
// and `>>`, `tee [-a]`, `mv` and `cp` (the destination), `rm` (a deletion) and
// `touch`, through quotes, `&&`, `;`, `|`, a leading `cd dir &&`, a `bash -c`
// around a literal script, and a heredoc's body skipped rather than read as
// commands. ANYTHING NOT READ CONFIDENTLY IS IGNORED, NEVER GUESSED, because a
// wrong name on an edit moves somebody's screen for a write that did not
// happen. So:
//
//   - THE WHOLE LINE YIELDS NOTHING for anything that could run a command this
//     reader cannot see or name a path it cannot know: `$(`, backticks — in an
//     unquoted heredoc's body too — process substitution, `eval` and `exec`, a
//     loop or a conditional (`for`, `while`, `if`, `case`, `{ }`, `( )`, `!`),
//     a variable, a glob, a brace or a `~` in a path, a quote left open, a
//     heredoc that never ends;
//   - a `cd` whose destination cannot be known — none, `-`, a variable, inside
//     a pipeline, after a `||` — STOPS the reading there: what came before it is
//     known, and every path after it would be a guess;
//   - a command after `||` may not have run, so its writes are dropped until
//     the next `;`, `&` or line;
//   - a command this reader does not know — `python`, `make`, `npm` — writes
//     what it writes, unseen, and only its own redirections are read;
//   - a known command with a flag this reader does not know is read for its
//     redirections only.
//
// It answers absolute paths, resolved against the directory the command ran
// in; which of them are inside the vault is the caller's question.

import { basename, isAbsolute, join, resolve } from "node:path";

/** What a command did to one path. */
export type ShellWriteOp = "write" | "append" | "edit" | "delete" | "move" | "copy" | "touch";

/** One write a command line makes: an absolute path, resolved against the
 *  directory the command ran in. */
export interface ShellWrite {
  path: string;
  op: ShellWriteOp;
}

/** A construct this reader will not guess at: the whole line yields nothing. */
class Tangled extends Error {}

/** A `cd` whose destination is unknowable: reading stops there. */
class Lost extends Error {}

interface Word {
  t: "word";
  /** The word with its quoting removed. */
  text: string;
  /** Any quote appeared in it. */
  quoted: boolean;
  /** A parameter expansion — `$x`, `${x}`, `$'…'` — appeared in it. */
  dyn: boolean;
  /** An unquoted glob or brace character appeared in it. */
  glob: boolean;
  /** It starts with an unquoted `~`. */
  tilde: boolean;
  /** As written, quotes and all. */
  raw: string;
}

type OpText = "&&" | "||" | ";" | "|" | "|&" | "&" | "\n";
interface Op {
  t: "op";
  op: OpText;
}

type RedirText = ">" | ">>" | ">|" | "&>" | "&>>" | "<" | "<<" | "<<-" | "<<<" | ">&" | "<&" | "<>";
interface Redir {
  t: "redir";
  op: RedirText;
}

type Token = Word | Op | Redir;

const META = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"]);
const PARAM_START = /[A-Za-z0-9_{@*#?$!-]/;

/** THE LEXER. POSIX shell words and operators, with a heredoc's body consumed
 *  at the newline after its operator. Throws `Tangled` for what it will not
 *  read. */
function lex(src: string): Token[] {
  const out: Token[] = [];
  const heredocs: { delim: string; strip: boolean; quoted: boolean }[] = [];
  let i = 0;
  const n = src.length;

  const readBodies = (): void => {
    for (const h of heredocs) {
      let found = false;
      while (i < n) {
        let end = src.indexOf("\n", i);
        if (end < 0) end = n;
        let lineText = src.slice(i, end);
        i = end < n ? end + 1 : n;
        if (h.strip) lineText = lineText.replace(/^\t+/, "");
        if (lineText === h.delim) {
          found = true;
          break;
        }
        // An unquoted delimiter runs the body's substitutions.
        if (!h.quoted && (lineText.includes("$(") || lineText.includes("`"))) throw new Tangled();
      }
      if (!found) throw new Tangled();
    }
    heredocs.length = 0;
  };

  let wantDelim: { strip: boolean } | null = null;

  while (i < n) {
    const c = src[i] as string;
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      continue;
    }
    if (c === "\n") {
      if (wantDelim) throw new Tangled();
      out.push({ t: "op", op: "\n" });
      i++;
      if (heredocs.length > 0) readBodies();
      continue;
    }
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    const three = src.slice(i, i + 3);
    if (c === "(" || c === ")") throw new Tangled();
    if (c === ";") {
      if (two === ";;" || two === ";&") throw new Tangled();
      out.push({ t: "op", op: ";" });
      i++;
      continue;
    }
    if (c === "&") {
      if (three === "&>>") {
        out.push({ t: "redir", op: "&>>" });
        i += 3;
      } else if (two === "&>") {
        out.push({ t: "redir", op: "&>" });
        i += 2;
      } else if (two === "&&") {
        out.push({ t: "op", op: "&&" });
        i += 2;
      } else {
        out.push({ t: "op", op: "&" });
        i++;
      }
      continue;
    }
    if (c === "|") {
      if (two === "||") {
        out.push({ t: "op", op: "||" });
        i += 2;
      } else if (two === "|&") {
        out.push({ t: "op", op: "|&" });
        i += 2;
      } else {
        out.push({ t: "op", op: "|" });
        i++;
      }
      continue;
    }
    if (c === "<" || c === ">") {
      if (two === "<(" || two === ">(") throw new Tangled();
      let op: RedirText;
      if (c === "<") op = three === "<<<" ? "<<<" : three === "<<-" ? "<<-" : two === "<<" ? "<<" : two === "<&" ? "<&" : two === "<>" ? "<>" : "<";
      else op = two === ">>" ? ">>" : two === ">|" ? ">|" : two === ">&" ? ">&" : ">";
      out.push({ t: "redir", op });
      i += op.length;
      if (op === "<<" || op === "<<-") wantDelim = { strip: op === "<<-" };
      continue;
    }

    // A word.
    const start = i;
    let text = "";
    let quoted = false;
    let dyn = false;
    let glob = false;
    let tilde = false;
    while (i < n) {
      const d = src[i] as string;
      if (META.has(d)) break;
      if (d === "\\") {
        if (src[i + 1] === "\n") {
          i += 2;
          continue;
        }
        if (i + 1 >= n) throw new Tangled();
        text += src[i + 1];
        quoted = true;
        i += 2;
        continue;
      }
      if (d === "'") {
        const close = src.indexOf("'", i + 1);
        if (close < 0) throw new Tangled();
        text += src.slice(i + 1, close);
        quoted = true;
        i = close + 1;
        continue;
      }
      if (d === '"') {
        quoted = true;
        i++;
        let closed = false;
        while (i < n) {
          const e = src[i] as string;
          if (e === '"') {
            closed = true;
            i++;
            break;
          }
          if (e === "`") throw new Tangled();
          if (e === "\\") {
            const f = src[i + 1];
            if (f === undefined) throw new Tangled();
            if (f === "\n") {
              i += 2;
              continue;
            }
            if (f === "$" || f === "`" || f === '"' || f === "\\") {
              text += f;
              i += 2;
              continue;
            }
            text += "\\";
            i++;
            continue;
          }
          if (e === "$") {
            const f = src[i + 1];
            if (f === "(") throw new Tangled();
            if (f !== undefined && PARAM_START.test(f)) dyn = true;
          }
          text += e;
          i++;
        }
        if (!closed) throw new Tangled();
        continue;
      }
      if (d === "`") throw new Tangled();
      if (d === "$") {
        const f = src[i + 1];
        if (f === "(") throw new Tangled();
        if (f !== undefined && (PARAM_START.test(f) || f === "'" || f === '"')) dyn = true;
        text += d;
        i++;
        continue;
      }
      if (d === "*" || d === "?" || d === "[" || d === "{") glob = true;
      if (d === "~" && i === start) tilde = true;
      text += d;
      i++;
    }
    const raw = src.slice(start, i);
    // A word of digits right against `<` or `>` is the redirection's fd, and
    // which fd changes nothing about which file is written.
    if (/^[0-9]+$/.test(raw) && (src[i] === "<" || src[i] === ">")) continue;
    if (wantDelim) {
      heredocs.push({ delim: text, strip: wantDelim.strip, quoted });
      wantDelim = null;
    }
    out.push({ t: "word", text, quoted, dyn, glob, tilde, raw });
  }
  if (wantDelim) throw new Tangled();
  // A heredoc whose command is the last line has no body at all.
  if (heredocs.length > 0) throw new Tangled();
  return out;
}

interface Command {
  words: Word[];
  redirs: { op: RedirText; target: Word }[];
  /** The operator before it, or null for the first. */
  after: OpText | null;
  /** The operator after it, or null for the last. */
  before: OpText | null;
}

function parse(tokens: Token[]): Command[] {
  const cmds: Command[] = [];
  let cur: Command = { words: [], redirs: [], after: null, before: null };
  let prevOp: OpText | null = null;
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k] as Token;
    if (tok.t === "op") {
      cur.before = tok.op;
      if (cur.words.length > 0 || cur.redirs.length > 0) cmds.push(cur);
      else if (tok.op !== "\n" && tok.op !== ";" && tok.op !== "&") throw new Tangled();
      prevOp = tok.op;
      cur = { words: [], redirs: [], after: prevOp, before: null };
      continue;
    }
    if (tok.t === "redir") {
      const target = tokens[k + 1];
      if (!target || target.t !== "word") throw new Tangled();
      cur.redirs.push({ op: tok.op, target });
      k++;
      continue;
    }
    cur.words.push(tok);
  }
  if (cur.words.length > 0 || cur.redirs.length > 0) cmds.push(cur);
  return cmds;
}

/** Words that open or shape a compound command, or run a string as one. */
const REFUSED = new Set([
  "for", "while", "until", "if", "then", "else", "elif", "fi", "do", "done", "case", "esac", "select", "function",
  "{", "}", "[[", "]]", "((", "!", "eval", "exec", "coproc", "alias", "trap",
]);
/** Words that run the command after them, and change nothing about it. */
const PREFIXES = new Set(["command", "builtin", "nohup", "time"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/** A path word: known exactly, or the line is tangled. */
function pathOf(w: Word, cwd: string): string {
  if (w.dyn || w.glob || w.tilde || w.text === "") throw new Tangled();
  return resolve(cwd, w.text);
}

/** THE READER. */
function read(src: string, cwd: string, depth: number): ShellWrite[] {
  const tokens = lex(src);
  const cmds = parse(tokens);
  const writes: ShellWrite[] = [];
  let dir = cwd;
  let certain = true;

  try {
    for (let k = 0; k < cmds.length; k++) {
      const cmd = cmds[k] as Command;
      if (cmd.after === "||") certain = false;
      else if (cmd.after === ";" || cmd.after === "&" || cmd.after === "\n") certain = true;
      const inPipe = cmd.after === "|" || cmd.after === "|&" || cmd.before === "|" || cmd.before === "|&";
      const found: ShellWrite[] = [];

      for (const r of cmd.redirs) {
        const op = r.op;
        if (op === "<" || op === "<<" || op === "<<-" || op === "<<<" || op === "<&") continue;
        if ((op === ">&" || op === "<>") && /^([0-9]+|-)$/.test(r.target.text) && !r.target.quoted) continue;
        const path = pathOf(r.target, dir);
        if (path.startsWith("/dev/")) continue;
        found.push({ path, op: op === ">>" || op === "&>>" ? "append" : "write" });
      }

      let words = cmd.words;
      while (words.length > 0 && ASSIGNMENT.test((words[0] as Word).raw)) words = words.slice(1);
      while (words.length > 0 && !(words[0] as Word).quoted && PREFIXES.has((words[0] as Word).text)) words = words.slice(1);
      const head = words[0];
      if (head) {
        if (!head.quoted && REFUSED.has(head.text)) throw new Tangled();
        // `[` is the test command, not a glob; it writes nothing.
        if (head.dyn || (head.glob && !(head.text === "[" && !head.quoted))) throw new Tangled();
        const name = head.text.includes("/") ? basename(head.text) : head.text;
        const args = words.slice(1);
        if (name === "cd" || name === "pushd" || name === "popd") {
          if (name !== "cd" || inPipe || !certain) throw new Lost();
          const operands = args.filter((a) => !(a.text === "-P" || a.text === "-L"));
          const to = operands[0];
          if (operands.length !== 1 || !to || to.text === "-" || to.dyn || to.glob || to.tilde || to.text === "") throw new Lost();
          dir = resolve(dir, to.text);
          continue;
        }
        found.push(...commandWrites(name, args, dir, depth));
      }
      if (certain) writes.push(...found);
    }
  } catch (e) {
    if (!(e instanceof Lost)) throw e;
  }
  return writes;
}

/** Split a command's arguments into flags and operands by a flag table:
 *  `bool` letters stand alone in a cluster, `value` letters take the rest of
 *  the cluster or the next argument; `long` names a long flag and whether it
 *  takes a value when written without `=`. Null for a flag the table does not
 *  know. */
function options(args: Word[], bool: string, value: string, long: Record<string, boolean>): { flags: Map<string, string>; operands: Word[] } | null {
  const flags = new Map<string, string>();
  const operands: Word[] = [];
  let k = 0;
  for (; k < args.length; k++) {
    const a = args[k] as Word;
    const t = a.text;
    if (t === "--") {
      k++;
      break;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const nameOf = eq < 0 ? t.slice(2) : t.slice(2, eq);
      if (!(nameOf in long)) return null;
      if (eq >= 0) flags.set(nameOf, t.slice(eq + 1));
      else if (long[nameOf]) {
        const next = args[k + 1];
        if (!next) return null;
        flags.set(nameOf, next.text);
        k++;
      } else flags.set(nameOf, "");
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        const ch = t[j] as string;
        if (value.includes(ch)) {
          const rest = t.slice(j + 1);
          if (rest !== "") flags.set(ch, rest);
          else {
            const next = args[k + 1];
            if (!next) return null;
            flags.set(ch, next.text);
            k++;
          }
          break;
        }
        if (!bool.includes(ch)) return null;
        flags.set(ch, "");
      }
      continue;
    }
    operands.push(a);
  }
  for (; k < args.length; k++) operands.push(args[k] as Word);
  return { flags, operands };
}

/** What one known command writes, beyond its redirections. */
function commandWrites(name: string, args: Word[], cwd: string, depth: number): ShellWrite[] {
  switch (name) {
    case "sed":
      return sedWrites(args, cwd);
    case "tee": {
      const o = options(args, "aip", "", { append: false, "ignore-interrupts": false, "output-error": false });
      if (!o) return [];
      const op: ShellWriteOp = o.flags.has("a") || o.flags.has("append") ? "append" : "write";
      return o.operands.map((w) => ({ path: pathOf(w, cwd), op }));
    }
    case "touch": {
      const o = options(args, "acmhf", "drt", { "no-create": false, date: true, reference: true, time: true, "no-dereference": false });
      if (!o) return [];
      return o.operands.map((w) => ({ path: pathOf(w, cwd), op: "touch" as const }));
    }
    case "rm": {
      const o = options(args, "rRfiIdv", "", {
        recursive: false, force: false, dir: false, verbose: false, interactive: false, "one-file-system": false,
        "preserve-root": false, "no-preserve-root": false,
      });
      if (!o) return [];
      return o.operands.map((w) => ({ path: pathOf(w, cwd), op: "delete" as const }));
    }
    case "mv":
    case "cp":
      return moveWrites(name, args, cwd);
    default:
      if (SHELLS.has(name)) return shellScript(args, cwd, depth);
      return [];
  }
}

function sedWrites(args: Word[], cwd: string): ShellWrite[] {
  let inPlace = false;
  let scriptGiven = false;
  const operands: Word[] = [];
  const LONG_BOOL = new Set(["quiet", "silent", "regexp-extended", "separate", "unbuffered", "null-data", "posix", "debug", "sandbox", "follow-symlinks", "zero-terminated"]);
  let k = 0;
  for (; k < args.length; k++) {
    const t = (args[k] as Word).text;
    if (t === "--") {
      k++;
      break;
    }
    if (t.startsWith("--")) {
      const eq = t.indexOf("=");
      const name = eq < 0 ? t.slice(2) : t.slice(2, eq);
      if (name === "in-place") inPlace = true;
      else if (name === "expression" || name === "file") {
        scriptGiven = true;
        if (eq < 0) k++;
      } else if (name === "line-length") {
        if (eq < 0) k++;
      } else if (!LONG_BOOL.has(name)) return [];
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        const ch = t[j] as string;
        if (ch === "i") {
          inPlace = true;
          // GNU takes a suffix in the same word; BSD's `-i ''` is an empty
          // suffix of its own. BSD's `-i .bak` is GNU's `-i` and a script
          // named `.bak`, and which sed this is cannot be read from the line.
          const next = args[k + 1];
          if (j === t.length - 1 && next) {
            if (next.text === "" && next.quoted) k++;
            else if (next.text.startsWith(".") && !next.text.includes(" ")) return [];
          }
          break;
        }
        if (ch === "e" || ch === "f" || ch === "l") {
          if (ch !== "l") scriptGiven = true;
          if (j === t.length - 1) k++;
          break;
        }
        if (!"nErsuz".includes(ch)) return [];
      }
      continue;
    }
    operands.push(args[k] as Word);
  }
  for (; k < args.length; k++) operands.push(args[k] as Word);
  if (!inPlace) return [];
  const files = scriptGiven ? operands : operands.slice(1);
  return files.map((w) => ({ path: pathOf(w, cwd), op: "edit" as const }));
}

function moveWrites(name: "mv" | "cp", args: Word[], cwd: string): ShellWrite[] {
  const o = name === "mv"
    ? options(args, "finvubTZ", "tS", {
      force: false, interactive: false, "no-clobber": false, verbose: false, update: false, backup: false, "no-target-directory": false,
      "strip-trailing-slashes": false, "target-directory": true, suffix: true, exchange: false, debug: false, context: false,
    })
    : options(args, "abdfiHlLnPpRrsuvxTZ", "tS", {
      archive: false, backup: false, "copy-contents": false, force: false, interactive: false, link: false, dereference: false,
      "no-clobber": false, "no-dereference": false, preserve: false, "no-preserve": false, recursive: false, "remove-destination": false,
      reflink: false, sparse: false, "strip-trailing-slashes": false, "symbolic-link": false, suffix: true, "target-directory": true,
      "no-target-directory": false, update: false, verbose: false, "one-file-system": false, "attributes-only": false, debug: false,
      context: false,
    });
  if (!o) return [];
  const ops = o.operands;
  const target = o.flags.get("t") ?? o.flags.get("target-directory");
  const pairs: { from: string; to: string }[] = [];
  if (target !== undefined) {
    if (target === "" || /[$*?[{~]/.test(target)) throw new Tangled();
    const dir = resolve(cwd, target);
    for (const w of ops) {
      const from = pathOf(w, cwd);
      pairs.push({ from, to: join(dir, basename(from)) });
    }
  } else if (ops.length === 2) {
    const from = pathOf(ops[0] as Word, cwd);
    const destWord = ops[1] as Word;
    const to = pathOf(destWord, cwd);
    const intoDir = destWord.text.endsWith("/") && !(o.flags.has("T") || o.flags.has("no-target-directory"));
    pairs.push({ from, to: intoDir ? join(to, basename(from)) : to });
  } else if (ops.length > 2) {
    if (o.flags.has("T") || o.flags.has("no-target-directory")) return [];
    const dir = pathOf(ops[ops.length - 1] as Word, cwd);
    for (const w of ops.slice(0, -1)) {
      const from = pathOf(w, cwd);
      pairs.push({ from, to: join(dir, basename(from)) });
    }
  } else return [];
  const out: ShellWrite[] = [];
  for (const p of pairs) {
    if (name === "mv") out.push({ path: p.from, op: "move" }, { path: p.to, op: "move" });
    else out.push({ path: p.to, op: "copy" });
  }
  return out;
}

/** `bash -c 'script'`: the script read as a line of its own, in the same
 *  directory, where it is a literal. */
function shellScript(args: Word[], cwd: string, depth: number): ShellWrite[] {
  const flag = args[0];
  const script = args[1];
  if (!flag || !script || !/^-[a-z]*c[a-z]*$/.test(flag.text)) return [];
  if (script.dyn || depth >= 3) throw new Tangled();
  return read(script.text, cwd, depth + 1);
}

/** The files `command`, run in `cwd`, writes — absolute, each once per
 *  operation. Nothing for a line it will not read confidently. */
export function shellWrites(command: string, cwd: string): ShellWrite[] {
  if (typeof command !== "string" || command.trim() === "" || !isAbsolute(cwd)) return [];
  let found: ShellWrite[];
  try {
    found = read(command, cwd, 0);
  } catch (e) {
    if (e instanceof Tangled) return [];
    throw e;
  }
  const seen = new Set<string>();
  const out: ShellWrite[] = [];
  for (const w of found) {
    const key = `${w.op}\u0000${w.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}
