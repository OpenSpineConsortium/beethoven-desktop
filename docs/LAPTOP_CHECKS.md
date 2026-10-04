# Laptop checks

What only a real computer and the real grid can settle. The container that built this edition has no
Claude Desktop, no Windows and no route to the grid (VPN and a one-time code), so none of these has been
done. Each one says what to do, what to look for, and has a line for the outcome; the outcome goes here
and into the spike's section 6 table (`docs/DESIGN.md` section 6). Use the `.mcpb` from the CI run's
artifact (`beethoven-desktop`) or `npm run pack`.

Settings for all of them: grid account `go2432`, site `wayne`, worker name `worker`.

1. **Install the bundle on Windows 11.** Double-click `beethoven-1.0.0.mcpb` (or Settings, Extensions,
   Advanced settings, Install Extension). Note what Desktop says about an unsigned bundle, and whether it
   asks for the four settings.
   Outcome: not yet measured.

2. **Tool approval.** In a new chat, ask "check my grid connection". Does Desktop ask before each tool
   call? Does "always allow" stick across a restart? Does `worker_stop` (marked destructive) ask even
   when others do not?
   Outcome: not yet measured.

3. **Sign in through WSL** (settings: Use WSL on; in WSL, `sudo apt install openssh-client` if `ssh` is
   missing). With the VPN up, ask Claude to sign in to the grid. A console window should open with
   three sentences and ssh's own prompt; type the password and the Google Authenticator code there.
   Close the window, then ask for `grid_check`. Expected: "Signed in to the grid", the account and the
   worker tool's version.
   Outcome: not yet measured.

4. **Windows' own ssh** (Use WSL off). Ask for `grid_check`. Expected, if Windows OpenSSH cannot keep a
   connection master: the message that Beethoven needs your own ssh key here or "Use WSL". Note what
   actually happens, and whether the sign-in window's ssh asked for the code.
   Outcome: not yet measured.

5. **The pinned host key.** The first request must pass the pin in `profiles/wayne.json`
   (`SHA256:kLTz1xK6anQ1denM+31kDEryQtgan2P76r9aLno+K3s`). Afterwards `~/.beethoven-desktop/known_hosts`
   (or WSL's own `~/.beethoven-desktop/`) should hold only `grid.wayne.edu` lines.
   Outcome: not yet measured.

6. **The worker, end to end.** Ask Claude to start the worker, then for its status a few times over some
   minutes (it should not ask the grid more than once a minute), then to open it in Claude once online.
   Expected: the browser opens the `https://claude.ai/code?environment=…` link; `worker_log` shows the
   lines. Leave the worker running or ask to stop it (Claude should ask you first).
   Outcome: not yet measured.

7. **The workspace on CephFS.** Ask Claude to list the worker's workspace and read `CLAUDE.md` from it.
   Expected: the listing of `/rs/rs_grp_oschome/go2432/hpcworker/workspaces/worker` and the file's text;
   if your grid `~/.bashrc` prints anything, the listing must still work.
   Outcome: not yet measured.

8. **What Desktop keeps.** Open Desktop's logs folder (Settings, Developer, or on Windows
   `%APPDATA%\Claude\logs`) and read the Beethoven server's log. Our server writes one line
   ("beethoven-desktop 1.0.0 started"); note whether Desktop also writes the tool results there (the
   workspace text would then be on disk in that log).
   Outcome: not yet measured.

9. **The sign-in wait.** `grid_sign_in` waits up to 40 seconds for you to finish typing. Note whether
   Desktop gives up on the call before that, and what Claude says if it does.
   Outcome: not yet measured.

10. **The Claude Code plugin.** In Claude Code on the laptop (CLI, or the Code tab of Desktop), run
    `claude --plugin-dir <the dist/beethoven folder>` (or add it from a local marketplace) and set the
    same options; ask for `grid_check` with the sign-in from check 3 still kept.
    Outcome: not yet measured.

11. **No usage credits.** On claude.ai, in the settings of the account the worker uses, confirm that paid
    usage beyond the plan (extra usage) is off. Nothing in Beethoven turns it on, but the account switch
    is where the rule actually holds.
    Outcome: not yet measured.
