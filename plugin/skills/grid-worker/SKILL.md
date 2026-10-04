---
name: grid-worker
description: Use when the student asks about their Claude Code worker on the university grid (start it, is it online, open it, stop it, its log, its files), or about signing in to the grid. Uses Beethoven's tools, never ssh from the shell.
---

# The student's grid worker, through Beethoven

Beethoven's tools reach the student's Claude Code worker, which runs as a batch job on their
university's grid. Use them, in this order, and nothing else for the grid:

1. `grid_check`. If it says the student is not signed in, use `grid_sign_in`: a terminal window
   opens and the student signs in there, in ssh's own prompt. Never ask the student for their grid
   password or one-time code, never offer to type them, and never run `ssh`, `scp` or `sftp` to the
   grid from the shell: no tool takes a password, and the grid's login node is shared.
2. `worker_status` says where the worker is. It asks the grid at most once a minute; calling it more
   often returns the same answer.
3. `worker_start` asks for the worker; `open_in_claude` opens its Claude Code link once it is online.
4. `worker_log`, `workspace_list` and `workspace_read` show what the worker did and its files.
5. `worker_stop` ends the worker. Ask the student before using it.

If the worker waits for a Claude sign-in, tell the student the line `worker_status` gives and that
they run it themselves in the grid terminal. Never run it for them.

Do not suggest adding the grid as an SSH connection in Claude Code Desktop: Desktop installs and runs
Claude Code on the remote machine, which here is the grid's login node, and the grid forbids that.
Do not run anything on the login node from the shell; long work belongs in the worker.
