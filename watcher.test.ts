import { Std } from "./deps.ts";
const { assertEquals } = Std.testing.asserts;

import { Watcher, WatchEvent } from "./watcher.ts";

const mktmp = () => Deno.makeTempDir({ prefix: "semitia-test-" });
const rmtmp = (path: string | URL) => Deno.remove(path, { recursive: true });

const asPromise = <F, T extends F = F>(
  fn: (resolve: (from: F) => void) => unknown,
) => new Promise<T>((resolve) => fn((from) => resolve(from as T)));

const asWEPromise = (watcher: Watcher, name: string, timing = 1) =>
  asPromise<Event, WatchEvent>((fn) =>
    watcher.addEventListener(name, (e) => (--timing === 0 ? fn(e) : undefined))
  );

const timeout = <T>(promise: Promise<T>) => Std.async.deadline(promise, 100);

// https://github.com/tommywalkie/Deno.watchFs#add-a-new-empty-file
Deno.test("event: *create* => touch (f.) (c,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "touch");

  w.watch();

  const at = Std.path.join(tmpdir, "touch");
  await Deno.writeTextFile(at, "");

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "touch", at });
});

// https://github.com/tommywalkie/Deno.watchFs#add-a-new-file
Deno.test("event: *create and write* => new (f.) (cm,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "new");

  w.watch();

  const at = Std.path.join(tmpdir, "new");
  await Deno.writeTextFile(at, "new");

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "new", at });
});

// https://github.com/tommywalkie/Deno.watchFs#edit-a-file
Deno.test("event: *write* => modify (f.) (mm,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "modify");

  w.watch();

  const at = Std.path.join(tmpdir, "modify");
  await Deno.writeTextFile(at, "touch");
  await Deno.writeTextFile(at, "modify");

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "modify", at });
});

// https://github.com/tommywalkie/Deno.watchFs#add-a-new-folder
Deno.test("event: *mkdir* => touch (.d) (c,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const dWEP = asWEPromise(w, "touch");

  w.watch();

  const at = Std.path.join(tmpdir, "touch");
  await Deno.mkdir(at, { recursive: true });

  const dWE = await timeout(dWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(dWE.content, { type: "touch", at });
});

// https://github.com/tommywalkie/Deno.watchFs#copy-a-file
Deno.test("event: *copy* => move (f.) (cmm,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fnWEP = asWEPromise(w, "new", 2);
  const fmWEP = asWEPromise(w, "modify", 1);

  w.watch();

  const from = Std.path.join(tmpdir, "new-from");
  const to = Std.path.join(tmpdir, "new-to");

  await Deno.writeTextFile(from, "new");
  await Std.fs.copy(from, to);

  const fnWE = await timeout(fnWEP);
  const fmWE = await timeout(fmWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fnWE.content, { type: "new", at: to });
  assertEquals(fmWE.content, { type: "modify", at: to });
});

// https://github.com/tommywalkie/Deno.watchFs#copy-a-folder
Deno.test("event: *copy* => new (fd) (cmm,c)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const dnWEP = asWEPromise(w, "new", 3);
  const fnWEP = asWEPromise(w, "new", 4);
  const fmWEP = asWEPromise(w, "modify", 1);

  w.watch();

  const parentFrom = Std.path.join(tmpdir, "parent-from");
  const parentTo = Std.path.join(tmpdir, "parent-to");
  const from = Std.path.join(parentFrom, "new-from");
  const to = Std.path.join(parentTo, "new-to");

  await Deno.mkdir(parentFrom, { recursive: true });
  await Deno.writeTextFile(from, "new");
  await Std.fs.copy(parentFrom, parentTo);

  const dnWE = await timeout(dnWEP);
  const fnWE = await timeout(fnWEP);
  const fmWE = await timeout(fmWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(dnWE.content, { type: "new", at: parentTo });
  assertEquals(fnWE.content, { type: "new", at: to });
  assertEquals(fmWE.content, { type: "modify", at: to });
});

// https://github.com/tommywalkie/Deno.watchFs#move-a-file
Deno.test("event: *move* => move (f.) (mm,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "move");

  w.watch();

  const parent = Std.path.join(tmpdir, "parent");
  const from = Std.path.join(tmpdir, "move-from");
  const to = Std.path.join(parent, "move-to");

  await Deno.mkdir(parent);
  await Deno.writeTextFile(from, "move");
  await Std.fs.move(from, to, { overwrite: true });

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "move", from, to });
});

// https://github.com/tommywalkie/Deno.watchFs#move-a-folder
Deno.test("event: *move* => move (.d) (,mm)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const dWEP = asWEPromise(w, "move");

  w.watch();

  const parent = Std.path.join(tmpdir, "parent");
  const from = Std.path.join(tmpdir, "move-from");
  const to = Std.path.join(parent, "move-to");

  await Deno.mkdir(parent);
  await Deno.mkdir(from);
  await Std.fs.move(from, to, { overwrite: true });

  const dWE = await timeout(dWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(dWE.content, { type: "move", from, to });
});

// https://github.com/tommywalkie/Deno.watchFs#rename-a-file
Deno.test("event: *move* => move (f.) (mm,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "move");

  w.watch();

  const from = Std.path.join(tmpdir, "move-from");
  const to = Std.path.join(tmpdir, "move-to");

  await Deno.writeTextFile(from, "");
  await Deno.rename(from, to);

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "move", from, to });
});

// https://github.com/tommywalkie/Deno.watchFs#rename-a-folder
Deno.test("event: *move* => move (.d) (,mm)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const dWEP = asWEPromise(w, "move");

  w.watch();

  const from = Std.path.join(tmpdir, "move-from");
  const to = Std.path.join(tmpdir, "move-to");

  await Deno.mkdir(from, { recursive: true });
  await Deno.rename(from, to);

  const dWE = await timeout(dWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(dWE.content, { type: "move", from, to });
});

// https://github.com/tommywalkie/Deno.watchFs#remove-a-file
Deno.test("event: *remove* => remove (f.) (r,)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "remove");

  w.watch();

  const at = Std.path.join(tmpdir, "remove");

  await Deno.writeTextFile(at, "remove");
  await Deno.remove(at);

  const fWE = await timeout(fWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "remove", at });
});

// https://github.com/tommywalkie/Deno.watchFs#remove-a-folder
Deno.test("event: *remove => remove (fd) (r,r)", async () => {
  const tmpdir = await mktmp();

  const w = new Watcher(tmpdir);
  const fWEP = asWEPromise(w, "remove", 1);
  const dWEP = asWEPromise(w, "remove", 2);

  w.watch();

  const dir = Std.path.join(tmpdir, "remove");
  const file = Std.path.join(dir, "remove");

  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(file, "remove");
  await Deno.remove(dir, { recursive: true });

  const fWE = await timeout(fWEP);
  const dWE = await timeout(dWEP);

  w.abort();
  await rmtmp(tmpdir);

  assertEquals(fWE.content, { type: "remove", at: dir });
  assertEquals(dWE.content, { type: "remove", at: file });
});

Deno.test("meta: cleanup", async () => {
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
