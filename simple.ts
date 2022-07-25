import { Std } from "./deps.ts";

type WatchEventContent =
  | { type: "create"; path: string }
  | { type: "modify"; path: string }
  | { type: "remove"; path: string };

type WatchEventType = WatchEventContent["type"];

export class WatchEvent extends Event {
  readonly path: string;

  constructor({ type, path }: WatchEventContent) {
    super(type);
    this.path = path;
  }
}

export class Watcher extends EventTarget {
  public readonly target: string;
  public readonly recursive: boolean;

  private readonly fswatcher: Deno.FsWatcher;
  private readonly emitter: AsyncIterableIterator<Deno.FsEvent>;
  public readonly abort: () => void;
  private readonly signal: Promise<void>;

  constructor(path = "", recursive = true) {
    super();

    const target = Std.path.resolve(path);

    this.target = target;
    this.recursive = recursive;

    this.fswatcher = Deno.watchFs(target, { recursive });
    this.emitter = this.fswatcher[Symbol.asyncIterator]();

    let abort: () => void;
    this.signal = new Promise<void>((resolve) => (abort = resolve));
    this.abort = abort!;
  }

  // --- --- --- --- --- --- --- --- ---

  public readonly watch = async () => {
    let event;
    while ((event = await this.maybeEmit())) {
      if (event.done === true) break;
      this.handle(event.value);
    }

    this.cleanup();
  };

  private readonly maybeEmit = () =>
    Promise.race([this.emitter.next(), this.signal]);

  private readonly cleanup = () => {
    this.fswatcher.close();

    for (const state of Object.values(this.states)) {
      state.cleanup();
    }
  };

  // --- --- --- --- --- --- --- --- ---

  private readonly handle = (event: Deno.FsEvent) => {
    if (event.flag) return console.warn(`detected flag: "${event.flag}"`);
    if (event.paths.length !== 1) return;

    const [path] = event.paths;
    const kind = event.kind;

    switch (kind) {
      case "any":
      case "access":
      case "other":
        return;
    }

    this.process(path, kind);
  };

  // --- --- --- --- --- --- --- --- ---

  private readonly process = (path: string, kind: WatchEventType) => {
    switch (kind) {
      case "create":
      case "remove":
        this.dispatch({ type: kind, path });
        break;

      case "modify":
        this.states.modify.update(path);
        break;
    }
  };

  private states = {
    modify: new WatcherState((path) => this.dispatch({ type: "modify", path })),
  };

  private readonly dispatch = (content: WatchEventContent) =>
    this.dispatchEvent(new WatchEvent(content));
}

class WatcherState {
  private static readonly THRESHOLD: number = 4;

  private readonly callback;

  constructor(callback: (path: string) => void) {
    this.callback = callback;
  }

  private timeout?: number;
  private path?: string;

  public readonly update = (path: string) => {
    if (!this.path) {
      this.set(path);

      return;
    }

    if (this.path === path) {
      this.clear();
      this.set(path);

      return;
    }

    if (this.path !== path) {
      this.invoke();
      this.set(path);

      return;
    }

    throw new UnreachableError();
  };

  private readonly set = (path: string) => {
    this.timeout = setTimeout(this.invoke, WatcherState.THRESHOLD);
    this.path = path;
  };

  private readonly clear = () => {
    clearTimeout(this.timeout);

    this.timeout = undefined;
    this.path = undefined;
  };

  private readonly invoke = () => {
    if (!this.path || !this.timeout) throw new UnreachableError();

    this.callback(this.path);
    this.clear();
  };

  public readonly cleanup = () => this.clear();
}

class UnreachableError extends Error {
  constructor() {
    super("entered unreachable code");
  }
}
