# Beethoven for Claude Desktop and Claude Code

Beethoven runs Claude Code and is not an Anthropic product; "Claude" and "Claude Code" are Anthropic's marks, used here to say what it runs; "Open OnDemand" is the mark of its publisher.

The desktop edition of Beethoven: a small local MCP server that reaches a student's Claude Code
worker on their university's grid over **their own ssh sign-in**, packaged two ways from one folder:

- a **Claude Desktop extension** (`beethoven-<version>.mcpb`, installed from Settings, Extensions);
- a **Claude Code plugin** (the same folder, with `.claude-plugin/plugin.json`), for the CLI and the
  Code tab of Claude Desktop.

It is the complement of the browser extension (`OpenSpineConsortium/beethoven-extension`), which
cannot open a terminal on the grid or show the worker's files. It speaks the same worker contract as
the browser (`OpenSpineConsortium/hpcworker`, `docs/V11_CONTRACT.md` and `docs/V12_CONTRACT.md`) and
changes nothing on the cluster side.

**Status: a prototype for the maintainer and the lab.** Nothing here has run against the real grid
yet; `docs/LAPTOP_CHECKS.md` lists what a real machine must settle. The agreement and privacy texts
(`LICENSE.txt` and `PRIVACY.md` in the browser extension's repository) do not yet describe this
edition, so it is not offered to students until they do (`docs/DESIGN.md`, "Before students").

## What it does

| Tool | What happens |
|---|---|
| `grid_sign_in` | Checks the grid's host key against the one pinned in the site profile, then opens a terminal window with `ssh` to the grid. The student types the grid password and one-time code there, in ssh's own prompt. That ssh stays as a connection master on this computer (four hours after its last use), and every other tool is a client of it. |
| `grid_sign_out` | Ends that kept sign-in (`ssh -O exit`). |
| `grid_check` | Is this computer signed in; the grid account; the version of the lab's worker tool; whether a Claude sign-in is on record on the grid. |
| `worker_status` | The worker's state and its Claude link, at most once a minute. |
| `worker_start` | One `connect` through the lab's shared copy of `hpcworker`, always without a Claude sign-in. |
| `worker_stop` | One `stop`; nothing is deleted. |
| `worker_log` | The last lines of `progress.log`. |
| `workspace_list`, `workspace_read` | The worker's workspace, over sshd's own sftp, inside the workspace only; links are not followed, credential-named files are refused, credential-shaped text is redacted. |
| `open_in_claude` | Hands the worker's checked `https://claude.ai/code…` link to the operating system's opener. |

On the grid it sends only the gate's own lines (`version`, `status`, `connect … --login never`,
`stop`, `read … progress.log`), run as `hpcworker gate` from the lab's shared copy over the student's
session, and sftp reads. No tool runs a command of the model's choosing.

## What it never does

- Hold, read, store, log or relay a Claude credential, a grid password, a one-time code or a key.
  No tool or setting has a field for one; the student types them only into ssh's own prompt.
- Open a network connection of its own: it has no HTTP client, no socket code and no dependency.
  It starts only the computer's `ssh`, `ssh-keyscan`, terminal app and link opener.
- Run anything on the grid's login node beyond the worker tool's own verbs, or run Claude Code there.
- Delete anything, here or on the grid.
- Touch claude.ai: it hands one checked link to the browser, as the browser edition's button does.
- Use usage credits or an API key: the worker runs on the student's own Claude subscription.

`npm run forbidden` checks the shipped code for each of these that a text search can see.

## Build and test

```
npm ci
npm run typecheck && npm test        # unit tests; the ssh tests start a real sshd of this account on 127.0.0.1
npm run build                        # dist/beethoven/: the extension folder and the plugin folder in one
npm run pack                         # also dist/beethoven-<version>.mcpb, validated by @anthropic-ai/mcpb
npm run gate                         # all of the above; git runs it before every push (.githooks/pre-push)
claude --plugin-dir dist/beethoven   # try it as a Claude Code plugin
```

The ssh tests need OpenSSH's `sshd` (on Ubuntu, `openssh-server`); without it they skip and say so.
With `HPCWORKER_DIR` pointing at a checkout of `OpenSpineConsortium/hpcworker`, one more test runs the
real `hpcworker gate` behind that sshd.

Settings (Claude Desktop: Settings, Extensions, Beethoven; Claude Code: the plugin's options): the grid
account name (not a password), the site (`wayne`), the worker name (`worker`), and on Windows whether
to use WSL's ssh.
