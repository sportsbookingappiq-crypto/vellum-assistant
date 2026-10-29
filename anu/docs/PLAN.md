# ANU plan

ANU lets a user describe a goal in plain language. An agent turns it into steps, runs them in an isolated environment with approved tools, and shows each step so the user can review it before anything is adopted.

The concept comes from the ANU architecture notes. Its shape: a phone app, an API that checks identity and permissions, and a sandbox that runs a harness with an agent inside it.

## Decisions

| Topic | Decision | Record |
| --- | --- | --- |
| Code location | `anu/` inside this repository, because creating a separate repository was refused (403) | [0001](decisions/0001-location-in-vellum-assistant.md) |
| Cloud | The current cloud environment. No new cloud provider | [0002](decisions/0002-current-cloud-environment.md) |
| Login | Phone number with a one-time code | [0003](decisions/0003-phone-number-login.md) |
| Test model provider | Kilo Gateway, as an `openai-compatible` connection | [0004](decisions/0004-kilo-gateway-test-provider.md) (proposed) |

## Phases

### Phase 0: decisions

Done for 0001 to 0003. 0004 is proposed. Its base URL and network access are still open.

### Phase 1: current cloud environment (in progress)

- `scripts/cloud-setup.sh` installs the `anu/` dependencies. It reads the Bun version from the repository's `.tool-versions`. If bun.sh is unreachable it warns and keeps the Bun already installed.
- `scripts/check-env.sh` reports readiness. It prints variable names and states, never values.
- `docs/environment.md` lists what to enter in the environment settings, and the network hosts to allow.

### Phase 2: Kilo test provider (pending)

Route the assistant's model calls to the Kilo Gateway in tests. No code change is needed. Kilo is configured as an `openai-compatible` connection with a credential-store key and a test profile (ADR 0004). Still open: the base URL (two conflicting sources), allowing the host through network access (currently refused with 403), and how `KILO_API_KEY` reaches the credential store.

### Phase 3: API and phone login (not started)

- Tables for users, login codes, tasks, and task steps.
- The login flow in ADR 0003: request a code, verify it, issue a short-lived session.
- Task endpoints: create, read status, stream steps, stop, export, and delete the user's data.
- Every sensitive operation checks permissions on the server.

### Phase 4: harness runner (not started)

Run the assistant runtime from `assistant/` for one task at a time, with no desktop app. Research found no single blocking call. A send returns acceptance, and the reply arrives on the event stream (`vellum events --json`, or `subscribe_assistant_events` after `messages_post`) until `message_complete`. The runtime boots with `VELLUM_WORKSPACE_DIR`, `RUNTIME_HTTP_PORT`, and `ACTOR_TOKEN_SIGNING_KEY`, and needs neither the gateway nor CES. The runner streams steps back to the API and writes results to the task's storage.

### Phase 5: approvals and safety (not started)

Constraint from `assistant/AGENTS.md`, "Permission controls v2": no new deterministic approval modes for assistant-owned actions. Consent for a risky step runs through the conversation with the model. The only deterministic gate is host computer access. The ANU design therefore changes its approval wording to fit this rule.

### Phase 6: phone client (not started)

Reuse `clients/web` through its Capacitor iOS and Android shells, and add a task screen: a step timeline, a stop button, approval prompts, and the result with its sources and confidence.

### Phase 7: isolation tests and a pilot (not started)

- Tests that one user cannot read another user's tasks, that a sandbox cannot reach internal networks, and that the harness cannot read secrets it was not given.
- A small pilot with a daily spending cap.
- Success measures from the architecture notes: did the agent finish the task, how often did it need a person, and did the user catch the errors before accepting the result.

## Known limits of the current environment

- It is a single, ephemeral container that is reclaimed after inactivity. It is not multi-tenant, so it suits development and tests, not real users' data.
- A per-user sandbox manager needs real cloud infrastructure. That is out of scope until the cloud decision is revisited.
