#!/bin/bash
# Refresh profiles/ from OpenSpineConsortium/hpcworker's export "profiles" (the composed site profiles,
# data only, canonical there) and write ORIGIN: the commit they came from, the export and its version,
# and each file's sha256 (test/boundary.test.ts checks the copy against it). Nothing of that repository
# is run here, and nothing is read from a checkout of it (the interface standard, interface/README.md).
#
#   bash profiles/pull.sh [--ref REF]   from GitHub through gh and your own sign-in (REF: main)
#
# REF must be a commit hpcworker's default branch contains (a merged change, never a pull request's
# branch), and only the files its interface/INTERFACE.json lists under the export "profiles" version 1
# at that commit are taken, each at its path below the folder the export's paths share
# (framework/profiles/wayne.json lands at profiles/wayne.json). A profile this copy has and the source
# no longer does is listed for a person to remove in a reviewed commit; nothing is deleted. Until
# hpcworker's default branch carries its interface/INTERFACE.json, this refuses and says so. The copy
# and ORIGIN are committed together; the build ships every profiles/*.json byte for byte.
REPO=OpenSpineConsortium/hpcworker
EXPORT=profiles WANT=1   # the export, and the version of it src/profile.ts reads
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# your own gh sign-in: a token another tool left in the environment is never what pulls
GH() { env -u GITHUB_TOKEN -u GH_TOKEN gh "$@"; }

export_paths() { # the provider's INTERFACE.json on stdin -> the export's paths, one per line; fails, naming what is offered, unless it offers EXPORT at WANT
  node -e '
const [id, want] = process.argv.slice(1);
let m;
try { m = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error("its INTERFACE.json is not JSON"); process.exit(1); }
const all = m && Array.isArray(m.exports) ? m.exports : [];
const e = all.find((x) => x && x.id === id);
if (!e || e.version !== Number(want) || !Array.isArray(e.paths) || e.paths.length === 0) {
  console.error(`export ${id} version ${want} is not offered (offered: ${all.map((x) => `${x && x.id} ${x && x.version}`).join(", ") || "none"})`);
  process.exit(1);
}
// a path this copy could not place below its own folder is refused before anything is fetched
const bad = e.paths.find((p) => typeof p !== "string" || p === "" || p.startsWith("/") || p.includes("\\") || p.split("/").includes(".."));
if (bad !== undefined) { console.error(`export ${id} lists a path no copy may take: ${JSON.stringify(bad)}`); process.exit(1); }
process.stdout.write(e.paths.join("\n") + "\n");' "$EXPORT" "$WANT"
}

shared_base() { # PATTERN... -> the folder all of them share, with its "/" ("" when only the root): framework/profiles/*.json -> framework/profiles/
  local p f base="" first=1
  for p in "$@"; do
    f="${p%%\**}"
    if [[ "$f" == */* ]]; then f="${f%/*}/"; else f=""; fi
    if [ $first = 1 ]; then base="$f"; first=0; continue; fi
    while [[ "$f" != "$base"* ]]; do
      base="${base%/}"
      if [[ "$base" == */* ]]; then base="${base%/*}/"; else base=""; fi
    done
  done
  printf '%s' "$base"
}

covered() { # PATH PATTERN... -> 0 when a pattern covers PATH ("dir/" every file under it, "*" within one part of a path)
  local path="$1" p re; shift
  for p in "$@"; do
    [ -n "$p" ] || continue
    if [[ "$p" == */ ]]; then [[ "$path" == "$p"* ]] && return 0
    else re="^$(printf '%s' "$p" | sed -e 's/[.[\^$+?(){}|]/\\&/g' -e 's/\*/[^\/]*/g')\$"; [[ "$path" =~ $re ]] && return 0; fi
  done
  return 1
}

placed() { # BASE PATH -> where PATH lands in this folder; fails when it is not below BASE, climbs out, or would land on ORIGIN, README.md or pull.sh
  local rel="${2#"$1"}"
  [ "$rel" != "$2" ] || [ -z "$1" ] || return 1
  case "/$rel/" in *//*|*/../*|*/./*) return 1;; esac
  case "$rel" in ORIGIN|README.md|pull.sh) return 1;; esac
  printf '%s' "$rel"
}

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

