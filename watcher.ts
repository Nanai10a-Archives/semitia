import { InternalWatcher, WatchInternalEvent } from "./internal.ts";

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

export class WatchEvent extends Event {
  public readonly content: Readonly<WatchEventParams>;

  constructor(params: WatchEventParams) {
    super(params.type);

    this.content = params;
  }
}

export class Watcher extends EventTarget {
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
  };

  private timeout: Record<string, number | undefined> = {};
  private THRESHOLD = 4;

  private handle = (e: Event) => {
    if (!(e instanceof WatchInternalEvent)) {
      throw new Error(`${e}`);
    }

    const { type, at, from, to } = {
      at: undefined,
      from: undefined,
      to: undefined,
      ...e.content,
    };

    switch (type) {
      case "create":
        this.timeout[at] = setTimeout(() => {
          this.timeout[at] = undefined;
          this.dispatch({ type: "touch", at });
        }, this.THRESHOLD);

        break;

      case "modify":
        if (this.timeout[at] !== undefined) {
          clearTimeout(this.timeout[at]);
          this.timeout[at] = undefined;
          this.dispatch({ type: "new", at });
          break;
        }

        this.dispatch({ type: "modify", at });

        break;

      case "move":
        this.dispatch({ type: "move", from, to });

        break;

      case "remove":
        this.dispatch({ type: "remove", at });

        break;

      default: {
        throw new Error(`${e}`);
      }
    }
  };
}

export default Watcher;
