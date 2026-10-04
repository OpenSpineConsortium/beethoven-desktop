# The three editions, Claude Code Desktop, and teams across grid jobs

greg, 2026-10-04 02:30Z: the desktop edition must work seamlessly with the Claude Code Desktop app, use
Desktop's own ssh if it can, and the three editions (the browser extension, Beethoven for VS Code and
this one) share what each has proven and improve each other. This is the desktop side of that; the
engine's design for several accounts and agent teams is `BUILD_PLAN.md` section 17 (the project's plan
files) and is not repeated here. Read on 2026-10-04: `beethoven-extension` at 7ecea53, `beethoven-vscode`
at 9ba36d2 (version 4.0.0) and, for section 2's two rule rows, at a8e5490 (the merge of pull request #5),
`hpcworker` at 73af802, the Desktop page `code.claude.com/docs/en/desktop`.

## 1. What each edition has proven

| Edition | Proven, with where it was measured |
|---|---|
| Browser (`beethoven-extension`, 12.x) | The contract (`status.json`, `connection.json`, `progress.log`, the `HPCW-STEP` lines) against the real grid; the gate (`hpcworker gate`, eight fixed verbs) as the only thing a client sends; the one-time grid key whose only command is the gate; the run folder read from `status.json` alone (server `docs/V11_CONTRACT.md` section 12); the redaction rules; a student's own sitting (hy9698, 2026-10-03). |
| VS Code (`beethoven-vscode`, 4.0.0) | ssh from Windows to the grid needs `MACs +hmac-sha1` ("no matching MAC found" without it) and is 13 s faster per connection with `AddressFamily inet` (nine runs each, 2026-09-28; its `extension/src/core/sshConfig.ts`); a key alone signs in to the login node with no one-time code (its BatchMode check, `docs/CHECKPOINT_2026-09-28.md` item 2); ssh to a compute node of one's own job through the login node (`ProxyJump`) works, about 23 s of it on the node's side (item 7); VS Code's own server ran on a compute node only under C&IT's glibc sysroot (item 8); Claude Code's own binary does not run on the grid's CentOS 7 (glibc 2.17), so it runs inside the Debian image (`docs/RESEARCH.md`); a study of claude-swap (`docs/research/claude_swap_notes.md`). |
| Desktop (this, 1.0.0) | The gate's lines over the student's own OpenSSH, kept as a connection master, against a real sshd and the real `hpcworker` 16 gate; a read-only sftp client that survives a `~/.bashrc` that prints; the host key pinned from the site profile. Nothing yet on a real laptop or the real grid (`LAPTOP_CHECKS.md`). |

## 2. What crosses, and where it stands

