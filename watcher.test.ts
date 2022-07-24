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

  const event = await Std.async.deadline(eventPromise, 100);

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "touch", at });
});

Deno.test("event: touch (cm)", async () => {
  const dir = await mktmp();

  const w = new Watcher(dir);
  const eventPromise = asWEPromise(w, "touch");

  w.watch();

  const at = Std.path.join(dir, "touch");
  await Deno.writeTextFile(at, "touch");

  const event = await Std.async.deadline(eventPromise, 100);

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "touch", at });
});

Deno.test("event: move (mm)", async () => {
  const dir = await mktmp();

  const w = new Watcher(dir);
  const eventPromise = asWEPromise(w, "move");

  w.watch();

  const from = Std.path.join(dir, "move-from");
  const to = Std.path.join(dir, "move-to");
  await Deno.writeTextFile(from, "");
  await Std.fs.move(from, to);

  const event = await Std.async.deadline(eventPromise, 100);

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "move", from, to });
});

Deno.test("event: modify (m)", async () => {
  const dir = await mktmp();

  const w = new Watcher(dir);
  const eventPromise = asWEPromise(w, "modify");

  w.watch();

  const at = Std.path.join(dir, "modify");
  await Deno.writeTextFile(at, "");
  await Deno.writeTextFile(at, "modify");

  const event = await Std.async.deadline(eventPromise, 100);

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "modify", at });
});

Deno.test("event: remove (r)", async () => {
  const dir = await mktmp();

  const w = new Watcher(dir);
  const eventPromise = asWEPromise(w, "remove");

  w.watch();

  const at = Std.path.join(dir, "remove");
  await Deno.writeTextFile(at, "");
  await Deno.remove(at);

  const event = await Std.async.deadline(eventPromise, 100);

  w.abort();
  await rmtmp(dir);

  assertEquals(event.content, { type: "remove", at });
});
