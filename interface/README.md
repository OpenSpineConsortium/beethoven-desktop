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

Every import is from `OpenSpineConsortium/hpcworker`, version 1, at the commit its `ORIGIN` names:

| Export | Kind | Into | What reads it |
| --- | --- | --- | --- |
| `profiles` | data | `profiles/` | the server (`src/profile.ts`); the build ships every `profiles/*.json` byte for byte |
| `contract` | contract | `contract/` | `test/contract.test.ts`, which holds every pattern, word and number `src/contract.ts` types by hand equal to it and runs every vector this edition reads through the code that reads it; `scripts/forbidden.mjs`, which refuses every name of `rules.json`'s `credential_variables` in the shipped code |
| `contract-text` | text | `contract-text/` | people changing `src/contract.ts`; `test/contract.test.ts` reads from it the one line `lines.json` does not carry (the stop line, `V11_CONTRACT.md` section 7.1) |
| `testbed` | program | `test/hpcworker-testbed/` | the opt-in real-gate lane (`test/lab.ts`): the fake scheduler, first on the lab's `PATH` |
| `framework` | program | `test/hpcworker-framework/` | the same lane: the lab's shared copy, run as a black box behind the testbed |

The server ships without any of them but the profiles: what it reads of the cluster side is typed by
hand in `src/contract.ts`, and the conformance test is what keeps those copies honest.

`profiles/`, `contract/` and `contract-text/` are committed with their `ORIGIN`. The two program
folders commit their `ORIGIN` alone; git ignores the rest (`.gitignore`), and they are filled only by a
person who wants the real-gate lane.

## How a copy is taken

```
bash interface/pull.sh FOLDER...              # hpcworker's main, through your own gh sign-in
bash interface/pull.sh --ref REF FOLDER...    # a commit, tag or branch that main contains
bash interface/pull.sh --all                  # every import, at one commit
bash interface/pull.sh --pinned FOLDER...     # exactly the commit FOLDER/ORIGIN already names
```

`FOLDER` is an import's `into`. The script asks GitHub through `gh` only: the commit, the provider's
`INTERFACE.json` at that commit, its tree (with each file's mode, so a program keeps its executable
bit) and each file's raw bytes; never a clone, a checkout or the provider's code. It refuses a commit
the provider's default branch does not contain, an export the provider does not list, and a version
other than the import's. It fetches every file before it places any, writes `ORIGIN` (repository,
commit, `export <id> <version>`, one `sha256` line per file, sorted by path), never deletes, and lists
a file the export dropped for a person to remove in a reviewed commit. `bash profiles/pull.sh` is the
same script for `profiles/`, under the name written down before the others existed.

Commit a pulled copy and its `ORIGIN` together, and the code a conformance test then asks to change
with them.

## The real-gate lane

`test/grid.ssh.test.ts` runs the server against an sshd of this account on 127.0.0.1 (`test/lab.ts`)
behind a stand-in of the gate (`test/gate-standin.sh`, itself held to the contract in
`test/contract.test.ts`). Its last block runs hpcworker's real gate instead, and it is opt-in: it
runs where a person fetched the two programs,

```
bash interface/pull.sh --pinned test/hpcworker-testbed test/hpcworker-framework
npm test
```

and otherwise skips, naming that command. Before anything of them is copied or run, the lab checks
both folders against their `ORIGIN`; a folder that is half fetched or edited fails the run instead of
skipping it. Nothing reads a checkout of hpcworker or a variable naming one, and nothing imports its
tests. It needs sshd like every ssh test, and CI cannot run it, since fetching from the private
repository needs a sign-in no workflow here holds.

## What checks it

`test/boundary.test.ts`, in `npm test` (so in the gate, before every push, and in CI):

- rule 1: no tracked file reaches another repository's checkout (a sibling path, a variable naming a
  checkout, a clone, a submodule, a workflow checking out another repository, a dependency by path or
  git URL, an import of another repository's code), except the short known list in the test, each
  entry with its reason and who removes it; an entry that no longer matches fails, so the list only
  shrinks;
- rule 2: `INTERFACE.json` has the standard's shape and every export path names a file;
- rule 3: each import folder holds exactly the files its `ORIGIN` lists, byte for byte, besides
  `ORIGIN` and its own `README.md` and `pull.sh` (the framework's own `README.md` is one of its files),
  and `ORIGIN` names the import's repository, a commit, and the export and version the import names; a
  committed import is tracked whole; a fetched one tracks its `ORIGIN` alone, git ignores the rest,
  and when it holds any file it is checked whole.

`test/contract.test.ts` is rule 4 (`test/origin.ts` holds the `ORIGIN` check both tests use).
