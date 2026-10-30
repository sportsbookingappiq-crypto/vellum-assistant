# Cloud environment settings

These settings live in the Claude Code cloud environment: the environment menu in the session's title bar, then Edit. The repository cannot change them. See [ADR 0002](decisions/0002-current-cloud-environment.md).

## 1. Setup script

Paste this into the Setup script field:

```bash
cd vellum-assistant && bash anu/scripts/cloud-setup.sh
```

The script installs the dependencies in `anu/bun.lock`. It tries to install the Bun version named in the repository's `.tool-versions`. If bun.sh is blocked, it prints a warning and continues with the Bun already installed.

## 2. Environment variables

| Name | Value | Notes |
| --- | --- | --- |
| `ANU_ENV` | `test` | One of `dev`, `test`, `staging`, `production`. |
| `OTP_SENDER` | `dev` | The only sender today. Refused outside `dev` and `test` ([ADR 0003](decisions/0003-phone-number-login.md)). |
| `KILO_BASE_URL` | `https://ai-gateway.kilo.ai/api/v1` | Confirmed live ([ADR 0004](decisions/0004-kilo-gateway-test-provider.md)). This is also the default. |
| `KILO_API_KEY` | `anonymous` | The literal `anonymous` works for free models. A real key is a secret: add it as a secret, never commit it. |
| `KILO_MODEL` | `kilo-auto/free` | Optional. |
| `DATABASE_URL`, `ANU_OTP_SECRET`, `ANU_INTERNAL_TOKEN` | generated | `bun run db:setup` writes them to `anu/.env`, which is gitignored. |

## 3. Network access

- Keep "Allow package managers" ticked so `bun install` can reach the npm registry.
- The Kilo Gateway host `ai-gateway.kilo.ai` must be reachable. It was on 2026-10-29. If a later policy blocks it, add it under Allowed domains.
- bun.sh is blocked by the current network policy. To install the pinned Bun, add `bun.sh` under Allowed domains.

## 4. Verify

After a new session starts, run:

```bash
bash anu/scripts/check-env.sh
```

It prints names and states only, never values. It exits non-zero when a required setting is missing or the database is unreachable. An unreachable Kilo gateway is a warning, because only the live tests need it.

The setup script cannot read saved variables or secrets. Those reach the session through the settings, not through the script.
