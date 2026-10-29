#!/usr/bin/env bash
# Setup for the ANU cloud environment. Safe to re-run.
# Installs the Bun version pinned in the repository root .tool-versions, then
# the anu/ dependencies from anu/bun.lock.
set -euo pipefail

ANU_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ANU_DIR/.." && pwd)"
BUN_VERSION="$(awk '$1 == "bun" { print $2 }' "$REPO_DIR/.tool-versions")"

if [ -z "$BUN_VERSION" ]; then
  echo "cloud-setup: no bun version found in $REPO_DIR/.tool-versions" >&2
  exit 1
fi

export PATH="$HOME/.bun/bin:$PATH"

if [ "$(bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
  echo "cloud-setup: installing Bun $BUN_VERSION"
  if ! curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"; then
    echo "cloud-setup: could not install Bun $BUN_VERSION from bun.sh" >&2
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "cloud-setup: bun is not installed" >&2
  exit 1
fi

FOUND_VERSION="$(bun --version)"
if [ "$FOUND_VERSION" != "$BUN_VERSION" ]; then
  echo "cloud-setup: warning: pinned Bun is $BUN_VERSION, running $FOUND_VERSION" >&2
fi

cd "$ANU_DIR"
bun install --frozen-lockfile
echo "cloud-setup: done"
