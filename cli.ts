import { Cliffy, Std } from "./deps.ts";

import { Watcher, WatchEvent } from "./watcher.ts";
import { VERSION } from "./version.ts";

const main = async (args: string[]) => {
  const result = await new Cliffy.Command()
    .name("semitia")
    .version(VERSION)
    .description("thin wrapper of Deno.watchFs.")
    .option("-t, --task <task:string>", "executes deno task.", {
      collect: true,
      conflicts: ["shell"],
      required: true,
    })
    .option("-s, --shell <cmd:string>", "executes shell command.", {
      collect: true,
      conflicts: ["task"],
      required: true,
    })
    .option("-a, --all", "unignore `.dot` and `temp~` files.")
    .arguments("[dirs...:string]")
    .parse(args);

  const paths = [...(result.args?.[0] ?? [""]), ...result.literal];
  const opts = result.options;

  const execute = [] as string[];

  if (opts.shell) {
    execute.push(...opts.shell);
  } else if (opts.task) {
    execute.push("deno", "task", ...opts.task);
  } else {
    throw new Error("non-provided executions.");
  }

  const prehandle = (event: Event) => {
    if (!(event instanceof WatchEvent)) return;

    switch (event.type) {
      case "touch":
      case "new":
      case "modify":
        return handle(event.path);

      case "move":
        return handle(event.path);
    }
  };

  const handle = (path: string) => {
    if (!opts.all && path.endsWith("~")) return;

    const hidden =
      path.split(Std.path.sep).find((s) => s.startsWith(".")) === undefined;
    if (!opts.all && !hidden) return;

    Deno.run({ cmd: [...execute, path] });
  };

  const watchers = paths.map((s) => new Watcher(s));

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
