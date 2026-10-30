# Extensions: three unreviewed design directions (no final spec yet)

# Registry-centric design

In this design the registry is the source of truth for packages, bot packages and versions. Each bot is pinned by a lockfile, and the sandbox installer turns that lockfile into a session workspace. The bot builder runs as a normal ANU task. Harness changes are kept to a minimum.

## 1. Processes
| Port | Process | Role |
|---|---|---|
| 8787 | ANU API (`anu/src/api`) | Auth, bots, sessions, tasks, goals, onboarding. Proxies the registry for the app. |
| 8788 | Sandbox (`anu/src/sandbox`) | Workers and harness. Gains `installer.ts`, `vault.ts` and `goal-loop.ts`. |
| 8789 | Registry (`anu/src/registry`, new) | Packages, versions, review, signing, resolver, blobs. Has its own Postgres schema `registry`. |

Who talks to whom:
- App to API: user token.
- API to registry: a service token plus `X-Anu-User`.
- Sandbox to registry: read-only service token for tarballs and the blocklist.
- The sandbox never publishes. All publishing goes through the API after the user confirms.

## 2. Data model
**registry schema**
- `packages(id "scope/name", kind, owner_user_id, visibility private|unlisted|public, created_at)`
- `versions(package_id, version, manifest jsonb, digest sha256, signature, size, origin human|agent, provenance jsonb, review_status pending|passed|rejected, yanked, published_at)`. The pair (package_id, version) is immutable and can never be republished.
- `blobs(digest PK, bytes|path)`, content-addressed.
- `reviews(version_ref, checks jsonb, reviewer, verdict)`
- `blocklist(package_id, range, reason)`
- `renames(from, to)`

**api schema** (additions)
- `bots` gains `package_ref`, `lock jsonb`, `lock_hash`, `grants jsonb` (autonomy, network allow, removed tools) and `goal_defaults jsonb`.
- `bot_builds(id, user_id, task_id, description, plan jsonb, state drafting|awaiting_confirm|applied|discarded)`
- `goals` and `goal_events`, as in Research 2.
- `secret_requests(id, session_id|task_id, bot_id, service, field, label, purpose, domains, status pending|provided|cancelled|expired)`. This table holds metadata only.
- `onboarding(user_id, state not_started|in_progress|done|skipped, session_id, answers jsonb, bot_id)`

**sandbox (host, outside every workspace)**
- `vault/` holds AES-256-GCM blobs keyed `(user, bot, service, field)`, encrypted with `ANU_VAULT_KEY`.
- `cache/<digest>/` holds unpacked packages, shared read-only.

## 3. Package manifest (`anu.package.json`)
- The schema follows Research 3: `schema: anu.package/1`, `id`, `kind` (bot|skill|plugin|mcp|prompt|tool), `version`, bilingual `displayName`/`description`, `license`, `engines.anu`, `origin`, `provenance`, `contents`, `dependencies`, `capabilities`, `secrets` and `digest`.
- `kind: tool` is packaged as a plugin `tools/*.ts` or as a skill `TOOLS.json`. A package never registers a core tool (assistant/src/tools/AGENTS.md).
- **Bot packages** add `bot: {identity, soul, avatar, starters, modelProfile, grants, goalDefaults}`. Their `dependencies` are the bot's extensions.
- Every path must stay under the package root.
- Descriptions are data. They appear only in the app and are never placed in any prompt.

## 4. Registry API (8789, `/v1`)
| Method | Path | Purpose |
|---|---|---|
| GET | `packages?q&kind&scope&cursor` | Search |
| GET | `packages/{id}` | Package metadata |
| GET | `packages/{id}/{version}` | Manifest, digest, signature, review status |
| GET | `packages/{id}/{version}/tarball` | Package download |
| POST | `packages` | Multipart tarball and manifest. The result is `pending_review` and private. |
| POST | `packages/{id}/{version}/visibility` | Change visibility |
| POST | `packages/{id}/{version}/yank` | Yank a version |
| POST | `resolve` | Takes `{deps, botId}` and returns `{lock:[{id,version,digest,signature,capabilities}], capabilityUnion, secrets}` |
| GET | `blocklist` | Blocked packages |
| GET | `renames` | Renames and removals |

The API mirrors these for the app under `/v1/market/*` and adds the user's install state.

## 5. Install and isolation
At worker boot (`drivers/harness.ts` `applyBotProfile`), if `lock_hash` differs from `<ws>/.anu-bot-lock`:
1. Fetch each lock entry by digest. Verify the sha256 and the registry ed25519 signature. Refuse anything that is yanked or blocklisted.
2. Copy or hardlink from the cache into `<ws>/plugins/<name>` or `<ws>/skills/<id>`. Never symlink, because the realpath containment checks reject links.
3. Write the per-bot configuration:
   - `skills.entries[id].enabled`
   - `.disabled` for excluded default plugins
   - `tools.exclude` or `.removed` for excluded core tools
   - `mcp.json`
   - IDENTITY.md and SOUL.md (existing)
4. Point the plugin install source at the registry with a new config key `extensions.registryUrl`, so `platform.baseUrl` is left alone. The registry also serves the `/v1/plugins/{name}/install/` shape (tgz plus ETag sha256), so the existing install pipeline works unchanged.
5. Replay this bot's vault entries into the session's CES with `POST /v1/secrets`, including their policy metadata.
6. Enforce capability `network` lists as a per-worker egress allowlist at the sandbox proxy.

Every session already has its own workspace and its own CES, so nothing leaks between bots. The vault replays only rows that match `(user, bot)`. The installer polls the blocklist every 10 minutes and quarantines affected sessions on their next turn.

