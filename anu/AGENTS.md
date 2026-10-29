# ANU agent guide

Read this before changing anything in `anu/`. It says what ANU is, what exists, what does not, and how to continue. Last updated 2026-10-29.

## What ANU is

ANU is a personal AI agent platform. A user describes a goal in plain language. An agent plans the steps, runs them with approved tools inside an isolated environment, and shows each step so the user can review it before anything is adopted.

The architecture has four parts: a phone app, an API that checks identity and permissions, a sandbox per task, and a harness inside the sandbox that runs the agent. The harness is the assistant runtime in `../assistant/`.

## Where things are

| Path | What it holds |
| --- | --- |
| `docs/PLAN.md` | Phases 0 to 7, with status of each |
| `docs/decisions/0001` to `0004` | Recorded decisions and their reasons |
| `docs/environment.md` | Settings to enter in the Claude Code cloud environment UI |
| `scripts/cloud-setup.sh` | Installs `anu/` dependencies. Safe to re-run |
| `scripts/check-env.sh` | Readiness check. Prints variable names and states, never values |
| `src/config.ts` | Loads and validates configuration with Zod |
| `src/config.test.ts` | Tests for `config.ts` |
| `.env.example` | Variable names only. Copy to `.env` locally, never commit `.env` |

## Current state

Done:
- Decisions 0001 to 0004 (0004 is proposed, not accepted).
- Setup script, readiness check, and configuration loader with 7 passing tests.
- Research on the assistant runtime (see "Harness facts" below).

Not done. Do not assume any of these exist:
- No database, no API server, no HTTP routes, no task model.
- No phone app changes. No login flow beyond the configuration guard.
- No cloud infrastructure. The environment is the Claude Code cloud container.
- No live call to any model provider. Kilo has never been reached.
- No harness runner. The assistant has not been started from `anu/`.

## Decisions to respect

- **0001 Location:** ANU lives in `anu/` inside `vellum-assistant`, because creating a separate repository was refused with 403.
- **0002 Environment:** development and tests run in the current cloud environment. It is ephemeral and single-tenant, so it holds test data only.
- **0003 Login:** phone number plus one-time code. Codes are stored as keyed hashes, expire in 5 minutes, allow 5 attempts. The `dev` sender is refused unless `ANU_ENV` is `dev` or `test`. Use only example numbers from `555-0100` to `555-0199`.
- **0004 Test model (proposed):** Kilo as an `openai-compatible` connection. No code change is needed. The key goes into the assistant's credential store, not an environment variable, because the connection path does not read environment variables.

## Commands

Run from `anu/`:

```bash
bash scripts/cloud-setup.sh     # install dependencies from bun.lock
bash scripts/check-env.sh       # readiness check
bun test src                    # tests, scoped to src
bun run typecheck               # strict TypeScript
```

Always pass a path to `bun test`. The parent repository's test suite is too large to run unscoped.

## Environment facts (as of 2026-10-29)

- Bun pinned in `../.tool-versions` is 1.3.11. This sandbox has 1.4.4 because `bun.sh` is blocked by network policy. `cloud-setup.sh` warns and continues in that case.
- Both Kilo hosts were refused with 403 on CONNECT: `ai-gateway.kilo.ai` and `api.kilo.ai`. Allowing them is a user action in the environment's network settings.
- The setup script cannot read saved variables or secrets. Secrets reach the session through the environment settings only.
- GitHub push to `sportsbookingappiq-crypto/vellum-assistant` required the Claude GitHub App to be installed on that repo. Do not retry a 403. Report it.

## Open questions

1. **Kilo base URL.** The official docs say `https://ai-gateway.kilo.ai/api/v1`. A copy in the Kilo-Org GitHub repo and a third-party guide say `https://api.kilo.ai/api/gateway`. Verify against a live response before recording either as correct.
2. **Key bootstrap.** Nothing yet moves `KILO_API_KEY` into the assistant's credential store. It needs a session-time script, because the setup script cannot read secrets.
3. **SMS provider.** Not chosen. Until it is, only the `dev` sender exists, and production refuses to start with it.

## Harness facts

From the read-only review of `../assistant/` (not executed):

- Sending a message does not return the reply. The send endpoint returns acceptance. The reply arrives on the event stream until a `message_complete` event.
- Ways to send: CLI `vellum message`, or HTTP `POST /v1/messages`, which returns 202.
- Ways to read the stream: CLI `vellum events --json`, or SSE `GET /v1/events`.
- The runtime boots from `assistant/src/daemon/main.ts`. It needs `VELLUM_WORKSPACE_DIR`, `RUNTIME_HTTP_PORT` (default 7821), and `ACTOR_TOKEN_SIGNING_KEY`. It does not need the gateway or CES.
- `DISABLE_HTTP_AUTH=true` exists for development only.
- Provider selection is profile-based: `llm.profiles` entry, then a provider connection. A generic `openai-compatible` provider takes a base URL per connection.

## Rules when working here

- Do not push to `main` or open a pull request unless the user asks explicitly.
- Never commit secrets, `.env` files, or real personal data. Use placeholder values in examples.
- Do not add a Kilo provider to `assistant/`. Configure it through the existing `openai-compatible` path.
- Do not modify `../assistant/` from here without reading `../assistant/AGENTS.md` first. Its rule "Permission controls v2" forbids new deterministic approval modes for assistant-owned actions. Approval for risky steps must go through the conversation.
- Do not call a model provider directly. Assistant calls must go through `getConfiguredProvider(callSite)`.
- Use exact versions in `dependencies` and `devDependencies`. No `^` or `~`.
- Do not use em dashes in code, docs, or commit messages.
- Keep this file current. When a decision or state changes, update the relevant section here in the same change.

## Next steps, in order

1. The user allows the Kilo host in network settings and confirms the base URL.
2. Verify the base URL and protocol with a live request that uses a test key. Record the result in ADR 0004 and mark it accepted.
3. Write a session-time script that moves `KILO_API_KEY` into the credential store, then create the `kilo-gateway` connection and `kilo-test` profile.
4. Run one live test call through the assistant. Only then start Phase 3.
5. Phase 3: database, login flow per ADR 0003, and API endpoints. Plan them in `docs/PLAN.md` before coding.
