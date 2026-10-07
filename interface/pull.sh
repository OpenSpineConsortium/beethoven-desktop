#!/bin/bash
# Take a pinned copy of another repository's export into the folder interface/INTERFACE.json names for
# it, and write that folder's ORIGIN: the repository, the commit, the export and its version, and each
# file's sha256 (test/boundary.test.ts checks the folder against it). Nothing of the other repository is
# run here, and nothing is read from a checkout of it (the interface standard, interface/README.md).
#
#   bash interface/pull.sh [--ref REF] FOLDER...    from GitHub through gh and your own sign-in (REF: main)
#   bash interface/pull.sh --pinned FOLDER...       exactly the commit FOLDER/ORIGIN already names
#   bash interface/pull.sh [--ref REF] --all        every import
#
# FOLDER is an import's "into" (profiles, contract, contract-text, test/hpcworker-testbed,
# test/hpcworker-framework). REF must be a commit the provider's default branch contains (a merged
# change, never a pull request's branch), and only the files the provider's interface/INTERFACE.json
# lists under the import's export, at the version the import names, at that commit, are taken, each at
# its path below the folder the export's paths share (framework/profiles/wayne.json lands at
# profiles/wayne.json). Every file is fetched before any is placed, so a failure leaves the folder as it
# was. A file this copy has and the export no longer does is listed for a person to remove in a
# reviewed commit; nothing is deleted. --pinned is how the opt-in real-gate lane's program folders
# (ignored by git but for their ORIGIN) are filled on a new checkout; it refuses unless what it fetched
# is byte for byte what ORIGIN records.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

import_of() { # INTO, this repository's INTERFACE.json on stdin -> "repository export version"; fails unless INTO is one import's folder
  node -e '
const into = process.argv[1];
let m;
try { m = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.error("interface/INTERFACE.json is not JSON"); process.exit(1); }
const all = m && Array.isArray(m.imports) ? m.imports : [];
const i = all.find((x) => x && x.into === into);
if (!i) { console.error(`no import goes into ${into} (imports: ${all.map((x) => x && x.into).join(", ") || "none"})`); process.exit(1); }
const ok = /^OpenSpineConsortium\/[a-z0-9.-]+$/.test(i.repository) && /^[a-z0-9-]+$/.test(i.export) && Number.isInteger(i.version) && i.version >= 1;
if (!ok) { console.error(`the import into ${into} is not one this script can take`); process.exit(1); }
process.stdout.write(`${i.repository} ${i.export} ${i.version}\n`);' "$1"
}

imports_all() { # this repository's INTERFACE.json on stdin -> every import's folder, one per line
  node -e '
const m = JSON.parse(require("fs").readFileSync(0, "utf8"));
for (const i of m.imports || []) process.stdout.write(i.into + "\n");'
}

export_paths() { # ID WANT, the provider's INTERFACE.json on stdin -> the export's paths, one per line; fails, naming what is offered, unless it offers ID at WANT
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
process.stdout.write(e.paths.join("\n") + "\n");' "$1" "$2"
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

placed() { # BASE PATH -> where PATH lands in the folder; fails when it is not below BASE, climbs out, or would land on ORIGIN
  local rel="${2#"$1"}"
  [ "$rel" != "$2" ] || [ -z "$1" ] || return 1
  case "/$rel/" in *//*|*/../*|*/./*) return 1;; esac
  [ "$rel" != ORIGIN ] || return 1
  printf '%s' "$rel"
}

own_file() { # DIR REL -> 0 when REL is the folder's own README.md or pull.sh: present, and not a file its ORIGIN records
  case "$2" in README.md|pull.sh) ;; *) return 1;; esac
  [ -e "$1/$2" ] || return 1
  ! recorded "$1/ORIGIN" "$2"
}

recorded() { # ORIGIN REL -> 0 when ORIGIN has a sha256 line for REL
  [ -f "$1" ] && grep -qxE "sha256 [0-9a-f]{64} $(printf '%s' "$2" | sed -e 's/[.[\^$*+?(){}|]/\\&/g')" "$1"
}