## 6. Harness changes (minimal)
- **Config key:** `extensions.registryUrl` in cli/lib, a small self-contained change.
- **`anu-author` skill:** wraps `plugin-builder` docs and adds an `anu pack` script that tars `<ws>/plugins/<name>` or `<ws>/skills/<id>`, writes the manifest with provenance and the sha256, and drops it in `<ws>/outbox/`. This adds no core tool.
- **No harness changes for /goal or the secret box.** Both live in the ANU sandbox and API.

## 7. Agent-authored extensions (pi-like)
1. The agent writes into its own workspace. Hot reload (`reconcilePluginSourcesNow`) loads it right away for that session only.
2. To test, it runs `anu pack --test`. The sandbox starts a throwaway worker with that package, which shows deterministic smoke output.
3. To publish, the agent asks in chat ("Save Weather Brief to your library?"). The app shows a publish card (capabilities, files, diff). Tapping Publish calls `POST /v1/sessions/:id/outbox/:pkg/publish`. The API reads the tarball from the sandbox and POSTs it to the registry with `origin: agent`.
4. Review then runs automatically:
   - static scan (eval, child_process, net outside the declared domains, credential APIs)
   - secret scan
   - capability check: what the code uses must be a subset of what it declares
   - a sandboxed run
5. A private package needs only the automatic review. Public visibility also needs human review.

## 8. Bot builder (a dedicated task)
`POST /v1/bots/build {description, locale}` creates a `bot_builds` row and a Task that runs as the system bot "Builder". The Builder has the `anu-author` and `anu-market` skills; `anu-market` runs `anu market search|resolve` through the sandbox, which proxies to the registry.

1. **Plan.** The model turns the description into needs: persona, model tier, a list of capabilities.
2. **Match.** For each need it searches the registry and prefers the user's own packages, then reviewed public ones.
3. **Create.** For gaps it authors the extension, tests it and packs it (section 7). These packages stay `pending_review` and private.
4. **Assemble.** It writes a `kind: bot` manifest and calls `resolve`. It saves the plan (persona, chosen packages, created packages, capability union, secrets needed) to `bot_builds.plan`. The task step timeline shows each step live.
5. **Confirm.** The build stops in `awaiting_confirm`, and the app shows a review screen. Confirm publishes the created packages (private), publishes the bot package, writes the `bots` row with its lock, and marks the build `applied`. Adjust sends edits back to the task. Discard deletes the drafts.

Approvals during the build are the task's own ordinary approvals. Today's `POST /v1/bots/draft` remains the fast fallback.

## 9. /goal
- **Commands:** `/goal <text>`, `/goal`, `draft`, `pause`, `resume`, `clear`, plus the Arabic aliases.
- **Data:** the contract and states follow Research 2.
- **Owner:** `goal-loop.ts` in the sandbox. After each `turn_complete` it:
  1. runs the gates in the workspace;
  2. calls the judge through the existing one-JSON-reply driver path, which is a harness turn on its configured provider, so `getConfiguredProvider` stays the only LLM path;
  3. stores a `goal_events` row;
  4. on `continue`, sends a synthetic user message carrying the judge's reason.
- **Guards:**
  - The judge fails closed: 3 errors pause the goal.
  - 3 turns without tool use pause the goal.
  - Budgets on turns (20), tokens, minutes (120) and cost lead to `budget_limited`, after a wrap-up turn.
  - A pending approval or secret request sets `waiting_*` and freezes the clocks.
  - A real user message takes priority over a queued continuation.
- **Permissions:** the goal never changes grants. The agent may only propose a goal in a card, and the user starts it.
- **API:** `POST|GET /v1/sessions/:id/goal`, `POST /v1/goals/:id/{pause,resume,clear,confirm-draft}`, `GET /v1/goals/:id/events`, and SSE `goal`.
- **Tasks:** a goal can be promoted to a task.

## 10. Permissions and Permission controls v2
The per-bot screen controls **what exists**, not approval modes:
- installed packages
- removed core tools
- network domains
- secrets (names only)
- model
- goal budget

"When it asks" is the existing threshold. It is written as the gateway per-conversation override for this bot's sessions, and `high` is not allowed for tasks or goals.

Install and publish are user actions in the app. They work like the host-computer gate, as an explicit user act and not an approval mode for the assistant's own actions. Inside chat they are proposals that the user taps.

When an update widens capabilities, dependencies or secrets, the user sees a diff sheet and must approve it again.

The following are not added: per-tool always-allow, timed grants, trust-rule lists.

## 11. Secret box
1. The harness emits `secret_request`, which carries metadata only.
2. `harness-turn.ts` stops declining it and sends protocol `{t:"secret_request"}`.
3. The API stores a `secret_requests` row and SSE sends an item.
4. The phone sheet "صندوق آمن / Secure box" collects the value (`isSecureTextEntry`, `FLAG_SECURE`).
5. The phone sends `POST /v1/sessions/:id/secrets/:reqId {value}`. The API streams it to the sandbox and never stores or logs it (pino redaction).
6. The sandbox sends `POST /v1/secret {delivery:"store"}`, which calls `persistPromptedCredential` and writes to CES. It also writes the value to the bot vault.
7. The model sees only "stored". Secrets pasted into chat are blocked by the API and the box opens instead.
8. Management: `GET/DELETE /v1/bots/:id/secrets` lists and deletes names. Values are never returned.

## 12. First-run onboarding
- **When it starts:** after the first OTP sign-up, when `onboarding.state = not_started`.
- **Screens:**
  - **Splash:** Stellar on white, with "ANU" in black and the black line below it. The app icon is Stellar on white.
  - **Welcome:** in Arabic or English, picked from the device and switchable.
  - **Onboarding chat:** a session with the system bot ANU, using the `anu-onboarding` skill.
  - **Build progress:** the bot-builder timeline.
  - **Review and confirm**
  - **Home**
