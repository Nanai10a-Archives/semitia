const std = {
  path: await import("https://deno.land/std/path/mod.ts"),
};

type WatchInternalEventParams =
  | {
      type: "ignore";
      reason:
        | "initial-create"
        | "with-create"
        | "momentary-progress"
        | "initial-modify"
        | "undecidable-modify"
        | "linux-access"
        | "unexpected";
    }
  | {
      type: "momentary";
      at: string;
    }
  | {
      type: "move";
      from: string;
      to: string;
    }
  | {
      type: "remove";
      at: string;
    }
  | {
      type: "create";
      at: string;
    }
  | {
      type: "modify";
      at: string;
    };

export class WatchInternalEvent extends Event {
  public readonly content: Readonly<WatchInternalEventParams>;

  constructor(params: WatchInternalEventParams) {
    super(params.type);
    this.content = params;
  }
}

type WatchStatus = {
  kind: Deno.FsEvent["kind"];
  time: number;
  path: string;
};

type WatchMomentaryStatus = {
  progress: "create" | "modify";
  path: string;
};

type WatchTimeoutStatus = {
  create?: number;
  modify?: number;
};

export class InternalWatcher extends EventTarget {
  target: string;
  recursive: boolean;

  private fswatcher: Deno.FsWatcher;
  private emitter: AsyncIterableIterator<Deno.FsEvent>;
  public readonly abort: () => void;
  private signal: Promise<null>;

  constructor(path = "", recursive = true) {
    super();

    const target = std.path.resolve(path);

    this.target = target;
    this.recursive = recursive;

    this.fswatcher = Deno.watchFs(target, { recursive });
    this.emitter = this.fswatcher[Symbol.asyncIterator]();

    let abort: () => void;
    this.signal = new Promise<null>((resolve) => (abort = () => resolve(null)));
    this.abort = abort!;
  }

  watch = async () => {
    let event;
    while ((event = await this.maybeEmit())) {
      if (event.done === true) break;
      if (event.value.paths.length !== 1) continue;

      this.current = {
        kind: event.value.kind,
        path: event.value.paths[0],
        time: new Date().getTime(),
      };

      for (const [k, v] of Object.entries(this.timeout)) {
        if (Object.entries(v!).length === 0) {
          delete this.timeout[k];
        }
      }

      for (const [k, v] of Object.entries(this.modifyHandle)) {
        if (!this.inThreshold(v!)) {
          delete this.modifyHandle[k];
        }
      }

      this.detect();

      this.previous = this.current;
    }

    this.fswatcher.close();
  };

  private maybeEmit = () => Promise.race([this.emitter.next(), this.signal]);

  private dispatch = (params: WatchInternalEventParams) =>
    this.dispatchEvent(new WatchInternalEvent(params));

  // --- --- --- --- --- --- --- --- ---

  private THRESHOLD = 4;

  private current: WatchStatus | null = null;
  private previous: WatchStatus | null = null;

  private momentary: WatchMomentaryStatus | null = null;
  private modifyHandle: Record<string, number> = {};
  private timeout: Record<string, WatchTimeoutStatus> = {};

  private detect = () => {
    if (this.current === null) throw new Error(`${this}`);

    const { path } = this.current;

    switch (this.current.kind) {
      case "create":
        this.momentary = { progress: "create", path };
        delete this.modifyHandle[path];

        this.timeout[path] = { ...this.timeout[path] };
        this.timeout[path].create = setTimeout(() => {
          delete this.timeout[path].create;
          this.dispatch({ type: "create", at: path });
          this.momentary = null;
        }, this.THRESHOLD);

        this.dispatch({ type: "ignore", reason: "initial-create" });

        break;

      case "modify":
        if (this.inMomentaryProgress()) {
          this.momentary = { progress: "modify", path };

          this.dispatch({ type: "ignore", reason: "momentary-progress" });
        }

        if (this.inModifyIgnoring()) {
          delete this.modifyHandle[path];
          this.dispatch({ type: "ignore", reason: "with-create" });
          break;
        }

        if (
          this.isEqualKinds() &&
          this.isEqualPaths() &&
          this.timeout[path] !== undefined
        ) {
          clearTimeout(this.timeout[path].modify);
          delete this.timeout[path].modify;

          this.dispatch({ type: "modify", at: path });
          break;
        }

        if (
          this.isEqualKinds() &&
          !this.isEqualPaths() &&
          this.previous !== null &&
          this.timeout[this.previous.path] !== undefined
        ) {
          clearTimeout(this.timeout[this.previous.path].modify);
          delete this.timeout[this.previous.path].modify;

          this.dispatch({ type: "move", from: this.previous.path, to: path });
          break;
        }

        if (this.timeout[path]?.create !== undefined) {
          this.dispatch({ type: "ignore", reason: "with-create" });
          break;
        }

        this.timeout[path] = { ...this.timeout[path] };
        this.timeout[path].modify = setTimeout(() => {
          delete this.timeout[path].modify;
          this.dispatch({ type: "modify", at: path });
        }, this.THRESHOLD);

        this.dispatch({ type: "ignore", reason: "initial-modify" });

        break;

      case "remove":
        if (this.inMomentaryProgress()) {
          clearTimeout(this.timeout[path].create);
          delete this.timeout[path].create;

          this.momentary = null;
          this.dispatch({ type: "momentary", at: path });
          break;
        }

        this.dispatch({ type: "remove", at: path });

        break;

      case "access":
        this.dispatch({ type: "ignore", reason: "linux-access" });

        break;

      default:
        throw new Error(`${this}`);
    }
  };

  private isEqualPaths = () =>
    this.previous !== null &&
    this.current !== null &&
    this.previous.path === this.current!.path;

  private isEqualKinds = () =>
    this.previous !== null &&
    this.current !== null &&
    this.previous.kind === this.current.kind;

  private inThreshold = (target?: number) =>
    target !== undefined && this.current !== null
      ? target - this.current.time <= this.THRESHOLD
      : this.previous !== null && this.current !== null
      ? this.previous.time - this.current.time <= this.THRESHOLD
      : false;

  private inModifyIgnoring = () =>
    this.current !== null &&
    this.modifyHandle[this.current.path] !== undefined &&
    this.inThreshold(this.modifyHandle[this.current.path]);

  private inMomentaryProgress = () =>
    this.current !== null &&
    this.momentary !== null &&
    (this.momentary.progress === "create"
      ? this.current.kind === "modify"
      : this.momentary.progress === "modify"
      ? this.current.kind === "remove"
      : false) &&
    this.momentary.path === this.current.path &&
    this.inThreshold();
}

export default InternalWatcher;