origin_commit() { # ORIGIN on stdin -> the commit it names
  local l
  while IFS= read -r l; do
    if [[ "$l" =~ ^commit\ ([0-9a-f]{40})$ ]]; then printf '%s' "${BASH_REMATCH[1]}"; return 0; fi
  done
  return 1
}

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

GH_SHA="" GH_SHA_FOR=""
pull_one() { # INTO REF PINNED
  local into="$1" ref="$2" pinned="$3" spec repo exp want dir sha default manifest patterns tree base line mode p rel
  spec=$(import_of "$into" < "$ROOT/interface/INTERFACE.json") || exit 2
  read -r repo exp want <<< "$spec"
  dir="$ROOT/$into"
  if [ "$pinned" = 1 ]; then
    ref=$(origin_commit < "$dir/ORIGIN" 2>/dev/null) || { echo "FAILED: $into/ORIGIN names no commit to take again" >&2; exit 1; }
  fi
  # one commit for every folder of the same repository and ref in this run
  if [ "$GH_SHA_FOR" = "$repo@$ref" ]; then sha="$GH_SHA"; else
    sha=$(gh api "repos/$repo/commits/$ref" --jq .sha) || { echo "FAILED: could not ask $repo for $ref (is gh signed in?)" >&2; exit 1; }
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "FAILED: no commit for $ref" >&2; exit 1; }
    default=$(gh api "repos/$repo" --jq .default_branch)
    case "$(gh api "repos/$repo/compare/$default...$sha" --jq .status)" in
      identical|behind) ;;
      *) echo "FAILED: $sha is not on $repo's $default; take only what was merged there" >&2; exit 1 ;;
    esac
    GH_SHA="$sha" GH_SHA_FOR="$repo@$ref"
  fi
  fetch() { gh api -H "Accept: application/vnd.github.raw" "repos/$repo/contents/$1?ref=$sha"; }

  # the export's paths, as the provider's manifest at that commit lists them
  manifest=$(fetch interface/INTERFACE.json 2>/dev/null) || { echo "FAILED: $repo has no interface/INTERFACE.json at $sha" >&2; exit 1; }
  patterns=$(printf '%s' "$manifest" | export_paths "$exp" "$want") || { echo "FAILED: $repo at $sha does not offer $exp version $want" >&2; exit 1; }
  local -a pats=() paths=() rels=() modes=()
  while IFS= read -r p; do [ -n "$p" ] && pats+=("$p"); done <<< "$patterns"
  base=$(shared_base "${pats[@]}")
  # each file with its mode in the tree, so a program's executable bit comes with it
  tree=$(gh api "repos/$repo/git/trees/$sha?recursive=1" \
    --jq 'if .truncated then error("the listing of the tree is truncated") else (.tree[] | select(.type == "blob") | "\(.mode) \(.path)") end') \
    || { echo "FAILED: could not list $repo at $sha" >&2; exit 1; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    mode="${line%% *}" p="${line#* }"
    covered "$p" "${pats[@]}" || continue
    case "$mode" in 100644|100755) ;; *) echo "FAILED: $p is not a plain file in $repo (mode $mode); no copy takes it" >&2; exit 1;; esac
    rel=$(placed "$base" "$p") || { echo "FAILED: $p has no place in $into/ (the export's folder is $base)" >&2; exit 1; }
    if own_file "$dir" "$rel"; then echo "FAILED: $p would replace $into/$rel, which is this folder's own" >&2; exit 1; fi
    paths+=("$p"); rels+=("$rel"); modes+=("$mode")
  done <<< "$tree"
  [ "${#paths[@]}" -gt 0 ] || { echo "FAILED: no file in $repo's export $exp at $sha" >&2; exit 1; }

  # every file first, beside its place; nothing is placed until all of them are here and read right
  local -a parts=() lines=()
  local i dest
  drop_parts() { local f; for f in "${parts[@]}"; do rm -f "$f"; done; }
  for i in "${!paths[@]}"; do
    p="${paths[i]}" rel="${rels[i]}" dest="$dir/${rels[i]}"
    mkdir -p "$(dirname "$dest")"
    parts+=("$dest.part")
    # raw bytes, not the JSON envelope (past 1 MB the contents API answers with an empty "content")
    fetch "$p" >"$dest.part" || { drop_parts; echo "FAILED: could not read $p at $sha" >&2; exit 1; }
    case "$rel" in
      *.json) node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$dest.part" 2>/dev/null \
                || { drop_parts; echo "FAILED: $p at $sha is not JSON" >&2; exit 1; };;
    esac
    if [ "${modes[i]}" = 100755 ]; then chmod 755 "$dest.part"; else chmod 644 "$dest.part"; fi
    lines+=("sha256 $(sha256_of "$dest.part") $rel")
  done
  local origin
  origin=$(printf 'repository %s\ncommit %s\nexport %s %s\n' "$repo" "$sha" "$exp" "$want"; printf '%s\n' "${lines[@]}" | LC_ALL=C sort -k3)
  if [ "$pinned" = 1 ] && [ "$origin" != "$(cat "$dir/ORIGIN")" ]; then
    drop_parts
    echo "FAILED: what $repo holds at $sha for $exp $want is not what $into/ORIGIN records; ORIGIN was not written by this script, or the import changed" >&2
    exit 1
  fi
  for i in "${!paths[@]}"; do mv -f "$dir/${rels[i]}.part" "$dir/${rels[i]}"; done
  printf '%s\n' "$origin" >"$dir/ORIGIN.part"
  mv -f "$dir/ORIGIN.part" "$dir/ORIGIN"
  echo "$into: ${#paths[@]} file(s) of $repo's export $exp $want at $sha"
  local f r known stale=0
  while IFS= read -r f; do
    rel="${f#"$dir"/}" known=0
    [ "$rel" = ORIGIN ] && continue
    own_file "$dir" "$rel" && continue
    for r in "${rels[@]}"; do [ "$r" = "$rel" ] && known=1; done
    [ $known = 1 ] && continue
    echo "not in $repo's export any more: $into/$rel (remove it in a reviewed commit)"
    stale=1
  done < <(find "$dir" -type f | LC_ALL=C sort)
  [ "$stale" = 0 ] || echo "until then test/boundary.test.ts fails: the folder holds a file ORIGIN does not list"
}