- **Script outline:**
  1. Greeting.
  2. A plain explanation in five short messages, each with a small illustration card: bots; chats and tasks; /goal; extensions and the marketplace; approvals and the secret box.
  3. Questions, as quick-reply chips with free text allowed:
     - What do you want help with first?
     - Which tone do you prefer?
     - What may it do without asking: only read and search, also make drafts, or always ask?
     - Name or face preference
  4. Build the bot with section 8.
  5. Show the result and let the user confirm or adjust.
- **Skip and redo:** "Skip" on every screen gives the defaults. "Redo onboarding" is in Settings.
- **API:**
  - `GET /v1/onboarding`
  - `POST /v1/onboarding/start {locale}`, which returns the session
  - `POST /v1/onboarding/answers`
  - `POST /v1/onboarding/build`, which returns a `bot_builds` id
  - `POST /v1/onboarding/{complete,skip,reset}`

## 13. Phone screens
- **Marketplace:** tabs Bots / Extensions / Mine, search, and kind chips.
- **Extension detail:** author, a "Made by your bot" badge, review status, plain capability rows with risky ones highlighted, secrets, dependencies, changelog.
- **Install sheet:** pick the bot, view capabilities, then Install.
- **Update diff sheet**
- **Publish card**
- **Builder progress and review**
- **Goal bar and draft card**
- **Bot permissions screen:** cards with Remove.
- **Secret box sheet**
- **Onboarding**

## 14. Security
- Every version is immutable and digest-pinned, and signed by the registry with ed25519 (key held only on 8789). The installer verifies before unpacking.
- The blocklist forces quarantine.
- Agent-written code: auto review (section 7), private by default, and human review before public.
- Runtime limits:
  - per-worker egress allowlist
  - no host mount
  - CPU, memory and time limits
  - plugin import timeout
  - the vault outside the workspace
- Injection: descriptions are never sent to the model. Search results go to the builder as structured fields with descriptions truncated and quoted as data.
- The secret never reaches the model, the database or the logs.
- /goal: fail-closed judge, budgets, and a no-progress guard.

## 15. Build phases
1. Registry server with manifest, blobs, signing, resolver, search, and the API proxy.
2. Sandbox installer with lockfiles, cache, vault replay and egress allowlist; the bot `lock` column.
3. Secret box end to end.
4. Marketplace screens, install sheet and permissions screen.
5. `anu-author` skill, publish flow and automatic review.
6. Bot builder task and review screen.
7. /goal loop, UI and push notifications.
8. Onboarding, plus the Stellar icon and splash.
9. Public visibility, human review and renames.

---

# Harness-native design

Core idea: an ANU extension is a harness plugin, skill, MCP config or prompt, with a manifest added. A bot is a workspace template. The registry stores signed tarballs. The bot builder and the onboarding are skills that run inside the harness. Verified in code: plugin hooks `stop`, `post-model-call` and `user-prompt-submit` (assistant/src/plugin-api/constants.ts); plugins can import `getConfiguredProvider` and `runConversationTurn` (plugin-api/index.ts, conversation-turn.ts). `stop` cannot continue the loop.

## 1. Processes

| Process | Port | Role |
|---|---|---|
| API `anu/src/api` | 8787 | Auth, bots, sessions, approvals, secret relay, proxies the marketplace |
| Sandbox `anu/src/sandbox` | 8788 | Workers, workspace materialization, package cache, bot vault |
| Registry `anu/src/registry` (new) | 8789 | Package metadata, tarballs, signing, review, blocklist, resolve |
| Harness (per session) | internal | CES, daemon and gateway, booted by `drivers/harness.ts` |

The registry has its own Postgres schema `registry` and its own blob directory. Only the API and the sandbox can reach it: the API with user-scoped tokens it mints, the sandbox with a service token that is read-only.

## 2. Data model

**Registry:**
- `packages(id, owner_user_id, kind, visibility private|unlisted|public, created_at)`
- `versions(package_id, version, manifest jsonb, digest, signature, origin human|agent, review_state pending|passed|rejected, yanked, published_at)`. Versions are immutable.
- `reviews(version_ref, checks jsonb, reviewer, verdict)`
- `blocklist(package_id, version_range, reason)`
- `renames(old, new)`

**API (migration 0005_extensions.sql):**
- `bot_packages(bot_id, package_id, range, pinned_version, digest, source store|builder|agent)`
- `bot_locks(bot_id, lock jsonb, lock_hash)`
- `bot_grants(bot_id, threshold, network jsonb, removed_tools text[])`
- `goals` and `goal_events`, as in Research 2
- `secret_requests(id, session_id, bot_id, service, field, label, purpose, domains, status)`. This table holds metadata only.
- `bot_builds(id, bot_id, session_id, plan jsonb, state)`
- `users.onboarded_at`

**Sandbox:**
- `vault/` holds AES-256-GCM blobs keyed `(user, bot, service, field)`, with the key in env `ANU_VAULT_KEY`, stored outside all workspaces.
- `cache/sha256/<digest>/` holds unpacked packages.

## 3. Package manifest

