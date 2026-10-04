# Vendored site profiles

These JSON files are **data**, vendored from the server repository
(`OpenSpineConsortium/hpcworker`, `framework/profiles/`), which is their canonical home. The build
(`scripts/build.mjs`) copies them into the bundle beside the server; the server reads only the keys
named in `src/profile.ts`.

When a profile changes in the server repository, refresh the copy here:

```
bash profiles/pull.sh        # from the repository root; uses your gh sign-in
```

then commit the change. No code lives here and none may.
