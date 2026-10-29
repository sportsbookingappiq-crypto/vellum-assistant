# 0001: Where the ANU code lives

Status: accepted (fallback in use)

## Context

The first plan was a separate private repository, `anu-platform`. Creating it through the GitHub integration failed with `403 Resource not accessible by integration`. The agreed fallback applies: use the same repository.

## Decision

ANU is built in `anu/` inside `sportsbookingappiq-crypto/vellum-assistant`, on branch `claude/wizardly-rubin-byn4qb`.

`anu/` is deliberately not a member of the root Bun workspace. The root `package.json` lists its members explicitly, so `anu/` keeps its own `package.json` and `bun.lock`. `clients/chrome-extension/` already follows this pattern.

## Consequences

- The repository is public (see the root `AGENTS.md`). Secrets, API keys, and private business details must never be committed under `anu/`.
- When GitHub grants repository-creation rights, the folder can move out with `git subtree split --prefix=anu`, which keeps its history.
- The harness that ANU drives comes from this same repository, so its version is pinned in one place.
