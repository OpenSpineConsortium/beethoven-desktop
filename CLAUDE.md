# Beethoven for Claude Desktop and Claude Code — working context

The desktop edition of Beethoven: a local MCP server (`src/`), packaged as a Claude Desktop extension
(`bundle/manifest.json`, `.mcpb`) and as a Claude Code plugin (`plugin/.claude-plugin/plugin.json`),
that reaches a student's Claude Code worker on their university's grid over the student's own ssh
sign-in. It is the third repository of the split, beside `OpenSpineConsortium/hpcworker` (the cluster
side, canonical for the contract and the site profiles) and `OpenSpineConsortium/beethoven-extension`
(the browser edition). Beethoven runs Claude Code and is not an Anthropic product; "Claude" and
"Claude Code" are Anthropic's marks, used here to say what it runs; "Open OnDemand" is the mark of its
publisher.

## Read first

- `docs/DESIGN.md` (what this edition is, what it never does, what must happen before students).
- `docs/LAPTOP_CHECKS.md` (what only a real machine and the real grid can settle; outcomes recorded there).
- `docs/EDITIONS.md` (what the three editions share, Claude Code Desktop's own SSH, and the client side of
  teams across accounts and grid jobs).
- The non-negotiable rules in the two other repositories' `CLAUDE.md` govern here too, unchanged. The
  ones this code touches most are restated below; when they differ, theirs win.

## Rules that are not negotiable

- **Never a Claude credential.** No `setup-token`, no `CLAUDE_CODE_OAUTH_TOKEN`, no reading
  `~/.claude/.credentials.json` or `~/.beethoven/claude` (or `~/.ashley/claude`), never
  `claude auth logout`. The worker is always started without a Claude sign-in (the gate's `connect`
  is `--login never`); the student signs in to Claude only in their own terminal on a compute node.
- **Never usage credits, by anyone, ever** (greg, 2026-10-04, same rank as every other rule here). No
  API key, no billing setting, nothing that asks for or relies on paid usage beyond the student's own
  flat-rate subscription. Several Claude accounts of the student's own may run workers at once (greg,
  2026-10-04 02:30Z); this edition shows which account each worker reported and never holds, copies or
  switches a sign-in. Which sign-in a job uses, and handing the lead between accounts, is the engine's
  (`beethoven-research`, `BUILD_PLAN.md` section 17).
- **No secret in a tool, a setting, an argv, a log or a file.** No tool schema or `user_config` field
  takes a password, a code, a key or a token. The grid password and one-time code are typed only into
  ssh's own prompt in a terminal window the student sees; this process never holds them. No askpass,
  no `sshpass`, no `expect`.
- **No network of our own and no remote code.** The server's only imports are Node's own modules for
  processes, files, paths and one hash; no `fetch`, no socket code, no `eval`, no dependency at run
  time. It starts only the computer's `ssh`, `ssh-keyscan`, terminal app and link opener.
  `npm run forbidden` enforces what a text search can see, and the build runs it on the shipped code.
- **Grid etiquette.** On the grid only the gate's own lines (`version`, `status`, `connect … chain|no-chain`,
  `stop`, `read … progress.log`) run, through the lab's shared copy, plus sshd's own sftp-server for
  reads. Nothing of ours runs on the login node beyond that; no container command, no `node`, no
  `python3`, no Claude Code there. Status at most once a minute; starts and stops at most once a minute.
  Never suggest adding the grid to Claude Code Desktop's SSH connections: that installs and runs
  Claude Code on the login node, and through a jump to a compute node it installs a build that the
  grid's CentOS 7 cannot run (`docs/EDITIONS.md` section 3).
- **Nothing is deleted**, here or on the grid. The sftp client has no request that writes, renames or
  removes. Workspace reads stay inside `<state_dir>/workspaces/<name>` by the grid's own REALPATH, never
  follow a link, refuse credential-named files and redact credential-shaped text. Of a run folder only
  `status.json` is ever opened.
