# ANU

ANU is a personal AI agent platform. A user describes a goal, an agent plans the steps and runs them with approved tools inside an isolated environment, and the user reviews each step before anything is adopted.

This folder holds the platform backend: an API with phone login, a sandbox server that runs tasks through pluggable drivers, the database schema, and the plan and decisions. It runs in the development container only. It is not deployed anywhere.

- Plan and phases: [`docs/PLAN.md`](docs/PLAN.md)
- Decisions: [`docs/decisions/`](docs/decisions/)
- API for client developers: [`docs/api.md`](docs/api.md) and [`openapi.yaml`](openapi.yaml)
- Cloud environment settings: [`docs/environment.md`](docs/environment.md)

## Quick start

Run from this folder (`anu/`). Needs Bun and PostgreSQL 15 (`psql`, and `initdb`/`pg_ctl` for the fallback).

```bash
bash scripts/cloud-setup.sh     # install dependencies from bun.lock
bun run db:setup                # databases, anu/.env with generated secrets, migrations
bun run seed                    # fake users and tasks (idempotent)
bun run dev                     # API on 127.0.0.1:8787 and sandbox on 127.0.0.1:8788
```

`db:setup` uses the system PostgreSQL over its local socket when the current OS user may create databases and roles. Otherwise it starts a private cluster in `.data/pg` on port 55432, socket only. It creates `anu_platform` and `anu_platform_test`, and writes `anu/.env` only if the file does not exist yet. Bun loads `.env` automatically. `.env` and `.data/` are gitignored.

Sign in as the seeded user:

```bash
curl -s -X POST localhost:8787/v1/auth/code/request -H 'content-type: application/json' \
  -d '{"phone":"+12025550100"}'
# {"expiresAt":"...","devCode":"123456"}   devCode appears only when ANU_ENV is dev or test
curl -s -X POST localhost:8787/v1/auth/code/verify -H 'content-type: application/json' \
  -d '{"phone":"+12025550100","code":"123456"}'
# {"token":"anu_s_...","tokenType":"Bearer",...}
curl -s localhost:8787/v1/tasks -H "authorization: Bearer anu_s_..."
```

Seeded users: `+12025550100` (one task in each state), `+12025550101` (one private task), `+12025550102` (no tasks).

## Commands

| Command | What it does |
| --- | --- |
| `bun run db:setup` | Create databases, write `.env` if missing, migrate dev and test databases |
| `bun run db:migrate` | Apply pending migrations to `DATABASE_URL` (`--test` for `ANU_TEST_DATABASE_URL`) |
| `bun run seed` | Load fake data into `DATABASE_URL` (`--reset` restores the seeded tasks to their original states) |
| `bun run api` | API server only |
| `bun run sandbox` | Sandbox server only |
| `bun run dev` | Both servers |
| `bun run test` | `bun test src`, against the test database |
| `bun run typecheck` | TypeScript, strict |
| `bash scripts/check-env.sh` | Readiness: names and states only, never secret values |

Always pass a path to `bun test`. The parent repository's suite is too large to run unscoped.

Opt-in live tests: `ANU_LIVE_KILO=1 bun test src/sandbox/kilo.live.test.ts` and `ANU_LIVE_HARNESS=1 bun test src/sandbox/harness.live.test.ts`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/config.ts` | Configuration for both servers, validated with Zod |
| `src/auth/` | One-time codes, `OtpSender`, sessions, rate limits |
| `src/api/` | API server, task service, SSE, sandbox client |
| `src/sandbox/` | Sandbox server, run manager, worker process, drivers |
| `src/db/` | Connection with row-level security scopes, migrations runner, seed data |
| `db/migrations/` | SQL migrations |
| `scripts/` | Setup, migrate, seed, dev runner, readiness check |

## Sandbox drivers

Set `ANU_SANDBOX_DRIVER` for the sandbox server.

- `scripted` (default): deterministic. Goal markers: `#approval` asks for an approval, `#fail` fails, `#slow` waits (for stop and timeout).
- `kilo`: plans and answers with two calls to the Kilo Gateway. No tools.
- `harness`: boots the assistant runtime from `../assistant` for each task (credential executor, daemon, and gateway, as a local hatch does), signs in as the guardian, and runs the goal against Kilo with the assistant's tools. The runtime's consent prompts become ANU approvals. Dev and test only (no network isolation). Ready after about 10 to 15 seconds.

Each run gets `ANU_SANDBOX_ROOT/<taskId>` as its workspace and a worker process in its own process group. The worker's environment is built from an allowlist (`PATH`, `LANG`, `TZ`, and a few more), with `HOME` and `TMPDIR` inside the workspace. Driver settings such as the Kilo key arrive on stdin, not in the environment. This is process-level isolation in one container, not a security boundary against hostile code.
