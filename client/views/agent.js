// SPDX-License-Identifier: AGPL-3.0-only
// Layer 14 — THE AGENT SCREEN, HOST SIDE: the box the look is drawn in, and
// the one thing in it that is not the look's — the INPUT BOX.
//
// A STUB, AND NOTHING CONSTRUCTS IT YET; track C1 builds it.
//
// The start screen, a chat and the list of chats are drawn by the plugin a
// workspace can replace, in a box on `AGENT_PAGE`, and this view mounts that
// box — on the Agent screen, or in the resizable panel beside a page — and
// feeds it `look.state` when it is ready and when what it shows changes shape,
// and `look.patch`, coalesced to one a frame, as the chats stream — ONLY
// through the `Frame.post` of the frame it mounted, never a broadcast, which
// throws, and never a scan of sessions by page. It hands the look `names`, the
// pages its places name, because the look cannot resolve a `uid`, and it
// answers the look's four `look.*` kinds for that box alone. The panel's head
// — its list of chats, expand, close — is the look's to draw.
//
// THE INPUT BOX IS BIOM'S, IN THE HOST, OVER THE BOX: the text area, the
// agent, model, mode and effort pickers under it, **More agents** and **More
// models**, the / menu, Stop while a turn runs, **Go to page** above it, and
// the sign-in pop-ups. Only what the person types here reaches an agent; the
// look can ask to open a chat, start a new thread, show the list or change
// the panel's size, and nothing else (*Chat*, `screens`, `picker`, `slash`,
// `plugin`; *History and View Switcher*, `popups`).

/** @import { FrameHost, UiStore } from "../../contracts/types.ts" */

/**
 * @typedef {object} AgentView
 * @property {() => HTMLElement} screen The Agent screen, whole.
 * @property {() => HTMLElement} panel The panel beside a page.
 */

/**
 * NOT BUILT: throws.
 * @param {{ h: Function, frameHost: FrameHost, ui: UiStore, ws: unknown, chats: unknown, switcher: unknown, vault: string }} _deps
 * @returns {AgentView}
 */
export function makeAgentView(_deps) {
  throw new Error("client/views/agent.js: the Agent screen is not built yet");
}
