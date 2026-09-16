// OURS, hand-written, and deliberately partial — see `xterm.d.ts` beside it for
// why upstream's own declaration cannot be the one read. `@xterm/addon-fit` 0.11.0.

import type { ITerminalAddon, Terminal } from "@xterm/xterm";

export declare class FitAddon implements ITerminalAddon {
  constructor();
  activate(terminal: Terminal): void;
  dispose(): void;
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}
