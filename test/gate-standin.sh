#!/bin/bash
# A stand-in for the lab's shared copy of hpcworker, for this repository's ssh tests: `hpcworker gate`
# only, answering the verbs of the server repository's docs/V12_CONTRACT.md ("The gate") from a run
# folder under $STANDIN_STATE (status.json, connection.json, progress.log as a test leaves them). It
# refuses what the real gate refuses for the lines this edition sends; it is not the real gate, which
# the test with HPCWORKER_DIR runs instead. Every line it is asked is appended to $STANDIN_STATE/calls.
set -u
[ "${1:-}" = gate ] && [ $# = 1 ] || { echo "HPCW-GATE refused"; exit 126; }
c="${SSH_ORIGINAL_COMMAND-}"
sd="${STANDIN_STATE:?}"
echo "$c" >> "$sd/calls"
case "$c" in *[!A-Za-z0-9._\ -]*|'') echo "HPCW-GATE refused"; exit 126;; esac
set -f; t=( $c ); set +f
name_ok() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$ ]]; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
case "${t[0]}" in
  version) [ ${#t[@]} = 1 ] || { echo "HPCW-GATE refused"; exit 126; }
    echo "HPCW-GATE ok 16 never $(id -un) claude=yes";;
  status) [ ${#t[@]} = 2 ] && name_ok "${t[1]}" || { echo "HPCW-GATE refused"; exit 126; }
    r="$sd/${t[1]}"
    [ -d "$r" ] || { echo "hpcworker: no worker named ${t[1]} (hpcworker worker start)" >&2; exit 1; }
    st=$(cat "$r/status.json" 2>/dev/null || echo null)
    co=$(cat "$r/connection.json" 2>/dev/null || echo null)
    job=$(cat "$r/job.id" 2>/dev/null || echo "")
    printf '{"v":1,"run":"%s","job":"%s","next_job":"","state_dir":"%s","status":%s,"connection":%s,"scheduler":null,"line":"%s"}\n' \
      "${t[1]}" "$job" "$sd" "$st" "$co" "$(cat "$r/line" 2>/dev/null || echo 'Your worker is online.')";;
  stop) [ ${#t[@]} = 2 ] && name_ok "${t[1]}" || { echo "HPCW-GATE refused"; exit 126; }
    [ -d "$sd/${t[1]}" ] || { echo "hpcworker: no worker named ${t[1]}" >&2; exit 1; }
    echo "$(now) Stopped" >> "$sd/${t[1]}/progress.log"
    echo "worker ${t[1]}: stopped (the job ended by itself; the chain ended)";;
  read) [ ${#t[@]} = 3 ] && name_ok "${t[1]}" || { echo "HPCW-GATE refused"; exit 126; }
    case "${t[2]}" in status.json|connection.json|progress.log|node) ;; *) echo "HPCW-GATE refused"; exit 126;; esac
    f="$sd/${t[1]}/${t[2]}"
    [ -e "$f" ] || { echo "HPCW-GATE missing" >&2; exit 1; }
    { [ -f "$f" ] && [ ! -L "$f" ]; } || { echo "HPCW-GATE not-plain" >&2; exit 3; }
    tail -c 262144 -- "$f";;
  connect) [ ${#t[@]} = 6 ] && name_ok "${t[1]}" && [[ "${t[3]}" =~ ^([0-9a-f]{32}|-)$ ]] || { echo "HPCW-GATE refused"; exit 126; }
    case "${t[4]}" in default|acceptEdits|plan) ;; *) echo "HPCW-GATE refused"; exit 126;; esac
    case "${t[5]}" in chain|no-chain) ;; *) echo "HPCW-GATE refused"; exit 126;; esac
    r="$sd/${t[1]}"; mkdir -p "$r" "$sd/workspaces/${t[1]}"
    echo 40501234 > "$r/job.id"
    echo "$(now) Asked the grid for a computer" >> "$r/progress.log"
    echo "HPCW-STEP setup ready"
    echo "HPCW-STEP queued 40501234 new $r"
    echo "HPCW-STEP done";;
  *) echo "HPCW-GATE refused"; exit 126;;
esac
