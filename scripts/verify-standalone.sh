#!/usr/bin/env bash
#
# The open-core boundary check, run locally. CI does the same thing by checking
# out without factory-pro/ (see .github/workflows/ci.yml); this is the version
# you can run on a working tree.
#
# Community must install, typecheck, lint and test with factory-pro/ absent. If
# this fails, the boundary is broken -- widen @factory/plugin-sdk rather than
# relaxing the check.
#
# The directory is moved aside and restored by an EXIT trap, so an interrupt or
# a failing build still puts it back.
set -euo pipefail

COMMUNITY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(dirname "$COMMUNITY")"
PRO="$ROOT/factory-pro"
STASH="$(mktemp -d)/factory-pro"

restore() {
  if [ -d "$STASH" ]; then
    mv "$STASH" "$PRO"
    echo "→ factory-pro/ restored"
  fi
}

if [ -d "$PRO" ]; then
  trap restore EXIT
  mv "$PRO" "$STASH"
  echo "→ factory-pro/ moved aside"
else
  echo "→ factory-pro/ not present; checking as-is"
fi

cd "$COMMUNITY"
echo "→ typecheck"; pnpm exec tsc --build --force
echo "→ lint";      pnpm exec eslint . --max-warnings 0
echo "→ test";      pnpm exec vitest run
echo
echo "✓ Community builds, lints and tests standalone."
