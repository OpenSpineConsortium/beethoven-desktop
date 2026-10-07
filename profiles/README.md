# Vendored site profiles

These JSON files are **data**: a pinned copy of the export `profiles` version 1 of
`OpenSpineConsortium/hpcworker` (`framework/profiles/*.json` there, their canonical home), taken under
the interface standard (https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md). The
build (`scripts/build.mjs`) copies every `*.json` here into the bundle beside the server, byte for
byte; the server reads only the keys named in `src/profile.ts`.

`ORIGIN` names the hpcworker commit the files equal, the export and its version, and each file's
sha256, and `test/boundary.test.ts` fails when a file differs from it or the folder holds one it does
not list.

When hpcworker's export changes, take a new copy (never edit one by hand):

```
bash profiles/pull.sh              # hpcworker's main through your own gh sign-in
bash profiles/pull.sh --ref REF    # a commit, tag or branch that main contains
```

(`profiles/pull.sh` is `interface/pull.sh` for this folder; `interface/README.md` says how it takes a
copy), then commit the copy and `ORIGIN` together. No code lives here and none may.
