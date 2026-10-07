#!/bin/bash
# profiles/ is one of this repository's imports, and interface/pull.sh takes every import the same way;
# this name stays so the command written down for the profiles keeps working:
#
#   bash profiles/pull.sh [--ref REF | --pinned]    the same as: bash interface/pull.sh [...] profiles
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../interface/pull.sh" "$@" profiles