The manifest lives in `anu.package.json` at the root of the tarball, next to the harness's own `package.json` and `plugin.json`, which stay unchanged:
- **Identity:** `schema: "anu.package/1"`, `id: "u.<handle>/<name>"`, `kind` (`bot`, `plugin`, `skill`, `mcp` or `prompt`), exact `version`, `displayName` and `description` in ar and en, `license` (an SPDX id compatible with MIT), `origin`, and `provenance` (botId, sessionId, sourceDigest).
- **contents:** paths relative to the root, with `..` rejected. Entries are `plugins/<name>/`, `skills/<id>/`, `mcp.json` and `prompts/*.md`.
- **dependencies:** exact versions or `^` ranges, resolved into a lock.
- **capabilities:** `network: [hosts]`, `shell`, `browser`, `schedules`, `hostComputer: false` (always false in v1), and `credentials: [{service, field, label, domains}]`.
- **bot** (only when kind is bot): name, role, personality, instructions, greeting, starters, avatar, modelProfile, the grants defaults, and `goalDefaults`.
- `digest` and `signature` are added by the registry.

A complete bot is a `kind: bot` package whose dependencies are its extensions.

## 4. Registry API (8789)

- `GET /v1/packages?q=&kind=&scope=&cursor=`
- `GET /v1/packages/:id`
- `GET /v1/packages/:id/:version`
- `GET /v1/packages/:id/:version/tarball`
- `POST /v1/resolve {deps}` returns a lock: a list of `{id, version, digest}`.
- `POST /v1/packages`: multipart upload. The registry stores the package as `pending`, runs review, signs it with Ed25519 if it passes, and makes it visible to the owner.
- `POST /v1/packages/:id/:version/{visibility,yank}`
- `GET /v1/blocklist`
- `GET /v1/renames`
- Compatibility shims `GET /v1/plugins/` and `/v1/plugins/:name/install/` (a tgz with an ETag sha256). With these, a sandbox can point `platform.baseUrl` at the registry for the existing `assistant plugins install` path. This happens only after the other `platform.baseUrl` uses are checked; otherwise the setting goes under a new key, `extensions.registryUrl`, in cli/lib.

**API proxy for the app:**
- `GET /v1/store`, `GET /v1/store/:id`
- `POST /v1/bots/:id/packages {id, range}`
- `DELETE /v1/bots/:id/packages/:pkg`
- `POST /v1/publish-requests/:id/{approve,reject}`

The API writes `bot_packages`, calls resolve, stores `bot_locks` and bumps `bot.version`.

## 5. Sandbox install and isolation

The `BotProfile` sent to the sandbox gains `lock` and `grants`. `applyBotProfile` in drivers/harness.ts runs these steps before boot. It skips them when `.anu-bot-version` equals `bot.version`.
1. For each lock entry, fetch from the cache, or download it and verify the digest and the registry signature. A package on the blocklist fails closed.
2. Hardlink or copy the files into `<ws>/plugins/<name>` and `<ws>/skills/<id>`. Do not use symlinks, because the realpath containment checks reject them. Merge the MCP entries into `<ws>/mcp.json`.
3. Write a `.disabled` sentinel for each default plugin the bot excludes and a `.removed` sentinel for each removed core tool. Set `skills.entries` in the config.
4. Write the IDENTITY.md and SOUL.md that come from the bot package.

After boot, the sandbox applies these:
- the threshold, through `PUT /v1/permissions/thresholds/conversations/{id}`
- the inference profile
- the bot's vault secrets, replayed into the session's CES through `POST /v1/secrets` together with their `allowedDomains` and `allowedTools` metadata

Isolation follows from three facts: one workspace and one CES per session, each workspace built only from its own bot's lock, and a vault that is keyed by bot. Nothing is installed globally. The sandbox polls the blocklist; a hit quarantines the package (disables it and marks the bot as stale).

**Sandbox limits:** each worker runs as its own uid, gets cgroup CPU, memory and pids caps, and has an egress proxy. The proxy allowlist is the union of the declared `network` hosts and the bot's default allowed hosts.

## 6. Harness changes (minimal)

- **`anu-goal`:** a new default plugin in assistant/src/plugins/defaults, self-contained. Details in section 8.
- **Skills, not core tools:**
  - `anu-extension-author` extends the plugin-builder references: author, test, package.
  - `anu-bot-builder`.
  - `anu-onboarding`.

  Their scripts call `assistant` CLI commands and the sandbox-local endpoint `ANU_SANDBOX_URL`. No new non-skill tool is registered.
- **`packages/anu-pack`:** a small script that tars a plugin directory and writes its manifest and digest.
- **No new approval modes.** The secret path reuses `SecretPrompter` and `POST /v1/secret`.

## 7. Agent-written extensions and the bot builder

**Self-extension:**
1. The agent writes the code under `<ws>/plugins/<name>` (or `skills/<id>`). Hot reload loads it into this session only.
2. The agent tests it in the session.
3. It runs `anu-pack`, then POSTs the result to the sandbox at `/internal/sessions/:id/publish-request`. The sandbox forwards it to the API, which creates a `publish_requests` row and stores the tarball in staging.
4. The chat shows a preview card with the name, a diff summary, the capabilities and the review result. Publishing goes ahead only when the user taps Approve in the app; the sandbox can never publish on its own.
5. On approve, the API uploads the package to the registry as private, with `origin: agent`.

**Bot builder** (`POST /v1/bots/build {description, locale}`; it replaces the current draft job):
1. The API creates a build session in a throwaway workspace that has the `anu-bot-builder` skill.
2. The model writes a plan: persona fields, then the needed capabilities, then a search of the store through the skill script (`GET store?q=`, results returned as data). The plan has three parts: `reuse` (package ids), `create` (specs) and `grants`.
3. For each item in `create`, the model writes and tests an extension in the same workspace and packs it as a staged package. Nothing is published yet.
4. The final reply is a fenced `anu-bot-plan` JSON block, which the API validates with zod. Progress streams over SSE as `build.step` events: searching, reusing X, writing Y, testing Y, done.
5. The phone shows a review screen: the persona, an Installed list (store packages), a Made for you list (new packages, each with code size and capabilities) and a permissions summary.
6. On confirm, the API publishes the created packages privately, creates the bot package, resolves the lock and creates the bot. The user can edit any part or remove an item, and nothing is saved until confirm.

