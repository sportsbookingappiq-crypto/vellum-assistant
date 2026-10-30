#!/usr/bin/env bash
# Reports whether this environment is ready to run ANU. Prints variable names
# and states only. Secret values are never printed.
set -uo pipefail

ANU_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$ANU_DIR/.." && pwd)"
PINNED_BUN="$(awk '$1 == "bun" { print $2 }' "$REPO_DIR/.tool-versions")"
export PATH="$HOME/.bun/bin:$PATH"

# Variables already set in the shell win over anu/.env (the same rule Bun uses).
if [ -f "$ANU_DIR/.env" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    name="${line%%=*}"
    [ -n "${!name:-}" ] || export "$line"
  done < "$ANU_DIR/.env"
fi

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

case "${OTP_SENDER:-}" in
  dev)
    case "${ANU_ENV:-}" in
      dev|test) report ok "OTP_SENDER=dev" ;;
      *) report fail "OTP_SENDER=dev is refused unless ANU_ENV is dev or test"; status=1 ;;
    esac ;;
  "") report fail "OTP_SENDER is not set"; status=1 ;;
  *) report fail "OTP_SENDER=$OTP_SENDER is not a known sender"; status=1 ;;
esac

for name in ANU_OTP_SECRET ANU_INTERNAL_TOKEN; do
  value="${!name:-}"
  if [ "${#value}" -ge 32 ]; then
    report ok "$name is set (value not shown)"
  elif [ -n "$value" ]; then
    report fail "$name is shorter than 32 characters"; status=1
  else
    report fail "$name is not set (bun run db:setup generates one in anu/.env)"; status=1
  fi
done

if [ -z "${DATABASE_URL:-}" ]; then
  report fail "DATABASE_URL is not set (run bun run db:setup)"
  status=1
elif (cd "$ANU_DIR" && bun -e '
  import { connect } from "./src/db/client.ts";
  const sql = connect(process.env.DATABASE_URL, { max: 1 });
  try { await sql`select 1 from schema_migrations limit 1`; } finally { await sql.end(); }
' >/dev/null 2>&1); then
  report ok "database reachable and migrated"
else
  report fail "database unreachable or not migrated (run bun run db:setup)"
  status=1
fi

if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
  report info "redis reachable (not used by ANU yet)"
fi

report info "ANU_SANDBOX_DRIVER=${ANU_SANDBOX_DRIVER:-scripted}"

KILO_URL="${KILO_BASE_URL:-https://ai-gateway.kilo.ai/api/v1}"
if [ "${KILO_API_KEY:-}" = "anonymous" ]; then
  report ok "KILO_API_KEY=anonymous (free models only)"
elif [ -n "${KILO_API_KEY:-}" ]; then
  report ok "KILO_API_KEY is set (value not shown)"
else
  report warn "KILO_API_KEY is not set; the kilo and harness drivers default to the literal key anonymous"
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
  -H "Authorization: Bearer ${KILO_API_KEY:-anonymous}" "$KILO_URL/models" 2>/dev/null)"
code="${code:-000}"
case "$code" in
  200|401) report ok "Kilo gateway reachable at $KILO_URL (HTTP $code)" ;;
  403|407) report warn "Kilo gateway blocked by network policy (HTTP $code); live tests will fail" ;;
  *) report warn "Kilo gateway unreachable (HTTP $code); live tests will fail" ;;
esac

exit "$status"
