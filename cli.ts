import { Cliffy, Std } from "./deps.ts";

import { Watcher, WatchEvent } from "./watcher.ts";
import { VERSION } from "./version.ts";

const main = async (args: string[]) => {
  const result = await new Cliffy.Command()
    .name("semitia")
    .version(VERSION)
    .description("thin wrapper of Deno.watchFs.")
    .arguments("[dirs...:string]")
    .group("emitter customizes")
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
    .group("accepting events")
    .option("-c --create", "on created")
    .option("-m --modify", "on written")
    .option("-r --remove", "on removed")
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

  if (!opts.create && !opts.modify && !opts.remove) {
    throw new Error("non-provided acceptions");
  }

  const prehandle = (event: Event) => {
    if (event instanceof WatchEvent) handle(event.path);
  };

  const handle = (path: string) => {
    if (!opts.all && path.endsWith("~")) return;

    const hidden =
      path.split(Std.path.sep).find((s) => s.startsWith(".")) === undefined;
    if (!opts.all && !hidden) return;

    Deno.run({ cmd: [...execute, path] });
  };

  const events = {
    create: opts.create,
    modify: opts.modify,
    remove: opts.remove,
  };

  const watchers = paths.map((s) => new Watcher(s));

  for (const w of watchers) {
    for (const [e, c] of Object.entries(events)) {
      if (c) w.addEventListener(e, prehandle);
    }
  }

  return Promise.all(watchers.map((w) => w.watch()));
};

export default main;

if (import.meta.main) {
  await main(Deno.args);
}