## 8. /goal

**Commands:** `/goal <text>`, `/goal`, `/goal draft`, `/goal pause|resume|clear`, with Arabic aliases. The API stores the contract and the budget (default 20 turns and 120 minutes, plus a token cap). The agent may propose a goal in chat, but only the user's tap or command activates it.

**Mechanism:** the `anu-goal` plugin reads `<ws>/.anu/goal.json`, which the sandbox writes. On `stop` with a clean exit reason it schedules a check, without blocking the hook:
1. Run the gates (shell checks in the workspace).
2. Run the judge through `getConfiguredProvider` (callSite `inference` with a small profile), which returns `{verdict continue|done|blocked|wait, reason, progress[]}`.
3. On `continue`, call `runConversationTurn` with a synthetic continuation message that carries the reason.

**Guards:** the judge fails closed (3 errors pause the goal). Three turns without tool use pause it. The budget leads to one wrap-up turn and then `budget_limited`. A real user message preempts the continuation. A pending approval or secret request sets `waiting_approval` or `waiting_secret` and stops the clocks. The goal never changes thresholds or grants.

**Reporting:** state and progress go out through `publishEvent`, then to the sandbox and on to the API as `goal.updated` on the SSE stream, and are written to `goal_events`. `achieved` requires the gates to pass and the judge to say done.

**Endpoints:** `POST/GET /v1/sessions/:id/goal`, `POST /v1/goals/:id/{pause,resume,clear,confirm-draft}`, `GET /v1/goals/:id/events`. A goal can be promoted to a Task.

## 9. Permissions and Permission controls v2

The per-bot screen controls capabilities. It does not add approval modes:
- **What the bot has:** installed packages, which the user can Remove.
- **Removed core tools** (via `.removed`).
- **Network hosts.**
- **Secrets:** names only, each with Delete.
- **Model.**
- **"When it asks":** the existing gateway threshold, shown as three plain choices. High is not offered for tasks.

There are no per-tool always-allow rules, no timed grants and no trust lists. Installing a package is a user action in the app, gated the same way as the host-computer gate. Inside chat, the agent's install, publish and goal proposals are cards the user taps. When an update grows a package's capabilities, the user is asked to confirm again. Runtime approvals keep the current path: `confirmation_request`, then the API approval card, then `/v1/confirm`.

## 10. Secret box, end to end

1. A skill runs `assistant credentials prompt`. The harness emits `secret_request` with metadata only.
2. In `harness-turn.ts`, the decline is replaced with `ctx.requestSecret`. The sandbox sends the protocol message `{t:"secret_request"}`, and the API stores a metadata row and sends an SSE item.
3. The phone opens the Secure box sheet: password input, `FLAG_SECURE` and `isSecureTextEntry`, and the line "the agent never sees this".
4. The phone sends `POST /v1/sessions/:id/secrets/:reqId {value}`. The API streams the value to the sandbox and never persists or logs it; pino redaction covers this route.
5. The worker calls `POST /v1/secret {delivery:"store"}`, then `persistPromptedCredential` stores the value in CES. The sandbox also seals a copy into the bot vault. The model sees only "stored".
6. A secret pasted into chat is blocked by `blockIngress`, and the API's pattern check opens the box instead.

## 11. First-run onboarding

The trigger is the first login with `onboarded_at` null. The phone opens `/anu/welcome`, a chat with the default ANU bot that has the `anu-onboarding` skill active. The skill's script outline is about 6 short turns, in the user's locale (ar or en):
1. Greeting plus three sentences: ANU is your personal agent; bots are helpers you shape; chats and tasks; /goal keeps working until done; extensions add abilities; it asks before acting and keys go in the secure box.
2. Question chips: what do you want help with (study, work, shopping, research, other).
3. Question: tone (friendly, brief, formal).
4. Question: what may it do alone (only answer, browse and draft, act after asking).
5. Optional: name your bot.
6. The bot builder runs (section 7). The build progress and review screens are reused, and Confirm or Adjust follows.

Skip on any screen sets `onboarded_at` and keeps the default ANU bot. Redo is under Settings, "Set up again". The endpoints are `POST /v1/onboarding/{start,skip,complete}`; start returns a session id. The splash shows Stellar on white with "ANU" in black, and the app icon shows Stellar on white.

## 12. Phone screens

- **Store:** search, kind tabs, cards with a verified or "Made by your bot" badge.
- **Extension detail:** description rendered as plain text, capability rows (risky ones highlighted), secrets needed, dependencies, versions.
- **Install sheet:** pick the bot, review the capabilities, Install.
- **Build progress and review** (section 7).
- **Goal bar:** collapsed it shows the objective, a chip and n/max. Expanded it shows the checklist, the evidence, the budget meters, and Pause and Clear.
- **Bot permissions screen.**
- **Secure box sheet.**
- **Publish request card.**

## 13. Security

- **Signing and integrity:** the registry signs `digest||manifest` with Ed25519, and the sandbox pins the public key. Versions are immutable. The blocklist forces quarantine.
- **Review:** a manifest schema check, a static scan (undeclared network calls, `child_process` without `shell: true`, credential APIs outside the declared services), a secret scan, and a dry run in a scratch sandbox with egress denied. Packages written by the agent stay private unless the user makes them public, and making them public requires review.
- **Prompt injection:** descriptions are never put into prompts. Builder search results go to the model as quoted data with length caps. Package ids follow a strict regex.
- **Limits:** plugins run in-process with the session daemon, so the worker uid, cgroups and the egress proxy are the boundary. One session, one bot.
- **Goal:** budgets plus fail-closed guards.

