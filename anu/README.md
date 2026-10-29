# ANU

ANU is a personal AI agent platform. A user describes a goal, an agent plans the steps and runs them with approved tools inside an isolated environment, and the user reviews each step before anything is adopted.

This folder holds the plan, the decisions, and the setup for the first build. It is not yet a deployable service.

- Plan and phases: [`docs/PLAN.md`](docs/PLAN.md)
- Decisions: [`docs/decisions/`](docs/decisions/)
- Cloud environment settings: [`docs/environment.md`](docs/environment.md)

## Commands

Run from this folder (`anu/`):

```bash
bash scripts/cloud-setup.sh     # install dependencies from bun.lock
bash scripts/check-env.sh       # readiness: names and states only, no secret values
bun test src                    # unit tests
bun run typecheck               # TypeScript, strict
```

The folder is not a member of the repository's root Bun workspace. It has its own `package.json` and `bun.lock`, and versions are exact (see `bunfig.toml`).
