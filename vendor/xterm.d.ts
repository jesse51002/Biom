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
  selectionForeground?: string;
}

export interface ITerminalOptions {
  cols?: number;
  rows?: number;
  allowProposedApi?: boolean;
  cursorBlink?: boolean;
  disableStdin?: boolean;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  macOptionIsMeta?: boolean;
  scrollback?: number;
  theme?: ITheme;
}

export interface IBuffer {
  readonly viewportY: number;
  readonly baseY: number;
}

export interface IBufferNamespace {
  readonly active: IBuffer;
}

export interface ITerminalAddon extends IDisposable {
  activate(terminal: Terminal): void;
}

export declare class Terminal implements IDisposable {
  constructor(options?: ITerminalOptions);
  readonly cols: number;
  readonly rows: number;
  readonly element: HTMLElement | undefined;
  readonly buffer: IBufferNamespace;
  options: ITerminalOptions;
  onBell: IEvent<void>;
  onData: IEvent<string>;
  onScroll: IEvent<number>;
  onTitleChange: IEvent<string>;
  onWriteParsed: IEvent<void>;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  reset(): void;
  focus(): void;
  resize(columns: number, rows: number): void;
  scrollToBottom(): void;
  hasSelection(): boolean;
  getSelection(): string;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  loadAddon(addon: ITerminalAddon): void;
  dispose(): void;
}
