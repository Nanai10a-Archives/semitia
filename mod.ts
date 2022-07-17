const BASE = "https://deno.land/std/";

const std = {
  fmt: {
    color: await import(BASE + "fmt/colors.ts"),
  },
  path: await import(BASE + "path/mod.ts"),
};

// --- --- --- --- --- --- --- --- ---

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

class WatchInternalEvent extends Event {
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

class InternalWatcher extends EventTarget {
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

      if (!this.inThreshold()) {
        this.momentary = undefined;
        this.modifyHandle = "pass";
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

  private current?: WatchStatus;
  private previous?: WatchStatus;

  private momentary?: WatchMomentaryStatus = undefined;
  private modifyHandle: "pass" | "ignore" = "pass";
  private timeout: Record<string, WatchTimeoutStatus | undefined> = {};

  private detect = () => {
    if (this.current === undefined) throw new Error(JSON.stringify(this));

    switch (this.current.kind) {
      case "create":
        {
          this.momentary = { progress: "create", path: this.current.path };
          this.modifyHandle = "ignore";

          const path = this.current.path;
          this.timeout[path] = { ...this.timeout[path] };
          this.timeout[path]!.create = setTimeout(() => {
            if (this.current === undefined) {
              throw new Error(JSON.stringify(this));
            }
            this.timeout[path]!.create = undefined;
            this.dispatch({ type: "create", at: path });
            this.momentary = undefined;
          }, this.THRESHOLD);

          this.dispatch({ type: "ignore", reason: "initial-create" });
        }
        break;

      case "modify":
        {
          if (this.inMomentaryProgress()) {
            this.momentary = {
              progress: "modify",
              path: this.current.path,
            };

            this.dispatch({ type: "ignore", reason: "momentary-progress" });
          }

          if (this.inModifyIgnoring()) {
            this.modifyHandle = "pass";
            this.dispatch({ type: "ignore", reason: "with-create" });
            break;
          }

          if (this.isEqualKinds() && this.isEqualPaths()) {
            if (this.timeout[this.current.path] === undefined) {
              throw new Error(JSON.stringify(this));
            }

            clearTimeout(this.timeout[this.current.path]!.modify);
            this.timeout[this.current.path]!.modify = undefined;

            this.dispatch({ type: "modify", at: this.current.path });
            break;
          }

          if (this.isEqualKinds() && !this.isEqualPaths()) {
            if (this.timeout[this.previous!.path] === undefined) {
              throw new Error(JSON.stringify(this));
            }

            clearTimeout(this.timeout[this.previous!.path]!.modify);
            this.timeout[this.previous!.path]!.modify = undefined;

            this.dispatch({
              type: "move",
              from: this.previous!.path,
              to: this.current.path,
            });
            break;
          }

          if (this.timeout[this.current.path]?.create !== undefined) {
            this.dispatch({ type: "ignore", reason: "with-create" });
            break;
          }

          const path = this.current.path;
          this.timeout[path] = { ...this.timeout[path] };
          this.timeout[path]!.modify = setTimeout(() => {
            if (this.current === undefined) {
              throw new Error(JSON.stringify(this));
            }

            this.timeout[path]!.modify = undefined;
            this.dispatch({ type: "modify", at: path });
          }, this.THRESHOLD);

          this.dispatch({ type: "ignore", reason: "initial-modify" });
        }
        break;

      case "remove":
        {
          if (this.inMomentaryProgress()) {
            clearTimeout(this.timeout[this.current.path]!.create);
            this.timeout[this.current.path]!.create = undefined;

            this.momentary = undefined;
            this.dispatch({ type: "momentary", at: this.current.path });
            break;
          }

          this.dispatch({ type: "remove", at: this.current.path });
        }
        break;

      case "access":
        {
          this.dispatch({ type: "ignore", reason: "linux-access" });
        }
        break;

      default: {
        throw new Error(JSON.stringify(this));
      }
    }
  };

  private isEqualPaths = () =>
    this.previous !== undefined &&
    this.current !== undefined &&
    this.previous.path === this.current!.path;

  private isEqualKinds = () =>
    this.previous !== undefined &&
    this.current !== undefined &&
    this.previous.kind === this.current.kind;

  private inThreshold = () =>
    this.previous !== undefined &&
    this.current !== undefined &&
    this.previous.time - this.current.time <= this.THRESHOLD;

  private inModifyIgnoring = () =>
    this.modifyHandle === "ignore" && this.inThreshold();

  private inMomentaryProgress = () =>
    this.current !== undefined &&
    this.momentary !== undefined &&
    (this.momentary.progress === "create"
      ? this.current.kind === "modify"
      : this.momentary.progress === "modify"
      ? this.current.kind === "remove"
      : false) &&
    this.momentary.path === this.current.path &&
    this.inThreshold();
}

type WatchEventParams =
  | {
      type: "touch";
      at: string;
    }
  | {
      type: "new";
      at: string;
    }
  | {
      type: "move";
      from: string;
      to: string;
    }
  | {
      type: "modify";
      at: string;
    }
  | {
      type: "remove";
      at: string;
    };

class WatchEvent extends Event {
  public readonly content: Readonly<WatchEventParams>;

  constructor(params: WatchEventParams) {
    super(params.type);

    this.content = params;
  }
}

class Watcher extends EventTarget {
  private internal: InternalWatcher;

  constructor(path = "", recursive = true) {
    super();

    this.internal = new InternalWatcher(path, recursive);

    this.internal.addEventListener("create", this.handle);
    this.internal.addEventListener("modify", this.handle);
    this.internal.addEventListener("move", this.handle);
    this.internal.addEventListener("remove", this.handle);
  }

  watch = () => this.internal.watch();
  abort = () => this.internal.abort();

  private dispatch = (params: WatchEventParams) => {
    this.dispatchEvent(new WatchEvent(params));
    console.log(params);
  };

  private timeout: Record<string, number | undefined> = {};
  private THRESHOLD = 4;

  private handle = (e: Event) => {
    if (!(e instanceof WatchInternalEvent)) {
      throw new Error(JSON.stringify(e));
    }

    switch (e.content.type) {
      case "create":
        {
          const { at } = e.content;

          this.timeout[at] = setTimeout(() => {
            this.timeout[at] = undefined;
            this.dispatch({ type: "touch", at: at });
          }, this.THRESHOLD);
        }

        break;

      case "modify":
        {
          const { at } = e.content;

          if (this.timeout[at] !== undefined) {
            clearTimeout(this.timeout[at]);
            this.timeout[at] = undefined;
            this.dispatch({ type: "new", at });
            break;
          }

          this.dispatch({ type: "modify", at });
        }
        break;

      case "move":
        {
          const { from, to } = e.content;

          this.dispatch({ type: "move", from, to });
        }
        break;

      case "remove":
        {
          const { at } = e.content;

          this.dispatch({ type: "remove", at });
        }
        break;

      default: {
        throw new Error(JSON.stringify(e));
      }
    }
  };
}

if (import.meta.main) {
  const w = new Watcher();
  w.watch();
}
