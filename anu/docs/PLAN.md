# ANU plan

ANU lets a user describe a goal in plain language. An agent turns it into steps, runs them in an isolated environment with approved tools, and shows each step so the user can review it before anything is adopted.

The concept comes from the ANU architecture notes. Its shape: a phone app, an API that checks identity and permissions, and a sandbox that runs a harness with an agent inside it.

## Decisions

| Topic | Decision | Record |
| --- | --- | --- |
| Code location | `anu/` inside this repository, because creating a separate repository was refused (403) | [0001](decisions/0001-location-in-vellum-assistant.md) |
| Cloud | The current cloud environment. No new cloud provider | [0002](decisions/0002-current-cloud-environment.md) |
| Login | Phone number with a one-time code | [0003](decisions/0003-phone-number-login.md) |
| Test model provider | Kilo Gateway at `https://ai-gateway.kilo.ai/api/v1`, key `anonymous` for free models | [0004](decisions/0004-kilo-gateway-test-provider.md) |

## Phases

### Phase 0: decisions

Done for 0001 to 0004. 0004 was accepted on 2026-10-29 after live checks.

### Phase 1: current cloud environment (done for development)

- `scripts/cloud-setup.sh` installs the `anu/` dependencies. It reads the Bun version from the repository's `.tool-versions`. If bun.sh is unreachable it warns and keeps the Bun already installed.
- `scripts/check-env.sh` reports readiness. It prints variable names and states, never values.
- `docs/environment.md` lists what to enter in the environment settings, and the network hosts to allow.
- `scripts/db-setup.sh` creates the PostgreSQL databases (system cluster, or a private one under `.data/pg`), writes `anu/.env` with generated secrets, and applies migrations.

### Phase 2: Kilo test provider (done)

Confirmed live on 2026-10-29: base URL `https://ai-gateway.kilo.ai/api/v1`, OpenAI Chat Completions, `Authorization: Bearer anonymous` for free models such as `kilo-auto/free`. The `kilo` sandbox driver calls it directly. The `harness` driver configures it inside the assistant runtime as an `openai-compatible` connection over the runtime's HTTP API, which also stores the key in the runtime's credential store (ADR 0004).

### Phase 3: API and phone login (done)

- PostgreSQL schema in `db/migrations/`: users, login codes, sessions, tasks, task steps, approvals, audit log. Row-level security on every table, keyed on the current user. The API switches to the application role in every transaction.
- Login per ADR 0003 in `src/auth/`: keyed hashes, 5-minute expiry, 5 attempts, rate limits per phone and per client address, dev sender only in dev and test.
- API server in `src/api/` (port 8787): task create, list, read, steps, SSE stream, stop, approvals, export, delete. Internal endpoints for the sandbox use a shared token and refuse user sessions.
- `openapi.yaml` and `docs/api.md` for client developers.

### Phase 4: harness runner (done for one task per run, dev and test only)

- Sandbox server in `src/sandbox/` (port 8788). Each run gets its own workspace directory and its own worker process in a separate process group, with an allowlisted environment that never holds platform secrets. Runs have a timeout and are killed on stop.
- Drivers: `scripted` (deterministic, for tests), `kilo` (two-call stand-in agent loop), `harness` (boots the credential executor, daemon, and gateway per task like a local hatch, leases a guardian token from the gateway, configures Kilo, sends the goal with `POST /v1/messages`, maps `GET /v1/events` to steps until `message_complete`). The event mapping lives in `drivers/harness-turn.ts` and is unit tested against a fake runtime.
- Steps from the `harness` driver: assistant narration before each tool call, one `tool` step per call with a one-line input summary (workspace paths shown relative), one `observation` per result with duration and output summary, a closing summary (tool calls, failures, approvals). If every tool call failed, the result carries confidence 0.2.
- Measured on 2026-10-30 with `kilo-auto/free`, five goals that need tools (write a file, count lines, a multi-step file task, run shell commands, create and delete a directory). Before (daemon alone with `DISABLE_HTTP_AUTH=true`): 0 of 5 achieved, every tool call denied with "requires guardian approval from a verified channel identity", 24 to 41 seconds per task. After: 5 of 5 achieved, 21 to 51 seconds per task, ready after 10 to 13 seconds. The multi-step goal also passed on `nvidia/nemotron-3.5-lightning:free`, `poolside/laguna-s-2.1:free`, and `cohere/north-mini-code:free`; `nvidia/nemotron-3-ultra-550b-a55b:free` was overloaded.
- Limits: dev and test only (no network isolation, and the gateway listens on all interfaces); three processes per task; about 375 MB per task workspace, because Qdrant and the embedding runtime download into each workspace in the background (they do not delay readiness). A shared cache would need read-only isolation first, or one task could plant binaries for the next.

