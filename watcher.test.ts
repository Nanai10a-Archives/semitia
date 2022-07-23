import { Std } from "./deps.ts";
const { assertEquals } = Std.testing.asserts;

import { Watcher, WatchEvent } from "./watcher.ts";

const mktmp = () => Deno.makeTempDir({ prefix: "semitia-test-" });
const rmtmp = (path: string | URL) => Deno.remove(path, { recursive: true });

const asPromise = <F, T extends F = F>(
  fn: (resolve: (from: F) => void) => unknown,
) => new Promise<T>((resolve) => fn((from) => resolve(from as T)));

const asWEPromise = (watcher: Watcher, name: string) =>
  asPromise<Event, WatchEvent>((fn) => watcher.addEventListener(name, fn));

Deno.test("event: touch (c)", async () => {
  const dir = await mktmp();

  const w = new Watcher(dir);
  const eventPromise = asWEPromise(w, "touch");

  w.watch();

  const at = Std.path.join(dir, "touch");
  await Deno.writeTextFile(at, "");

  const event = await eventPromise;

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "touch", at });
});
