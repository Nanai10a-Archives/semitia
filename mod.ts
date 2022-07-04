const BASE = "https://deno.land/std/";

const std = {
  fmt: {
    color: await import(BASE + "fmt/colors.ts"),
  },
  path: await import(BASE + "path/mod.ts"),
};

// --- --- --- --- --- --- --- --- ---

const dispatch = (event: string) => {
  console.log(`dispatched: ${event} on ${new Date().getTime()}\n`);
};

declare global {
  interface Array<T> {
    equals: (another: Array<T>) => boolean;
  }
}

Array.prototype.equals = function (another) {
  if (this.length !== another.length) {
    return false;
  }

  let equal = true;
  for (const index in this) {
    equal = equal && this[index] === another[index];
  }

  return equal;
};

export const inoCache = async (path = "", recursive = true) => {
  const { join, resolve } = std.path;

  let record: Record<string, number> = {};

  for await (const de of Deno.readDir(resolve(path))) {
    const name = resolve(join(path, de.name));

    record[name] = (await Deno.stat(name)).ino!;

    if (recursive && de.isDirectory) {
      const fromDir = await inoCache(name, recursive);
      record = { ...record, ...fromDir };
    }
  }

  return record;
};

class Watcher {
  private target: string;
  private recursive: boolean;

  private fswatcher: Deno.FsWatcher;
  private emitter: AsyncIterableIterator<Deno.FsEvent>;
  private abort: () => void;
  private signal: Promise<null>;

  constructor(path = "", recursive = true) {
    const target = std.path.resolve(path);

    this.target = target;
    this.recursive = recursive;

    this.fswatcher = Deno.watchFs(target, { recursive });
    this.emitter = this.fswatcher[Symbol.asyncIterator]();

    let abort: () => void;
    this.signal = new Promise<null>((resolve) => (abort = () => resolve(null)));
    this.abort = abort!;
  }

  watch = () => {
    this.loop();

    return this.abort.bind(this);
  };

  private loop = async () => {
    let event;
    while ((event = await this.maybeEmit())) {
      if (event.done === true) throw new Error("emitter reached end of events");
      if (event.value.paths.length !== 1) continue;

      const kind = event.value.kind;
      const path = event.value.paths[0];
      const time = new Date().getTime();

      if (!this.inThreshold(time)) {
        this.momentaryProgress = "none";
        this.modifyHandle = "pass";
      }

      const { bold, gray } = std.fmt.color;

      console.debug(`  ${path}\t${kind}\t${time}`);
      console.debug(
        gray(
          `( ${this.previousPath ?? "\t\t\t"}\t${this.previousKind ?? "\t"}\t${
            this.previousTime ?? "             "
          }\t) + ${this.modifyHandle}\t& ${
            this.momentaryProgress === "none"
              ? "      "
              : this.momentaryProgress
          }\t& ${this.momentaryPath}`
        )
      );
      const detected = this.detect(kind, path, time);
      switch (detected) {
        case "ignore":
        case "momentary":
          break;

        case "move":
          console.debug(
            bold(`${detected} on ${time} (${this.previousPath} -> ${path})\n`)
          );
          break;

        case "modify":
        case "remove":
          console.debug(bold(`${detected} on ${time} (${path})\n`));
      }

      this.previousKind = kind;
      this.previousTime = time;
      this.previousPath = path;
    }
  };

  private maybeEmit = () => Promise.race([this.emitter.next(), this.signal]);

  // --- --- --- --- --- --- --- --- ---

  private THRESHOLD = 4;

  private previousKind: string | undefined = undefined;
  private previousTime: number | undefined = undefined;
  private previousPath: string | undefined = undefined;

  private momentaryProgress: "none" | "create" | "modify" = "none";
  private momentaryPath: string | undefined = undefined;
  private modifyHandle: "pass" | "ignore" = "pass";

  private createTimeout: number | undefined = undefined;
  private moveTimeout: number | undefined = undefined;

