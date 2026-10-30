<p align="center">
  <img src="assets/banner.png" alt="ANU: your personal AI agent" width="100%">
</p>

# ANU

ANU is your personal AI agent. Tell it what you need and it gets it done. It can research, write, code, handle email and schedules, and run recurring jobs. Before anything risky, it asks you first.

ANU is early. The phone app is not built yet, and the platform runs in a development container. [Status](#status) lists what works.

## Quick start

Run ANU on your machine and talk to it directly with the `anu` CLI:

```bash
./setup.sh      # installs Bun if needed, installs dependencies, links the anu CLI
anu hatch       # create a local assistant and make it active
anu client      # chat with it in this terminal
anu sleep       # stop it; data is kept
```

`anu --help` lists every command, grouped by task. The published npm package and the desktop installers still carry Vellum's names ([ADR 0005](anu/docs/decisions/0005-rebrand-compatibility-identifiers.md)), so install from source for now.

## Developers: how a task runs

1. You send a goal: `POST /v1/tasks {"goal": "..."}`.
2. The API checks your session and starts a sandbox run: a workspace directory and a worker process of its own.
3. The agent writes a plan, then works through it. Every step (`plan`, `tool`, `observation`, `message`, `result`) streams over `GET /v1/tasks/:id/events` as it happens.
4. Before a risky step, the agent asks. The task waits in `awaiting_approval` until you approve or reject it.
5. The task ends `succeeded`, `failed`, or `stopped`, with a result and a confidence score. You can stop it at any point, export everything with `GET /v1/me/export`, and delete it all with `DELETE /v1/me`.

The full contract is in [`anu/docs/api.md`](anu/docs/api.md) and [`anu/openapi.yaml`](anu/openapi.yaml).

## Developers: the four parts

| Part | What it does | Where | State |
| --- | --- | --- | --- |
| Phone app | Goal input, step timeline, approve and reject, stop, result | `clients/web`, through its Capacitor iOS and Android shells | Not started |
| API | Phone login, tasks, steps, live stream, approvals, export, delete. Row-level security on every table | [`anu/src/api`](anu/src/api), port 8787 | Works in development |
| Sandbox | One workspace and process group per task, an allowlisted environment with no platform secrets, a timeout, stop | [`anu/src/sandbox`](anu/src/sandbox), port 8788 | Works. Process isolation only |
| Harness | The agent itself: plans, calls tools, asks for consent | [`assistant/`](assistant), booted per task by the `harness` driver | Completes a turn against a live model. Dev only |

The sandbox runs one of three drivers, set with `ANU_SANDBOX_DRIVER`: `scripted` (deterministic, for tests and demos), `kilo` (a two-call plan and answer through Kilo Gateway, no tools), and `harness` (the full assistant runtime, about 30 seconds to boot).

## Developers: platform quick start

Needs Bun and PostgreSQL 15. Run from `anu/`:

```bash
bash scripts/cloud-setup.sh     # install dependencies from bun.lock
bun run db:setup                # databases, anu/.env with generated secrets, migrations
bun run seed                    # fake users and tasks
bun run dev                     # API on :8787, sandbox on :8788
```

Sign in as the seeded user. In development the code comes back in the response instead of by SMS:

```bash
curl -s -X POST localhost:8787/v1/auth/code/request -H 'content-type: application/json' \
  -d '{"phone":"+12025550100"}'                       # {"expiresAt":"...","devCode":"123456"}
curl -s -X POST localhost:8787/v1/auth/code/verify -H 'content-type: application/json' \
  -d '{"phone":"+12025550100","code":"123456"}'       # {"token":"anu_s_...",...}
```

Run a task that stops for approval. With the default `scripted` driver, `#approval` in the goal makes the agent ask "Write summary.md to the task workspace?" before it writes anything:

```bash
TOKEN=anu_s_...
curl -s -X POST localhost:8787/v1/tasks -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"goal":"Summarize this workspace #approval"}'
curl -N localhost:8787/v1/tasks/<task-id>/events -H "authorization: Bearer $TOKEN"
curl -s -X POST localhost:8787/v1/tasks/<task-id>/approvals/<approval-id> \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"decision":"approve"}'
```

The approval id is in `approvals` on `GET /v1/tasks/<task-id>`. More commands, the seeded users, and the live tests are in [`anu/README.md`](anu/README.md).

## Developers: what the assistant already does

ANU's assistant is the open-source Vellum assistant, renamed. It brings these, each documented next to its code:

| Area | What it does | Read more |
| --- | --- | --- |
| Consent | Under permission controls v2, risky actions are agreed in the conversation. The one fixed approval gate is access to the host computer | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Credentials | Secrets live in a separate process and never reach the model | [`assistant/docs/credential-execution-service.md`](assistant/docs/credential-execution-service.md) |
| Memory | Facts it learns are filed in the workspace and pulled into later turns | [`assistant/docs/architecture/memory.md`](assistant/docs/architecture/memory.md) |
| Skills | 76 bundled skills, each a `SKILL.md` loaded on demand | [`skills/`](skills) |
| Channels | Desktop, web, iOS, Telegram, Slack, email, and phone, behind one gateway that decides who may talk to it | [`gateway/ARCHITECTURE.md`](gateway/ARCHITECTURE.md) |
| Models | Anthropic, OpenAI, Gemini, Ollama, OpenRouter, Fireworks, and any OpenAI-compatible endpoint. ANU's tests use Kilo Gateway's free models | [`meta/llm-provider-catalog.json`](meta/llm-provider-catalog.json) |

## Status

Works, in one development container:

- Phone login with one-time codes: keyed hashes, 5-minute expiry, 5 attempts, rate limits.
- Tasks, steps, the live stream, stop, approvals, export, and delete, with row-level security.
- A sandbox run per task with a timeout and a scrubbed environment; a test checks that no platform secret reaches the worker.
- The `harness` driver boots the assistant and completes a turn against Kilo Gateway.

Not built yet:

- The phone app's task screen.
- An SMS provider. Only the development sender exists, and it refuses to run outside `dev` and `test`.
- Network isolation, and a container or VM per task. Today's sandbox is a directory, a process group, and an allowlisted environment: not a boundary against hostile code.
- Tool calls inside the harness (they need the gateway), and mapping the assistant's consent prompts onto ANU approvals.
- Any deployment.

The phases are in [`anu/docs/PLAN.md`](anu/docs/PLAN.md) and the decisions behind them in [`anu/docs/decisions/`](anu/docs/decisions).

## Docs

| Doc | What it covers |
| --- | --- |
| [`anu/AGENTS.md`](anu/AGENTS.md) | The platform: what exists, how the parts talk, rules for changing it |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The assistant runtime, gateway, and clients |
| [`docs/ANU-VOICE.md`](docs/ANU-VOICE.md) | How ANU writes: assistant replies, UI, CLI, and docs |
| [`assets/brand/BRAND.md`](assets/brand/BRAND.md) | The mark, palette, and usage |
| [`GLOSSARY.md`](GLOSSARY.md) | The words the code and docs use |

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), and `AGENTS.md` in the folder you are changing. Report security issues privately as described in [`SECURITY.md`](SECURITY.md). Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

MIT. ANU is built on the open-source [Vellum assistant](https://github.com/vellum-ai/vellum-assistant), and its copyright notice stays in [`LICENSE`](LICENSE) as the license requires. Integration logos come from [Simple Icons](https://github.com/simple-icons/simple-icons) under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
