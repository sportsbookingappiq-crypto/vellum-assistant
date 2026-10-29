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
| `KILO_BASE_URL` | pending | Set once the Kilo Gateway decision is recorded (ADR 0004, not yet written). |
| `KILO_API_KEY` | secret | Add it as a secret in the settings. Never commit it or paste it into chat. |

## 3. Network access

- Keep "Allow package managers" ticked so `bun install` can reach the npm registry.
- Add the Kilo Gateway host under Allowed domains once it is known (pending ADR 0004).
- bun.sh is blocked by the current network policy. To install the pinned Bun, add `bun.sh` under Allowed domains.

## 4. Verify

After a new session starts, run:

```bash
bash anu/scripts/check-env.sh
```

It prints names and states only, never values. It exits non-zero when a required setting is missing or the Kilo gateway cannot be reached.

The setup script cannot read saved variables or secrets. Those reach the session through the settings, not through the script.
