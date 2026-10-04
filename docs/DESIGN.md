# Beethoven for Claude Desktop and Claude Code: design

Version 1, 2026-10-04 (Linear BEE-154, project F1). It follows the spike
(`plan/DESKTOP_EXTENSION_SPIKE.md` in the project's files, BEE-153) and says where the prototype
departs from it and why. Beethoven runs Claude Code and is not an Anthropic product; "Claude" and
"Claude Code" are Anthropic's marks, used here to say what it runs; "Open OnDemand" is the mark of its
publisher. Nothing here has run against the real grid yet; `docs/LAPTOP_CHECKS.md` lists what must.

## 1. What exists already, and what this adds

- **Claude Desktop extensions** are local MCP servers in a `.mcpb` zip with a `manifest.json`
  (`manifest_version` 0.3). Desktop runs a `node` server with its own Node. Desktop is on macOS and
  Windows, and Anthropic now ships a Linux beta, so the spike's "macOS and Windows only" no longer holds;
  the manifest lists all three platforms.
- **Claude Code plugins** carry MCP servers too (`.claude-plugin/plugin.json`, `mcpServers`,
  `userConfig`), for the CLI and the Code tab of Claude Desktop. The same folder serves both: the build
  writes the `.mcpb` manifest and the plugin manifest side by side, and one server reads its settings
  from the environment either host sets.
- **Claude Code Desktop's own SSH sessions** run a remote Claude Code: adding a host installs Claude Code
  on it and runs it there. On Wayne State's grid that host would be the login node, where the banner
  bans `node` and C&IT asked for nothing container-related. Through a jump to a compute node of one's
  own job the hop works, but the node's CentOS 7 cannot run the Claude Code Desktop installs
  (`EDITIONS.md` section 3). So that feature is not a way in, as documented, and the server's
  instructions and the plugin's skill tell the model never to suggest it.
- **The browser edition** cannot open a terminal on the grid (its key is the gate's, forced to eight
  verbs, no pty) and shows three run files and no workspace. This edition adds what it cannot: a real
  terminal for the sign-in, and a read-only view of the worker's workspace.

What this edition is for: the student (or lab lead) who wants their worker's files and status in the
same Claude conversation, on their own computer, with their own ssh.

## 2. The ssh model

**The system's own ssh, never a library.** The server starts the computer's `ssh` and `ssh-keyscan`.
The student's own ssh setup, the grid's password and one-time code prompts, and any hardware key work as
they already do; no ssh code of ours needs an audit; no native binary needs signing.

**The sign-in is the student's, in a terminal window.** `grid_sign_in` writes a small launcher into
`~/.beethoven-desktop/` (owner only: the ssh line and three plain sentences; there is no secret to write)
and asks the operating system to open it in its terminal app (`open -a Terminal` on macOS, a console
window through `start` on Windows, the first of the usual terminal apps on Linux). The student types the
password and code in ssh's own prompt. That ssh is a connection master (`ControlMaster=auto`,
`ControlPersist=4h`, `ControlPath=~/.beethoven-desktop/cm-%C`); once signed in, the window may close and
every tool call is a client of the master (`ControlMaster=no`, `BatchMode=yes`). With no master, ssh
signs in by itself with the student's own key or agent only and, for a password account, fails at once
with "not signed in": no tool can ever prompt. The spike's askpass helper is not used: it would put the
password through a program of ours.

**Windows.** Windows' own OpenSSH is expected not to support connection masters (not yet measured on
a machine). Two ways are offered: "Use WSL" in the settings runs WSL's ssh (masters work there; the
socket lives in WSL's home), or, without it, each request signs in by itself and so needs the student's
own key for the grid. Which of these the pilot uses is a laptop check.

**The host key is pinned.** The site profile carries `ssh_host_key` (SHA256). Before the first request,
`ssh-keyscan` fetches the grid's keys anonymously and only lines whose fingerprint equals the pin are
written to our own `known_hosts`; ssh then runs with `StrictHostKeyChecking=yes` against that file only.
A grid that answers with another key gets nothing about the student, not even the account name.

