# 0004: Kilo Gateway as the test model provider

Status: proposed. The base URL and network access are not yet confirmed.

## Context

- Tests need a model that is not the Anthropic route used by the session.
- The repository has no Kilo provider. A profile may name only providers from a closed list in `assistant/src/config/schemas/llm.ts`. `openai-compatible` is on that list and accepts a base URL per connection (`assistant/src/providers/inference/auth.ts`).
- A connection's API key comes only from the secure credential store. The connection path does not read environment variables (`assistant/src/providers/inference/resolve-auth.ts`). A `KILO_API_KEY` variable is therefore not read by the harness directly.
- The Kilo documentation gives two base URLs. The official docs at kilo.ai point to `https://ai-gateway.kilo.ai/api/v1`. A copy of the API reference in the Kilo-Org GitHub repository and a third-party integration guide point to `https://api.kilo.ai/api/gateway`.
- On 2026-10-29, the egress policy of this environment refused CONNECT to both hosts with 403.

## Decision (proposed)

Configure Kilo as an `openai-compatible` connection. No code change is needed.

1. Store the key with `assistant credentials set --service kilo --field api_key`.
2. Create connection `kilo-gateway` with the base URL from `KILO_BASE_URL` and a model ID.
3. Create profile `kilo-test` on that connection, and make it the active profile for tests.

The CLI verbs come from the help text in `assistant/src/cli/commands/inference-providers.ts`. They were not executed during this research.

## Open items

- Confirm the base URL against the live documentation. The official docs point to `ai-gateway.kilo.ai`.
- Allow the chosen host under Allowed domains in the environment's network settings.
- Confirm the wire protocol live: OpenAI Chat Completions, `Authorization: Bearer`, no extra headers. The quickstart shows this, but it has not been run here.
- Decide how `KILO_API_KEY` reaches the credential store. The setup script cannot read secrets, so the step has to run inside the session, for example a `scripts/kilo-bootstrap.sh` that the operator runs.

## Consequences

- The assistant runtime stays unchanged. ANU only configures it.
- Tests that depend on Kilo are skipped until the host is allowed and the key is present.
