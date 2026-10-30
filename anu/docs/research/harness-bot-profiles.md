# Harness inventory for bot profiles

BOT PROFILE INVENTORY. All paths are relative to (local path) Read-only; nothing was changed.

KEY FACT: anu/src/sandbox/drivers/harness.ts (withRuntime) boots one full assistant per task or session. It writes the workspace at <ctx.workspaceDir>/harness/.vellum/workspace (VELLUM_WORKSPACE_DIR), then configures it over gateway HTTP through client.call(...). It already sends POST /v1/secrets, POST /v1/inference/provider-connections, POST /v1/inference/profiles ("kilo-free") and POST /v1/config/set {path:"llm.activeProfile"}. Every turn goes to POST /v1/messages {conversationKey:"anu-<id>", inferenceProfile} (drivers/harness-turn.ts:232-245). Each session has its own workspace, so the workspace-global harness settings below are effectively per bot.

(1) BOT PROFILE FIELDS AND THE HARNESS MECHANISM BEHIND EACH

a. Name, emoji, role, personality -> IDENTITY.md (template: assistant/src/prompts/templates/IDENTITY.md; fields Name/Emoji/Nature/Personality/Role plus an Avatar section).
- Read by GET /v1/identity (assistant/src/runtime/routes/identity-routes.ts, getIdentity).
- Injected into the system prompt by assistant/src/prompts/system-prompt.ts (PROMPT_FILES = IDENTITY.md, SOUL.md; buildCoreIdentityContext).
- How to apply: write the file before boot, or after boot with POST /v1/workspace/write {path:"IDENTITY.md", content} (runtime/routes/workspace-routes.ts:601).
- Pre-writing it is better. ensurePromptFiles() (system-prompt.ts:121) only copies templates when a file is missing. When IDENTITY.md or SOUL.md already exists, isFirstRun is false and BOOTSTRAP.md (the onboarding interview) is not seeded. That is what a ready-made bot wants.
- Caution: an IDENTITY.md that still matches the template is skipped (isTemplateContent).

b. Persona and instructions -> SOUL.md, which is always included in the prompt. Template: prompts/templates/SOUL.md. It carries the Boundaries and How You Work sections.
- Do not replace the whole file, or the safety and length rules are lost.
- Write the bot's instructions as a section appended to the template text (for example "## This bot"). Apply it the same way as IDENTITY.md.
- Per-user tone goes in users/<slug>.md and users/default.md, resolved by prompts/persona-resolver.ts. That is the guardian or user persona, not the bot, so leave it alone.

c. Avatar traits (bodyShape, eyeStyle, color) -> the harness avatar store: assistant/src/avatar/avatar-store.ts setCharacter() writes traits.json, the PNG and avatar.json.
- Route: POST /v1/avatar/render-from-traits {bodyShape, eyeStyle, color} (runtime/routes/avatar-routes.ts:458).
- The ids are the same packages/avatar-catalog ids that anu/src/api/agents.ts already uses (BODY_SHAPES, EYE_STYLES, AVATAR_COLORS).
- The phone renders the avatar from traits itself, so this call only keeps the harness's own view of itself consistent (identity-avatar.ts, avatar/get). Calling it is optional but cheap.

d. Model -> llm.profiles and llm.activeProfile.
- Routes: POST, PUT and DELETE /v1/inference/profiles[/:name], plus /v1/inference/active-profile (runtime/routes/inference-profiles-routes.ts:934-1063).
- Generic config writes: POST /v1/config/set.
- Per conversation: PUT /v1/conversations/:id/inference-profile {profile} (conversation-management-routes.ts:1005), or the inferenceProfile field on /v1/messages, which the driver already sends.
- Schema: assistant/src/config/schemas/llm.ts. Resolution: config/llm-resolver.ts. Seeded profile names: config/seed-inference-profiles.ts.
- The bot should store a profile NAME. The driver then passes it instead of the hard-coded PROFILE constant. The kilo-free connection stays as the base.

e. Skills -> skills.entries[id].enabled in workspace config.json.
- Code: daemon/handlers/skills.ts:1145 enableSkill() and disableSkill().
- Routes: POST /v1/skills/:id/enable, POST /v1/skills/:id/disable, /v1/skills/:id/config. List with GET /v1/skills; also skills/search and skills/install.

f. Plugins:
- Workspace level: /v1/plugins/:name/enable and /v1/plugins/:name/disable (runtime/routes/plugins-routes.ts:2132, 2167).
- Per conversation: PUT /v1/conversations/:id/enabledplugins {enabledPlugins: string[] | null} (conversation-management-routes.ts:1040). This is the cleanest per-bot plugin set.

