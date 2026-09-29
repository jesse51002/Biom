// SPDX-License-Identifier: AGPL-3.0-only
// Layer 3 — THE WORKSPACE'S SETTINGS FILE: `.biom/settings.json`, where the
// chat's choices are kept (*Chat*, `picker`: *the choices are kept* — the
// agent last picked, each agent's last model, mode and effort, and the view).
//
// BESIDE THE CHATS AND NEVER IN GIT. `.biom/` is the framework's folder inside
// a workspace and ignores itself — `.biom/.gitignore` says `*`, written by the
// composition root on every mount that finds it missing — and the watcher
// skips it by name, so a choice kept is never a page changed and never a
// version in the workspace's history.
//
// WRITTEN WHOLE OR NOT AT ALL, through the framework's own write path: the
// `Files` this is handed is rooted at `.biom/` and built with no baseline, and
// its `write` puts the bytes beside the file and renames. A reader sees the
// old file or the new one, never half. Writes land in the order the choices
// were made, each the whole of what is kept at that moment, so the last one
// on disk is the last choice.
//
// READ ONCE, when the workspace mounts. A missing file is the defaults — Tool
// calls, no agent, nothing kept — and nothing is written until a choice is
// made. A file that is not a settings file — torn, hand-broken, another
// version — is said once in the log, PUT ASIDE as `settings.json.bad` rather
// than overwritten, and the defaults are used; a field inside a good file
// that is out of bounds is left out (`server/domain/choices.ts`).
//
// WHAT THE CHATS KEEP comes through `picked` and `chose`, which the
// composition root hands the chats, and what a new chat starts on is `saved`.
// The view is the one choice a window makes here itself, through
// `settings.set`.

import type { AgentKey, ChatSettings, ChatView, ConfigValue, Files, PickerCategory } from "../../contracts/types.ts";
import { MAX_AGENTS, defaults, isKey, isKeptValue, isPicker, isView, readChoices, writeChoices } from "../domain/choices.ts";

/** The file, under `.biom/`. */
export const SETTINGS_FILE = "settings.json";
/** Where a file that would not read is put. */
export const SETTINGS_ASIDE = "settings.json.bad";

export interface SettingsDeps {
  /** Files rooted at the workspace's `.biom/`, with no baseline. */
  files: Files;
  /** Where a diagnostic line goes — the server's log. */
  log?: (line: string) => void;
}

export interface Settings {
  /** Settles once the file has been read. Nothing is kept before it. */
  readonly loaded: Promise<void>;
  /** What is kept now, as a copy. */
  read(): ChatSettings;
  /** Keep the view, and answer what is kept once it is on disk. */
  set(patch: { view?: ChatView }): Promise<ChatSettings>;
  /** A chat was made with this agent, or switched to it. */
  picked(agent: AgentKey): void;
  /** One of this agent's pickers was set. */
  chose(agent: AgentKey, category: PickerCategory, value: ConfigValue): void;
  /** This agent's kept values, as a copy — `{}` for one with none. */
  saved(agent: AgentKey): Partial<Record<PickerCategory, ConfigValue>>;
  /** Settles once every write asked for so far has landed. */
  flushed(): Promise<void>;
}

const copy = (s: ChatSettings): ChatSettings => ({
  view: s.view,
  agent: s.agent,
  agents: Object.fromEntries(Object.entries(s.agents).map(([k, v]) => [k, { ...v }])),
});

export function makeSettings(deps: SettingsDeps): Settings {
  const say = deps.log ?? ((line: string) => console.warn(line));
  let kept: ChatSettings = defaults();
  let ready = false;
  /** The writes, in order: each the whole of what was kept when it was asked. */
  let chain: Promise<void> = Promise.resolve();

  const loaded: Promise<void> = (async () => {
    let text: string | null = null;
    try {
      text = await deps.files.read(SETTINGS_FILE);
    } catch (e) {
      say(`settings: ${SETTINGS_FILE} could not be read (${e instanceof Error ? e.name : typeof e}), so the defaults are used`);
      return;
    }
    if (text === null) return;
    let parsed: unknown = undefined;
    let read: ChatSettings | null = null;
    try {
      parsed = JSON.parse(text);
      read = readChoices(parsed);
    } catch {
      read = null;
    }
    if (read !== null) {
      kept = read;
      return;
    }
    // NOT A SETTINGS FILE: said once, put aside rather than overwritten, so
    // whatever somebody wrote there is still there to read.
    say(`settings: ${SETTINGS_FILE} is not a settings file this build reads, so it was put aside as ${SETTINGS_ASIDE} and the defaults are used`);
    try {
      await deps.files.write(SETTINGS_ASIDE, text);
      await deps.files.remove(SETTINGS_FILE);
    } catch (e) {
      say(`settings: ${SETTINGS_FILE} could not be put aside (${e instanceof Error ? e.name : typeof e}); it will be written over at the next choice`);
    }
  })().finally(() => {
    ready = true;
  });

  /** WRITE WHAT IS KEPT NOW, after every write before it. */
  const save = (): Promise<void> => {
    const text = writeChoices(kept);
    const run = chain.then(() => deps.files.write(SETTINGS_FILE, text)).catch((e: unknown) => {
      say(`settings: ${SETTINGS_FILE} could not be written (${e instanceof Error ? e.name : typeof e}); the choice holds until the server stops`);
    });
    chain = run;
    return run;
  };

  /** A change, made now if the file has been read and after it otherwise, so
   *  the read never lands over a choice. Answers whether anything moved. */
  const change = (fn: () => boolean): Promise<void> => {
    const apply = (): Promise<void> => (fn() ? save() : chain);
    return ready ? apply() : loaded.then(apply);
  };

  return {
    loaded,

    read: () => copy(kept),

    async set(patch) {
      await change(() => {
        if (patch.view === undefined || !isView(patch.view) || patch.view === kept.view) return false;
        kept = { ...kept, view: patch.view };
        return true;
      });
      return copy(kept);
    },

    picked(agent) {
      void change(() => {
        if (!isKey(agent) || kept.agent === agent) return false;
        kept = { ...kept, agent };
        return true;
      });
    },

    chose(agent, category, value) {
      void change(() => {
        if (!isKey(agent) || !isPicker(category) || !isKeptValue(value)) return false;
        const had = Object.prototype.hasOwnProperty.call(kept.agents, agent) ? kept.agents[agent] : undefined;
        if (had !== undefined && had[category] === value) return false;
        // A NEW AGENT PAST THE BOUND IS NOT KEPT: the bound is on the file, and
        // one agent too many forgets nothing already there.
        if (had === undefined && Object.keys(kept.agents).length >= MAX_AGENTS) return false;
        kept = { ...kept, agents: { ...kept.agents, [agent]: { ...had, [category]: value } } };
        return true;
      });
    },

    saved(agent) {
      const had = Object.prototype.hasOwnProperty.call(kept.agents, agent) ? kept.agents[agent] : undefined;
      return had === undefined ? {} : { ...had };
    },

    flushed: () => loaded.then(() => chain),
  };
}
