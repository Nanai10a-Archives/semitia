# semitia

for [deno](https://deno.land), thin wrapper of
[`Deno.watchFs`](https://doc.deno.land/deno/stable/~/Deno.watchFs)

"semitia" ... from [twdne](https://l.thisworddoesnotexist.com/3ZZ2)

## usage

minimal usage:

```sh
deno run --allow-read=$PWD --allow-run https://deno.land/x/semitia/cli.ts -ms echo
```

...then if changed files, shows full paths of file.\
example:

```sh
$ deno run --allow-read=$PWD --allow-run https://deno.land/x/semitia/cli.ts -ms echo
# write some changes to README.md, then ...
/home/user/semitia/README.md
```

...but usually will be able to use this:

```sh
$ deno run -A https://deno.land/x/semitia/cli.ts -ms echo
```

## permission

here is a list of used `Deno` APIs.\
example:

- `API` : permission

then, it's list:

- `Deno.watchFs` : _**read**_
- `Deno.args` : none
- `Deno.run` : _**run**_

## install

(you can use `-A --unstable` flags, but semitia doesn't need unnecessary
permissions)

```sh
deno install --allow-read --allow-run --name semitia https://deno.land/x/semitia/cli.ts
```

_warn: please setup environment variables (**$PATH**) yourself!_