### Phase 5: approvals and safety (started)

The API and the sandbox carry approvals end to end: a driver asks, the task waits in `awaiting_approval`, the user decides in the app, and the decision reaches the driver. The `scripted` driver uses this. The `harness` driver maps the runtime's own consent prompts onto it: a `confirmation_request` event becomes an ANU approval, and the user's decision goes back through the runtime's `POST /v1/confirm`. The runtime's risk policy decides what needs consent; ANU adds no approval mode. Secret requests are declined (ANU cannot collect secrets). Question cards (`question_request`) are closed unanswered and recorded as a step until the app can answer them.

Trajectory supervision lives in the assistant's existing `exploration-drift` default plugin (a `post-tool-use` hook that adds a provider-only notice, never system prompt text). It already nudged on long silent exploration runs and on identical repeated calls for loop-prone models. It now also nudges, on every model, when the last four exploration calls alternate between the same two calls (A, B, A, B).

Constraint from `assistant/AGENTS.md`, "Permission controls v2": no new deterministic approval modes for assistant-owned actions. Consent for a risky step runs through the conversation with the model. The only deterministic gate is host computer access. The ANU design therefore changes its approval wording to fit this rule.

### Phase 6: phone client (in progress)

Current status and next steps are in [`HANDOFF.md`](HANDOFF.md). The design is [`design/phone-app.md`](design/phone-app.md).

Reuse `clients/web` through its Capacitor iOS and Android shells, and add a task screen: a step timeline, a stop button, approval prompts, and the result with its sources and confidence.

Done:
- The `/anu` screens.
- An audit of the native code: no model calls, agent logic, secrets, or authorization on the phone. The one exception is native platform sign-in.
- `ANU_SERVER_URL`, which sets the shell's server and a start path of `/anu`.
- A launch at `/anu` skips the platform session boot.
- `bun run mobile:e2e`: 44 of 44 checks under iOS and Android user agents. Every data request goes only to the ANU API, and it covers identity and isolation, approve, and stop.
- A debug APK builds on Linux, and its config was inspected.

Still open:
- Real devices or emulators, and the iOS build.
- An HTTPS host.
- Removing NativeAuth and the platform App Links from ANU builds.
- Sentry settings.

See `docs/mobile-thin-client.md`.

### Phase 7: isolation tests and a pilot (in progress)

Done: tests that one user cannot read, stop, approve, or export another user's tasks (404), that row-level security holds even for a query without an owner filter, that internal endpoints refuse user tokens, and that sandboxed processes do not receive platform secrets. Still open: network isolation of the sandbox, the pilot, and the success measures.

- Tests that one user cannot read another user's tasks, that a sandbox cannot reach internal networks, and that the harness cannot read secrets it was not given.
- A small pilot with a daily spending cap.
- Success measures from the architecture notes: did the agent finish the task, how often did it need a person, and did the user catch the errors before accepting the result.

### Phase 8: extensions, registry, and /goal (not started)

Requirements are in [`HANDOFF.md`](HANDOFF.md) and research in [`research/`](research/). No final spec yet.

## Known limits of the current environment

- It is a single, ephemeral container that is reclaimed after inactivity. It is not multi-tenant, so it suits development and tests, not real users' data.
- A per-user sandbox manager needs real cloud infrastructure. That is out of scope until the cloud decision is revisited.
