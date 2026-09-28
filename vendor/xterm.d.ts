// OURS, hand-written, and deliberately partial — the same arrangement as
// `markdown-it.d.ts` and `yaml.d.ts` beside it. Upstream's own `typings/xterm.d.ts`
// is an ambient `declare module` block, which `tsconfig` `paths` cannot resolve to
// as a module, so this declares the part of `@xterm/xterm` 6.0.0 that
// `client/views/terminal.js` and `client/boot.js` actually use and nothing more.
// Reaching for a member that is not here is the signal to add it deliberately.

export interface IDisposable {
  dispose(): void;
}

export interface IEvent<T> {
  (listener: (arg: T) => unknown): IDisposable;
}

export interface ITheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
}

export interface ITerminalOptions {
  cursorBlink?: boolean;
  disableStdin?: boolean;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  macOptionClickForcesSelection?: boolean;
  scrollback?: number;
  theme?: ITheme;
}

export interface ITerminalAddon extends IDisposable {
  activate(terminal: Terminal): void;
}

export declare class Terminal implements IDisposable {
  constructor(options?: ITerminalOptions);
  readonly cols: number;
  readonly rows: number;
  options: ITerminalOptions;
  onData: IEvent<string>;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  focus(): void;
  resize(columns: number, rows: number): void;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  clear(): void;
  input(data: string, wasUserInput?: boolean): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  loadAddon(addon: ITerminalAddon): void;
  dispose(): void;
}
