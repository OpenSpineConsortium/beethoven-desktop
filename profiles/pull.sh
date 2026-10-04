#!/bin/bash
# Refresh the vendored site profiles from their canonical home, the server repository.
# Data only, over the person's own gh sign-in; run from anywhere (it works in its own folder).
set -uo pipefail
REPO=${1:-OpenSpineConsortium/hpcworker}
cd "$(dirname "$0")" || exit 1
GH() { env -u GITHUB_TOKEN -u GH_TOKEN gh "$@"; }
# the listing's failure must be this script's failure: inside $(...) a dead gh would otherwise
# leave an empty loop and a clean exit, having pulled nothing
names=$(GH api "repos/$REPO/contents/framework/profiles" --jq '.[].name') || { echo "FAILED: could not list $REPO/framework/profiles (is gh signed in?)" >&2; exit 1; }
n=0
for f in $(printf '%s\n' "$names" | grep '\.json$'); do
  # raw bytes, not the JSON envelope: past 1 MB the contents API answers with an empty "content"
  # and base64 -d would install an empty file over a good profile
  GH api -H "Accept: application/vnd.github.raw+json" "repos/$REPO/contents/framework/profiles/$f" > "$f.part" \
    || { rm -f "$f.part"; echo "FAILED $f" >&2; exit 1; }
  python3 -m json.tool "$f.part" > /dev/null 2>&1 || { rm -f "$f.part"; echo "FAILED $f: not JSON" >&2; exit 1; }
  mv -f "$f.part" "$f" && echo "pulled $f"; n=$((n + 1))
done
[ "$n" -gt 0 ] || { echo "FAILED: $REPO/framework/profiles lists no profiles" >&2; exit 1; }