main() {
  set -euo pipefail
  local ref=main refset=0 pinned=0 all=0 f
  local -a folders=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) [ $# -ge 2 ] && [ -n "$2" ] || { echo "--ref needs a branch, tag or commit" >&2; exit 2; }; ref="$2" refset=1; shift 2 ;;
      --pinned) pinned=1; shift ;;
      --all) all=1; shift ;;
      -*) echo "usage: bash interface/pull.sh [--ref REF | --pinned] FOLDER... | --all" >&2; exit 2 ;;
      *) [[ "$1" =~ ^[a-z0-9._-]+(/[a-z0-9._-]+)*$ ]] || { echo "\"$1\" is not an import's folder" >&2; exit 2; }; folders+=("${1%/}"); shift ;;
    esac
  done
  [ "$refset" = 0 ] || [ "$pinned" = 0 ] || { echo "--ref and --pinned do not go together" >&2; exit 2; }
  if [ "$all" = 1 ]; then
    [ "${#folders[@]}" = 0 ] || { echo "--all takes no folder" >&2; exit 2; }
    while IFS= read -r f; do [ -n "$f" ] && folders+=("$f"); done < <(imports_all < "$ROOT/interface/INTERFACE.json")
  fi
  [ "${#folders[@]}" -gt 0 ] || { echo "usage: bash interface/pull.sh [--ref REF | --pinned] FOLDER... | --all" >&2; exit 2; }
  command -v node >/dev/null || { echo "FAILED: node is needed to read the manifests" >&2; exit 1; }
  # every folder named is an import before anything is asked of GitHub
  for f in "${folders[@]}"; do import_of "$f" < "$ROOT/interface/INTERFACE.json" >/dev/null || exit 2; done
  command -v gh >/dev/null || { echo "FAILED: gh is not installed" >&2; exit 1; }
  for f in "${folders[@]}"; do pull_one "$f" "$ref" "$pinned"; done
}

# sourced (test/boundary.test.ts reads the pure parts above), nothing runs
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