**Every ssh is hardened the same way:** `ForwardAgent=no`, `ForwardX11=no`, `ClearAllForwardings=yes`,
`PermitLocalCommand=no`, `UpdateHostKeys=no`; `-T` for requests; the child's environment drops every
variable named like a token, secret, password, key or a Claude/Anthropic setting.

## 3. What runs on the grid

(What the three editions share, Claude Code Desktop's own SSH sessions, and the client side of teams
across accounts and grid jobs: `EDITIONS.md`.)

**The gate's lines, run through the lab's shared copy.** Where the spike called `hpcworker worker
status`, `connect` and `worker stop` directly, the prototype sends exactly the gate's verbs, as
`env SSH_ORIGINAL_COMMAND='<line>' bash '<shared>/bin/hpcworker' gate` over the student's own session:

| Tool | Line |
|---|---|
| `grid_check` | `version` |
| `worker_status`, `open_in_claude` | `status NAME` |
| `worker_start` | `connect NAME SITE - MODE chain` or `no-chain` (the gate adds `--login never`) |
| `worker_stop` | `stop NAME` |
| `worker_log` | `read NAME progress.log` |
| `worker_list` | none: sshd's sftp reads `<state_dir>/<name>/status.json` for each run folder, and no other file of it |
| `account_list` | none, and nothing over sftp either: it reads two files on this computer (section 7) |

Why the gate: its word allowlist, its caps (three names a week, twelve starts an hour), its 60 s poll
floor, its `--login never` and its output format are already reviewed and tested in the server repository,
and the browser speaks the same lines. This is a restriction the edition keeps on itself, not one sshd
enforces: the student's own session could run anything, and the edition simply never sends anything
else (the lab's sshd test counts it: every command session is one gate line). The gate's `watch`,
`restrict` and `forget` are never sent. `rc.log` is not read (the gate refuses it; it carries the worker's
own output).

**Files over sshd's own sftp-server.** `workspace_list` and `workspace_read` speak SFTP version 3 to
`ssh -s … sftp` with a client of about 350 lines that has only REALPATH, LSTAT, FSTAT, OPENDIR, READDIR,
OPEN-for-read, READ and CLOSE: no request that writes, renames or removes exists in it. Reads are confined
to `<state_dir>/workspaces/<name>`: the grid resolves every folder (REALPATH) and it must lie inside the
workspace's own resolved root; a file must be plain by LSTAT (a link is refused, not followed); the open
file's FSTAT must match what LSTAT saw; names that hold credentials (`.credentials.json`, `.claude.json`,
`*.token`, `.env*`, `*.pem`, `*.key`, `id_*`, `.netrc`) are refused by name; the text passes a credential
redactor; binary files are not shown. The run directory itself (where `job.token` lives) is never listed.
A `~/.bashrc` that prints breaks OpenSSH's own sftp ("message too long"); this client skips text before
the session's first reply (up to 64 KiB), and the lab's sshd test runs with such a `~/.bashrc`.

**Floors.** Status at most once a minute per worker (the last answer is given again with its time);
starts and stops at most once a minute; the log and each workspace read at most once in five seconds.
Requests go one at a time over the one connection.

## 4. What it never does

- Hold, read, store, log or relay a Claude credential, a grid password, a one-time code or a key; no tool
  or setting has a field for one.
- Use usage credits or an API key: the worker runs on the student's own flat-rate subscription, and this
  edition has no billing setting and nothing that asks for more usage.
- Open a network connection of its own (no HTTP client, no socket code, no run-time dependency), load
  code, or touch claude.ai beyond handing one checked link to the browser.
- Run anything on the login node beyond the gate's verbs and sftp-server, or run Claude Code there.
- Delete anything, here or on the grid.

