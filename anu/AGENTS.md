# ANU agent guide

Read this before changing anything in `anu/`. It says what ANU is, what exists, what does not, and how to continue. Last updated 2026-10-30 (Phases 3 to 5, harness runs tools).

## What ANU is

ANU is a personal AI agent platform. A user describes a goal in plain language. An agent plans the steps, runs them with approved tools inside an isolated environment, and shows each step so the user can review it before anything is adopted.

The architecture has four parts: a phone app, an API that checks identity and permissions, a sandbox per task, and a harness inside the sandbox that runs the agent. The harness is the assistant runtime in `../assistant/`.

## Where things are

| Path | What it holds |
| --- | --- |
| `docs/PLAN.md` | Phases 0 to 7, with status of each |
| `docs/decisions/` | Recorded decisions and their reasons |
| `docs/api.md`, `openapi.yaml` | Public API for client developers |
| `docs/environment.md` | Settings to enter in the Claude Code cloud environment UI |
| `src/config.ts` | Configuration for the API and sandbox, validated with Zod |
| `src/auth/` | One-time codes, `OtpSender`, sessions, rate limits |
| `src/api/` | API server (`server.ts`), routes (`app.ts`), task service, sandbox client |
| `src/sandbox/` | Sandbox server, run manager, per-task worker, drivers in `drivers/` |
| `src/db/` | Connection and RLS scopes (`client.ts`), migration runner, seed data |
| `db/migrations/` | SQL migrations, applied in file-name order |
| `scripts/` | `db-setup.sh`, `db-migrate.ts`, `seed.ts`, `dev.ts`, `check-env.sh`, `cloud-setup.sh` |
| `.env.example` | Variable names only. `bun run db:setup` writes a real `.env`, which is gitignored |

## Current state

Done:
- Decisions 0001 to 0004 accepted. Kilo confirmed live: `https://ai-gateway.kilo.ai/api/v1`, key `anonymous` for free models.
- PostgreSQL schema with row-level security, reproducible setup (`bun run db:setup`), idempotent seed.
- API server (port 8787): phone login per ADR 0003, tasks, steps, SSE, stop, approvals, export, delete, internal endpoints for the sandbox.
- Sandbox server (port 8788): per-task workspace and worker process, sanitized environment, timeout, stop. Drivers `scripted`, `kilo`, and `harness`.
- The `harness` driver boots `../assistant` in local-hatch topology (credential executor, daemon, gateway), authenticates as the guardian, runs assistant tools, routes the runtime's consent prompts to ANU approvals, and reports each tool call as steps (live tests pass).
- Mobile thin-client audit and simulated phone run (`bun run mobile:e2e`, `scripts/mobile-e2e.ts`). Every data request goes only to the ANU API. It covers login, wrong and expired codes, isolation, logout, approve, and stop. See `docs/mobile-thin-client.md`.
- Tests: `bun test src` runs config, login, sessions, tasks, isolation, sandbox, and a two-process end-to-end test against a real test database.

Not done. Do not assume any of these exist:
- No SMS provider. Only the `dev` sender, which returns the code in the response.
- Phone apps are thin clients only in simulation. `ANU_SERVER_URL` at `cap sync` opens the Capacitor shells at `/anu`, and `bun run mobile:e2e` passes 44 of 44 checks under iOS and Android user agents with a stubbed native bridge. A debug APK builds on Linux. Nothing has run on a real device or the iOS simulator. Native platform sign-in (WorkOS and vellum.ai) is still compiled in. See `docs/mobile-thin-client.md`.
- No network isolation for sandbox runs, and no container or VM per task. Isolation is a directory, a process group, and an allowlisted environment.
- The `harness` driver is dev and test only (no network isolation; the gateway listens on all interfaces like a local hatch). It boots three processes per task (about 10 to 15 seconds to ready) and downloads Qdrant and the embedding runtime into each task workspace in the background (about 375 MB per task). The runtime's `question_request` cards are closed unanswered (recorded as a step) and `secret_request` prompts are declined, because ANU approvals are yes or no only.
- No cloud infrastructure or deployment. No pilot.

## How the pieces talk

