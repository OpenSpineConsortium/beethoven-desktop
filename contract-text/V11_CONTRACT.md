# Beethoven 11.0.0 and framework 10: the contract between the parts

Written 2026-10-01 for the five streams that build 11.0.0 at the same time: the cluster tool
(`framework/`), the extension's core and background, the extension's pages, the mock portal with
its browser harness, and the texts. Where two of them must agree, this document says what, exact to
the character where a parser reads it. The types live in `extension/src/core/contract.ts`,
`model.ts`, `messages.ts` and `keys.ts`; where this document and a doc comment differ, this document
wins and the comment is a defect.

Sources, in order of authority: the user's own words; the orchestrator's amendments AM1 to AM8; the
final specification (`scratchpad/v11/SPEC.md`, called "the spec" below); the 10.0.0 code at commit
f8d2e88. Nothing here was run against the university: no grid, no portal (AM5).

**Unproven on the grid:** the one-time key step (AM2, section 8) and everything that depends on the
portal's ssh reading `~/.ssh/config` on the OnDemand server. Every file that implements it says so,
and Details says so to the lab lead while `LOGIN_SETUP_PROVEN` is `false`.

---

## 1. Decisions

Where the spec was silent or could be read two ways, I decided. Each decision names the section that
carries it out.

- **D1. Every Claude sign-in goes through `connect`.** Connect, "Sign in to Claude" and "Sign in again"
  all type one `connect` line (with `--login auto` or `always`; the `fresh` that "Use another account"
  typed is refused since framework 17, §5.1). `claude login --plain` stays exactly as in framework 9,
  for the 10.0.0 extension only. (§4, §5)
- **D2. `connect` is typed into an open shell with `exec`.** It reads the pasted code from standard
  input, so it cannot go through the framed `runShellCommand`; `exec` replaces the login shell, so
  the ssh session, and with it the WebSocket, end when connect ends. Nothing is left on the login
  node. The short verbs (`worker status --json`, `worker stop`, `worker restrict`, `install
  --shared`) go through the framed `runShellCommand` as in 10.0.0. (§4)
- **D3. Every 11.0.0 line names the lab's shared copy by its full path**
  (`/rs/rs_grp_oschome/shared/beethoven/hpcworker/current/bin/hpcworker` at Wayne State), never the
  launcher in `~/.hpcworker/bin`. The first `connect` must work on an account that is not set up
  yet, and an account still on a pre-8.0.0 copy of its own must not run old code. (§4)
