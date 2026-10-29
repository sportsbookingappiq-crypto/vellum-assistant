# 0002: Cloud environment

Status: accepted

## Context

The first plan proposed provisioning Google Cloud with Terraform. The user chose the current cloud environment instead: the Claude Code cloud environment this work runs in. Its settings sit in the environment menu: the setup script, environment variables, and network access. The `gcp.ts` and `aws.ts` modules in the CLI only retire instances. They do not create them.

## Decision

Development and tests run in the current cloud environment. Its configuration lives in the environment settings and is documented in [`../environment.md`](../environment.md). The only repository-side parts are the scripts in `anu/scripts/`.

## Consequences

- The environment is one ephemeral container, reclaimed after inactivity. It holds test data only.
- The setup script cannot read saved environment secrets. Secrets reach processes as environment variables or network credentials, which the environment settings control.
- A host blocked by network policy must be allowed in the environment's network settings. Scripts cannot change that setting.
- Production hosting is a separate decision. Revisit it when real user data or a multi-tenant requirement appears.
