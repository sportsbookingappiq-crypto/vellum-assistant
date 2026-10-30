# Approvals, permissions and secrets inventory

## What exists today (read-only inventory)

**Approvals.** The harness checks each tool call with `assistant/src/permissions/checker.ts` (`check()`, `DefaultApprovalPolicy`). The inputs are the risk the gateway classifies (`classify_risk` IPC), the auto-approve threshold and the actor's capabilities. Thresholds belong to the gateway: there is one global value per mode, `PUT /v1/permissions/thresholds`, and a per-conversation override, `PUT /v1/permissions/thresholds/conversations/{id}` (`gateway/src/http/routes/auto-approve-thresholds*.ts`). The threshold levels are none, low, medium and high, and `threshold.ts` treats high as full access. A prompt goes out as a `confirmation_request` event and is settled by `POST /v1/confirm`. Guardian decisions go through `applyGuardianDecision()` (`assistant/src/approvals/AGENTS.md`).

**Permission controls v2 (root `AGENTS.md`).** No new deterministic approval modes, toggles, per-tool or per-command approvals, timed grants, wildcard scopes or persistent trust-rule UI. Consent should go through the conversation. The only exceptions are true host-computer or identity-boundary enforcement. The flag is not in `meta/feature-flags/feature-flag-registry.json`, so the rule applies as written. The host-access gate survives only as `persistence/migrations/217-conversation-host-access.ts` and `rejectUnattendedHostTool` (`daemon/conversation-tool-setup.ts:263`). In ANU the "host" is the sandbox workspace, so that gate effectively never fires.

**Secrets.**
- Skills call `assistant credentials prompt --service X --field Y`, for example `skills/public-ingress/SKILL.md:116`.
- That reaches `POST /v1/credentials/prompt` (`runtime/routes/credential-prompt-routes.ts`). Tool code can use `requestSecret` from the tool context instead (`conversation-tool-setup.ts:521`).
- Both paths go to `SecretPrompter.prompt()` (`permissions/secret-prompter.ts`). It broadcasts `secret_request`, which carries metadata only (service, field, label, purpose, allowedTools, allowedDomains, allowOneTimeSend), and blocks until it times out.
- The client answers with `POST /v1/secret {requestId, value, delivery: "store"|"transient_send"}` (`runtime/routes/approval-routes.ts`). This route requires the guardian and the `approval.write` scope.
- `persistPromptedCredential` (`credential-execution/prompted-credential.ts`) then writes the value through `setSecureKeyAsync` to CES (`security/secure-keys.ts`, using RPC, then HTTP, then an encrypted-file fallback). It also writes policy metadata (allowed tools and domains, injection templates) and scrubs transcripts. The broker injects the value at use time (`tools/credentials/broker.ts`).
- The model only ever sees an "ok" result. Values pasted into chat are caught by `security/secret-ingress.ts` (`secretDetection.blockIngress`).
- Channels without a UI get a one-time gateway link instead (`credential-request-routes.ts`).
- The web UI is `clients/web/src/domains/chat/components/secret-prompt-card.tsx` plus `domains/credential-requests/credential-entry-page.tsx`.

**ANU today.**
- `anu/src/sandbox/drivers/harness-turn.ts` maps `confirmation_request` to `ctx.requestApproval`, which becomes the protocol message `{t:"approval"}` and then the API `approvals` table (`anu/src/api/sessions.ts` `decide()`). The decision is sent back with `POST /v1/confirm`.
- `secret_request` is **declined**: the driver cancels it with `POST /v1/secret {requestId}` (lines 374 to 383).
- CES is **per session**: `harness.ts` creates `<workspaceDir>/harness/.vellum/protected` for each worker, and the Kilo key is pushed in at boot with `POST /v1/secrets` (`configureRuntime`, line 57).

## (a) Approvals

1. Keep the current path unchanged: harness confirmation, then the API approval card, then `/v1/confirm`. Copy follows `phone-app.md` §A: one question in the bot's voice with Allow and Not now buttons.
2. Add an "ask in chat" variant for v2. When the agent has no prompt to raise but needs consent (publishing an extension, spending against a `/goal` budget, installing from the marketplace), it asks in plain conversation and acts on the user's reply. This needs no new mode.
3. Approvals for extension publish and bot-builder installs are ordinary chat turns with a preview card. They are not a new approval type.
4. When a session or task is stopped, mark its approvals `expired` (already done) and also cancel the harness prompt.
5. `/goal` loops in unattended mode must not auto-approve. A pending approval pauses the goal and shows the "Needs you" state.

## (b) Per-bot permissions screen

Split what v2 allows from what it forbids.

**Allowed as bot-level capability grants.** These are capability filters and boundaries, not approval modes. Each one maps to an existing mechanism, applied by `applyBotProfile` in `drivers/harness.ts`:

- **Tools and extensions the bot has.** Installed packages go through `skills.entries[id].enabled` and `PUT /v1/conversations/:id/enabledplugins`. Removed capabilities go through `tools.exclude` (`src/config/schemas/tools.ts`). If a tool is absent, nothing can approve it.
- **Credentials the bot can use.** Each secret has `allowedTools` and `allowedDomains` metadata (`tools/credentials/policy-types.ts`), which CES and the broker enforce.
- **Network domains for its extensions.** This is a registry manifest permission that the sandbox enforces as a boundary.
- **Model and budget.** The model is `inferenceProfile`; the `/goal` budget is enforced by ANU, not by the harness.