  private detect = (kind: Deno.FsEvent["kind"], path: string, time: number) => {
    switch (kind) {
      case "create":
        this.momentaryProgress = "create";
        this.momentaryPath = path;
        this.modifyHandle = "ignore";
        this.createTimeout = setTimeout(() => {
          this.createTimeout = undefined;
          this.lazyReturn("create", path, time);
          this.momentaryProgress = "none";
          this.momentaryPath = undefined;
        }, this.THRESHOLD);
        return "ignore";

      case "modify":
        if (this.momentaryProgress === "modify")
          this.momentaryProgress = "none";

        if (this.momentaryProgress === "create" && this.momentaryPath === path)
          this.momentaryProgress = "modify";

        if (this.modifyHandle === "ignore" && this.inThreshold(time)) {
          this.modifyHandle = "pass";
          return "ignore";
        }

        if (this.previousKind === "modify") {
          clearTimeout(this.moveTimeout);
          this.moveTimeout = undefined;
          if (this.previousPath === path) {
            return "modify";
          } else {
            return "move";
          }
        }

        if (this.momentaryProgress === "none") {
          this.moveTimeout = setTimeout(() => {
            this.moveTimeout = undefined;
            this.lazyReturn("modify", path, time);
          }, this.THRESHOLD);
        }

        return "ignore";

      case "remove":
        if (
          this.momentaryProgress === "modify" &&
          this.momentaryPath === path &&
          this.inThreshold(time)
        ) {
          clearTimeout(this.createTimeout);
          this.createTimeout = undefined;

          this.momentaryProgress = "none";
          this.momentaryPath = undefined;
          return "momentary";
        }

        return "remove";

      case "access":
        return "ignore";

      default:
        throw new Error("unexpected kind of event");
    }
  };

  private inThreshold = (currentTime: number) =>
    this.previousTime !== undefined &&
    this.previousTime - currentTime <= this.THRESHOLD;

  private lazyReturn = (event: string, path: string, time: number) =>
    console.debug(
      std.fmt.color.bold(
        `${std.fmt.color.italic(event)} on ${time} (${path})\n`
      )
    );
}

// --- --- --- --- --- --- --- --- ---

const watch = async (path = "", recursive = true) => {
  const resolved = std.path.resolve(path);

  const inos = await inoCache(resolved);

  const fw = Deno.watchFs(resolved, { recursive });

  let current = {
    kinds: [] as string[],
    paths: [] as string[],
    times: [] as number[],
  };

  let maybeIncomingModifyEvent: number | undefined = undefined;
  let maybeMomentary: number | undefined = undefined;

  for await (const { kind, paths } of fw) {
    if (kind === "access" || paths.length !== 1) {
      continue;
    }

    const path = paths[0];

    // --- --- ---

    const time = new Date().getTime();
    current.kinds.push(kind);
    current.paths.push(path);
    current.times.push(time);

    // --- --- ---

    console.table(current.kinds);
    console.table(current.paths);
    console.log();

    // --- --- ---

    const IGNORE_TEMPORARY = false;

    if (IGNORE_TEMPORARY && path.endsWith("~")) {
      dispatch("ignore temporary");
      current = { kinds: [], paths: [], times: [] };
      continue;
    }

    // --- --- ---

    const DELTA = 4;

    const DETECT_MOMENTARY = true;
    const DETECT_NEW = true;

    // new:emp         | c > .
    // new:edt         | c > m
    // new:emp -> edit | c > m | m > .
    // new:edt -> edit | c > m | m > m
    // edit            | m   . |

    if (DETECT_NEW && current.kinds.equals(["create"])) {
      dispatch("new");

      maybeIncomingModifyEvent = time;
      maybeMomentary = time;

      current = { kinds: [], paths: [], times: [] };
      continue;
    }

    if (
      DETECT_NEW &&
      maybeIncomingModifyEvent !== undefined &&
      current.kinds.equals(["modify"]) &&
      maybeIncomingModifyEvent - time <= DELTA
    ) {
      maybeIncomingModifyEvent = undefined;
      maybeMomentary = time;
      current = { kinds: [], paths: [], times: [] };
      continue;
    }

    if (
      DETECT_MOMENTARY &&
      maybeMomentary !== undefined &&
      current.kinds.equals(["remove"]) &&
      maybeMomentary - time <= DELTA
    ) {
      dispatch("momentary");
      maybeMomentary = undefined;
      current = { kinds: [], paths: [], times: [] };
      continue;
    }

    if (
      DETECT_NEW &&
      maybeIncomingModifyEvent !== undefined &&
      maybeIncomingModifyEvent - time >= DELTA
    ) {
      maybeIncomingModifyEvent = undefined;
    }

    if (
      DETECT_MOMENTARY &&
      maybeMomentary !== undefined &&
      maybeMomentary - time >= DELTA
    ) {
      maybeMomentary = undefined;
    }

    // --- --- ---

    const DETECT_MOVE_EDIT = true;

    if (DETECT_MOVE_EDIT && current.kinds.equals(["modify", "modify"])) {
      if (current.paths[0] === current.paths[1]) {
        dispatch("edit");
      } else {
        dispatch("move");
      }

      current = { kinds: [], paths: [], times: [] };
      continue;
    }

    // --- --- ---

    const DETECT_REMOVE = true;

    if (DETECT_REMOVE && current.kinds.equals(["remove"])) {
      dispatch("remove");
      current = { kinds: [], paths: [], times: [] };
      continue;
    }
  }
};

if (import.meta.main) {
  const w = new Watcher();
  w.watch();
  // await watch();
}
