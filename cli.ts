import { Std } from "./deps.ts";

import { Watcher, WatchEvent } from "./watcher.ts";

const main = (args: string[]) => {
  const { _: paths, t, s, a } = Std.flags.parse(args);

  let run: (arg: string) => void;
  if (typeof t === "string" && s === undefined) {
    run = (arg: string) =>
      void Deno.run({ cmd: ["deno", "task", ...t.split(/\s+/), arg] });
  } else if (typeof s === "string" && t === undefined) {
    run = (arg: string) => void Deno.run({ cmd: [...s.split(/\s+/), arg] });
  } else {
    return console.log("needs to provide action");
  }

  if (a !== undefined && typeof a !== "boolean") {
    return console.log("-a is boolean flag");
  }
  const all = a;

  const watchers = (paths as unknown[])
    .filter((e) => typeof e === "string")
    .map((e) => e as string)
    .map((s) => new Watcher(s));

  const prehandle = (e: Event) => {
    if (!(e instanceof WatchEvent)) return;

    switch (e.content.type) {
      case "touch":
      case "new":
      case "modify":
        return handle(e.content.at);

      case "move":
        return handle(e.content.to);
    }
  };

  const handle = (path: string) => {
    if (!all && path.endsWith("~")) return;

    const hidden =
      path.split(Std.path.sep).find((s) => s.startsWith(".")) === undefined;
    if (!all && !hidden) return;

    run(path);
  };

  for (const w of watchers) {
    w.addEventListener("touch", prehandle);
    w.addEventListener("new", prehandle);
    w.addEventListener("move", prehandle);
    w.addEventListener("modify", prehandle);
  }

  return Promise.all(watchers.map((w) => w.watch()));
};

export default main;

if (import.meta.main) {
  await main(Deno.args);
}
