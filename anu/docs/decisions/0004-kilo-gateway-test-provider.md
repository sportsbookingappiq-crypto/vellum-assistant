# 0004: Kilo Gateway as the test model provider

Status: accepted (2026-10-29). The base URL, the wire protocol, and network access are confirmed live.

## Context

- Tests need a model that is not the Anthropic route used by the session.
- The repository has no Kilo provider. A profile may name only providers from a closed list in `assistant/src/config/schemas/llm.ts`. `openai-compatible` is on that list and accepts a base URL per connection (`assistant/src/providers/inference/auth.ts`).
- A connection's API key comes only from the assistant's secure credential store. The connection path does not read environment variables (`assistant/src/providers/inference/resolve-auth.ts`).
- The Kilo documentation gave two base URLs: `https://ai-gateway.kilo.ai/api/v1` (official docs) and `https://api.kilo.ai/api/gateway` (a copy in the Kilo-Org GitHub repository). On 2026-10-29, `api.kilo.ai` does not resolve. `ai-gateway.kilo.ai` answers.

## Confirmed on 2026-10-29

- Base URL: `https://ai-gateway.kilo.ai/api/v1`. `GET /models` returns 200.
- Protocol: OpenAI Chat Completions at `POST /chat/completions` with `Authorization: Bearer <key>` and no extra headers.
- Key: the literal string `anonymous` is accepted for free models, so tests need no secret. A real key is still a secret and must never be committed.
- Free models include `kilo-auto/free` and `nvidia/nemotron-3.5-lightning:free`. They are reasoning models: use `max_tokens` of at least 512, or the reply can be empty.
- `kilo-auto/free` routes to different underlying models. One run reported `stealth/glyph-cluster`.
- Network access from this environment works. The earlier 403 no longer happens.

## Decision

Kilo is reached in two ways, both without changing `assistant/`:

1. The ANU sandbox `kilo` driver (`anu/src/sandbox/drivers/kilo.ts`) calls the gateway directly. It is a stand-in agent loop for tests and demos, not the harness.
2. The ANU sandbox `harness` driver (`anu/src/sandbox/drivers/harness.ts`) boots the assistant runtime and configures Kilo through the runtime's own HTTP API, as an `openai-compatible` connection:
   1. `POST /v1/secrets` with `{"type": "credential", "name": "kilo:api_key", "value": "<key>"}` stores the key in the credential store.
   2. `POST /v1/inference/provider-connections` creates connection `kilo` with `base_url` and `auth: {"type": "api_key", "credential": "credential/kilo/api_key"}`.
   3. `POST /v1/inference/profiles` creates profile `kilo-free` on that connection.
   4. `POST /v1/config/set` makes `kilo-free` the active profile. Each message also names it with `inferenceProfile`.

This answers the earlier open item of how the key reaches the credential store: the driver writes it over the runtime's HTTP API at boot, per task.

Settings: `KILO_BASE_URL` (default above), `KILO_API_KEY` (default `anonymous`), `KILO_MODEL` (default `kilo-auto/free`).

## Consequences

- The assistant runtime stays unchanged. ANU only configures it.
- Live tests are opt-in: `ANU_LIVE_KILO=1` and `ANU_LIVE_HARNESS=1`. They pass against the free models as of 2026-10-29.
- Free models are shared and rate limited, and `kilo-auto/free` may change model between calls. Live tests check shape, not exact wording.
- Model calls other than the main turn (titles, memory) resolve through `llm.defaultProvider`, which cannot be `openai-compatible`. In a harness run they fail quietly. This does not block a turn.
