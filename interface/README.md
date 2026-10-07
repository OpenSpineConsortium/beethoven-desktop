# What beethoven-desktop offers and takes

This repository is one sealed unit of the Beethoven ecosystem (the interface standard:
https://github.com/OpenSpineConsortium/beethoven/blob/main/INTERFACES.md). `INTERFACE.json` lists
what it offers other repositories and what it takes from them; everything not listed is private and
may change in any pull request.

## What it offers

Nothing to another repository: `exports` is empty. What it offers people (the MCP server's tools, the
bundle and the plugin) is read by Claude Desktop and Claude Code, not by a repository of the
ecosystem.

## What it takes

| From | Export | Version | Into | Taken by |
| --- | --- | --- | --- | --- |
| `OpenSpineConsortium/hpcworker` | `profiles` (data: the composed site profiles) | 1 | `profiles/` | `profiles/pull.sh`, recorded in `profiles/ORIGIN` |

The copy in `profiles/` predates hpcworker's own `INTERFACE.json`, so its `ORIGIN` names the commit
on hpcworker's `main` whose `framework/profiles/wayne.json` it equals, with no `export` line; the next
pull, from a commit `main` contains, writes one.

Once hpcworker's interface is merged, this repository also takes (Wave B):

- hpcworker's `contract` export (the lines, the file schemas, the rules and the vectors the real
  writer produced), so the hand-typed parsers and constants in `src/contract.ts` are tested against
  it rather than against this repository's own strings;
- for the opt-in test against the real gate, hpcworker's `testbed` and `framework` program exports,
  each as a folder that commits only its `ORIGIN` and holds the fetched files ignored by git; the
  test checks them against `ORIGIN` before it runs them. Until then that test reads a sibling
  checkout named by `HPCWORKER_DIR`, which `test/boundary.test.ts` lists among the known reaches.

## What checks it

`test/boundary.test.ts`, in `npm test` (so in the gate, before every push, and in CI):

- rule 1: no tracked file reaches another repository's checkout (a sibling path, a variable naming a
  checkout, a clone, a submodule, a workflow checking out another repository, a dependency by path or
  git URL, an import of another repository's code), except the short known list in the test, each
  entry with its reason and who removes it; an entry that no longer matches fails, so the list only
  shrinks;
- rule 2: `INTERFACE.json` has the standard's shape and every export path names a file;
- rule 3: each import folder holds exactly the files its `ORIGIN` lists, byte for byte, besides
  `ORIGIN`, `README.md` and `pull.sh`, and `ORIGIN` names the import's repository, a commit, and the
  export and version the import names when it has an `export` line.
