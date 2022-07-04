const BASE = "https://deno.land/std/";

const std = {
  fmt: {
    color: await import(BASE + "fmt/colors.ts"),
  },
  path: await import(BASE + "path/mod.ts"),
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

if (import.meta.main) {
  const w = new Watcher();
  w.watch();
}