**Must stay conversational or unchanged:**
- When it asks: this is the existing threshold, shown once as a plain-words choice (`phone-app.md` §13). It is set per bot only by writing the gateway per-conversation override for that bot's sessions (`PUT /v1/permissions/thresholds/conversations/{id}` at boot). That reuses the existing v2 scope and adds no new verb. Do not offer full access ("high") for unattended runs.
- No per-tool always-allow, no timed grants and no trust-rule list. "Don't ask again for X" is answered in chat.
- The screen shows each item as a card with a sentence, for example "Can send email from Gmail (uses your Gmail key)", plus Remove. Removing an item uninstalls it or deletes the secret, then restarts any worker whose `bot_version` is stale.

Isolation: grants live on the bot row and are applied per workspace, so a bot never sees another bot's tools or secrets.

## (c) Secure secret box, end to end

1. **Harness.** The skill runs `assistant credentials prompt`, which emits `secret_request` with metadata only.
2. **Sandbox driver.** In `harness-turn.ts`, replace the decline with `ctx.requestSecret({requestId, service, field, label, purpose, allowedDomains})`. This is a new protocol message `{t:"secret_request", ref, ...metadata}` in `anu/src/sandbox/protocol.ts`. The parent's answer is `{t:"secret", ref, value?, cancelled?}`.
3. **API.** The `secret_requests` table (`anu/src/api/sessions.ts`, tasks too) stores **only metadata and status**. The session gets `pendingSecret`, and SSE sends an `item` of kind `secret_request` that never holds a value.
4. **Phone.** A "صندوق آمن" / "Secure box" sheet shows the service, purpose and allowed domains. It uses `<input type="password" autocomplete="off">`; the Capacitor shells use iOS `isSecureTextEntry` and Android `FLAG_SECURE` with a password input type. Pasting is allowed. The box says "the agent never sees this". It submits `POST /v1/sessions/:id/secrets/:requestId {value}`, and Cancel sends `{cancel:true}`.
5. **API handling.** The handler checks ownership and that the request is pending, then streams the value straight to the sandbox (`sandbox-client.ts`, `POST /internal/sessions/:id/secrets`). It never writes the value to Postgres, logs, audit `detail` or the step timeline; redact it in Fastify/pino serializers. The `secret_requests` row becomes `provided`.
6. **Sandbox.** It forwards the value to the worker, which calls `POST /v1/secret {requestId, value, delivery:"store"}`. The daemon then runs `persistPromptedCredential` and stores the value in CES with its policy metadata. The model receives only "stored".
7. **Persistence per bot.** Because CES lives per session, add a sandbox-side bot vault, `anu/src/sandbox/vault.ts`. It holds AES-256-GCM blobs keyed `(user_id, bot_id, service, field)`, with the key from env `ANU_VAULT_KEY` and storage outside every workspace. In `configureRuntime`, the vault replays the bot's own secrets into each new session's CES with `POST /v1/secrets`, the same way the Kilo key is loaded, along with metadata. Other bots' entries are never loaded.
8. **Management.** The bot permissions screen lists secret names only (`GET /v1/bots/:id/secrets`) and allows `DELETE`. Values are never returned.
9. **Paste guard.** Values pasted in chat stay blocked by the harness `blockIngress`. The API should also refuse to store messages that match the secret patterns: copy the pattern list from `security/secret-patterns.ts` into ANU code rather than importing it across the boundary, then show the secret box instead.
10. **Extensions.** Extension manifests declare the secrets they need (service, field, domains). Installing one never collects a value; the secret box opens the first time the secret is used.

This matches MCP's rule that credentials must never pass through the LLM context or intermediaries. It also follows the broker/proxy injection practice and OWASP LLM02 (sensitive information disclosure) and LLM06 (excessive agency).

## Sources
- [MCP elicitation spec](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)
- [MCP SEP-1036, URL-mode elicitation](https://modelcontextprotocol.io/seps/1036-url-mode-elicitation-for-secure-out-of-band-intera)
- [Composio, keeping API tokens out of the LLM context](https://composio.dev/content/credential-isolation-ai-agents)
- [Agent Vault](https://trilogyai.substack.com/p/agent-vault-protects-secrets)
- [DEV Community, handling API keys when an agent reads untrusted content](https://dev.to/the_seventeen/the-right-way-to-handle-api-keys-when-your-agent-reads-untrusted-content-5gb6)
- [OpenAI Codex agent approvals and security](https://developers.openai.com/codex/agent-approvals-security.md)
- [Codex permission profiles](https://codex.danielvaughan.com/2026/05/08/codex-cli-permission-profiles-sandbox-modes-security-layers/)
- [OWASP MASTG-BEST-0069](https://mas.owasp.org/MASTG/best-practices/MASTG-BEST-0069/)
- [Apple isSecureTextEntry](https://developer.apple.com/tutorials/data/documentation/uikit/uitextinputtraits/issecuretextentry.md)
- [Talsec secure input](https://docs.talsec.app/appsec-articles/glossary/secure-input-protection)
