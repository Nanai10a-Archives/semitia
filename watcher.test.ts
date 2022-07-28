import { Std } from "./deps.ts";
const { assertEquals } = Std.testing.asserts;

import { Watcher, WatchEvent, WatchEventType } from "./watcher.ts";

const randomid = () => Math.random().toString(36).substring(2, 9);

const PREFIX_GLOB = ".test/semitia-test-*";

const testdir = () =>
  Std.path.join(Deno.cwd(), PREFIX_GLOB.replace("*", randomid()));

const mktmp = () => {
  const tmpdir = testdir();
  Deno.mkdir(tmpdir, { recursive: true });
  return tmpdir;
};

const rmtmp = (path: string | URL) => Deno.remove(path, { recursive: true });

const asPromise = <F, T extends F = F>(
  fn: (resolve: (from: F) => void) => unknown,
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
  prepares: ((context: TextContext) => unknown | Promise<unknown>)[];
  tasks: ((context: TextContext) => unknown | Promise<unknown>)[];
};

type CleanupTestParam = { type: "cleanup" };

type TextContext = {
  path: (path: string) => string;
};

const tps: TestParam[] = [
  // https://github.com/tommywalkie/Deno.watchFs#add-a-new-empty-file
  {
    type: "verify",
    action: { kind: "shell", content: "touch" },
    outputs: [{ type: "create", path: "file", timing: 1 }],
    target: "file",
    inputs: ["create"],
    prepares: [],
    tasks: [(c) => Deno.writeTextFile(c.path("file"), "")],
  },
  // https://github.com/tommywalkie/Deno.watchFs#add-a-new-file
  {
    type: "verify",
    action: { kind: "about", content: "writes new file" },
    outputs: [
      { type: "create", path: "file", timing: 1 },
      { type: "modify", path: "file", timing: 1 },
    ],
    target: "file",
    inputs: ["create", "modify"],
    prepares: [],
    tasks: [(c) => Deno.writeTextFile(c.path("file"), "content")],
  },
  // https://github.com/tommywalkie/Deno.watchFs#edit-a-file
  {
    type: "verify",
    action: { kind: "about", content: "edit file" },
    outputs: [{ type: "modify", path: "file", timing: 1 }],
    target: "file",
    inputs: ["modify", "modify"],
    prepares: [(c) => Deno.writeTextFile(c.path("file"), "content")],
    tasks: [(c) => Deno.writeTextFile(c.path("file"), "modified-content")],
  },
  // https://github.com/tommywalkie/Deno.watchFs#add-a-new-folder
  {
    type: "verify",
    action: { kind: "shell", content: "mkdir" },
    outputs: [{ type: "create", path: "dir", timing: 1 }],
    target: "directory",
    inputs: ["create"],
    prepares: [],
    tasks: [(c) => Deno.mkdir(c.path("dir"), { recursive: true })],
  },
  // https://github.com/tommywalkie/Deno.watchFs#copy-a-file
  {
    type: "verify",
    action: { kind: "shell", content: "cp" },
    outputs: [
      { type: "create", path: "copied-file", timing: 1 },
      { type: "modify", path: "copied-file", timing: 1 },
    ],
    target: "file",
    inputs: ["create", "modify", "modify"],
    prepares: [(c) => Deno.writeTextFile(c.path("file"), "content")],
    tasks: [(c) => Std.fs.copy(c.path("file"), c.path("copied-file"))],
  },

  // https://github.com/tommywalkie/Deno.watchFs#copy-a-folder
  {
    type: "verify",
    action: { kind: "shell", content: "cp -r" },
    outputs: [
      { type: "create", path: "copied-dir", timing: 1 },
      { type: "create", path: "copied-dir/file", timing: 2 },
      { type: "modify", path: "copied-dir/file", timing: 1 },
    ],
    target: "both",
    inputs: ["create", "create", "modify", "modify"],
    prepares: [
      (c) => Deno.mkdir(c.path("dir"), { recursive: true }),
      (c) => Deno.writeTextFile(c.path("dir/file"), "content"),
    ],
    tasks: [(c) => Std.fs.copy(c.path("dir"), c.path("copied-dir"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#move-a-file
  {
    type: "verify",
    action: { kind: "shell", content: "mv" },
    outputs: [
      { type: "modify", path: "file", timing: 1 },
      { type: "modify", path: "moved-file", timing: 2 },
    ],
    target: "file",
    inputs: ["modify", "modify"],
    prepares: [(c) => Deno.writeTextFile(c.path("file"), "content")],
    tasks: [(c) => Std.fs.move(c.path("file"), c.path("moved-file"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#move-a-folder
  {
    type: "verify",
    action: { kind: "shell", content: "mv" },
    outputs: [
      { type: "modify", path: "dir", timing: 1 },
      { type: "modify", path: "moved-dir", timing: 2 },
    ],
    target: "directory",
    inputs: ["modify", "modify"],
    prepares: [(c) => Deno.mkdir(c.path("dir"), { recursive: true })],
    tasks: [(c) => Std.fs.move(c.path("dir"), c.path("moved-dir"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#rename-a-file
  {
    type: "verify",
    action: { kind: "about", content: "rename" },
    outputs: [
      { type: "modify", path: "file", timing: 1 },
      { type: "modify", path: "renamed-file", timing: 2 },
    ],
    target: "file",
    inputs: ["modify", "modify"],
    prepares: [(c) => Deno.writeTextFile(c.path("file"), "content")],
    tasks: [(c) => Deno.rename(c.path("file"), c.path("renamed-file"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#rename-a-folder
  {
    type: "verify",
    action: { kind: "about", content: "rename" },
    outputs: [
      { type: "modify", path: "dir", timing: 1 },
      { type: "modify", path: "renamed-dir", timing: 2 },
    ],
    target: "directory",
    inputs: ["modify", "modify"],
    prepares: [(c) => Deno.mkdir(c.path("dir"), { recursive: true })],
    tasks: [(c) => Deno.rename(c.path("dir"), c.path("renamed-dir"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#remove-a-file
  {
    type: "verify",
    action: { kind: "shell", content: "rm" },
    outputs: [{ type: "remove", path: "file", timing: 1 }],
    target: "file",
    inputs: ["remove"],
    prepares: [(c) => Deno.writeTextFile(c.path("file"), "content")],
    tasks: [(c) => Deno.remove(c.path("file"))],
  },
  // https://github.com/tommywalkie/Deno.watchFs#remove-a-folder
  {
    type: "verify",
    action: { kind: "shell", content: "rm -r" },
    outputs: [
      { type: "remove", path: "dir/file", timing: 1 },
      { type: "remove", path: "dir", timing: 2 },
    ],
    target: "both",
    inputs: ["remove", "remove"],
    prepares: [
      (c) => Deno.mkdir(c.path("dir"), { recursive: true }),
      (c) => Deno.writeTextFile(c.path("dir/file"), "content"),
    ],
    tasks: [(c) => Deno.remove(c.path("dir"), { recursive: true })],
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
        const glob = Std.path.join(Deno.cwd(), PREFIX_GLOB);

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
        console.log(tmpdir);

        const expects = tp.outputs.map(({ type, path }) => ({
          type,
          path: Std.path.join(tmpdir, path),
        }));
        console.table(expects);

        const context: TextContext = {
          path: (path) => Std.path.join(tmpdir, path),
        };

        for (const prepare of tp.prepares) {
          await prepare(context);
        }

        const w = new Watcher(tmpdir);

        const eventPsPromises = tp.outputs.map(({ type, timing }) =>
          asPsPromise(asWEPromise(w, type, timing))
        );

        w.watch();

        for (const task of tp.tasks) {
          await task(context);
        }

        for (const i in eventPsPromises) {
          const params = await timeout(eventPsPromises[i]);
          console.log(params);

          assertEquals(params, expects[i]);
        }

        w.abort();
      });

      continue;
    }
  }
}