1. The client calls the API with a session token.
2. `POST /v1/tasks` stores the task and calls the sandbox `POST /v1/runs` with `ANU_INTERNAL_TOKEN`.
3. The sandbox starts `src/sandbox/worker.ts` with `setsid`, a sanitized environment, and the workspace as its directory. The worker runs the driver and writes `@@anu {json}` lines on stdout.
4. The sandbox relays those lines to the API's `/internal/v1/tasks/:id/...` endpoints, in order.
5. Clients watch `GET /v1/tasks/:id/events`. Approval decisions and stops are pushed from the API to the sandbox, which also polls approvals as a fallback.

To add a driver, implement `Driver` in `src/sandbox/drivers/types.ts`, register it in `drivers/index.ts`, and add its name to `DRIVERS` in `src/config.ts`. A driver gets settings on stdin through `DriverSettings`, never through the environment.

## Database rules

- Every query goes through `Db.asUser(userId, ...)` or `Db.asSystem(...)` in `src/db/client.ts`. Both switch to the application role (`ANU_DB_APP_ROLE`) so row-level security applies. Do not query `db.sql` directly in application code.
- User-scoped queries still filter by owner explicitly. RLS is the second line.
- Add schema changes as a new file in `db/migrations/`. Never edit an applied migration.
- Tests use `ANU_TEST_DATABASE_URL` (default `anu_platform_test` over the local socket) and phone numbers from `555-0100` to `555-0199`, with a different area code per test file.

## Decisions to respect

- **0001 Location:** ANU lives in `anu/` inside `vellum-assistant`, because creating a separate repository was refused with 403.
- **0002 Environment:** development and tests run in the current cloud environment. It is ephemeral and single-tenant, so it holds test data only.
- **0003 Login:** phone number plus one-time code. Codes are stored as keyed hashes, expire in 5 minutes, allow 5 attempts. The `dev` sender is refused unless `ANU_ENV` is `dev` or `test`. Use only example numbers from `555-0100` to `555-0199`.
- **0004 Test model:** Kilo Gateway at `https://ai-gateway.kilo.ai/api/v1`, OpenAI Chat Completions, `Bearer anonymous` for free models. In the harness it is an `openai-compatible` connection created over the runtime's HTTP API.

## Commands

Run from `anu/`:

```bash
bash scripts/cloud-setup.sh     # install dependencies from bun.lock
bun run db:setup                # databases, .env, migrations
bun run seed                    # fake data
bun run dev                     # API :8787 and sandbox :8788
bash scripts/check-env.sh       # readiness check
bun test src                    # tests, scoped to src
bun run typecheck               # strict TypeScript
```

Always pass a path to `bun test`. The parent repository's test suite is too large to run unscoped.

## Harness facts

Verified by running the `harness` driver on 2026-10-29 and 2026-10-30:

