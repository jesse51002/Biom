// SPDX-License-Identifier: AGPL-3.0-only
// Layer 2 — THE CHAT'S KEPT CHOICES, PURE: what `.biom/settings.json` may say,
// read loosely and bounded, and which of an agent's kept values its own list
// still offers (*Chat*, `picker`: *the choices are kept*).
//
// WHAT IS KEPT is `ChatSettings`: the view last picked, the agent last picked,
// and each agent's last model, mode and effort by the picker's category — a
// category and not an option's id, because a category is what the person
// picked from and an id is the session's own word, which a new version of the
// agent may spell otherwise. `server/workspace/settings.ts` keeps the file;
// the chats apply what it holds. Both read it through here, so the shape is
// said once.
//
// A VALUE IS APPLIED ONLY WHERE THE AGENT'S LIST STILL OFFERS IT: the picker
// of that category — the FIRST option in it, which is the one the input box
// draws — holding that value among its choices, or a switch for a switch. A
// model the agent has dropped since is skipped without a word, so a new chat
// never asks an agent for a value it would refuse.
//
// READ LOOSELY, WRITTEN EXACTLY, like the protocol's reading beside it: a key
// that is not an agent's, a category that is not a picker's, an id past
// `WIRE_BOUNDS.id` and a value of the wrong type are each left out, never
// guessed at; a file that is not a settings file at all is the caller's to
// put aside.

import type { AgentKey, ChatSettings, ChatView, ConfigOption, ConfigValue, PickerCategory } from "../../contracts/types.ts";
import { AGENT_KEY, CHAT_VIEWS, DEFAULT_VIEW } from "../../contracts/wire.js";
import { WIRE_BOUNDS } from "../platform/acp-wire.ts";

/** The file's version. A file of another is not read as this one. */
export const SETTINGS_VERSION = 1;

/** The three pickers under the input, in the spec's order. */
export const PICKERS: readonly PickerCategory[] = Object.freeze(["model", "mode", "thought_level"]);

/** How many agents' choices are kept. The registry lists a few dozen; this is
 *  a bound on a file somebody edited, not a number anybody reaches. */
export const MAX_AGENTS = 128;

/** A workspace that has kept nothing: Plain, no agent, no choices. */
export const defaults = (): ChatSettings => ({ view: DEFAULT_VIEW, agent: null, agents: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export const isPicker = (v: unknown): v is PickerCategory => typeof v === "string" && (PICKERS as readonly string[]).includes(v);
export const isView = (v: unknown): v is ChatView => typeof v === "string" && (CHAT_VIEWS as readonly string[]).includes(v);
export const isKey = (v: unknown): v is AgentKey => typeof v === "string" && AGENT_KEY.test(v);

/** A value a picker may be kept at: a choice's value within the protocol's
 *  bound, or a switch's state. */
export const isKeptValue = (v: unknown): v is ConfigValue =>
  typeof v === "boolean" || (typeof v === "string" && v !== "" && v.length <= WIRE_BOUNDS.id);

/**
 * THE FILE, READ: the settings it holds, bounded, or null where it is not a
 * settings file of this version at all — not an object, or another version —
 * which the caller puts aside rather than overwrites.
 */
export function readChoices(raw: unknown): ChatSettings | null {
  if (!isObj(raw) || raw.version !== SETTINGS_VERSION) return null;
  const out = defaults();
  const chat = isObj(raw.chat) ? raw.chat : {};
  if (isView(chat.view)) out.view = chat.view;
  if (isKey(chat.agent)) out.agent = chat.agent;
  const agents = isObj(chat.agents) ? chat.agents : {};
  let count = 0;
  for (const key of Object.keys(agents)) {
    if (count >= MAX_AGENTS) break;
    const kept = agents[key];
    if (!isKey(key) || !isObj(kept)) continue;
    const one: Partial<Record<PickerCategory, ConfigValue>> = {};
    for (const cat of PICKERS) {
      const v = own(kept, cat) ? kept[cat] : undefined;
      if (isKeptValue(v)) one[cat] = v;
    }
    if (Object.keys(one).length === 0) continue;
    out.agents[key] = one;
    count++;
  }
  return out;
}

/** THE FILE, AS WRITTEN: its version and what is kept, two-space indented so
 *  a person who opens it can read it. */
export function writeChoices(s: ChatSettings): string {
  return `${JSON.stringify({ version: SETTINGS_VERSION, chat: { view: s.view, agent: s.agent, agents: s.agents } }, null, 2)}\n`;
}

/** THE PICKER OF A CATEGORY: the first of the agent's options in it, the one
 *  the input box draws. */
export function pickerOf(options: readonly ConfigOption[], category: PickerCategory): ConfigOption | null {
  return options.find((o) => o.category === category) ?? null;
}

/** WHICH PICKER AN OPTION IS, by its id: the category it is the picker of, or
 *  null for an option that is no picker — `other`, or a second option in a
 *  category, which the input box never draws. */
export function pickerCategoryOf(options: readonly ConfigOption[], option: string): PickerCategory | null {
  const o = options.find((x) => x.id === option);
  if (!o || !isPicker(o.category)) return null;
  return pickerOf(options, o.category) === o ? o.category : null;
}

/** Whether an option offers a value: one of a select's choices, or a switch
 *  for a switch. */
export function offers(option: ConfigOption, value: ConfigValue): boolean {
  if (option.type === "boolean") return typeof value === "boolean";
  return typeof value === "string" && option.choices.some((c) => c.value === value);
}

/**
 * AN AGENT'S KEPT VALUES THAT ITS LIST STILL OFFERS, by the option id each is
 * set on — what a new chat with that agent starts on. A category the agent
 * has no picker for, and a value its picker no longer offers, are left out.
 */
export function offeredChoices(options: readonly ConfigOption[], kept: Partial<Record<PickerCategory, ConfigValue>> | undefined): Map<string, ConfigValue> {
  const out = new Map<string, ConfigValue>();
  if (!kept) return out;
  for (const cat of PICKERS) {
    const v = own(kept as Record<string, unknown>, cat) ? kept[cat] : undefined;
    if (v === undefined) continue;
    const o = pickerOf(options, cat);
    if (o && offers(o, v)) out.set(o.id, v);
  }
  return out;
}
