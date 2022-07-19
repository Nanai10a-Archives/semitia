import { Std } from "./deps.ts";
const { assertEquals } = Std.testing.asserts;

import { Watcher, WatchEvent } from "./watcher.ts";

Deno.test("event: touch (c)", async () => {
  const dir = await Deno.makeTempDir({ prefix: "semitia-test-" });

  const w = new Watcher(dir);
  const event = new Promise<WatchEvent>((resolve) =>
    w.addEventListener("touch", (e) => resolve(e as WatchEvent))
  );
  w.watch();

  const at = Std.path.join(dir, "touch");
  (await Deno.create(at)).close();

  w.abort();
  await Deno.remove(dir, { recursive: true });

  assertEquals((await event).content, { type: "touch", at });
});