- **D4. `connect` takes three flags the spec does not list:** `--profile SITE` (setting up an account
  needs the site profile's name), `--permission-mode` (Settings' "Ask before each command" / "Accept
  edits" / "Plan only" must reach the worker) and `--no-chain` ("Keep my worker running" off). The
  login mode `--login fresh` it also took (sign out of Claude Code on the grid, then sign in, for "Use
  another account", which the spec gave no mechanism for) is withdrawn in framework 17: Beethoven's
  software never signs anyone out of Claude, and connect refuses the value with one sentence (§5.1);
  the student signs out themselves, and the panel says so (§5.3). (§5)
- **D5. `--login auto` skips the sitting when the newest `status.json` of any run in the state
  directory says `claude_login.loggedIn: true`,** whatever its age. The spec says "the run's last
  status.json"; the sign-in belongs to the account, not to one worker, so a second worker name would
  otherwise cost an allocation for nothing. If the sign-in has lapsed since, the job says `need_login`
  and the panel shows "Sign in to Claude to finish." (§5)
- **D6. The keepalive is `HPCW-LOGIN: still waiting`, printed only by `connect`,** at least every
  20 s from `HPCW-STEP signin` until the sitting ends, by whichever process is the terminal's one
  writer at that moment: connect on the login node while it waits for the sign-in computer, the
  sitting on the compute node while it waits for the link and the code. `claude login --plain` (10.0.0)
  prints none. The spec puts the whole keepalive in `login_plain.sh`, which cannot print before it
  has a computer. (§5.5)
- **D7. `connect` ends within 14 minutes** (840 s): at most 600 s for the sign-in computer, then a
  code budget of `min(600, 840 − elapsed)` and at least 120 s. The extension cuts any shell sitting at
  15 minutes (shell.ts `SESSION_MAX_MS`, PRIVACY "fifteen minutes at the latest"), and the spec's own
  waits add to 20. (§5.6)
- **D8. `HPCW-STEP queued` carries the job id and the run folder** (`HPCW-STEP queued <job> new|kept
  <run dir>`), so the extension can list the run folder within a second without first reading
  `profile.json`. (§5.3)
- **D9. Ten failure codes** in `HPCW-STEP failed <code> <sentence>`: `usage`, `setup`,
  `restricted`, `refused`, `signin-node`, `signin-code`, `signin-timeout`, `signin-billed` and
  `signin-method` (framework 17: the sitting refused a sign-in that is not a Claude subscription's),
  `signin`, and `other` for anything else. The panel words come from the code, never from the
  sentence. (§5.3)
- **D10. status.json gains `online_at`, `renewal` and `stop_reason`** besides the spec's fields.
  `online_at` gives "Ready in Claude, 7 min after you asked." and the terminal line without the
  browser's clock; `renewal` stops a chain successor from showing a queue clock counted from hours
  ago; `stop_reason` tells the student's Stop from the 20-minute sign-in abandon. (§9)
- **D11. `worker status` writes status.json only while it still says `queued` for the same job and
  no `node` file exists,** and the extension never moves a job back to "queued" once it has seen it
  further along. The spec has both the login node and the job writing status.json; this is the guard.
  A queued job that squeue no longer lists, with no `node` file, becomes `error`, "the grid ended the
  request before it started". (§6, §9.3)
- **D12. `expected_start` is empty unless Slurm gives a time in the future.** Slurm's `%S` is often
  `N/A` or a past estimate; "Expected around 9:12." appears only for a real future time. (§9)
- **D13. progress.log is ISO-8601 UTC, one fixed sentence per line,** trimmed by `worker start` to
  its last 400 lines. The "In line: …" lines of the spec's example log are Beethoven's own events
  (from the scheduler's reason), not the framework's. (§11, §15)
- **D14. The student never reads `status.json` `message` or `hint`.** The panel's words come from the
  state, the reason class and the failure code. `message` goes to Details and to `Couldn't start: …`
  in progress.log, both outside the hygiene rule. (§9.4)
- **D15. The claude.ai tab id lives in session storage (`CLAUDE_TAB_KEY`), not in `LAST_KNOWN_KEY`.**
  A tab id from before a browser restart can name another tab. The link, title, state and time stay
  in `LAST_KNOWN_KEY` (local). (§16)
- **D16. Five storage keys the spec does not list:** `GRID_KEY`, `PRESS_KEY`, `TERMINAL_TAB_KEY`
  (session) and `ONCE_KEY` (local), plus `CLAUDE_TAB_KEY` from D15. Each needs a PRIVACY row (§16,
  §20).
- **D17. The agreement is formed by the tick and the press, whatever Chrome's prompt answers.** The
  page writes TermsRecord v2 at the press; a Deny leaves the agreement accepted and the button reads
  "Try again", which asks Chrome again and nothing else. (§17)
- **D18. `worker restrict` does not stop a running worker;** the next `connect` refuses with
  `failed restricted`. No unmark verb: the student removes the marker in the Files app, as before.
  (§7.2)
- **D19. The panel before the agreement** shows the spec's TERMS_REFUSAL sentence and one button,
  "Open the welcome page". (model.ts `WORDS.termsNeeded`)
- **D20. A portal with no site profile** gets "Turn on your VPN." / "Connect to your university's
  VPN." in the GlobalProtect moment, and the session title "Grid worker". (model.ts, contract.ts
  `sessionTitleFor`)
- **D21. `need_consent`** (the marker went missing) shows "Needs you" / "Press Connect to turn on
  Remote Control." with Connect, which writes the marker again. The spec has no words for it.
- **D22. The status rows' unknowns:** the Grid row reads "Checking…" before the first check of a
  browser session; the Claude row reads "—" when no `claude_login` is under 5 minutes old; the Worker
  row reads "Asking…" while the connect line is in flight.
- **D23. AM2's in-between state** (Beethoven typed the line, re-testing every 2 s) reads "Checking…".
- **D24. Toolbar titles the spec leaves out:** "Beethoven" (stopped, unknown), "Beethoven · Starting",
  "Beethoven · Needs you", "Beethoven · Couldn't start".
- **D25. Show log's waiting lines by reason class:** "In line: the grid is busy", "In line: waiting
  for your share of the grid", "In line: the grid is under maintenance".
- **D26. The login-setup line is `bash <shared>/bin/hpcworker login-setup`.** AM2 says "the full path
  of the lab's shared copy of the tool … then login-setup"; the `bash` in front is how every line
  since 8.0.0 has run the shared copy, because the exec bit on the lab's volume is not guaranteed.
  (§8)
- **D27. `~/.ssh/config` gets one managed block, appended at the end, for the login host's names,
  listing our key first and then the client's default key files.** Section 8.2 says why each part is
  needed.
- **D28. The authorized_keys entry's `from=` holds at most four addresses**, the newest kept, so an
  OnDemand service on two web servers works after the step has run from each.
- **D29. `login-setup --remove` deletes the two key files it made** (recognised by their comment),
  besides its config block and its authorized_keys line.
- **D30. The page script types only into xterm.js's helper textarea.** An older terminal (hterm,
  OnDemand before its xterm.js shell) gets nothing typed: the panel goes straight to "Paste, then
  press Enter." with the line already on the clipboard. Enter is a synthetic `input` event with
  `inputType: "insertText"` and `data: "\r"`, because a synthetic `keydown` cannot carry a keyCode
  across the page script's isolated world. (§8.5)
- **D31. "Shell is up" means the page title, changed after the page script loaded, begins
  `<AccessID>@`** (`st1234@warrior:~`, the title bash sets on RHEL and CentOS for xterm terminals).
  The password prompt never changes the title. A site whose shell sets no title never gives the
  sign, and the student presses "I'm in". (§8.5)
- **D32. The Claude sign-in sitting is hosted by the background by default,** with a `{}` frame to the
  portal every 20 s. If the mock's 11-minute sitting (§18) fails, the open panel hosts it instead, as
  10.0.0 did, and closing the panel ends the sitting while the worker keeps its place (AM4).
- **D33. A plan is refused only when Claude Code names one and it is not Pro, Max, Team or
  Enterprise.** An unknown plan ("-") is not refused. (contract.ts `planAllowsRemoteControl`)
- **D34. A pasted code is typed only if it is 8 to 512 printable ASCII characters without spaces**,
  after trimming; anything else gets "That code didn't work. Copy it again from the Claude tab."
  without reaching the grid. (contract.ts `plausibleCode`)
- **D35. "Update" opens the extension's own store page** (`https://chromewebstore.google.com/detail/<runtime id>`).
- **D36. "Cancel" in the home's foot row (in line) runs `worker stop`, like "Stop".** The `cancel`
  action is something else: it withdraws a press kept for later ("Connecting when ready…") or ends a
  sign-in sitting in flight, and the worker keeps its place.
- **D37. The Grid row's live check** (one background GET of the dashboard) runs when the panel opens,
  on every press that needs the grid, and once a minute while the panel is open.

## 2. What I found contradictory in the specification

1. **The hygiene rule versus the spec's own words.** The test must fail the build on any
   student-facing "job", yet the spec's third Try asking prompt is "Write a Slurm job for my script,
   submit it, and tell me when it's done." and the share hero's subline is "It starts when your other
   grid jobs finish." The hygiene test needs an allow-list of exactly these two strings (model.ts
   `WORDS.home.prompts[2]`, `WORDS.queue.shareSub`).
2. **The password dead end versus AM2.** Moment 6's "The grid asked for a password, which Beethoven
   never types. Ask your lab lead." and the "Remote Control and ssh keys" section's "Beethoven stops …
   and shows the moment-6 sentence" are replaced by the one-time key step (§8).
3. **`scripting` "tab mode only" versus AM2.** The key step needs Beethoven's page script in the
   grid's terminal tab in direct mode too. The manifest comment, LISTING.md's permission row and
   PRIVACY's page-script sentences must say "and for the one-time grid terminal step" (§20).
4. **The keepalive's author** (D6) and **the 15-minute cap against 20 minutes of waits** (D7).
5. **"Elapsed time always counts from submitted_at"** is wrong for a chain successor, whose
   submitted_at is hours old (D10, `renewal`).
6. **Two writers of status.json** (`worker status` on the login node and the job) with no rule (D11).
7. **`LAST_KNOWN_KEY` holding a tab id "kept across browser restarts"** (D15).
8. **The spec's `connect` synopsis** cannot set up an account, carry the permission mode or switch the
   chain off, and "Use another account" has no mechanism (D4; since framework 17 none of ours either:
   the student signs out of Claude Code themselves, §5.3).
9. **"the run's last status.json"** for skipping the sign-in, when the sign-in belongs to the account
   (D5).

## 3. Who builds what, and the files of the contract

| Stream | Owns | Reads from this contract |
|---|---|---|
| Cluster tool | `framework/` (bin, lib, jobs, profiles, tests, VERSION 10) | §4–§14, §19 |
| Core and background | `extension/src/core/*` except the four contract files' types, `src/entrypoints/background.ts`, `portal.content.ts`, `src/ext/*`, `src/licensing/*` | everything |
| Pages | the welcome page, the panel, Details, Settings (`src/entrypoints/options`, `sidepanel`, `src/ui/*`) | §15–§17, model.ts, messages.ts |
| Mock and harness | `extension/mock-ood/*`, the browser harness | §4–§14, §18 |
| Texts | LICENSE.txt, PRIVACY.md, THIRD_PARTY_NOTICES.md, docs, store texts, the website | §16, §20 |

The four contract files: `contract.ts` (wire types, paths, command builders, parsers), `model.ts`
(views, actions, every student-facing sentence in `WORDS`), `messages.ts` (runtime messages and
ports), `keys.ts` (storage keys and the shape of each value). Everything I added there has a working
body; nothing is left as a stub. What the other streams must still write against them is in §21.

## 4. Command lines

Every line is one line, built by `contract.ts commands`, and every argument has been checked before it
is placed (a builder throws rather than quote around a bad value). `<shared>` is the site profile's
`shared_install` after `sharedRootOf` (at Wayne State
`/rs/rs_grp_oschome/shared/beethoven/hpcworker/current`); `<id>` is the installation's 32 hex
characters; `<name>` matches `^[A-Za-z0-9_-]{1,32}$`.

| Builder | The exact line | Transport | Audit class |
|---|---|---|---|
| `commands.connect` | `exec bash '<shared>/bin/hpcworker' connect --name '<name>' --profile '<site>' --consent '<id>' --login '<auto\|always\|never>' --permission-mode '<default\|acceptEdits\|plan>'` and ` --no-chain` at the end when "Keep my worker running" is off; ` --consent '<id>'` only when the data statement for this worker is in force (`--login` takes `auto`, `always` or `never` from the 15.0.0 extension; the framework still parses an older build's `fresh`, only to refuse it, §5.1) | `openShell` (interactive) | scheduler (60 s floor) |
| `commands.statusJson` | `bash '<shared>/bin/hpcworker' worker status --name '<name>' --json` | `runShellCommand` | scheduler (60 s floor) |
| `commands.stop` | `bash '<shared>/bin/hpcworker' worker stop --name '<name>'` | `runShellCommand`, 90 s timeout | scheduler |
| `commands.restrict` | `bash '<shared>/bin/hpcworker' worker restrict --name '<name>'` | `runShellCommand` | shell (15 s floor) |
| `commands.consentRecord` | `bash '<shared>/bin/hpcworker' claude consent --record '<id>'` | `runShellCommand` | shell (Details only; connect does this itself) |
| `commands.installShared` (10.0.0) | `bash '<shared>/bin/hpcworker' install --shared '<shared>' --profile '<site>'` | `runShellCommand` | shell |
| `commands.loginSetup` (AM2) | `bash <shared>/bin/hpcworker login-setup` (unquoted: the student may read it) | typed by the page script into the student's own terminal page, or pasted by the student; never sent by Beethoven's own shell | none (not Beethoven's shell) |

Moment 6 still runs `commands.installShared` once, before Connect, when the facts say the account
does not yet use the lab's shared copy (that is what ticks "Your grid account is ready"); connect's
own setup step (§5.2 step 2) is the safety net for a returning run.

The audit chokepoint (`audit.ts`) classifies by the line's text: it must recognise `connect` and
`worker status` behind the `exec bash '…'` and `bash '…'` prefixes. A refused floor is retried
silently and never shown.

`openShell` for connect: open the socket, wait for the prompt to settle, type the line followed by
`\r` once, then read lines (terminal codes stripped by `shell.ts clean`, split on `\n`) and parse
each with `contract.ts parseConnectLine`. Send `{}` every 20 s (`messages.ts SHELL_KEEPALIVE_MS`)
until the socket closes. Type the pasted code as one `{"input":"<code>\r"}` frame. Close the socket
yourself only to cancel. Before typing anything, the existing password detection
(`/password:|passphrase|Permission denied/i` on the text before the line is typed) ends the sitting
with "password" and nothing typed; the key step follows (§8).

`shell.ts` must let `{}` through its frame guard, which today refuses any frame without `input` or
`resize`. OnDemand's Shell parses it and ignores it: `JSON.parse` succeeds, and neither `msg.input`
nor `msg.resize` is set (OOD 4.1 `app.js`, scratchpad `channel/ood_shell_release_4.1.js` lines
253-260). It does not count as activity there: only input and terminal output reset OnDemand's idle
timer (lines 246, 257), which is why the framework's own keepalive line exists.

## 5. `connect`

### 5.1 Synopsis

```
hpcworker connect [--name NAME] [--profile SITE] [--consent INSTALL_ID]
                  [--login auto|always|never] [--permission-mode default|acceptEdits|plan]
                  [--no-chain]
```

| Flag | Default | Meaning |
|---|---|---|
| `--name` | `worker` | the worker; `^[A-Za-z0-9_-]{1,32}$` |
| `--profile` | the account's `~/.hpcworker/profile.json` | the site profile used when the account must be set up; required when there is none |
| `--consent` | none | write the Remote Control answer (§5.2 step 3); `^[0-9a-f]{32}$` |
| `--login` | `auto` | `auto`: skip the sitting when D5's rule says signed in; `always`: run the sitting (Claude Code answers at once when it is signed in); `never`: no sitting. The 15.0.0 extension sends one of these three. `fresh` (framework 10 to 16: the sitting after `claude auth logout` inside it), which an older build still sends for "Use another account", is parsed only to be refused (framework 17; Beethoven never signs anyone out of Claude): `HPCW-STEP failed usage --login fresh is no longer offered: Beethoven never signs anyone out of Claude; to use another account, sign out of Claude Code yourself on a compute node, then sign in again`, exit 2, nothing done |
| `--permission-mode` | the profile's `worker_defaults.permission_mode` | passed to `worker start` |
| `--no-chain` | chain on | passed to `worker start` |

Unknown flags and bad values: `HPCW-STEP failed usage <sentence>`, exit 2, nothing done.

### 5.2 What it does, in order

1. Check the flags (above).
2. **Setup.** When this account does not already run the lab's shared copy that the site profile's
   `shared_install` names (the marker `~/.hpcworker/shared` is missing or names another folder, or
   `~/.hpcworker/bin/hpcworker` is not the launcher, or `~/.hpcworker/profile.json` is missing), run
   framework 5's shared install for that folder with `--profile SITE`, with all its guards (a live run
   on an own copy refuses). Print `HPCW-STEP setup changed` after it succeeds, or `HPCW-STEP setup
   ready` when nothing was needed. A failure prints `HPCW-STEP failed setup <the install's sentence,
   without "hpcworker: ">`, exit 3.
3. **Consent**, only with `--consent ID`: write `~/.hpcworker/consent` atomically (write to
   `consent.part`, rename), mode 0600, content exactly `yes <ISO-8601 UTC> <ID>` and a newline,
   replacing whatever was there; then print `HPCW-STEP consent`. A failed write prints `HPCW-STEP
   failed other could not write the Remote Control answer`, exit 1.
4. **Restricted.** When `<state_dir>/workspaces/<name>/.restricted` exists, or the profile restricts
   the name (`restricted: true`, or `restricted_workspaces` holding the name or `"*"`): `HPCW-STEP
   failed restricted the workspace <path> is marked restricted`, exit 4. Nothing is submitted.
5. **Worker.** `worker start`'s own check (one squeue over job.id and next.id): when a job of the run
   is PENDING or RUNNING, submit nothing and print `HPCW-STEP queued <that job> kept <run dir>`.
   Otherwise run `worker start --name NAME --permission-mode MODE [--no-chain]` (which writes the
   queued status.json and progress.log's "Asked the grid for a computer", §9.2, §11) and print
   `HPCW-STEP queued <job> new <run dir>`. When the scheduler refuses: `HPCW-STEP failed refused
   <sbatch's message on one line>`, exit 5. `worker start`'s human sentences and its first-time
   notice are not printed under connect.
6. **Sign-in.** By `--login` (D5 for `auto`). When the sitting is skipped under `auto`, print
   `HPCW-STEP signed-in <email> <plan>` from that status.json's `claude_login`. Otherwise print
   `HPCW-STEP signin`, then run the sitting (§5.4) with the keepalive (§5.5) inside the budget (§5.6);
   on its `SIGNED-IN <email> <plan>` print `HPCW-STEP signed-in <email> <plan>`. Under `always` the
   15-minute "a worker confirmed it" shortcut of `plain_login` is not used. A failure
   prints the sitting's own `HPCW-LOGIN-FAILED: …` line and then `HPCW-STEP failed <code>
   <sentence>` with the code from this table, and the worker keeps its place:

   | The sitting's outcome | Code | Exit |
   |---|---|---|
   | no computer for the sitting within 600 s, or the allocation ended early | `signin-node` | 6 |
   | "Claude Code did not accept the code; …" | `signin-code` | 7 |
   | "no code arrived within …", "the sign-in did not finish within …" | `signin-timeout` | 7 |
   | "Claude Code offered a sign-in that bills by use …" (framework 17: the link's host or the menu was the Console's; nothing was opened) | `signin-billed` | 7 |
   | "Claude Code on the grid is signed in in a way that …" (framework 17: already signed in, not with a Claude subscription) | `signin-method` | 7 |
   | any other `HPCW-LOGIN-FAILED` | `signin` | 7 |

7. Print `HPCW-STEP done`, exit 0.

Each `HPCW-STEP` line appears at most once, in the order above; after a `failed` line nothing more is
printed and connect exits.

### 5.3 The HPCW-STEP grammar

A step line is the whole line: it starts at the first column, the fields are separated by one space,
and it ends at the newline. The extension strips terminal codes and trims before matching
(`contract.ts STEP_RE`, `parseStepLine`).

```
HPCW-STEP setup ready
HPCW-STEP setup changed
HPCW-STEP consent
HPCW-STEP queued <job> new <run dir>
HPCW-STEP queued <job> kept <run dir>
HPCW-STEP signin
HPCW-STEP signed-in <email> <plan>
HPCW-STEP done
HPCW-STEP failed <code> <sentence>
```

- `<job>`: the scheduler's job id, digits only.
- `<run dir>`: the run folder, `<state_dir>/<name>`, to the end of the line (it may hold spaces; never a
  newline). Optional for the parser; framework 10 always prints it.
- `<email>`, `<plan>`: one token each, `-` when Claude Code did not say. `<plan>` is Claude Code's
  `subscriptionType` (`max`, `pro`, `team`, `enterprise`, `free`, …).
- `<code>`: `usage`, `setup`, `restricted`, `refused`, `signin-node`, `signin-code`,
  `signin-timeout`, `signin-billed`, `signin-method`, `signin` or `other` (an unknown word reads as
  `other`; a framework 16 copy never prints the two framework 17 codes). `<sentence>`: one line in
  the tool's words, for Details and the log; may be empty.

| Line | What the extension does |
|---|---|
| `setup …` | ticks "Your grid account is ready" |
| `consent` | sets Acknowledgement v3 `consent_recorded_at` |
| `queued <job> new\|kept <run dir>` | records the run (state dir = the run dir's parent, name = its last part, job); lists the run folder at once; the hero leaves "Asking…" |
| `signin` | "Getting your Claude sign-in ready…"; after 2 minutes without `signin-node` or `auth-url`, "The grid is busy. Still finding a computer for the sign-in…" |
| `signed-in <email> <plan>` | "Signed in as <email> · <Plan>" with the drawn check for 3 s; refuses the plan per D33 ("This Claude account has no Pro or Max plan. Remote Control needs one. To use another Claude account, sign out of Claude on the grid first (your lab lead's guide shows how), then press Sign in again." [Sign in again]); closes the Anthropic tab per §17 |
| `done` | the sitting is over; the files take it from here |
| `failed <code> …` | `setup`: "Your grid account can't use the lab's copy yet. Ask your lab lead." [Copy details]; `restricted`: "This workspace is marked restricted. Choose another under More about your data."; `refused`: "The grid didn't take the request." [Try again]; `signin-node`: "The grid didn't find a computer for the sign-in. Your worker keeps its place in line." [Try again]; `signin-code`: "That code didn't work. Copy it again from the Claude tab." [Sign in again]; `signin-timeout`: "The sign-in timed out." [Sign in again]; `signin-billed`: "Beethoven signs in only with a Claude subscription, on Claude's own sign-in page. This sign-in offered a different page, so Beethoven didn't open it." [Sign in again]; `signin-method`: "Claude on the grid is signed in, but not with a Claude subscription, and Beethoven runs only on your own subscription. Ask your lab lead to help you sign in again with your Claude account." [Copy details]; `signin`, `usage`, `other`: "The grid didn't take the request." [Try again] |
| the socket closes with no `done` or `failed` | "The grid didn't take the request." [Try again]; the transcript's last 20 lines go to Details only |

### 5.4 The sitting's lines

Unchanged from framework 9 (`framework/lib/login_plain.sh`, `bin/hpcworker plain_login`), each a whole
line:

```
HPCW-LOGIN: requesting a compute node                                  (login node, before the allocation)
HPCW-LOGIN: on <host>; checking whether you are signed in already      (the sitting has its computer)
HPCW-LOGIN: starting Claude Code's sign-in; waiting for the sign-in link
HPCW-LOGIN: a menu appeared; chose the first entry
HPCW-LOGIN: the menu is still up; pressed Enter again
AUTH-URL: <Anthropic's authorize link>
HPCW-LOGIN: paste the code from that page
HPCW-LOGIN: code received, checking
HPCW-LOGIN: that code was not accepted; paste it again
SIGNED-IN <email> <subscriptionType>                                   ("-" for an empty field)
HPCW-LOGIN-FAILED: <one plain sentence>
HPCW-LOGIN: still waiting                                              (the keepalive, connect only)
```

The sitting never runs a sign-out (framework 17; until framework 16 `--login fresh` ran `claude auth
logout` before `claude auth login`, and connect now refuses `fresh` at the flag check, §5.1): a
student who wants another account signs out of Claude Code themselves on a compute node, then signs
in again. The extension's reading (`parseConnectLine`): `requesting a compute node` starts the
2-minute clock; `on <host>;` stops it; `AUTH-URL:` opens Anthropic's page only when
`isClaudeAuthUrl` passes (https, claude.ai or claude.com, never `platform.claude.com` or a subdomain
of it, the Console's sign-in, which bills by use) and otherwise reads it as `refused-url`: nothing is
opened, and the panel says that Beethoven signs in only with a Claude subscription, with Sign in
again (no API key anywhere, greg, 2026-10-04). A framework 17 sitting never prints such a link: it
ends itself with `signin-billed` (§5.2);
`paste the code from that page` (or Claude Code's own "Paste code here") focuses the box; `code
received, checking` shows the box busy; `that code was not accepted` shows "That code didn't work.
Copy it again from the Claude tab." and keeps the sitting open for another paste.

**How the code is given.** Once `paste the code from that page` has arrived (or 5 s after the
`AUTH-URL:` line, when Claude Code words its prompt differently), the extension types the pasted code
as one `{"input":"<code>\r"}` frame, once, after D34's check. It is never stored, logged, counted
into a view, or kept after the frame is sent; the audit records only its byte count, as 10.0.0 does.
The framework never echoes it: the sitting's terminal has echo off for the whole sitting, and Claude
Code's screen is never copied to the output.

### 5.5 The keepalive and the one-writer rule

From `HPCW-STEP signin` until the sitting's last line, connect guarantees a line at least every 20 s:
when 20 s pass with nothing printed, it prints `HPCW-LOGIN: still waiting`. Before the sitting has its
computer, connect on the login node prints it; once the sitting runs, the sitting prints it (between
its own checks while it waits for the link and for the code).

Every line the extension parses arrives whole and at the start of a line: at any moment exactly one
process writes to the terminal. The cluster stream chooses how (for example, connect relays the
allocation's output line by line and is then the only writer). As a second guard, the extension
removes the text `HPCW-LOGIN: still waiting` wherever it appears inside a line before parsing the
rest (`withoutKeepalive`), so a glued keepalive cannot hide a step.

Framework 10 relays with `lib/relay.sh`, bash builtins only: the relay runs on the login node for the
whole sitting, and warrior's banner bans `python3` (with `node`, `make`, `md5sum`, `rsync` and others,
"terminated on sight"), which relayed it in the first build. The relay never reads with a timer, since
bash 4.2's `read -t` can drop what it had read of a line when the timer fires; connect runs a ticker
beside srun (`relay.sh --ticks`, coreutils `sleep 1` between ticks) that writes a 6-byte tick line
into the relay's pipe once a second, never to the terminal. The keepalive is written at the first tick
within half a second of 20 s without output (a gap of 19.5 to 20.5 s, as the earlier relay's 20 to
20.5 s), a part of a line left waiting is written alone at the fifth tick after the one that brought
its last byte (5 to 6 s after it, counted in ticks so a busy node cannot shorten it; the earlier
relay, 5 to 5.5 s), carriage returns are removed, and the relay ends with status 0 (connect's status
is srun's). When the portal's shell is cut, srun, the ticker and the relay are all in the terminal's
process group and end with its SIGHUP; nothing of the sitting is left on the login node.

### 5.6 Time budget

Connect ends within 840 s of its start: the sign-in computer is waited for at most 600 s
(`HPCW_ALLOC_WAIT_S=600`, as today), and the sitting's code budget is `min(600, 840 − seconds already
spent)`, at least 120 s. The extension's own cap stays 15 minutes.

### 5.7 Transcripts

A first run (the sign-in needed):

```
HPCW-STEP setup changed
HPCW-STEP consent
HPCW-STEP queued 40501234 new /rs/rs_grp_oschome/st1234/hpcworker/worker
HPCW-STEP signin
HPCW-LOGIN: requesting a compute node
HPCW-LOGIN: still waiting
HPCW-LOGIN: on asx15; checking whether you are signed in already
HPCW-LOGIN: starting Claude Code's sign-in; waiting for the sign-in link
AUTH-URL: https://claude.ai/oauth/authorize?code=true&client_id=…
HPCW-LOGIN: paste the code from that page
HPCW-LOGIN: still waiting
HPCW-LOGIN: code received, checking
SIGNED-IN alex@wayne.edu max
HPCW-STEP signed-in alex@wayne.edu max
HPCW-STEP done
```

A returning Connect after a Stop (signed in on the grid):

```
HPCW-STEP setup ready
HPCW-STEP consent
HPCW-STEP queued 40509876 new /rs/rs_grp_oschome/st1234/hpcworker/worker
HPCW-STEP signed-in alex@wayne.edu max
HPCW-STEP done
```

The scheduler refuses:

```
HPCW-STEP setup ready
HPCW-STEP consent
HPCW-STEP failed refused sbatch: error: Batch job submission failed: Invalid qos specification
```

## 6. `worker status --json`

`hpcworker worker status --name NAME --json` prints exactly one JSON object on one line on standard
output and exits 0. With no run folder it prints `hpcworker: no worker named NAME (hpcworker worker
start)` on standard error and exits 1.

```json
{"v":1,"run":"worker","job":"40501234","next_job":"","state_dir":"/rs/rs_grp_oschome/st1234/hpcworker",
 "status":{…status.json after this call…},"connection":{…connection.json…}|null,
 "scheduler":{"state":"PENDING","reason":"Priority","expected_start":"2026-10-01T13:12:00Z","node":"","checked_at":"2026-10-01T12:58:03Z"}|null,
 "line":"Your worker is in line for a computer (14 min so far)."}
```

(Shown on three lines here; on the wire it is one.) Types: `contract.ts StatusJson`. Framework 9's
`--json` fields (`run`, `job`, `next_job`, `status`, `connection`) are kept.

**The one scheduler call.** Only when status.json says `queued` (or there is no status.json, a
job.id exists and no `node` file does), the command makes ONE `squeue -h -j <job> -o '%T|%r|%S|%N'`:

- a line came back: `scheduler` = {state: `%T`, reason: `%r`, expected_start: `%S` as ISO-8601 UTC
  when it is a time in the future, else `""`, node: `%N`, checked_at: now}. Then, only while
  status.json still says `queued` for this job and no `node` file exists, status.json is rewritten
  atomically with `scheduler_state`, `reason`, `expected_start`, `checked_at`, and `got_computer_at` =
  `checked_at` when `%T` is `RUNNING` and `got_computer_at` is empty.
- nothing came back (the job is gone) and there is no `node` file: `scheduler` = {state: `"GONE"`,
  reason, expected_start and node `""`, checked_at}; status.json becomes state `error`, message "the
  grid ended the request before it started", needs `nothing`; progress.log gets "Couldn't start: the
  grid ended the request before it started".

Otherwise `scheduler` is `null` and nothing is asked: the job's own files say where it is.

**`line`, and the first line of `worker status` without `--json`:**

| Condition | Line |
|---|---|
| queued | `Your worker is in line for a computer (<N> min so far).` (N from submitted_at) |
| starting, running or need_consent | `Your worker has a computer and is connecting to Claude.` |
| online, `renewal` false, online_at and submitted_at known | `Your worker is online (ready <N> min after you asked).` |
| online otherwise | `Your worker is online.` |
| need_login | `Your worker is waiting for your Claude sign-in.` |
| preempted with next_job | `Your worker is renewing itself; it is back in a few minutes.` |
| preempted without next_job | `Your worker has ended. hpcworker connect starts it again.` |
| stopped, stop_reason login_abandoned | `Your worker stopped: waiting for your Claude sign-in timed out.` |
| stopped | `Your worker is stopped.` |
| error | `Your worker couldn't start: <message>` |
| no status.json yet | `Your worker has been asked for and has not reported yet.` |

Framework 9's lines move behind `--details`. `worker start --wait [MIN]` and `worker watch` (terminal
users) read status.json and progress.log every 5 s, ask squeue at most once a minute and only while
queued, and end with the online line and `Open in Claude: <link>  Look for <title>.`

## 7. The other verbs

### 7.1 `worker stop` (unchanged)

`hpcworker worker stop --name NAME`: the stop file, a wait of up to 45 s for the job's own
`stop.done`, then one squeue and one scancel for whatever is left. A worker still in line (its queued
file for `job.id`, no node file) is cancelled at once, with no wait, and `worker stop` itself writes
`stopped` (`stop_reason` `request`); when squeue does not answer then, its ids are cancelled as they
stand (§22). Prints `worker NAME: stopped
(<how>[; cancelled at the scheduler: <ids>]; the chain ended)` and exits 0; with no run folder,
`hpcworker: no worker named NAME` on standard error, exit 1. The extension's test of success: exit 0
and `/^worker \S+: stopped \(/m`. The panel shows "Stopping…" from the press until status.json says
`stopped` (or the line has answered and no job is listed).

### 7.2 `worker restrict` (new)

`hpcworker worker restrict --name NAME`: creates `<state_dir>/workspaces/NAME/` if needed and writes
the marker `.restricted` (mode 0644, content `restricted <ISO-8601 UTC> by hpcworker worker restrict`
and a newline). Prints `worker NAME: marked restricted (<marker path>); it will not start there until
the marker is removed` or, when it was already there, `worker NAME: already marked restricted
(<marker path>)`; exit 0 either way. It does not stop a running worker (D18). The extension's test:
exit 0 and `/^worker \S+: (already )?marked restricted/m`.

### 7.3 `claude consent --record` (new)

`hpcworker claude consent --record INSTALL_ID`: writes `~/.hpcworker/consent` exactly as connect's
step 3 does and prints `recorded in <path> (fallback marker): your workers may now host Remote
Control`, exit 0. An id that is not 32 lower-case hex characters: `hpcworker: claude consent --record
needs this installation's 32-character id` on standard error, exit 2. `claude consent` without
`--record` is unchanged (a person at a terminal).

## 8. `login-setup` and the one-time key step (AM2)

**Unproven on the grid.** It was designed from how OnDemand's Shell app runs ssh and has not been
tried by a student without a key. It is tested only on the mock (§18).

### 8.1 Why it is needed, and why the key never reaches the browser

The portal's Shell app runs, as the student and on the OnDemand server, `ssh <host>` (or the site's
`OOD_SSH_WRAPPER`), with the host as its only argument, or `[host, -t, "cd '<dir>' ; exec ${SHELL}
-l"]` (OOD 4.1 `app.js` lines 194-225). It passes no `-i`, `-F` or `-o`, so the ssh client reads the
student's `~/.ssh/config` and, when no `IdentityFile` applies to the host, tries the default key
files (`id_rsa`, `id_ecdsa`, `id_ecdsa_sk`, `id_ed25519`, `id_ed25519_sk`, `id_xmss`, `id_dsa`).
Greg's account works because it has an `id_rsa` made in 2022 that authorises itself; a student
account has no key, so the Shell asks for a password, and Beethoven never types one. The key that
fixes this lives in the student's grid account, made there, used only by the OnDemand server's own
ssh. A browser extension cannot use an ssh key (it has no sockets), and a copy in browser storage
would be an unused credential that opens a university account with no password and no second factor.
Nothing about the key is ever stored or sent by Beethoven.

The step relies on the OnDemand server and the login nodes sharing the student's home folder. That is
how the Files app and the Shell both land in the same home today; that the OnDemand server's ssh
reads that same `~/.ssh` is assumed, not seen.

### 8.2 What it does

`hpcworker login-setup`, typed into a terminal that came in through ssh (the portal's Shell):

1. **Refuses to run outside such a session.** `SSH_CONNECTION` must hold four fields; its first field,
   the client address, must be an IPv4 or IPv6 literal and not a loopback address. That address is
   the machine the terminal came from: the university's OnDemand server.
2. **Refuses to run under an agent** (Claude Code or any program, the framework's
   `hpcw_agent_marker`): this changes how the account signs in.
3. **Refuses when sshd would ignore the key:** the home folder writable by group or others.
4. **`~/.ssh`**: created if missing, mode 0700.
5. **The key**: `~/.ssh/beethoven_ed25519` and `.pub`, made with `ssh-keygen -t ed25519 -N '' -C
   'beethoven-login-setup <user> <YYYY-MM-DD>'`, private 0600, public 0644. When both files exist and
   the public key's comment starts with `beethoven-login-setup`, they are reused. When either exists
   and is not ours, it stops (nothing changed). Never touches, reads out or prints any `id_*` file or
   any private key.
6. **`~/.ssh/config`**: one managed block, appended at the end of the file (prepending would capture
   the student's own top-level options into our Host block), rewritten in place on a second run and
   never duplicated, mode 0600 when the file is created and the existing mode kept otherwise:

   ```
   # >>> beethoven login-setup (managed; "hpcworker login-setup --remove" removes this block) >>>
   Host <names>
       IdentityFile ~/.ssh/beethoven_ed25519
       IdentityFile ~/.ssh/id_rsa
       IdentityFile ~/.ssh/id_ecdsa
       IdentityFile ~/.ssh/id_ecdsa_sk
       IdentityFile ~/.ssh/id_ed25519
       IdentityFile ~/.ssh/id_ed25519_sk
       IdentityFile ~/.ssh/id_dsa
   # <<< beethoven login-setup <<<
   ```

   `<names>`: the profile's `submit_host` and `<submit_host>.*` (at Wayne State `warrior warrior.*`,
   which covers `warrior.nas.grid.wayne.edu`, the host the Shell app's link names), the profile's
   `ood_shell_host` when set, and this login node's `hostname -s` and `hostname -f`. The default key
   files are listed after ours because an `IdentityFile` that applies to a host stops the ssh client
   from adding its defaults; listing them keeps every key the student already uses working, in the
   client's own order, after ours. A missing file in the list is skipped by ssh without a message.
   After writing, `ssh -G <first name>` must parse the file and list our key; if not, the previous
   file is put back and the step stops.
7. **`~/.ssh/authorized_keys`**: one line for our key, mode 0600 (created 0600), never two:

   ```
   from="<address>[,<address>…]",no-agent-forwarding,no-port-forwarding,no-X11-forwarding ssh-ed25519 <key> beethoven-login-setup <user> <YYYY-MM-DD>
   ```

   The key opens the account only from those addresses, never from the internet. A second run from a
   new address adds it to the list, at most four, the newest kept (D28). No `no-pty` and no
   `restrict`: the Shell needs a terminal. The student's other lines are never changed.
8. Ends with exactly one of the lines in §8.3.

`hpcworker login-setup --remove`: removes our authorized_keys line, our config block and the two key
files whose comment says they are ours (D29); ends with `Done. Removed Beethoven's grid key.` or
`Nothing to remove.`, exit 0. Every step is safe to run twice.

### 8.3 Output lines and exit codes

The last line is exactly one of these; lines before it, if any, are plain progress for a person.

| Last line | Exit |
|---|---|
| `Done. The grid will not ask again.` | 0 |
| `Done. Removed Beethoven's grid key.` (`--remove`) | 0 |
| `Nothing to remove.` (`--remove`) | 0 |
| `Stopped: this is not a session that came in through ssh, so there is no address to allow.` | 2 |
| `Stopped: this session came from this same computer, not from the grid's website.` | 2 |
| `Stopped: this changes how your account signs in, so it runs only in the grid's own terminal, not under Claude Code or another program.` | 2 |
| `Stopped: this runs as your own account, never as root.` | 2 |
| `Stopped: your home folder can be written by others, so the grid would ignore any key in it.` | 3 |
| `Stopped: ~/.ssh could not be made private.` | 4 |
| `Stopped: ssh-keygen is not available here.` | 5 |
| `Stopped: the key could not be made.` | 5 |
| `Stopped: ~/.ssh/beethoven_ed25519 is there but was not made by this tool; nothing was changed.` | 6 |
| `Stopped: ~/.ssh/config could not be updated safely; nothing was changed.` | 7 |
| `Stopped: ~/.ssh/authorized_keys could not be updated; nothing was changed.` | 7 |

The two exit-7 lines also end a run (and `--remove`) that finds `~/.ssh/config` or
`~/.ssh/authorized_keys` to be a link to another file, or our start line without our end line, before
anything is touched. "Nothing was changed" is kept true: a step that stops puts back what the earlier
ones did (the key it made, the config file, `~/.ssh`'s mode, `~/.ssh` itself when it made it).

Beethoven never reads this output (it reads nothing of the terminal). It learns the outcome by
testing its own channel (§8.5). `contract.ts loginSetupOutcome` exists for the framework's and the
mock's tests.

### 8.4 When the step appears

Only when the portal's shell asked for a password (shell.ts's existing detection, before anything
is typed) while a press waits: Connect, Stop, "Sign in to Claude", "Mark this workspace restricted".
An automatic shell line that meets a password (the channel test, the setup line under moment 6)
records `CHANNEL_KEY.shell = "password"` and shows nothing until the student's next press, which
then waits ("Connecting when ready…") behind the step.

### 8.5 The panel moment and the page script (model.ts `LoginSetupMoment`)

| Phase | Words | Primary |
|---|---|---|
| offer | "One more thing, once." / "Type your grid password in the grid's own terminal. Beethoven never sees it." | "Open the grid terminal" |
| password | "Type your password in the terminal, then press Enter." | "I'm in" |
| checking | "Checking…" (D23) | none |
| done | "Done. You won't need this again." with the drawn check | none; the waiting press carries on |
| paste | "Paste, then press Enter." and the fold "What does the line do?": the line, and "It makes a key in your grid account that only the grid's own website can use, so it stops asking." | none |
| closed | "Not done yet." | "Open the grid terminal" |

1. **"Open the grid terminal".** Inside the click, the page writes the line (`LoginSetupMoment.line`,
   `commands.loginSetup`) to the clipboard. It sends `open-terminal-for-login-setup`; the background
   opens `<portal origin>/pun/sys/shell/ssh/<shell host>` ("default" unless Settings names another) in
   a new tab, in front, in the panel's window, and records it in `TERMINAL_TAB_KEY`. The phase becomes
   `password`.
2. **The page script in that tab.** It is Beethoven's portal page script (`portal.content.ts`), which
   the runtime registration already loads on the granted origin in tab mode; in direct mode the
   background injects it into that one tab with `scripting.executeScript` once the tab has loaded. The
   background sends `terminal.watch {account}`. The page script watches `document.title` only (a
   MutationObserver on `<title>`), and sends `terminal.shell-up` once, when the title has changed
   since it loaded and begins with `<account>@` (D31). It sends no title text. It attaches no keyboard,
   input or clipboard listener and reads nothing of the terminal's contents.
3. **Typing.** Beethoven types only after the student's "I'm in", or after `terminal.shell-up`;
   never on a timer. The background sends `terminal.type {line}`. The page script refuses any line
   that fails `contract.ts isLoginSetupLine`. It finds `textarea.xterm-helper-textarea`; if there is
   none, it answers `{typed:false, how:"unsupported", why:"unsupported"}` and the panel goes to
   `paste`. Otherwise it focuses it and dispatches, on it:
   - `new ClipboardEvent('paste', {clipboardData: <DataTransfer with "text/plain" = line>, bubbles: true, cancelable: true})`;
   - `new InputEvent('input', {data: '\r', inputType: 'insertText', bubbles: true})` (D30).

   It answers `{typed:true, how:"xterm"}`. Phase `checking`.
4. **The test.** Every 2 s the background opens one shell WebSocket of its own (the channel test:
   the page, the token, the socket, the prompt) and checks that no password prompt comes before the
   prompt settles. On success it records `CHANNEL_KEY.shell = "ok"`, closes the terminal tab it opened
   (only while `tabs.get` still shows it on the shell page's path, and never the window's last tab:
   it opens a New Tab first), shows `done`, adds "Done. You won't need this again." to Show log, and
   carries on with the waiting press. After 10 s of failures: phase `paste`; it keeps testing every
   2 s while the tab exists, up to 5 minutes. If the tab is closed first: phase `closed`.

Nothing of this is stored but the tab record (session) and the channel verdict. No key, no line
output, no title.

## 9. status.json (framework 10)

Path: `<state_dir>/<name>/status.json`. Written atomically (`status.json.part`, then rename) and only
by four writers: `worker start` (the queued file), `worker status` (the scheduler fields while
queued, and the `GONE` error when the scheduler no longer lists the job), `worker stop` (`stopped`
for a worker still in line), and the job (every other write, on each change and every 30 s). The
second and third write only while the file still says `queued` for that job and no node file exists.

### 9.1 Fields

All times are ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SSZ`. "10" in the last column marks a field new in
framework 10.

| Field | Type | Written by | Meaning | |
|---|---|---|---|---|
| `version` | number | all | framework version (10) | |
| `site` | string | all | the profile's site | |
| `run` | string | all | the worker's name | |
| `job` | string | all | the job this file is about (a chain successor has a new id) | |
| `node` | string | job | the compute node; `""` while queued | |
| `pid` | number | job | | |
| `state` | string | all | `queued`, `starting`, `need_login`, `need_consent`, `running`, `online`, `stopped`, `preempted`, `error` | queued: 10 |
| `message` | string | all | the tool's words (Details only, D14); queued: `waiting for a computer` | |
| `needs` | string | all | `login`, `consent` or `nothing`; queued: `nothing` | |
| `hint` | string | all | one sentence; queued: `Your worker is in line for a computer.`; starting no longer promises "about a minute": `Your worker has a computer and is connecting to Claude.` | |
| `submitted_at` | string | worker start; kept by the job | when the scheduler accepted `job` | 10 |
| `got_computer_at` | string | job (worker status while queued) | when `job` began on its node | 10 |
| `started_at` | string | job | as framework 9 (the job's start); equal to `got_computer_at` | |
| `online_at` | string | job | when this job's Remote Control first registered; `""` until then | 10 |
| `ends_at` | string | job | `got_computer_at` + the job's hours: "Renews itself at 4:50 PM" | 10 |
| `renewal` | boolean | worker start (false); job | true when this job was queued by its predecessor in the chain | 10 |
| `updated_at` | string | all | the heartbeat | |
| `title` | string | worker start; job | the session title asked for (§13 `session_title`; "<title> · <name>" for a worker not named `worker`; may contain U+00B7) | 10 |
| `session_name` | string | job | the name Claude Code chose at registration | |
| `requested_name` | string | worker start; job | what `--name` asked for: now equal to `title` (was `<site>-<run>`) | |
| `environment_url`, `session_url` | string | job | `https://claude.ai/code?environment=env_…` (both, as framework 9) | |
| `environment_id` | string | job | | |
| `claude_login` | object | job | `{loggedIn, email, subscriptionType, checked_at}`, re-checked every 300 s; never a token | |
| `consent` | boolean | all | the Remote Control answer is on record | |
| `consent_source` | string | all | `claude_config`, `marker`, `none` | |
| `workspace_trusted`, `rc_alive`, `resumed`, `tmux` | boolean | job | | |
| `restarts` | number | job | Remote Control restarts within this job | |
| `chain` | boolean | all | always on | |
| `next_job` | string | all | the queued successor, `""` until queued | |
| `chain_note` | string | job | | |
| `scheduler_in_worker`, `scheduler_note` | | job | framework 9 | |
| `workspace`, `rc_log`, `token_path` | string | job | paths (Details only) | |
| `stop_reason` | string | job | state `stopped` only: `request` or `login_abandoned` | 10 |
| `scheduler_state` | string | worker status | while queued: Slurm's `%T`, or `GONE` | 10 |
| `reason` | string | worker status | while queued: Slurm's `%r` (`Priority`, `Resources`, `None`, `QOSMax…`, `AssocGrp…`, `ReqNodeNotAvail…`) | 10 |
| `expected_start` | string | worker status | `%S` in UTC when in the future, else `""` (D12) | 10 |
| `checked_at` | string | worker status | when it asked | 10 |

### 9.2 The queued file

`worker start` writes this right after `sbatch` succeeds, before printing anything (keys in this
order; values for Wayne State):

```json
{"version":10,"site":"wayne","run":"worker","job":"40501234","node":"","state":"queued","message":"waiting for a computer","needs":"nothing","hint":"Your worker is in line for a computer.","submitted_at":"2026-10-01T12:44:05Z","updated_at":"2026-10-01T12:44:05Z","title":"Wayne State grid","requested_name":"Wayne State grid","renewal":false,"chain":true,"next_job":"","consent":true,"consent_source":"marker","scheduler_state":"","reason":"","expected_start":"","checked_at":""}
```

It also removes the `node` file (as framework 9 does) and appends progress.log's "Asked the grid for
a computer". A chain successor queued by the job (`adapter_submit_after`) gets no queued file: its
predecessor's status.json carries `next_job`, and the successor's first write sets `renewal: true`
(the successor knows it is one because `next.id`'s first field is its own id).

The job's first write replaces the queued file; it keeps `submitted_at` from it when its `job`
matches, and otherwise takes it from the scheduler (`scontrol show job` SubmitTime) or leaves it
`""`. It writes `node` and `got_computer_at` first, before anything else that can fail.

The sign-in abandon: a job still in `need_login` after the profile's `login_abandon_s` (1200 s) writes
state `stopped`, `stop_reason` `login_abandoned`, message `stopped: waiting for your Claude sign-in
timed out`, queues no successor (and cancels one already queued), appends "Stopped: waiting for your
Claude sign-in timed out" to progress.log, and exits. The time counts from the job's own start.

### 9.3 How the extension reads it

- **R1 Stale files.** A status.json or connection.json whose `job` is neither the run's job nor the
  run's `next_job` is ignored. When it names the run's `next_job`, that job becomes the run's job (a
  renewal).
- **R2 Queued is live** while `status.job` is the run's job.
- **R3 Never backwards.** Once a job has been seen past `queued` (any other state, or a `node` file
  modified at or after its `submitted_at`), a later `queued` for that job is ignored.
- **R4 Got a computer:** the `node` file is listed with `modified_at` at or after `submitted_at`, or
  the state is `starting`/`running` with `got_computer_at` set.
- **R5 Online:** state `online`, `environment_url` passes `isEnvironmentUrl`, and the heartbeat under
  90 s old (`updated_at`, or the listing's `modified_at` when the clocks disagree).
- **R6 Reconnecting:** state `starting`, `restarts` ≥ 1 and `online_at` set (it had been online).
- **R7 Slow:** `starting` or `running` for 3 minutes from `got_computer_at` with no online.
- **R8 Renewing:** state `preempted` with `next_job` set.
- **R9 Stopped** with `stop_reason` `login_abandoned`: hero "Stopped", log line "Stopped: waiting for
  your Claude sign-in timed out".
- **R10 Clocks** count from `submitted_at` (the queue) and `got_computer_at` ("Got a computer … ·
  0:20"), never from the browser; no queue clock when `renewal` is true.
- **R11 The Claude row** uses `claude_login` only when its `checked_at` is under 5 minutes old.
- **R12 A live state whose heartbeat is over 3 minutes old** (10.0.0's `STALE_AFTER_MS`) reads as
  last known: "As of 9:02 · online".
- **R13 "Ready in Claude, 7 min after you asked."**: `online_at − submitted_at`, rounded to whole
  minutes, only for the job the student's Connect submitted (`renewal` false). The same minutes go to
  `WAIT_HISTORY_KEY` as `got_computer_at − submitted_at`.

### 9.4 What the student never sees

`message`, `hint`, job and successor ids, node, partition, QoS, paths, Slurm's raw reason, raw shell
output, rc.log. Details shows them.

## 10. connection.json

Unchanged (`session_name`, `requested_name`, `session_url`, `environment_url`, `environment_id`,
`node`, `job`, `pid`, `started_at`, `token_path`, `workspace`, `rc_log`, `permission_mode`,
`capacity`, `resumed`, `next_job`), plus `title` and `online_at` (as in status.json). Written by the
job when the session registers. R1 applies.

## 11. The `node` file and progress.log

**`node`**: `<state_dir>/<name>/node`, one line, the compute node's short name and a newline. The job
writes it as its first act (framework 9 already does: `echo "$NODE" > node`); `worker start` removes
it right after a successful submit. The extension learns it exists from the listing (R4) and reads it
once for Details; a student never sees it.

**progress.log**: `<state_dir>/<name>/progress.log`. One line per event:

```
<YYYY-MM-DDTHH:MM:SSZ> <sentence>
```

appended with one write per line (O_APPEND). `worker start` trims the file to its last 400 lines
(temporary file, rename) before it appends. The sentences are a fixed set (`contract.ts PROGRESS`,
`parseProgressLine`); the time is UTC; the extension shows it on the browser's clock as "8:44".

| Sentence | Written by | When | Show log says |
|---|---|---|---|
| `Asked the grid for a computer` | worker start | right after the scheduler accepted the job (not for a chain successor) | Asked the grid for a computer |
| `Got a computer` | job | first act, with the `node` file | Got a computer |
| `Connecting to Claude` | job | the first start of Remote Control in this job | Connecting to Claude |
| `Online: <environment link>` | job | the first registration in this job | Online · <title> |
| `Waiting for your Claude sign-in` | job | entering need_login | Waiting for your Claude sign-in |
| `Reconnecting` | job | Remote Control exited after being online and will start again | Reconnecting |
| `Renewing` | job | wall time or preemption, successor queued | Renewing |
| `Ended` | job | wall time or preemption, no successor | Ended |
| `Stopped` | job | after a stop request | Stopped |
| `Stopped: waiting for your Claude sign-in timed out` | job | the abandon rule | Stopped: waiting for your Claude sign-in timed out |
| `Couldn't start: <message>` | job; worker status (GONE) | state error | Couldn't start (the message in Details only) |

Any other line is shown in Details only. The job also prints `<H:MM> Online. Open in Claude: <link>`
(the node's local time) to its own output when it first registers.

## 12. The run folder, and what the extension lists

```
<state_dir>/<name>/
  job.id  next.id  node  status.json  connection.json  progress.log
  rc.log  rc.prev.log  stop  stop.done  chain.log  job.sbatch  params
  launch.sh  in_image.sh  job.token  slurm_<id>.out  .notice-shown
<state_dir>/workspaces/<name>/            the worker's working folder (CLAUDE.md, .restricted)
~/.hpcworker/{profile.json, shared, consent, bin/hpcworker}
```

The extension lists `<state_dir>/<name>/` through the Files app's JSON listing (`portal.ts listDir`)
and looks only at the names and `modified_at` of `status.json`, `connection.json`, `node`,
`progress.log`, `next.id`, `stop.done` and `rc.log`. It never downloads `job.token`, `job.sbatch`,
`params`, the launch files or the job output.

| When | What |
|---|---|
| From Connect until online, panel open | the listing every 5 s; status.json and connection.json downloaded only when their `modified_at` changes; `node` read once when it appears; `worker status --json` once a minute while queued |
| From Connect until online, panel closed | an alarm every 30 s: the listing and changed files only |
| Online, or no start in progress | the listing every 60 s (panel open or closed), files only |
| Show log or Details open | progress.log downloaded when its `modified_at` changes |
| Details open, or `running` 60 s with no link | rc.log, once a minute (the registration fallback, `parseRegistration`) |
| The grid sign-in moment | one dashboard GET on each `tabs.onUpdated` "complete" of that tab, each 2-second panel tick, and a 0.5-minute alarm |
| The GlobalProtect moment | one credential-free no-cors request every 3 s while a page is open |
| Panel open, otherwise | one dashboard GET when it opens, on each press needing the grid, and once a minute (D37) |

Details' footer stays true: "Reads the worker's files every 5 seconds while it starts and once a
minute after; asks the scheduler at most once a minute."

## 13. The site profile (`framework/profiles/wayne.json`)

New keys, with Wayne State's values. The texts stream's `sync-profiles.mjs` copies the file into
`extension/public/profiles/`; the extension reads it with `contract.ts siteProfileFrom`.

| Key | Value | Read by |
|---|---|---|
| `ood_base_url` (kept; first read in 11.0.0) | `"https://ondemand.grid.wayne.edu"` | the welcome page's default portal (`keys.ts defaultPortalFrom`) |
| `vpn_portal` | `"protect.wayne.edu"` | the GlobalProtect moment's chip and the welcome's second requirement |
| `vpn_app` | `"GlobalProtect"` | the GlobalProtect moment, "Is GlobalProtect on?" |
| `vpn_help_url` | `"https://services.wayne.edu/TDClient/277/Portal/KB/Article/20314/Wayne-State-VPN-and-the-Global-Protect-client"` | "How to set it up" |
| `grid_account_help_url` | `"https://services.wayne.edu/TDClient/277/Portal/KB/ArticleDet?ID=20199"` (KB 20199; this address form is TeamDynamix's standard one and was not fetched) | "How to get one" |
| `ood_auth` | `"http-basic"` (a hint only; the channel test decides) | Details |
| `session_title` | `"Wayne State grid"` | the job's `--name`, status.json `title`, every "Look for Wayne State grid" |
| `login_abandon_s` | `1200` | the job's abandon rule |
| `shared_install` (kept) | `"/rs/rs_grp_oschome/shared/beethoven/hpcworker/current"` | every 11.0.0 command line |

Kept and still read: `submit_host` (`"warrior"`, login-setup's Host names), `ood_shell_host` (`""`),
`vpn_required` (`true`), `shared_state_dir`, `worker_defaults` (hours 8, which "Your worker restarts
itself every 8 hours" uses; capacity 4). The worker partition is the lab lead's decision (spec
Decision 5); the profile's partition keys are not touched by this contract.
`lib/profile.py` validates the new keys and accepts their absence; `RESUME_WINDOW_S` becomes 4 hours.

## 14. Waiting: the reason, the estimate and the history

`contract.ts reasonClass(reason)`: `share` for `QOSMax…`, `QOSGrp…`, `AssocGrp…`, `AssocMax…`;
`maintenance` for `ReqNodeNotAvail…` or anything containing `Reserv`; `line` for everything else
(`Priority`, `Resources`, `None`, `""`, unknown).

| Class | Hero / subline |
|---|---|
| line | "In line for a computer" / "3:12 · It starts as soon as one is free." plus "Expected around 9:12." when `expected_start` is set, else "Last time: 6 min." when `WAIT_HISTORY_KEY` has one |
| share | "Waiting for your share of the grid" / "It starts when your other grid jobs finish." |
| maintenance | "The grid is under maintenance" / "Your worker starts when it's back." |
| any, past 15 min | the subline adds "The grid is busy today. Your worker is still in line." |

The toolbar badge shows the whole minutes ("3m", ochre), the tooltip "Beethoven · In line for 3 min".

## 15. Views and actions (model.ts)

The pages are pure functions of a view; the core computes views from facts. `model.ts` holds:

- `WORDS`: every student-facing sentence, verbatim, as constants or small functions. The agreement's
  four summary lines and its tick belong to `terms.ts` (`SUMMARY`, `AFFIRMATION`, plus `TWO_TICKS =
  false` for the counsel variant); the data statement's four lines and its tick to `disclosure.ts`
  (`SHORT_STATEMENT`, `STATEMENT_TICK`). Views carry those as strings the core copies in.
- `LOG_WORDS`: Show log's words for Beethoven's events and the worker's progress lines.
- `PanelView` = `terms-needed` | `journey` (one `JourneyView` per `Moment`: welcome, globalprotect,
  grid, statement, connect, claude, login-setup, queue, starting, online) | `home` (`HomeView`: hero,
  the one primary, the online secondary row, the Grid/Claude/Worker rows, the foot row, Try asking,
  one-time cards, Show log). `WelcomeView`, `DetailsView`, `SettingsView`, `ToolbarView`, `TourView`.
- `Action`: every button and automatic step a page sends; `ActionResults` maps each kind to what it
  answers at once (the rest arrives as a new view). `PageAct` names the controls a page carries out
  alone because they need the click's own user activation (the clipboard) or are purely visual:
  copy-link and show-phone (from `HomeView.link`), copy-prompt, copy-vpn, copy-log, the login-setup
  line, show/hide terms, save and print terms, the ticks, folds and the confirm row.
- `formatTimer`, `formatUp`, `formatAgo`, `formatClock`: the formats the spec shows ("2:41", "2 h 14
  min", "20 s", "4:50 PM", "9:12").

Gestures: the welcome page's "Agree and continue" calls `sidePanel.open({windowId})` and
`permissions.request({origins:[<origin>/*]})` itself, inside the click and before any await, writes
TermsRecord v2 itself, and then sends `agree` with what Chrome answered. "Use this portal" and
Settings' "Change" do the same with their own request. Nothing else needs a gesture: tabs are opened
by the background.

Every tab Beethoven opens is recorded (`OpenedTab`) and closed only by the rules in §17.

## 16. Storage (keys.ts)

| Key | Area | Shape | PRIVACY row |
|---|---|---|---|
| `LAST_KNOWN_KEY` `bridge.lastKnown` | local | `LastKnown`: worker name, state, title, environment link, seen_at, online_since, ends_at, account | the spec's new local row ("your worker's claude.ai link, its session title, its last known state and when it was seen …"), without the tab (D15) |
| `CHANNEL_KEY` `bridge.channel` | local | `ChannelNote`: origin, `direct`/`tab`, shell `ok`/`password`/`unknown`, tested_at | "how the extension reaches your portal (directly, or through a tab it opens)" |
| `WAIT_HISTORY_KEY` `bridge.waits` | local | `WaitHistory`: `minutes: number[]`, at most five, newest last | "how long your last five waits for a computer took, in minutes" |
| `TOUR_SEEN_KEY` `bridge.tourSeen` | local | `TourSeen`: seen_at, completed | "that the tour was seen" |
| `ONCE_KEY` `bridge.once` | local | `OnceNotes`: first_online_at, try_asking_dismissed_at, pin_tip_shown_at, pin_tip_done_at, tour_card_dismissed_at, new_session_tip_at | **new row needed**: "which one-time tips you have seen or dismissed" |
| `PREFS_KEY` (kept) | local | `Prefs` + `appearance?: "cream" \| "system"`; `auto_start` now means "Keep my worker running" | the spec's row 2 |
| `PORTAL_KEY` (kept) | local | `PortalSettings`; written only after Chrome grants the origin | row 1 |
| `SIGNIN_TAB_KEY` `bridge.signinTab` | session | `OpenedTab` | "the tabs the extension opened itself" |
| `ANTHROPIC_TAB_KEY` `bridge.anthropicTab` | session | `AnthropicTab`: + pasted_at, loads_since_paste | same |
| `CLAUDE_TAB_KEY` `bridge.claudeTab` | session | `OpenedTab`: + loaded, loads_after | same (the spec put it in local; D15) |
| `TERMINAL_TAB_KEY` `bridge.terminalTab` | session | `OpenedTab` | same, **add** "the grid's terminal tab for the one-time step" |
| `ACTIVITY_KEY` `bridge.activity` | session | `ActivityEntry[]` ({at, text}), at most 200 | "a plain-words activity list for Show log" |
| `GRID_KEY` `bridge.grid` | session | `GridNote`: reach, session, account, checked_at | **add** to the connection-state row: "whether your portal answers and whether you are signed in to it" |
| `PRESS_KEY` `bridge.press` | session | `PendingPress`: kind, fresh, at | **add**: "a press waiting until the grid can carry it" |
| `RUN_KEY` (kept) | session | `RunState` (facts.ts), every write through one queue (§22); + `clock_offset_ms` | kept; the clock offset is named in the session row |
| `WELCOME_PRESS_KEY` `bridge.welcomePress` | session | `{at}`, written by the welcome page inside the click | "that you pressed Agree and continue …, for a few minutes" (§22) |
| `TERMS_HISTORY_KEY` `bridge.termsHistory` | local | earlier acceptance records, at most ten | the acceptance row: "an acceptance made with an earlier version … kept beside it, out of force" |

Nothing about the ssh key, no terminal text, no page title, no Claude credential and no pasted code is
ever stored.

## 17. Messages and tabs (messages.ts)

- `VIEW_PORT` (`beethoven-view`): each open page connects once, sends `{type:"subscribe", surface,
  windowId}`, then `{type:"tick"}` every 2 s (`TICK_MS`); the background answers with `{type:"view",
  view}` at once and on every change. An open port is how the background knows a panel is open.
- `{type:"action", action}` answered with `Answer<ActionResults[kind]>`; `{type:"view.get",
  surface}`; `{type:"panel.opened", windowId}` (the access re-check LICENSE 3(a) ties to opening the
  panel after a day or after a no).
- `terminal.watch {account}`, `terminal.type {line}` (background → the page script in the terminal
  tab; answer `TerminalTyped`) and `terminal.shell-up` (page script → background). §8.5.
- `CONNECT_PORT` (`beethoven-connect`): tab mode's connect sitting in the page script. The first frame
  is `{type:"connect", options: ConnectOptions}`; the page script builds the line itself with
  `commands.connect` from the bundled profile's shared copy, so it never runs a line it did not build;
  `{type:"input", text}` is the code; out-frames carry parsed `ConnectEvent`s only, never the
  terminal's text, plus `{type:"password"}` when the shell asked for one before anything was typed.
- Kept for tab mode and 10.0.0's page script: `portal.hello`, `portal.call`, `portal.ping`,
  `portal.tab`, `run.*`, `worker.start`, `killlist.refresh`, `access.check`, `LOGIN_PORT` with
  `LoginIn`/`LoginOut`.

**Tabs.** A tab is closed by Beethoven only if Beethoven opened or navigated it itself, only while
`tabs.get` still shows it where Beethoven left it (the grid tab: the portal origin; the terminal tab:
the shell page's path; Anthropic's tab: no new load since the paste), and never as the window's last
tab (a New Tab is opened first). claude.ai's tab is brought forward (`tabs.update {active:true}`,
`windows.update {focused:true}`) only while it has had no new load since Beethoven's own load
completed; otherwise "Open my session" opens the link in one new tab. Focus returns to the tab that
was in front before a sign-in tab opened. No "tabs" permission: loads are counted from
`tabs.onUpdated` status events, and the URLs are visible on the granted origin only.

**Toolbar** (`ToolbarView`): badge "…" ochre (asked, starting, renewing, reconnecting), "3m" ochre (in
line), "!" ochre (needs you), "!" brick (error), none (online, stopped); the lit icon
(`public/icon/on-*.png`) only when online; titles in `WORDS.toolbar`. `openPanelOnActionClick: true`.

## 18. The mock portal and the harness

The mock (`extension/mock-ood/server.mjs`, `mock-ood/bin/hpcworker`) speaks this contract exactly: the
same lines, the same files, the same field names. New switches:

| Switch | Default | Behaviour |
|---|---|---|
| `MOCK_AUTH=basic` | cookie | every `/pun/*` request and the shell WebSocket handshake answer `401` with `WWW-Authenticate: Basic realm="private"` unless `Authorization: Basic` carries `--user` and `MOCK_PASSWORD` (default `mockpass`); `/` answers `302` to `/public/start.html` (a page with a "LOGIN TO ONDEMAND" link to the dashboard). The real portal answered exactly this on 2026-10-01 (AM1). |
| `--samesite none\|lax\|strict` | as 10.0.0's mock | the cookie mode's `SameSite`; `lax` and `strict` force tab mode |
| `MOCK_QUEUE_S=<n>` | 0 | a submitted worker stays PENDING n seconds; `squeue -h -j <id> -o '%T\|%r\|%S\|%N'` answers `PENDING\|<reason>\|<now+n, %Y-%m-%dT%H:%M:%S>\|` then `RUNNING\|None\|<start>\|node01`; status.json is the queued file until the stand-in job starts |
| `MOCK_QUEUE_REASON` | `Priority` | the `%r` above |
| `MOCK_SIGNIN_WAIT_S=<n>` | 0 | the sign-in computer takes n seconds, with keepalives; 600 or more ends in `HPCW-STEP failed signin-node` |
| `MOCK_CODE_WAIT_S=<n>` | 600 | the sitting's code budget (D7) |
| `MOCK_PLAN` | `max` | `SIGNED-IN st1234@wayne.edu <plan>`; `free` exercises the refusal |
| `MOCK_SHELL_KEYLESS=1` | off | AM2's mode, below |
| `MOCK_LOGIN_FAIL=1`, `MOCK_LOGGED_IN=false`, … | as 10.0.0 | unchanged |

**Keyless mode.** Until this mock account has run `login-setup`, every shell WebSocket (the
background's and the terminal page's) first prints `st1234@login1's password: ` (it matches shell.ts's
`/password:/`) and waits for a line: the right password (`MOCK_PASSWORD`) prints the usual "Last
login" line and prompt; a wrong one prints `Permission denied, please try again.` and asks again;
three wrong ones close the socket. Shells carry `SSH_CONNECTION="10.0.0.1 52341 10.0.0.2 22"`. The
mock's `login-setup` writes `~/.ssh/beethoven_ed25519` and `.pub`, the config block and the
authorized_keys line with `from="10.0.0.1"` exactly as §8.2 says, and prints §8.3's lines; from then
on the shell skips the password whenever `~/.ssh/authorized_keys` holds a line containing
`beethoven-login-setup` and `from="10.0.0.1"`. In this mode the page `/pun/sys/shell/ssh/<host>` is a
real terminal: a `<textarea class="xterm-helper-textarea">` that turns a `paste` event's
`text/plain`, an `input` event with `inputType: "insertText"` and a `keydown` Enter into `{input}`
frames, shows the output (never echoing the password), starts with the title `Shell`, and sets
`document.title` from OSC 0 or 2 sequences; after the password, the mock's prompt sends
`ESC ] 0 ; st1234@login1:~ BEL`.

**The harness must show, on the mock:** the one-gesture welcome (panel and permission from one click);
the Basic sign-in tab closing itself; the tab-closing guards (only self-opened tabs, only where
Beethoven left them, never the last tab); the queue with a running clock, the reason classes and the
estimate; the code paste; the keyless path end to end (offer → terminal → password typed through
Windows UI Automation into the terminal page → "I'm in" or the title sign → the line typed → the
test passes → the tab closes → "Done. You won't need this again." → the waiting Connect carries on);
the unsupported-terminal path ("Paste, then press Enter."); and a sitting held 11 minutes with the
code pasted at 10:30 (`MOCK_CODE_WAIT_S=700`), to settle D32. The live access service may be reached
only by the real extension, against the mock at localhost, as `st1234` (hard rule 4); every other
approval answer uses a local stand-in.

## 19. What framework 10 keeps for the 10.0.0 extension (AM5)

Greg's installed 10.0.0 and his running worker (framework 9) must keep working when framework 10
replaces 9 on the lab's volume. From `contract.ts` at f8d2e88 and its callers:

- **Lines 10.0.0 types, and the output it reads from each:**
  - `bash '<dir>/bin/hpcworker' install --shared '<dir>' --profile '<site>'`: exit 0 on success; exit
    3 with `hpcworker: the shared copy at <dir> cannot be used from this account: <why>. Nothing was
    changed.` (install.ts `sharedUnusable`).
  - `bash ~/.hpcworker/bin/hpcworker discover 2>/dev/null || …`: the JSON keys `host`, `scheduler`
    (`family`), `runtime` (`candidates[].name`, `modules`, `pyxis`, `user_namespaces`), `os`,
    `glibc`, `env` (`TMPDIR`, `SLURM_TMPDIR`, `https_proxy`), `partitions[]` (`name`, `timelimit`,
    `avail`), `tools` (`tmux`, `python3`).
  - `bash ~/.hpcworker/bin/hpcworker probe`: `probe job <id> submitted …` or `probe job <id> is still
    …`; probe.json as `ProbeFile`.
  - `bash ~/.hpcworker/bin/hpcworker worker start --name '<n>' --permission-mode '<m>'`: `worker <n>
    submitted as job <id> …` or `worker <n> already has job <id> (…); nothing submitted`.
  - `bash ~/.hpcworker/bin/hpcworker worker stop --name '<n>'`.
  - `bash ~/.hpcworker/bin/hpcworker claude login --plain`: every line in §5.4 except the keepalive,
    exactly as framework 9, including the 15-minute "already signed in (a worker confirmed it …)"
    shortcut. **No keepalive here.**
- **Files 10.0.0 reads:** status.json and connection.json with every framework 9 field (§9.1 keeps
  them all), rc.log's registration block, job.id, next.id (`<successor> <parent>`),
  `~/.hpcworker/shared`, the launcher's tag on its second line, `VERSION` (shared and own),
  `profile.json` (`shared_state_dir`, `site`, `shared_install`, `restricted`, `restricted_workspaces`),
  probe/probe.json, `workspaces/<n>/.restricted`.
- **Files 10.0.0 writes through Files, which framework 10 must still honour:** `~/.hpcworker/consent`
  (any content counts as the answer; 10.0.0 writes `yes <ISO> <install id>`) and the stop file
  `<run>/stop` (a touch).
- **The new state.** 10.0.0 does not know `queued`: it treats the run as not live, and its automatic
  start runs `worker start` at most once a minute (its 60 s floor) and gets `worker <n> already has
  job <id> (PENDING); nothing submitted`. Framework 10 must keep that sentence and `worker start`'s
  one-squeue check, so nothing is ever submitted twice; the cost is one squeue a minute while queued.
  10.0.0's strip says "Starting your worker…" meanwhile. A `stopped` worker (the abandon rule
  included) is never restarted by 10.0.0's automatic start (`maybeAutoStart` skips state `stopped`).
- **Values that change and are only displayed by 10.0.0:** `requested_name` becomes the title;
  `hint` for starting no longer says "about a minute"; the resume window becomes 4 hours.
- **VERSION** becomes 10; 10.0.0 only shows it.

## 20. Changes needed outside the four contract files

For the streams that own them (I did not edit them):

- **core (`shell.ts`)**: let `{}` through the frame guard (§4); add the interactive connect sitting
  with `exec`, the 20 s `{}`, `parseConnectLine`; the password result before typing.
- **core (`audit.ts`)**: classify `connect` and `worker status` behind `exec bash '…'` / `bash '…'`
  as scheduler-class, `worker restrict` as shell.
- **core (`terms.ts`)**: `TWO_TICKS = false` beside the one `AFFIRMATION`; TERMS_VERSION 8, TERMS_DATE
  `'2026-10-01'` (AM6).
- **core (`disclosure.ts`)**: `SHORT_STATEMENT`, `STATEMENT_TICK`, Acknowledgement v3 with
  `consent_recorded_at` set on `HPCW-STEP consent`.
- **core (`facts.ts`, `steps.ts`)**: R1–R13; the views of model.ts.
- **background / `portal.content.ts`**: the terminal page script (§8.5), `CONNECT_PORT`, `VIEW_PORT`,
  tab records and guards (§17).
- **framework**: everything in §5–§14; `common.sh` `hpcw_needs`/`hpcw_hint` for `queued`; the
  starting hint; `slurm.sh` `adapter_status_one` with the `%T|%r|%S|%N` format.
- **texts**: PRIVACY rows for `ONCE_KEY`, `GRID_KEY`, `PRESS_KEY`, the terminal tab (§16) and the
  claude.ai tab moving to the session row; the page-script and `scripting` sentences (LICENSE 5(f),
  PRIVACY, LISTING.md's permission row, the manifest comment) must cover the one-time grid terminal
  step: "a page script on the grid's own terminal page, once, to type one line after you sign in
  there; it reads the page title and nothing else"; the reviewer recipe gains the keyless path on the
  mock; THIRD_PARTY_NOTICES for qrcodegen and the site diagram. The hygiene test's allow-list (§2,
  item 1).

## 21. Left to the streams

No function in the four contract files is a stub: the command builders, `parseStepLine`,
`parseConnectLine`, `withoutKeepalive`, `parseStatusJson`, `parseProgressLine`, `loginSetupOutcome`,
`isLoginSetupLine`, `reasonClass`, `planWord`, `planAllowsRemoteControl`, `plausibleCode`,
`sessionTitleFor`, `siteProfileFrom`, `defaultPortalFrom` and the four formatters have working bodies,
checked by a scratch script on 2026-10-01 (71 cases, all passing; not committed, because test files
belong to the core stream). What the core stream writes against them: the views from facts (steps.ts
`journey()` and `home()`), the background's handlers for each `Action`, the sitting host (D32), the
channel test, and the tests named in the spec plus one per parser above.

## 22. After the review (the integration pass, 2026-10-01)

Four verifiers ran the build (the harness on the mock, a look at every screen, an adversarial read of
the code, and the cluster tool with the texts). What changed in the contract because of them; where an
earlier section says otherwise, this section wins.

**The run record.** Every write of `RUN_KEY` goes through one queue in the background (`mutateRun`):
each writer re-reads the record inside it and merges what it knows. A listing applies only files whose
`modified_at` is not older than what the record holds, and only to the same run (state directory and
name); it never writes a record of a run it found while a Connect is under way. `HPCW-STEP queued`
merges `pressed` and `started_by` into the record as it is then, and only after that is the queue
moment shown. `worker status --json`'s answer is merged for the same job, while it is still in line,
never written back from a copy read before its wait. Going online (the wait history, the
announcement, claude.ai opened once) is decided inside the queue, once.

**One connect at a time.** `startConnect` claims the start before its first await (`mem.startId`); a
second caller in the same moment types nothing. The panel's tick carries no kept press while a press
is being handled (`mem.pressDepth`). Stop, Cancel and "Sign in again" give up a connect not typed yet:
its floor wait ends, and a shell it opened is closed before its line. A shell page that answers 401 or
403 during a Connect is the grid sign-in lapsing: the press waits for it, as any press does.

**The floor.** `worker status` has a 60-second clock of its own (`audit.ts` class `status`), apart from
`scheduler` (connect, worker stop, probe): the background's own question never takes the turn of a
Stop or a Connect, and is not asked at all while a press waits or runs. When its own wait is over it
asks only if the answer is still wanted. Two presses of the student's (Stop, then Connect) still share
the 60-second scheduler floor.

**The shell is typed into only on evidence that it is up** (`shell.ts`): a last line shaped like a
prompt (`$ # % >` at its end, not a password prompt), or sshd's `Last login:` followed by four seconds
of quiet. Never on silence: a shell that says nothing for 30 s is given up with nothing typed. After a
line is typed, a password prompt before the line is seen to run (its echo, or `HPCW-`, or the begin
marker) ends the sitting as `password` and nothing more is sent. `testShell` says `ok` on the same
evidence only; output that shows neither is `unknown`.

**Clocks.** `RunState.clock_offset_ms` (the Files app's `Date` header against this computer's clock,
0 within three seconds): `runFacts` moves every grid time onto this computer's clock before comparing
it with now (R5, R11, R12) or handing it to a timer.

**The welcome page and the panel.** "Use this portal" only chooses; Chrome is asked for that origin by
"Agree and continue", inside its click. The page writes `WELCOME_PRESS_KEY` (session) inside the same
click, before the panel opens, so the panel says "Almost there." / "Choose Allow in Chrome's box.
Beethoven carries on here." / "Waiting for Chrome…" (and after a Deny "Choose Try again on the welcome
page."), never the terms refusal while Chrome's box is up. The terms-needed view is no longer sent:
before the agreement the panel's journey moment `welcome` says "Finish on the welcome page" with
TERMS_REFUSAL. After the first run, a portal whose grant was taken away shows `welcome` in state
`revoked` ("Allow Beethoven again" [Allow again]: the panel asks Chrome inside the click, then sends
`use-portal`), not a VPN sentence. A welcome tab is navigated to the grid only while the welcome page's
own port from that tab is connected; a sign-in tab only while it is still on the portal.

**Words.** "Ready in Claude in under a minute." under a minute; "· online just now" in the first
minute, never "up 0 min", and "up …" only from a time the grid gave; "Expected around 5:43 PM."; the
Claude row "Not checked yet"; the Worker row "As of 6:04 PM · online"; the Grid row "Can't reach";
Cancel while in line asks "Give up your place in line?" [Cancel it] [Keep it]. A wait that ends in a
failure says so as the moment's headline, without its clock: "The grid didn't take the request." /
"Try again in a minute. If it happens again, Details for your lab lead has the reason."; "The grid
didn't find a computer for the sign-in." / "Your worker keeps its place in line."; "Your worker
couldn't start." The Claude moment appears only when its link was shown (`linkShown`); a sign-in that
was already there says "Signed in as … · Max" as a toast. A sign-in the background lost says "The
sign-in stopped before it finished." [Sign in again]. The statement's checklist, all done, is one
line: "Signed in as st1234 · Approved · Ready". The Details footer names both scheduler clocks.

**The home.** At most one one-time card (the pin tip, else the tour card); Try asking is one compact
card (one prompt, its dots, Copy, the x); the waiting states draw their timer as the hero's large line;
the track stays, all done, while "You're online." holds. The auto tour sends `{kind:'tour',
event:'auto'}` when it begins (ONCE_KEY `tour_auto_played_at`), so the home offers no tour card after it.

**The agreement.** A record that replaces another keeps it in `TERMS_HISTORY_KEY`. Settings shows the
installation identifier with the acceptance record and saves the record as text (`terms.ts
recordText`), so LICENSE 19(a)'s notice condition points at something.

**The toolbar.** Unlit is `icon/off-*.png` (the rack alone, no tile, the ink's faint tone; also the
manifest's `action.default_icon`); lit stays `icon/on-*.png`.

**The cluster tool.** `adapter_status_many` exits 2 when squeue fails for a reason other than "Invalid
job id"; `worker start` (and `connect`) then submits nothing: `HPCW-STEP failed refused the scheduler
did not answer, so nothing was submitted; try again in a minute` (exit 5). One `worker start` at a time
per worker (`<run>/.start.lock`, the job ids read inside it). `worker status` writes `GONE` only when
the scheduler no longer lists the job or lists it ended; a state word it does not know changes
nothing. squeue is bounded at 20 s. The person-facing first line of a live state whose file is over
three minutes old: `Your worker last reported N min ago (it said: online); it may have ended.` The
sign-in abandon asks Claude Code once more before stopping, and counts from `signin.pending` (touched
by `connect` when its sitting starts and ends) when that is later. The worker job binds an empty file
over `~/.ssh/beethoven_ed25519` inside the container (`hpcw_hide_login_key`), only when the key exists
and a bind of the home makes it visible.