`scripts/forbidden.mjs` fails the build on what a text search can see of these (imports outside Node's
own process, file, path and hash modules; `fetch`; `eval`; a shell; askpass and password options; the
Claude sign-in folder's names; deletions; output beside the protocol; the gate verbs never sent).

## 5. Before students

The prototype is for the maintainer and the lab. Before any student installs it:

1. **The agreement and privacy texts** (`LICENSE.txt`, `PRIVACY.md`, canonical in the browser repository)
   must describe this edition (what it reads on the grid, the local folder, the pinned key, no requests to
   the vendor), with integer version bumps, and the edition must show and record acceptance before its
   first grid request; it has no acceptance step yet.
2. **The credential posture review** (BEE-157): the sign-in launcher, the kept master, the sftp path rules
   and the redactor, read by someone other than their author.
3. **Distribution** (BEE-158, D6, greg's decision): the browser's rule is one private Chrome Web Store
   listing; this edition has no store. Options: the `.mcpb` from CI handed to approved students the way
   the browser edition reaches them, a university Claude organization's extension allowlist, or the
   Connectors Directory (which Anthropic calls the secondary path for bundles). Until decided, nothing is
   offered.
4. **Withdrawal.** The browser edition checks a signed withdrawn-versions list; this edition opens no
   connection of its own, so it has no such check. Access still ends where it must: the shared copy is
   behind the grid's approved list (the volume root's named-user ACL), so a removed student's
   `bash <shared>/bin/hpcworker` fails and the tool says to ask the lab lead.
5. **Signing**: `mcpb sign` exists; what Desktop shows for an unsigned or self-signed bundle is a laptop
   check.

## 6. Answers to the spike's open questions so far

| # | Question | Answer |
|---|---|---|
| 1 | Per-tool approval in Desktop | not yet measured (laptop check 2) |
| 2 | Windows OpenSSH masters; askpass | askpass dropped by design; masters not yet measured (checks 3, 4) |
| 3 | Self-signed bundle at install | not yet measured (check 1) |
| 4 | Where Desktop writes stderr and tool traffic | not yet measured (check 8); the server writes one start line |
| 5 | An unrestricted desktop key beside the gate's | not needed: the kept password-and-code sign-in serves every request |
| 6 | Login-node load with both editions open | each request is one short channel over the one kept connection; not yet measured on warrior |
| 7 | `realpath` through the `shared/ashley` link on CephFS | the workspace root is resolved by the grid itself; not yet measured (check 7) |
| 8 | Which channel reaches students | greg's decision, BEE-158 |

## 7. The student's own Claude accounts on this computer

greg's ask of 2026-10-04 02:30Z lets one person run several Claude accounts of their own; the engine's
account switcher, `bee` (`beethoven-research`, `src/beethoven_research/bee/`, `docs/bee/`), keeps the
list on each machine. `account_list` shows that list on this computer and changes nothing in it.

**What it reads, and nothing else.** bee's folder is `$BEE_REGISTRY_DIR`, else `$BEETHOVEN_HOME/engine`,
else `~/.beethoven/engine`, the same rule bee uses. In it, `accounts.json` (version 1: label, the folder
each account signs in to, on or off, order, resting time; at most 64 KiB) and, per listed label,
`usage/<label>.json` (the last 5-hour and 7-day readings the account's status line saw; at most 4 KiB).
Each must be a plain file: bee replaces its files whole, so a link (which could point anywhere) is
refused unread, the list with a sentence and a reading as no reading. The folder each account signs in to is shown in the structured result as a path and is never opened,
listed or checked; a unit test records every path the reader asks for. No process is started (bee is not
run), and nothing goes to the grid.

**The same answer as bee.** The rows are `bee account list --json`'s: in order, a resting time only while
it lasts, a reading only until its window resets. A list bee refuses (another version, a field bee never
writes, a label or folder twice, a relative folder, a time without its zone) is refused here with a plain
sentence, never shown in part. Checked once against bee itself at `beethoven-research` b7b8650: the same
rows for a four-account fixture, and the same verdict on twelve lists, ten refused and two taken.

**Not here yet.** The list on the grid (bee keeps one there too, under the grid account's
`~/.beethoven/engine`): reading it would widen the sftp reads beyond the workspace and each run's
`status.json`, so it waits on a decision. Which bee account a grid worker runs under: `status.json`
would need an `account` field written from `BEE_ACCOUNT`, a contract change in `hpcworker`
(`docs/V12_CONTRACT.md`) and every client together (`EDITIONS.md` section 4); until then `worker_list`
names a worker's Claude account by the e-mail address Claude Code reported, and the two views are matched
by the student. A list kept inside WSL is not the Windows home's and is not read. Whether a
`BEE_REGISTRY_DIR` set by the student reaches the server under Claude Desktop is laptop check 15.