main() {
  set -euo pipefail
  local ref=main
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) [ $# -ge 2 ] && [ -n "$2" ] || { echo "--ref needs a branch, tag or commit" >&2; exit 2; }; ref="$2"; shift 2 ;;
      *) echo "usage: bash profiles/pull.sh [--ref REF]" >&2; exit 2 ;;
    esac
  done
  command -v gh >/dev/null || { echo "FAILED: gh is not installed" >&2; exit 1; }
  command -v node >/dev/null || { echo "FAILED: node is needed to read the export's paths" >&2; exit 1; }

  local sha default manifest patterns tree base p rel dest
  sha=$(GH api "repos/$REPO/commits/$ref" --jq .sha) || { echo "FAILED: could not ask $REPO for $ref (is gh signed in?)" >&2; exit 1; }
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "FAILED: no commit for $ref" >&2; exit 1; }
  default=$(GH api "repos/$REPO" --jq .default_branch)
  case "$(GH api "repos/$REPO/compare/$default...$sha" --jq .status)" in
    identical|behind) ;;
    *) echo "FAILED: $sha is not on $REPO's $default; take only what was merged there" >&2; exit 1 ;;
  esac
  fetch() { GH api -H "Accept: application/vnd.github.raw" "repos/$REPO/contents/$1?ref=$sha"; }

  # the export's paths, as the provider's manifest at that commit lists them
  manifest=$(fetch interface/INTERFACE.json 2>/dev/null) || {
    echo "FAILED: $REPO has no interface/INTERFACE.json at $sha on $default: its interface is not merged yet, so there is no export \"$EXPORT\" to take. The copy here stays as profiles/ORIGIN records it." >&2
    exit 1
  }
  patterns=$(printf '%s' "$manifest" | export_paths) || { echo "FAILED: $REPO at $sha does not offer $EXPORT version $WANT" >&2; exit 1; }
  local -a pats=() paths=() rels=()
  while IFS= read -r p; do [ -n "$p" ] && pats+=("$p"); done <<< "$patterns"
  base=$(shared_base "${pats[@]}")
  tree=$(GH api "repos/$REPO/git/trees/$sha?recursive=1" \
    --jq 'if .truncated then error("the listing of the tree is truncated") else (.tree[] | select(.type == "blob") | .path) end') \
    || { echo "FAILED: could not list $REPO at $sha" >&2; exit 1; }
  while IFS= read -r p; do
    [ -n "$p" ] && covered "$p" "${pats[@]}" || continue
    rel=$(placed "$base" "$p") || { echo "FAILED: $p has no place in profiles/ (the export's folder is $base)" >&2; exit 1; }
    paths+=("$p"); rels+=("$rel")
  done <<< "$tree"
  [ "${#paths[@]}" -gt 0 ] || { echo "FAILED: no file in $REPO's export $EXPORT at $sha" >&2; exit 1; }

  local -a origin=("repository $REPO" "commit $sha" "export $EXPORT $WANT")
  local i
  for i in "${!paths[@]}"; do
    p="${paths[i]}" rel="${rels[i]}" dest="$HERE/${rels[i]}"
    mkdir -p "$(dirname "$dest")"
    # raw bytes, not the JSON envelope (past 1 MB the contents API answers with an empty "content"),
    # and a profile that is not JSON never replaces a good one
    fetch "$p" >"$dest.part" || { rm -f "$dest.part"; echo "FAILED: could not read $p at $sha" >&2; exit 1; }
    case "$rel" in
      *.json) node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$dest.part" 2>/dev/null \
                || { rm -f "$dest.part"; echo "FAILED: $p at $sha is not JSON" >&2; exit 1; };;
    esac
    mv -f "$dest.part" "$dest"
    origin+=("sha256 $(sha256_of "$dest") $rel")
  done
  printf '%s\n' "${origin[@]}" >"$HERE/ORIGIN.part"
  mv -f "$HERE/ORIGIN.part" "$HERE/ORIGIN"
  echo "profiles: ${#paths[@]} file(s) of $REPO's export $EXPORT $WANT at $sha"
  local f r known stale=0
  while IFS= read -r f; do
    rel="${f#"$HERE"/}" known=0
    case "$rel" in ORIGIN|README.md|pull.sh) continue;; esac
    for r in "${rels[@]}"; do [ "$r" = "$rel" ] && known=1; done
    [ $known = 1 ] && continue
    echo "not in $REPO's export any more: profiles/$rel (remove it in a reviewed commit)"
    stale=1
  done < <(find "$HERE" -type f | sort)
  [ "$stale" = 0 ] || echo "until then test/boundary.test.ts fails: the folder holds a file ORIGIN does not list"
}

# sourced (test/boundary.test.ts reads the pure parts above), nothing runs
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