| What | From | Into | State |
|---|---|---|---|
| `MACs=+hmac-sha1`, `AddressFamily=inet` on every ssh, `-4` on the host-key scan | VS Code | desktop | **done here** (`src/ssh.ts`), unit-tested; on Windows not yet measured (checks 4 and 5) |
| Every worker of the account, read from each run folder's `status.json` and nothing else of it | browser | desktop | **done here**: `worker_list` (`src/runs.ts`), tested against sshd with the stand-in and with the real gate |
| A worker that says it is running but has not rewritten its status for five minutes is named as possibly gone | (new) | desktop | **done here**; the browser and VS Code could show the same line |
| The student's own Claude accounts on this computer, as the engine's `bee` lists them (the project's `plan/ACCOUNT_SWITCH_CLIENTS.md`, item 1) | engine | desktop | **done here**: `account_list` (`src/accounts.ts`) reads bee's list and usage files, gives the rows `bee account list --json` gives, and opens no sign-in folder (`DESIGN.md` section 7). The worker's account label in `status.json` waits on the contract (section 4). |
| The one-time grid key restricted to `hpcworker gate`, so the student signs in with the code once, not every four hours | browser | desktop | proposed: the browser keeps the key non-extractable in the browser; here it would have to live in the operating system's own ssh agent, never in a file of ours (the no-secret-in-a-file rule). Needs its own design and greg's word. |
| Diagnostics with every feature (a check per feature, `REQUIRED_BY_FEATURE`) | VS Code | desktop, browser | proposed: `grid_check` grows one line per feature |
| Drop the pay-per-use API key overflow (`anthropicApiKey`, `beethoven accounts add-key`) | rule | VS Code | **merged** 2026-10-04 13:27Z: `beethoven-vscode` pull request #5 (5.0.0, BEE-191, greg's order of 03:15Z): the worker answers "rate limited" with the reset time when the window is spent, and a key stored by 4.0.0 is never used. 5.0.0 is not yet built or signed; the newest built release is still 4.0.0, which has the overflow. |
| No API key anywhere, "the only fundamental rule of this software" (greg, 2026-10-04 13:27Z): no Console or API key, no `apiKeyHelper`, no Bedrock, Vertex or Foundry route, no gateway (`ANTHROPIC_BASE_URL`), no CI that runs Claude Code on a key or a token held as a secret (claude-code-action or the like), no usage credits; in the code, in what a student reads, in the documents and in the maintainer's own tooling | rule | all three, and the cluster side | Desktop: **done here**. The server starts no Claude Code; every program it starts loses each variable that would put Claude Code on a key, a token, a gateway or a cloud provider (`childEnv`, unit-tested with all nine); `npm run forbidden` fails the shipped code on any of those names, `apiKeyHelper`, the Console's sign-in (`--console`) or its pages, or a key's `sk-ant-` prefix, except on the lines that take them away (the drop list, the redactor), with a test each way; CI uses no Anthropic key (its one secret, `RULESETS_TOKEN`, is a GitHub token that applies the branch rule and runs no Claude Code). VS Code: the row above. Browser (read at 7ecea53) and the cluster side (read at 73af802): each repository's own sweep; at 73af802 the worker's environment loses the key, token, gateway and file-descriptor variables, not yet the three cloud-provider switches (`CLAUDE_CODE_USE_BEDROCK`, `_VERTEX`, `_FOUNDRY`); at 7ecea53 the browser's sign-in check (`checks.ts`) still takes a token sign-in (`oauth`) as good, where only `claude.ai` is the subscription. |
| One cluster side for all three: the lab's shared `hpcworker` and its gate instead of VS Code's own daemon (`grid/beethovend.js`) and `~/.beethoven/bin` copy | browser, desktop | VS Code | proposed; it would make a VS Code worker appear in the other two editions' lists |
| The pinned host key from the site profile | desktop | VS Code | proposed (VS Code uses `StrictHostKeyChecking accept-new` for nodes) |
| The browser's contract mirror (`contract.ts`) | browser | desktop | already shared: `src/contract.ts` mirrors the same server documents |

Never crosses: licence keys (VS Code keeps its own; the browser dropped them in 4.0.0; none here), any
copied or relayed Claude credential, setup-tokens, an API key.

## 3. Claude Code Desktop

**What works now.** The plugin (`dist/beethoven`) loads in Claude Code, including the Code tab's local
sessions ("click the + button ... and select Plugins"), and the `.mcpb` in the Chat tab. The worker
itself is a Remote Control session, so its `https://claude.ai/code?environment=…` link (`open_in_claude`)
opens it in claude.ai; whether Desktop's Code tab can open it directly is not documented on the Desktop
page and is not yet measured (check 13).

**Why Desktop's own SSH sessions cannot host the grid's worker, as documented.** The page says: "The
remote machine must run Linux or macOS. Desktop installs Claude Code on the remote machine automatically
the first time you connect." Pointed at the login node, that installs and runs Claude Code there, which
the grid forbids. Pointed at a compute node of a running job through `ProxyJump` (the shape in
`BUILD_PLAN.md` 17.1 D6), the hop works (measured by the VS Code edition, asx1, 2026-09-28) and a key
needs no one-time code (measured the same day), so M7 is answered yes and M8 does not arise with a key.
What stops it is the node itself: the compute nodes run CentOS 7 with glibc 2.17, VS Code's own server
ran there only under C&IT's glibc sysroot, and Claude Code's native binary needs a newer system (its
documented floor is Ubuntu 20.04 or Debian 10; reports give GLIBC_2.26 since 2.1.243 and a crash on
CentOS 7.9), which is why every worker runs Claude Code inside the lab's Debian image. Since 2.1.113
Claude Code does not use Node at run time, so a Node under the home folder changes nothing. The page
documents no setting to run Desktop's remote Claude Code through a wrapper such as `apptainer exec`, the
way the VS Code extension has `claudeProcessWrapper`. So: not as documented. One experiment could change
that (check 14: what Desktop installs on a compute node, and whether it runs); until then the desktop
edition keeps its own ssh, the student's OpenSSH.

**Agent teams are not in Desktop.** The page: "Agent teams ... are available in the CLI, not in
Desktop." Desktop's "work across sessions" sees only the sessions Desktop runs itself (local, SSH,
WSL). Cross-session messaging reaches other sessions of the same account, across machines over Remote
Control (`BUILD_PLAN.md` 17.1 X4), which would let a Code tab session message the grid worker; not yet
measured (check 13).

## 4. Teams across accounts and grid jobs: what the clients show and control

The engine (BUILD_PLAN 17.2) runs one master per account, each an always-on Slurm job in the worker's
shape, with satellite sessions as further Slurm jobs, one account holding the super-master lease, and a
registry with one row per session. Its registry lives in the engine's store, which no client reaches
(no network of our own). What the clients can read, all three the same way, is files under the grid
account's state directory. So the proposal to the engine (for the re-plan and skeleton threads to take
or change):

1. **Every master and satellite is a run folder with a `status.json`**, started through the lab's
   `hpcworker`, so `worker_list` (here), the browser's run listing and a VS Code tree show them with no
   new reader, and the gate's `stop NAME` stops any of them.
2. **`status.json` gains four fields**, written by the job: `account` (the label, never anything from
   inside the sign-in directory), `role` (`master` or `satellite`), `parent` (the master's run name; empty
   for a master) and `lease` (`{"holder": true, "expires_at": "…"}` on the holder only). A contract change
   in `docs/V12_CONTRACT.md` and every client together.
3. **What every client then shows**: one tree per account (master, then its satellites), the lease
   holder marked; per session its state, computer, job, the Claude account it reported (already shown
   here from `claude_login`) and its link; a satellite whose parent is stopped or silent for five minutes
   flagged "without its master"; a session that says it runs but has gone silent flagged (already here).
4. **What a client controls**: open a session's link; stop a session (the gate's `stop`, asked first,
   `destructiveHint`); start a master for an account the student has signed in. A client never signs in,
   never switches which account a job uses, never moves the lease and never writes to the state
   directory: those are the engine's. Teammates inside one master (Claude Code's own in-process team) are
   not separate jobs and show as the master's; the engine's roster file, if it writes one beside the
   status, can list them read-only.

## 5. Not yet measured

On a real machine: checks 4, 5 and 12 to 14 in `LAPTOP_CHECKS.md`. On the grid: whether the image's
`claude` could serve as Desktop's remote Claude Code; whether a Code tab session lists and messages the
worker over Remote Control; the four status fields of section 4 (they do not exist yet).
