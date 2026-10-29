#!/usr/bin/env bash
# Reports whether this environment is ready to run ANU. Prints variable names
# and states only. Secret values are never printed.
set -uo pipefail

ANU_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ANU_DIR/.." && pwd)"
PINNED_BUN="$(awk '$1 == "bun" { print $2 }' "$REPO_DIR/.tool-versions")"
export PATH="$HOME/.bun/bin:$PATH"

status=0
report() { printf '%-5s %s\n' "$1" "$2"; }

if command -v bun >/dev/null 2>&1; then
  BUN_NOW="$(bun --version)"
  if [ "$BUN_NOW" = "$PINNED_BUN" ]; then
    report ok "bun $BUN_NOW"
  else
    report warn "bun $BUN_NOW (repo pins $PINNED_BUN)"
  fi
else
  report fail "bun is not installed"
  status=1
fi

case "${ANU_ENV:-}" in
  dev|test|staging|production) report ok "ANU_ENV=$ANU_ENV" ;;
  "") report fail "ANU_ENV is not set (dev, test, staging, or production)"; status=1 ;;
  *) report fail "ANU_ENV=$ANU_ENV is not a known environment"; status=1 ;;
esac

if [ -n "${KILO_API_KEY:-}" ]; then
  report ok "KILO_API_KEY is set (value not shown)"
else
  report warn "KILO_API_KEY is not set, so live model calls are skipped"
fi

if [ -z "${KILO_BASE_URL:-}" ]; then
  report fail "KILO_BASE_URL is not set"
  status=1
else
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$KILO_BASE_URL/models" 2>/dev/null)"
  code="${code:-000}"
  case "$code" in
    200|401) report ok "Kilo gateway reachable (HTTP $code)" ;;
    403|407) report fail "Kilo gateway blocked by network policy (HTTP $code)"; status=1 ;;
    *) report fail "Kilo gateway unreachable (HTTP $code)"; status=1 ;;
  esac
fi

exit "$status"
