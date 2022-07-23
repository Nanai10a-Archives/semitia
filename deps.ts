import * as flags from "https://deno.land/std/flags/mod.ts";
import * as fs from "https://deno.land/std/fs/mod.ts";
import * as path from "https://deno.land/std/path/mod.ts";
import * as asserts from "https://deno.land/std/testing/asserts.ts";
const Std = { flags, fs, path, testing: { asserts } };

import * as Cliffy from "https://deno.land/x/cliffy/mod.ts";

export { Cliffy, Std };
