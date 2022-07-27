import { Std } from "./deps.ts";
const { assertEquals } = Std.testing.asserts;

import { Watcher, WatchEvent, WatchEventType } from "./watcher.ts";

const mktmp = () => Deno.makeTempDir({ prefix: "semitia-test-" });
const rmtmp = (path: string | URL) => Deno.remove(path, { recursive: true });

const asPromise = <F, T extends F = F>(
  fn: (resolve: (from: F) => void) => unknown
) => new Promise<T>((resolve) => fn((from) => resolve(from as T)));

const asWEPromise = (watcher: Watcher, type: string, timing = 1) =>
  asPromise<Event, WatchEvent>((fn) =>
    watcher.addEventListener(type, (e) => (--timing === 0 ? fn(e) : undefined))
  );

const timeout = <T>(promise: Promise<T>) => Std.async.deadline(promise, 100);

const asParams = ({ type, path }: WatchEvent) => ({ type, path });

const asPsPromise = async (promise: Promise<WatchEvent>) =>
  asParams(await promise);

type TestParam = VerifyTestParam | CleanupTestParam;

type VerifyTestParam = {
  type: "verify";
  action: { kind: "shell" | "about"; content: string };
  outputs: { type: WatchEventType; path: string; timing: number }[];
  target: "file" | "directory" | "both";
  inputs: Deno.FsEvent["kind"][];
  tasks: ((context: TextContext) => unknown)[];
};

type CleanupTestParam = { type: "cleanup" };

type TextContext = {
  path: (path: string) => string;
};

const tps: TestParam[] = [
  {
    type: "verify",
    action: { kind: "about", content: "create" },
    outputs: [{ type: "create", path: "file", timing: 1 }],
    target: "file",
    inputs: ["create"],
    tasks: [(c) => Deno.writeTextFile(c.path("file"), "")],
  },
  {
    type: "cleanup",
  },
];

const actiontext = ({ kind, content }: VerifyTestParam["action"]) => {
  switch (kind) {
    case "shell":
      return `"${content}"`;
    case "about":
      return `*${content}*`;
  }
};

const targettext = (target: VerifyTestParam["target"]) => {
  switch (target) {
    case "file":
      return "f ";

    case "directory":
      return " d";

    case "both":
      return "fd";
  }
};

const testname = (tp: TestParam) => {
  let r = "";

  r += tp.type;
  r += ": ";

  switch (tp.type) {
    case "cleanup": {
      r += "remove unneccesary directories";

      break;
    }

    case "verify": {
      const { action, inputs, target, outputs } = tp;

      r += actiontext(action);
      r += " => ";

      r += outputs.map(({ type }) => type).join(" ");

      r += " ";

      r += "(";
      r += targettext(target);
      r += ")";

      r += " ";

      r += "(";
      r += inputs.map((s) => s.substring(0, 1)).join("");
      r += ")";

      break;
    }
  }

  return r;
};

for (const tp of tps) {
  switch (tp.type) {
    case "cleanup": {
      Deno.test(testname(tp), async () => {
        const dir = (await mktmp())
          .split(Std.path.sep)
          .slice(0, -1)
          .join(Std.path.sep);

        const glob = Std.path.join(dir, "semitia-test-*");

        for await (const e of Std.fs.expandGlob(glob)) {
          if (e.isDirectory) {
            rmtmp(e.path);
          }
        }
      });

      continue;
    }

    case "verify": {
      Deno.test(testname(tp), async () => {
        const tmpdir = await mktmp();

        const w = new Watcher(tmpdir);

        const eventPsPromises = tp.outputs.map(({ type, timing }) =>
          asPsPromise(asWEPromise(w, type, timing))
        );

        const expects = tp.outputs.map(({ type, path }) => ({
          type,
          path: Std.path.join(tmpdir, path),
        }));

        w.watch();

        const context: TextContext = {
          path: (path) => Std.path.join(tmpdir, path),
        };

        for (const task of tp.tasks) {
          task(context);
        }

        for (const i in eventPsPromises) {
          const params = await timeout(eventPsPromises[i]);

          assertEquals(params, expects[i]);
        }

        w.abort();
      });

      continue;
    }
  }
}

// https://github.com/tommywalkie/Deno.watchFs#add-a-new-empty-file
// https://github.com/tommywalkie/Deno.watchFs#add-a-new-file
// https://github.com/tommywalkie/Deno.watchFs#edit-a-file
// https://github.com/tommywalkie/Deno.watchFs#add-a-new-folder
// https://github.com/tommywalkie/Deno.watchFs#copy-a-file
// https://github.com/tommywalkie/Deno.watchFs#copy-a-folder
// https://github.com/tommywalkie/Deno.watchFs#move-a-file
// https://github.com/tommywalkie/Deno.watchFs#move-a-folder
// https://github.com/tommywalkie/Deno.watchFs#rename-a-file
// https://github.com/tommywalkie/Deno.watchFs#rename-a-folder
// https://github.com/tommywalkie/Deno.watchFs#remove-a-file
// https://github.com/tommywalkie/Deno.watchFs#remove-a-folder