g. Tools to hide -> tools.exclude: string[] (config/schemas/tools.ts). Apply with POST /v1/config/set {path:"tools.exclude"}.
- This is a capability filter, not a new approval mode, so it is consistent with Permission controls v2.

h. Starters -> no direct mechanism. See gap 1.

i. Channels and contacts (/v1/contacts, contact-channels/:id, contact-prompt-routes.ts) belong to the user, not the bot. Keep them out of bot profiles.

j. Multiple assistants (cli/src/commands/hatch.ts, species, --name, ~/.vellum.lock.json) are machine-level instances. The ANU sandbox already gets the same result: one isolated instance per session. Do not map bots onto species or lockfile entries.

(2) WHERE THE MAPPING SHOULD LIVE IN ANU

DB: new migration anu/db/migrations/0004_bots.sql.
- Table bots: id, user_id (null for built-in defaults, or a separate is_default flag), name, emoji, role, personality, instructions (text, size-capped), body_shape, eye_style, color, model_profile (text, null = default), skills text[], plugins text[], excluded_tools text[], starters jsonb (array of {label, prompt}), timestamps. Same RLS pattern as agents.
- Add chat_sessions.bot_id (references bots).
- Agents are currently made by insertAgent (anu/src/api/agents.ts, random identity). Use the bot's name and traits instead when bot_id is set.

API: new anu/src/api/bots.ts.
- CRUD /v1/bots, plus POST /v1/bots/draft (one-sentence description -> profile).
- POST /v1/sessions accepts bot_id.
- Document it in anu/openapi.yaml and anu/docs/api.md.

Sandbox:
- Extend the "session" ParentMessage in anu/src/sandbox/protocol.ts with an optional bot: BotProfile, threaded through sessions.ts spawn() and the sandbox-client.
- In drivers/harness.ts, add applyBotProfile(workspace, client, bot) inside withRuntime:
  - Before spawning the daemon: write IDENTITY.md and SOUL.md (the template plus the bot section) into `workspace`. The daemon reads them at prompt build, and pre-writing them prevents BOOTSTRAP onboarding.
  - After readiness: call render-from-traits, skills enable/disable, tools.exclude via config/set, and enabledplugins on the conversation.
  - Pass bot.modelProfile ?? PROFILE as inferenceProfile in runTurn.
- Make it idempotent, because a resumed session reboots on the same workspace. Overwriting the files on every boot is fine while the bot stays the source of truth. If the assistant's own edits to SOUL.md must persist, write only when a hash of the bot profile has changed (store it in a sidecar file).
- Put the shared BotProfile type in anu/src/sandbox/drivers/types.ts (SessionContext.bot).

(3) GAPS AND THE LEAST INVASIVE FIX

1. Starters. Harness conversation-starters (persistence/schema/conversation-starters.ts; routes conversation-starters GET and DELETE only) are generated from memory by a background job (home/job-handlers/conversation-starters.ts). There is no API to set them. Keep bot starters in ANU (bots.starters) and render them client-side. Do not change the harness.
2. Profile from one sentence. There is no harness endpoint for this. LLM calls in assistant/ must go through getConfiguredProvider, so do not add one there. Options:
   (a) call the model from anu/src/api directly. This needs approval, because anu does no LLM calls today.
   (b) run it as a single harness turn in a throwaway sandbox: "return JSON {name, emoji, personality, instructions, traits, starters}", then validate with zod. This reuses the kilo profile.
   (b) is least invasive. Always offer an editable form after the draft.
3. Model choice on the phone. Profiles exist per workspace, but each sandbox only has kilo-free. Expose a small ANU allowlist of profile names that the driver creates through POST /v1/inference/profiles on the existing kilo connection. Never take free-form provider config from users.
4. Persona per conversation. The harness has no per-conversation system-prompt override in its routes; systemPromptOverride exists only internally, for subagents and wake. Workspace-per-session already isolates it, so do not add a route. This becomes a real gap only if one runtime ever serves several bots, and then the fix would be one harness instance per bot workspace, not a new override.
5. Skill ids for the picker. Read GET /v1/skills from a running sandbox, or ship a curated allowlist in ANU. Unknown ids should fail validation at create time.
6. Default bots. Seed them as rows with user_id null (migration), each with curated instructions. User-facing labels go in clients/web/src/i18n catalogs including ar. The instruction text stays in the DB and is not translated.

Rules to follow: no em dashes in the seeded text, phones 555-01xx in fixtures, keep the appended SOUL section short (system prompt minimalism), and do not commit.