- **No code on claude.ai.** One checked `https://claude.ai/code…` link is handed to the operating
  system's opener; nothing else touches claude.ai.
- **Students see plain words.** Tool results a student reads say what happened in sentences; no
  close codes, job flags or variable names.
- Never use the p-word (the one that starts "prov" and ends "enance") for the history of a file or a
  piece of data; say origin, source or record. Versions are integers (1.0.0, 2.0.0); `package.json`,
  both manifests and `src/version.ts` carry the same one (`scripts/build.mjs` checks).

## Layout

- `src/`: `index.ts` (the stdio server), `mcp.ts` (JSON-RPC 2.0 and MCP, hand-written, no SDK at run
  time), `tools.ts` (the eleven tools), `runs.ts` (every worker's `status.json`, and nothing else of a run folder), `grid.ts` (the verbs and their floors), `ssh.ts` (argv, the kept
  sign-in, the pinned host key), `sftp.ts` (a read-only SFTP v3 client), `workspace.ts` (the path rules),
  `terminal.ts` (the sign-in launcher, the terminal and the opener), `contract.ts` (mirrors the server
  repository's `docs/V11_CONTRACT.md` and `docs/V12_CONTRACT.md`), `redact.ts`, `profile.ts`, `config.ts`.
- `profiles/`: site profiles vendored as data from `hpcworker` (`bash profiles/pull.sh`).
- `bundle/`, `plugin/`: the two manifests, the icon and the plugin's skill.
- `test/`: `unit.test.ts`; `lab.ts` (a real sshd of this account on 127.0.0.1 with the grid's
  algorithms) with `gate-standin.sh`; `grid.ssh.test.ts`; `mcp.e2e.test.ts` (the built server through
  the official MCP SDK client).

## Building and testing

```
npm ci
npm run typecheck && npm test              # the ssh tests need sshd (Ubuntu: openssh-server); Linux only
HPCWORKER_DIR=../hpcworker npm test        # also the real hpcworker gate behind the same sshd
npm run build                              # dist/beethoven/: the extension folder and the plugin folder in one
npm run pack                               # dist/beethoven-<version>.mcpb, validated by @anthropic-ai/mcpb
claude plugin validate dist/beethoven
```

CI (`.github/workflows/ci.yml`) holds no secret: the full suite on ubuntu with `BD_REQUIRE_LAB=1` (the
ssh tests fail instead of skipping), the unit tests on macOS and Windows, the bundle and plugin
validated and uploaded as an artifact. The real-gate test needs the private server repository, so it
runs on a maintainer's machine or in a session that has both checkouts.

**The tests decide what lands, with no human step** (greg, 2026-10-04). `.githooks/pre-push` runs
`npm run gate` (typecheck, forbidden, tests, the packed and validated bundle) and a red gate does not
leave the machine; `npm ci` points git at it (`npm run hooks`). `SKIP_GATE=1` skips it knowingly, and
the commit says why. Work goes to `main` through pull requests, opened ready for review and never as
drafts; `.github/workflows/automerge.yml` arms GitHub's auto-merge on each one, and it merges when
the checks `.github/rulesets/main.json` requires are green (deletion and force-push blocked;
organization admins bypass). That rule is applied to GitHub by `.github/workflows/rulesets.yml`
with the maintainer's `RULESETS_TOKEN` secret; until it is applied, auto-merge stays off, because
armed without a required check it would merge before the tests. The laptop checks never hold a
merge: they cannot run in CI, and they are the maintainer's verification after it.

## How to be useful here

A wrong state that reads as plausible is the failure to fear. Check against something outside the
computation: the sshd log of the lab, the stand-in's `calls` file, the real gate's output, a real
machine's screen. What no machine has shown yet is "not yet measured", and `docs/LAPTOP_CHECKS.md` is
where it gets measured.