- Sending a message does not return the reply. The send endpoint returns acceptance. The reply arrives on the event stream until a `message_complete` event.
- Ways to send: CLI `vellum message`, or HTTP `POST /v1/messages`, which returns 202.
- Ways to read the stream: CLI `vellum events --json`, or SSE `GET /v1/events`.
- The daemon boots from `assistant/src/daemon/main.ts` and answers `/readyz` without the gateway or CES, but it is not usable alone. Without the gateway, a `DISABLE_HTTP_AUTH=true` caller has no guardian binding, so its trust class is `unknown` and every side-effect tool is denied ("requires guardian approval from a verified channel identity"); the risk classifier also lives in the gateway. Without CES, every credential read during provider setup waits about 3 seconds on a CES reconnect, which can stall boot for minutes.
- The driver therefore starts what a local hatch starts: `credential-executor/src/main.ts`, the daemon, and `gateway/src/index.ts --vellum-gateway`, each in its own process group, with one instance directory (`harness/.vellum/{workspace,protected}`), `CES_BOOTSTRAP_SOCKET_DIR`, a shared `ACTOR_TOKEN_SIGNING_KEY`, and per-task `RUNTIME_HTTP_PORT`, `GATEWAY_PORT`, and `QDRANT_HTTP_PORT` (the Qdrant default 6333 would collide between tasks).
- The gateway's `/readyz` turns 200 only after the daemon reports its migrations done. Then `POST /v1/guardian/init` with header `x-bootstrap-secret` (the `GUARDIAN_BOOTSTRAP_SECRET` given to the gateway, one per task) returns a guardian `accessToken`. Every later call goes to the gateway with `Authorization: Bearer <token>`. `DISABLE_HTTP_AUTH` is not used.
- The runtime asks for consent with a `confirmation_request` event (`requestId`, `toolName`, `input`, `riskLevel`, `riskReason`). The driver turns it into an ANU approval and answers with `POST /v1/confirm {requestId, decision: "allow" | "deny"}`. Which calls prompt is the runtime's own risk policy (for example a piped `cat | awk` prompted, a plain `rm -rf` inside the workspace did not); ANU adds no approval mode of its own.
- `tool_use_start` carries `startedAt` and `tool_result` carries `completedAt`, so the driver reports durations. Assistant text before a tool call becomes a `message` step.
- Weaker free models sometimes reply with only an announcement ("on it.") and stop without a tool call. The driver sends the goal as a task request (`taskMessage` in `drivers/harness-turn.ts`): the goal, then one sentence asking the assistant to do the work in this turn, narrate briefly, and end with the result. The driver never sends follow-ups of its own; whether a reply is finished is the model's call.
- Models often assume the workspace is `/workspace`. File tools remap that prefix; `bash` does not. The runtime's per-turn `<workspace>` block already gave the real root, so it now labels it: `Root: <path> (working directory of bash and file tools)` (`assistant/src/workspace/top-level-renderer.ts`). In the 2026-10-30 bench, `/workspace` references in tool calls went from 3 (2 failed `bash` calls) in 13 runs to 1 (no failure) in 11.
- When the user rejects an approval, the runtime's tool result says so: "the user declined this call. Do not attempt the same action again, with this tool, another tool, or a reworded command" (`assistant/src/tools/permission-checker.ts`). A prompt that timed out or was superseded keeps the older "ask whether to try again" text, because nobody declined it.
- Provider selection is profile-based: `llm.profiles` entry, then a provider connection. A generic `openai-compatible` provider takes a base URL per connection.
- Connections live in the runtime's SQLite database, not `config.json`, so the driver creates them over HTTP after `GET /readyz` returns 200: `POST /v1/secrets`, `POST /v1/inference/provider-connections`, `POST /v1/inference/profiles`, `POST /v1/config/set`.
- `POST /v1/messages` needs `conversationKey`, `content`, `sourceChannel` (`vellum` today), and `interface` (`cli` has no host computer access). Subscribe to `GET /v1/events?conversationKey=...` before sending.
- The runtime spawns helpers (memory worker, embedding worker, Qdrant) that outlive a plain kill. The driver starts each service in its own process group and kills the groups.
- Env var names still use `VELLUM_*` while the rename is in progress. The driver sets both `VELLUM_WORKSPACE_DIR` and `ANU_WORKSPACE_DIR`.

## Rules when working here

- Never commit secrets, `.env` files, or real personal data. Use placeholder values in examples.
- Do not add a Kilo provider to `assistant/`. Configure it through the existing `openai-compatible` path.
- Do not modify `../assistant/` from here without reading `../assistant/AGENTS.md` first. Its rule "Permission controls v2" forbids new deterministic approval modes for assistant-owned actions. Approval for risky steps must go through the conversation.
- Inside `../assistant/`, do not call a model provider directly. Assistant calls must go through `getConfiguredProvider(callSite)`. The `kilo` driver in `src/sandbox/drivers/` is ANU's own stand-in and calls the gateway directly by design.
- Never pass `ANU_INTERNAL_TOKEN`, `ANU_OTP_SECRET`, `DATABASE_URL`, or any other secret into a sandboxed process. `sanitizeEnv` refuses secret-looking names, and a test checks the real worker's environment.
- Logs never contain a full phone number. Use `maskPhone`. The logger also masks anything phone-shaped.
- Use exact versions in `dependencies` and `devDependencies`. No `^` or `~`.
- Do not use em dashes in code, docs, or commit messages.
- Keep this file current. When a decision or state changes, update the relevant section here in the same change.