## 14. Build plan

1. Registry server, manifest schema, `anu-pack`, signing, resolve.
2. Sandbox materialization, cache, sentinels, the bot lock in BotProfile, API store endpoints, store and install screens.
3. Secret box and bot vault.
4. `anu-goal` plugin, goal API and goal bar.
5. Bot builder skill, build screens, publish requests, review pipeline.
6. Onboarding skill and screens, redo and skip.
7. Hardening: blocklist polling, egress proxy, rescans.

---

# Option C: pi-style self-extending bots

In this design the agent is the main author of extensions. Every bot has its own dev area. There the agent writes an extension, reloads it, tests it, packs it and asks to publish it. The marketplace is a thin catalog that lists those same packages. /goal drives the long builds.

## 1. Processes

| Process | Port | Role |
|---|---|---|
| Phone app (clients/web /anu/*, Capacitor) | none | Thin client |
| ANU API (anu/src/api) | 8787 | Auth, bots, sessions, goals, secret metadata, publish approvals. It proxies the registry for the app. |
| Sandbox (anu/src/sandbox) | 8788 | Per-session harness workers, per-bot install, dev area, review runner, bot vault |
| Registry (new, anu/src/registry) | 8789 | Package store, search, resolve, signing, blocklist. Only the sandbox (service token) and the API (user token) can reach it. |

## 2. Package format (`anu.package.json` at the tarball root)

```json
{"schema":"anu.package/1","id":"u.<userId>/weather-brief","kind":"bot|skill|plugin|mcp|prompt",
 "version":"1.0.0","displayName":{"en":"","ar":""},"description":{"en":"","ar":""},
 "license":"MIT","engines":{"anu":">=0.4.0"},"origin":"human|agent",
 "provenance":{"botId":"","sessionId":"","sourceDigest":"sha256:","reviewId":""},
 "contents":{"plugins":["plugins/weather/"],"skills":["skills/weather/"],"prompts":["prompts/*.md"]},
 "bot":{"identity":"IDENTITY.md","soul":"SOUL.md","modelProfile":null,"threshold":"low","goalDefaults":{"maxTurns":20}},
 "dependencies":{"u.anu/web-search":"^2.0.0"},
 "capabilities":{"network":["api.open-meteo.com"],"shell":false,"browser":false,"schedules":false,"filesystem":"workspace"},
 "secrets":[{"service":"openmeteo","field":"api_key","label":{"en":"API key","ar":"مفتاح"},"allowedDomains":["api.open-meteo.com"]}]}
```

- **Tools** ship only as plugin `tools/*.ts` or as skill `TOOLS.json`. They never become core registry tools (assistant/src/tools/AGENTS.md). MCP servers ship as a plugin's `mcp.json`.
- **Paths** stay inside the package root.
- **Descriptions** are display data only. They never enter a prompt.
- **Integrity**: the registry stores the sha256 of the tarball and signs `{id, version, digest, capabilities}` with ed25519. A version can never be republished.

## 3. Data model

**API Postgres (migration 0005_extensions.sql)**
- `bot_packages`: `bot_id, package_id, range, locked_version, digest, enabled, installed_by (user|builder|agent)`.
- `bots`: gains the columns `lock_digest` and `threshold`.
- `publish_requests`: `id, user_id, bot_id, draft_id, manifest jsonb, review jsonb, state (pending|approved|rejected|expired)`.
- `goals`: `id, user_id, bot_id, session_id, task_id, contract jsonb, state, turns_used, tokens_used, started_at, ended_at, last_reason, created_by`.
- `goal_events`: `goal_id, turn, verdict, reason, progress jsonb, gate_results jsonb, tokens, at`.
- `secret_requests`: `id, session_id, bot_id, service, field, label, purpose, allowed_domains, state`. This table holds metadata only, never a value.
- `onboarding`: `user_id, state (not_started|in_progress|done|skipped), session_id, bot_id, answers jsonb`.

**Registry (its own database, SQLite or a separate Postgres schema)**
- `packages`: `id, owner_user_id, scope (private|unlisted|public), kind`.
- `versions`: `package_id, version, manifest, digest, signature, review_status, yanked, created_at`.
- `blobs`: content-addressed storage.
- `blocklist`: `package_id, version_range, reason`.
- `renames`.

**Sandbox, outside every workspace**
- `vault/`: AES-256-GCM blobs keyed by `(user, bot, service, field)`. The key comes from `ANU_VAULT_KEY`.
- `cache/<digest>/`: unpacked packages.

## 4. Registry API (8789)

- `GET /v1/packages?q=&kind=&scope=&cursor=`
- `GET /v1/packages/{id}`
- `GET /v1/packages/{id}/{version}` returns the manifest, digest, signature and review status.
- `GET /v1/packages/{id}/{version}/tarball`
- `POST /v1/resolve {deps}` returns a lockfile `[{id, version, digest, signature}]`.
- `POST /v1/drafts`: the sandbox uploads a packed draft. It is visible only to its owner, and the response includes a review id.
- `POST /v1/drafts/{id}/promote`: API only, after the user approves.
- `POST /v1/packages/{id}/{version}/yank`
- `GET /v1/blocklist`
- `GET /v1/renames`

The API exposes `/v1/marketplace/*` to the app. It filters what it proxies by the user's scope and adds an "installed in bot X" flag.

## 5. Sandbox install and isolation

1. When a session worker starts with `bot`, `applyBotProfile` (drivers/harness.ts) compares `lock_digest` with `<ws>/.anu-bot-version`.
2. If they differ, it fetches each lock entry into `cache/<digest>` and checks the digest and the registry signature. Any entry on the blocklist aborts the start with a "needs attention" item.
3. It copies the files (no symlinks, because containment uses realpath) into `<ws>/plugins/<name>` and `<ws>/skills/<id>`.
4. It writes `.disabled` for each default plugin the bot excludes and sets `tools.exclude` for each core capability the bot lacks.
5. It applies the bot's threshold through the per-conversation override.
6. It replays the bot's vault secrets into this session's CES with `POST /v1/secrets`, together with their allowedDomains and allowedTools metadata.
7. Each session has its own workspace and CES, and the vault replays only the secrets of that bot, so nothing crosses between bots.
8. Network capabilities are enforced as an egress allowlist on the worker process (sandbox env proxy). This is a boundary, not an approval prompt.

## 6. Self-extension loop (core of this option)

**Dev area.** Each bot has `<bot-dev>/<botId>/` on the sandbox host. It is mounted into that bot's sessions as `<ws>/dev/`, and other bots never see it.

**Skill `anu-extension-author`.** This is a first-party skill that extends `plugin-builder`, not a new tool. It teaches the agent to:
1. Scaffold `dev/<name>/` with `anu.package.json`, declaring capabilities and secrets honestly.
2. Copy the scaffold into `<ws>/plugins/<name>`. The existing `reconcilePluginSourcesNow` hot reload picks it up on the next turn, so no daemon restart is needed.
3. Write tests under `dev/<name>/test/` and run them with `bash` in the workspace.
4. Run `anu-pack dev/<name>`, a script shipped inside the skill. It produces a tarball and its digest and POSTs them to the sandbox's local `/internal/drafts`. The sandbox forwards the draft to the registry. The worker never holds a registry token.
5. Tell the user in chat what it built and ask whether to publish.

**Review pipeline** (sandbox, before the publish card is shown):
- A static scan: denylisted APIs (`child_process` outside declared shell, raw `fetch` to undeclared hosts, reads outside the plugin root, `resolveCredential` for undeclared services), secret patterns copied from security/secret-patterns.ts into ANU code, and minified or obfuscated code.
- A **capability diff**: what the package declares against what the code uses.
- A **sandbox test run**: a throwaway workspace with no vault secrets and network limited to the declared domains. It runs the package tests and records syscalls and egress.
- An **LLM summary** of what the code does: a harness turn in a throwaway workspace (the same pattern as the bot draft job, so there is no LLM call outside assistant/). It is given the source as quoted data with an instruction to ignore embedded instructions.

The review JSON travels with the draft as `{findings, capabilityDiff, testResult, summary}`.

**Publish.** The card shows the plain-language summary, the capabilities, the findings and the test result. Approve calls `POST /v1/publish-requests/:id/approve`, then the registry promotes the draft to `private`. Making a package public needs a second explicit action and passes a registry review queue. Any finding of "high" severity blocks Approve until the agent fixes it.

## 7. Bot builder

The flow starts with `POST /v1/bots/build {description, locale}` and runs as a sandbox job in a throwaway builder workspace.

1. **Draft the profile** (name, role, persona, instructions) as in phone-app.md B.2.
2. **Plan**: the model lists the capabilities it needs and searches the registry through a skill script (`anu-market search`).
3. **Reuse** the matching packages. Each choice cites the reason it was picked.
4. **Create what is missing** through the authoring loop in a `/goal` scoped to the builder session, with the contract "package X passes its tests and review". The budget is 12 turns.
5. **Assemble** a `kind: bot` draft with dependencies, then call `/v1/resolve` to get the lockfile.
6. **Stream progress** over SSE as `build.step` events.
7. **Confirm**: a sheet lists the profile, each package (reused or new), the union of capabilities and the needed secrets. Confirming the sheet is the publish approval for the new packages and the install. The user can remove items or edit fields first.

## 8. /goal

**Commands**
- `/goal <text>`, `/goal`, `/goal draft <text>`, `pause`, `resume`, `clear`.
- Arabic aliases: هدف, إيقاف, استئناف, مسح.
- The agent can propose a goal, but only the user starts one.

**Contract**: objective, verification, constraints, gates (shell commands), budget (maxTurns 20, maxTokens, maxWallMinutes 120).

**States**: drafting, pursuing, waiting_approval, waiting_secret, paused, achieved, blocked, budget_limited, cleared.

**Where the loop runs.** The sandbox owns it (`anu/src/sandbox/goals.ts`), so assistant/ needs no change. After each `runTurn` it:
1. Runs the gates in the workspace.
2. Runs the judge as a harness turn on a separate hidden conversation with a small inference profile. Inside the harness that call goes through getConfiguredProvider. The judge returns `{verdict, reason, progress[]}`.
3. On `continue`, submits a synthetic user message: "Continue toward the goal. Judge says: <reason>".

**Rules**
- The judge fails closed: 3 errors pause the goal.
- 3 turns with no tool use pause the goal.
- A pending approval or secret request suspends the goal and its clocks.
- A real user message always takes priority over the queued continuation.
- At the budget limit the agent gets one wrap-up turn, then the goal pauses.
- A goal never changes the bot's threshold or capabilities.
- A goal can be promoted to a Task so it keeps running without the chat open.

**API**: `POST|GET /v1/sessions/:id/goal`, `POST /v1/goals/:id/{pause,resume,clear,confirm-draft}`, `GET /v1/goals/:id/events`, and SSE `goal.updated`.

## 9. Permissions and Permission controls v2

The per-bot permissions screen shows **what the bot has**, not approval modes:

- Installed packages, each with plain-language capability rows and a Remove button.
- Secret names, with a Delete button.
- Network domains, as the union of the bot's package capabilities.
- Model.
- A "when it asks me" choice: Often or Sometimes. This is one plain-words choice written as the existing per-conversation threshold override; "high" is never offered for unattended runs.

What this design does not add: per-tool always-allow rules, timed grants, or trust lists. "Don't ask again" requests are handled in chat.

Why this fits v2: installing and removing are capability filters (a tool that is absent cannot run) and boundaries enforced by the sandbox. Publishing and installs the agent proposes are chat cards the user taps. Harness approvals keep their path unchanged: `confirmation_request`, then the approval card, then `/v1/confirm`. If an update increases a package's capabilities, the update is held until the user confirms the diff sheet.

## 10. Secret Box

1. A skill runs `assistant credentials prompt` or calls `requestSecret`. The harness emits `secret_request`, which carries metadata only.
2. `drivers/harness-turn.ts` stops declining these requests and sends `{t:"secret_request", ref, service, field, label, purpose, allowedDomains}` (added to protocol.ts).
3. The API inserts a metadata-only row and emits an SSE item of kind `secret_request`.
4. The phone shows the "صندوق آمن / Secure box" sheet:
   - a password input with autocomplete off;
   - iOS `isSecureTextEntry` and Android `FLAG_SECURE`;
   - the line "The agent never sees this."
5. `POST /v1/sessions/:id/secrets/:requestId {value | cancel}`. The API streams the value to the sandbox at `/internal/sessions/:id/secrets` and never persists or logs it (pino redaction).
6. The worker calls `POST /v1/secret {requestId, value, delivery:"store"}`, and `persistPromptedCredential` writes the value to CES. The sandbox also seals a copy into the bot vault. The model sees only "stored".
7. Values pasted in chat are still blocked by `blockIngress`, and the API also refuses messages that match the secret patterns and opens the box instead.
8. Packages the agent writes reach secrets only through the broker's domain-bound injection. The review scan flags any code that echoes a credential into a tool result.

## 11. First-run onboarding

**Trigger.** On the first successful OTP sign-up, `onboarding.state` is `not_started`, so the app routes to `/anu/welcome`.

**Branding.** The splash is Stellar on white with "ANU" in black. Onboarding uses the same white canvas with Stellar at the top.

**Flow.** `POST /v1/onboarding/start {locale}` creates a session with the default ANU bot and an onboarding skill. The skill holds the script as model instructions, so it does not grow the system prompt.

1. **Intro (2 short bubbles).** "I'm ANU, your personal AI agent. Tell me what you need and I get it done." Then a plain explanation of: bots (helpers with their own tools), chats, tasks that run on their own, /goal, extensions, approvals ("I ask before risky things") and the Secret Box ("passwords go in a locked box I never see").
2. **Q1.** What do you want help with most? Chips: work, study, shopping, research, coding, other, plus free text.
3. **Q2.** How should I talk to you? Chips: brief, friendly, formal.
4. **Q3.** What may I do without asking? Chips: just read and search, also make files, ask me every time. This maps to the threshold.
5. **Q4 (optional).** Any apps or sites you use daily?
6. **Build.** The model emits `anu-bot-build` with the answers. The API calls `/v1/bots/build`, so it is the same builder (section 7). The progress screen shows step chips.
7. **Confirm sheet.** The user can Confirm, Adjust (which returns to chat with the model) or Redo.

**Skip, redo and API**
- Skip is available on every screen. It sets `skipped` and gives the user the default bot.
- Settings has "Redo setup", which calls `POST /v1/onboarding/restart`.
- API: `GET /v1/onboarding`, `POST /v1/onboarding/{start,answer,complete,skip,restart}`. Answers are stored for redo.
- Both Arabic and English are supported. The script follows the user's locale.

## 12. Phone screens

1. **Marketplace**: search, kind tabs, "Made by your bots" and "Installed" filters, cards with a verified or agent badge.
2. **Extension detail**: description shown as plain text, capability rows (risky rows tinted), secrets, dependencies, versions and changelog, and the review summary.
3. **Install sheet**: pick the target bot, see the capabilities and Install. On an update, a diff sheet.
4. **Publish card in chat**: summary, findings, test result, Approve or Not now.
5. **Bot builder progress**: a step timeline and the confirm sheet.
6. **Goal bar**: pinned and collapsible. It shows the checklist with evidence, budget meters, Pause and Clear, and the draft card.
7. **Bot permissions**: section 9.
8. **Secret Box sheet**: section 10.
9. **Onboarding**: section 11.

## 13. Security summary

- **Signing and integrity**: ed25519 registry signatures, digest checks at install, immutable versions.
- **Blocklist**: polled every 10 minutes. A blocked package is quarantined, which means it is removed from the workspace and the bot is flagged.
- **Agent-written code**:
  - It runs only in that bot's workspace.
  - It never receives other bots' secrets.
  - It passes the review pipeline before publish.
  - It cannot publish without a user tap.
  - The worker has no registry credentials.
- **Prompt injection**: package text is never put into a prompt. The LLM review treats source as data.
- **Runaway /goal**: turn, time and token budgets, the no-progress guard and fail-closed judging.
- **Licenses**: pi is MIT, so its patterns can be reused with attribution. Dependencies use exact versions.

## 14. Phases

1. **P1**: Secret Box end to end, plus the bot vault.
2. **P2**: Registry 8789 (store, resolve, sign), lockfile install in `applyBotProfile`, marketplace screens.
3. **P3**: The authoring skill, dev area, pack script, review pipeline and publish card.
4. **P4**: The /goal loop in the sandbox, the judge, and the goal UI.
5. **P5**: The bot builder (reuse plus create) and the permissions screen.
6. **P6**: Onboarding, public scope review queue, blocklist polling.
