# pi extension system research

PI (badlogic/pi-mono, packages/coding-agent) RESEARCH FOR ANU

Source: shallow clone at (scratch path) (commit e5c6182, 2026-10-30). I read it and never ran it. The package is now published as `@earendil-works/pi-coding-agent` v1.4.0 (the legacy `@mariozechner/*` names still map to it). Earendil acquired the project, so the docs link to github.com/earendil-works/pi. Main files: packages/coding-agent/docs/{extensions,packages,skills,prompt-templates,security,sessions,rpc-extension-ui}.md, src/core/extensions/types.ts, src/core/system-prompt.ts. Web: https://github.com/badlogic/pi-mono, https://pi.dev/packages, https://agentic-ai.readthedocs.io/en/latest/AgentHarness/pi-dev/, https://urandom.io/blog/2026-03-07-pi-dev-deep-dive

1. EXTENSION MODEL
- Unit: a TS or JS module whose default export is a factory `(pi: ExtensionAPI) => void | Promise<void>`. It is loaded with jiti, so no build step is needed. Pi maps the host imports (pi-coding-agent, pi-agent-core, pi-ai, pi-tui, typebox) onto its own copies, so all extensions share one set of classes and registries (see virtual-modules.ts, jiti-loader.ts).
- Discovery locations:
  - global: `~/.pi/agent/extensions/*.ts`, `*/index.ts`, or `*/package.json` with a `pi.extensions` field
  - project: `.pi/extensions/` (loads only after the user grants "project trust")
  - extra paths, `npm:`/`git:` packages and `builtin:<name>` entries listed in settings.json
  - `-e path|npm:` for a one-off test
- Manifest: there is no separate manifest file. It is the `pi` key in package.json: `extensions`, `skills`, `prompts`, `themes` (globs and `!` exclusions are allowed), plus `changelogPath`, `image`, `video` (gallery previews). Conventional directories (extensions/, skills/, prompts/, themes/) work without the key. The npm keyword `pi-package` makes a package appear in the pi.dev gallery. Host packages go in `peerDependencies: "*"` and runtime dependencies go in `dependencies`. Each package gets its own module root.
- Runtime lifecycle:
  - Startup: project_trust, then factory, then session_start(reason startup|reload|new|resume|fork), then resources_discover.
  - Per prompt: input, then before_agent_start, then agent_start, then turns, then agent_end, then agent_before_settle (can append entries and request ONE continuation), then agent_settled (final idle).
  - Per turn: turn_start, then context, context_with_system, before_provider_headers/request, after_provider_response, message_*, then per tool call tool_execution_start, tool_call (can block or mutate input, can set `terminate`), tool_result (can rewrite the result), tool_execution_end, then turn_end (can append entries and request a continuation).
  - Session events: session_before_switch, session_before_fork, session_before_compact, session_before_tree (each can cancel), session_shutdown, model_select, user_bash, ui_prompt_start/end, mcp_servers_change.
  - Handlers run in load order, then registration order. Each event has a defined composition rule: notification, mutate in place, chained transform, gate, or last override.
- ExtensionAPI surface:
  - Events and tools: `on`, `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`/`getFlag`, `getActiveTools`/`getAllTools`/`setActiveTools`.
  - Messages and session: `sendMessage`, `sendUserMessage` (with `expandPromptTemplates` it dispatches a /command), `appendEntry` (durable state that never reaches the model), `setSessionName`, `setLabel`.
  - Process and model: `exec`, `setModel`, `setThinkingLevel`, `registerProvider`/`unregisterProvider`, `registerVirtualModel`.
  - MCP: `registerMcpServer`/`unregisterMcpServer`/`getMcpServers`.
  - Other: renderers, `events` (an inter-extension bus), `getSettings`.
- ctx (ExtensionContext):
  - `ui` (select, confirm, input, editor, notify, setStatus, setWidget, custom)
  - `mode`, `hasUI`, `cwd`
  - `sessionManager` (read-only tree), `modelRegistry`/`model`
  - `signal`, `abort`, `isIdle`, `compact`, `getContextUsage`, `getSystemPrompt`, `isProjectTrusted`
  - Command contexts also get `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`, `waitForIdle`.
- Tool definition:
  - Fields: name, label, description, typebox `parameters`, `prepareArguments`, and `execute(id, params, signal, onUpdate, ctx)`, which returns `{content (sent to the LLM), details (for state and rendering), isError?, terminate?, usage?}`.
  - Prompt text: `promptSnippet` is one line in the `<tools>` section; `promptGuidelines` are bullets that appear only while the tool is active.
  - Exposure: `direct | model-only | codemode | deferred | hidden`. Deferred tools are found through the built-in `tool_search`. Tools cannot be unregistered; re-registering one as hidden withdraws it.
  - Also: `namespace`, MCP-style `annotations` (readOnly, destructive, idempotent, openWorld hints), `reachesTools`, and `ctx.executeTool` for nested calls, which still pass through the tool_call gates.
- State: extensions should store state in the tool result `details` and rebuild it from `sessionManager.getBranch()` on session_start and session_tree. That way state follows the session branch.
- Skills follow the Agent Skills spec (agentskills.io): a SKILL.md with name and description frontmatter, loaded progressively; `/skill:name` forces one; `disable-model-invocation` makes a skill command-only. Prompt templates are .md files with `description` and `argument-hint` frontmatter and `${1:-default}` arguments; the filename becomes the `/command`.
- Sessions are an append-only tree stored in a file. `/tree` branches within the same file, `/fork` starts a new session from an earlier message, `/clone` copies the active branch. A summary of the branch being left can be carried into the new one, and compaction keeps the original entries.

2. SELF-EXTENSION FLOW
- The docs start with: "Pi can create extensions. Ask it to build one for your use case."
- The mechanism is documentation, not a special tool. system-prompt.ts adds a docs section with the paths to the docs and examples and tells the model to read extensions.md and examples/extensions fully before implementing. The model then writes the file into an auto-discovered directory with its ordinary write and edit tools.
- Hot reload: `/reload` (or `ctx.reload()`) emits session_shutdown, reloads extensions, skills, prompts, themes and context files, then emits session_start(reason "reload").
- Tools cannot call reload in the middle of a run. The documented pattern (examples/extensions/reload-runtime.ts) is a tool that sets a flag and returns `terminate: true`, after which an `agent_settled` handler calls `sendUserMessage("/reload-runtime", {expandPromptTemplates: true})`. Code after a reload still runs from the old version, so reload must be the last thing a handler does.
- Testing is ad hoc: `pi -e ./ext.ts` runs a one-off session with the extension loaded.
- Publishing is manual: add a package.json with the `pi` key and the `pi-package` keyword, then `npm publish` or push to git.

3. PACKAGING AND DISTRIBUTION
- `pi install npm:@x/y@1.0.0 | git:host/repo@ref | ./local` (add `--local` for project scope), plus `pi list`, `pi remove`, `pi update --extensions`.
- Exact npm versions and git tags or commits are pinned. Package identity is the npm name, or the git URL without the ref, so equivalent declarations are deduplicated.
- Settings can filter what loads from a package per resource type (`[]` loads none, `!glob`, `+path`, `-path`). Filters can only narrow a package, never widen it.
- A package that fails to install is skipped with a warning and retried on the next start.
- Package changelogs are shown after an update.
- There is no signing and no capability manifest. The gallery only shows a "review the source" warning.

4. PERMISSION MODEL
- By design there is none: no approval popups, and extensions run in-process with full OS permissions (docs/security.md). Safety comes from running Pi in a container or VM.
- The only built-in gate is project trust, which decides whether project-local resources load. The decision is stored in ~/.pi/agent/trust.json, and an extension can decide it through the `project_trust` event.
- Approvals are left to extensions: examples permission-gate.ts, confirm-destructive.ts and protected-paths.ts block calls through `tool_call` combined with `ctx.ui.confirm`. The docs show a Codex-style rule based on annotations.
- Over RPC, ctx.ui dialogs become `extension_ui_request`/`extension_ui_response` messages (select, confirm, input, editor, with optional timeouts). This is exactly the bridge a phone client would need.

5. WHAT ANU SHOULD COPY
- One package format for every extension kind. Use package.json with a single `anu` key listing extensions, skills, prompts, MCP servers, tools and a `bot` profile, with conventional directories as the fallback. That makes "a complete bot" just a package with a profile plus dependencies.
- Pinned exact versions, package identity independent of the ref, and per-bot filters that only narrow. These fit a per-bot lockfile served by the 8789 registry.
- Self-extension through docs plus hot reload: a skill (not a new core tool, which fits assistant/src/tools/AGENTS.md) that points the model at the authoring docs and writes into the bot's own scratch extensions directory. A test run in an isolated sandbox session, then reload at the settle point, then a publish request that the user approves in conversation.
- The lifecycle shape, especially `agent_before_settle`/`turn_end` with a guarded "continue" and pi's explicit endless-loop warning. This maps directly onto ANU's /goal: at settle, a done-check decides whether to continue, with turn, time and cost budgets as guards.
- Tool exposure levels and MCP-style annotations, so a bot's permissions screen can show readOnly/destructive/openWorld hints.
- Store state in tool `details` and `appendEntry`, rebuilt per branch.
- The RPC UI sub-protocol as the model for app approval cards and secure input. The difference for ANU: the secret-box response must go straight to CES and never back into the transcript. In pi, `ctx.ui.input` results return to extension code and can reach the model.
- Things NOT to copy:
  - In-process, full-permission execution. ANU should run third-party or agent-written code in the per-bot sandbox and add a declared-permissions manifest plus signature or hash checks at the registry.
  - Project-local auto-load, which is a prompt-injection and supply-chain risk.
  - The tool_call gate as a deterministic approval system, which would conflict with Permission controls v2. Keep consent conversational and use the gate only for the host-computer boundary.

6. LICENSE
MIT (LICENSE: "Copyright (c) 2025 Mario Zechner"; package.json `"license": "MIT"`). This is compatible with ANU, so the patterns and even code can be reused with attribution.

---

PI CODING AGENT: RESEARCH FOR ANU EXTENSIONS DESIGN

Sources: I cloned the repo read-only at commit e5c6182 (2026-10-30) into (scratch path) I did not run any of its code. The package is now `@earendil-works/pi-coding-agent` v1.4.0. Earendil took the project over in 2026, and the old `@mariozechner/*` import names still map to the new ones.
- Files read: packages/coding-agent/docs/{extensions,packages,skills,prompt-templates,security,sessions,how-pi-works}.md, src/core/extensions/types.ts, src/core/pi-manifest.ts, src/core/system-prompt.ts, and examples/extensions/{preset.ts,sandbox,subagent,permission-gate.ts,reload-runtime.ts}.
- Web: https://github.com/badlogic/pi-mono, https://mariozechner.at/posts/2025-11-30-pi-coding-agent/, https://pi.dev/packages, https://www.zenml.io/llmops-database/building-pi-a-minimal-extensible-coding-agent-framework

LICENSE: MIT ("Copyright (c) 2025 Mario Zechner", LICENSE at the repo root). This is compatible with ANU, so we can copy ideas and adapt code with attribution.

1. RESOURCE TYPES (what pi can be extended with)
- Extensions: TypeScript or JavaScript modules loaded into the pi process with jiti (no build step). The default export is a factory `(pi: ExtensionAPI) => void | Promise<void>`. They can register tools, slash commands, shortcuts, CLI flags, model providers, virtual models, MCP servers, renderers and terminal UI, and they can subscribe to lifecycle events.
- Skills: implement the Agent Skills spec (https://agentskills.io/specification). A skill is a directory containing SKILL.md plus scripts/, references/ and assets/.
  - Frontmatter fields: name, description, license, compatibility, metadata, allowed-tools (experimental), disable-model-invocation.
  - Only the name, description and path go into the system prompt. The full SKILL.md is read on demand, and `/skill:name args` forces a skill to load.
- Prompt templates: Markdown files that become `/name` commands. Frontmatter holds `description` and `argument-hint`, and the body supports substitutions such as `${1:-default}`.
- Themes: JSON color files.
- MCP: now built in through .pi/mcp.json and `pi.registerMcpServer`. The 2025 blog said pi "does not and will not" support MCP, so the project has moved away from that position.

Discovery locations:
- `~/.pi/agent/extensions/*.ts`
- `*/index.ts`
- `*/package.json` with a `pi.extensions` field
- the project equivalents under `.pi/...`
- the settings.json `packages` and `extensions` arrays
- `builtin:<name>` entries in settings

2. EXTENSION API SURFACE (types.ts, `interface ExtensionAPI` at line 1602)
- `pi.on(event, handler)` returns an unsubscribe function.
- Startup and resources: `project_trust`, `resources_discover` (returns extra skill, prompt and theme paths), `mcp_servers_change`.
- Session events: `session_start` (reason: startup, reload, new, resume or fork), `session_before_switch`, `session_before_fork`, `session_before_compact`, `session_compact`, `session_before_tree`, `session_tree`, `session_shutdown`.
- Agent events: `before_agent_start` (can mutate the system prompt options), `agent_start`, `agent_end`, `agent_before_settle`, `agent_settled`, `turn_start`, `turn_end`.
  - `turn_end` can append entries and request a continuation.
  - `agent_before_settle` is the last point where an extension can act: it can append entries and return `continue: true`.
- Model request events: `context`, `context_with_system`, `before_provider_headers`, `before_provider_request`, `after_provider_response`, `provider_stream_event`, plus message start, update and end.
- Tool events: `tool_execution_start`, `tool_call` (can mutate input or return `{block, reason, terminate}`), `tool_result` (can transform the result), `tool_execution_end`.
- Other events: `input` (can intercept or transform), `user_bash`, `model_select`, `thinking_level_select`, `ui_prompt_start` and `ui_prompt_end`, `cache_warming_decision`.
- How handlers combine: notification-only, in-place mutation, chained transformation, gate (fail closed), and last-override.

Methods:
- registerTool, registerCommand, registerShortcut, registerFlag, registerProvider and unregisterProvider, registerVirtualModel, registerMcpServer and unregisterMcpServer.
- Renderers: registerMessageRenderer, registerEntryRenderer, registerToolRenderer.
- Messaging: sendMessage, sendUserMessage (with an option to expand prompt templates).
- appendEntry (durable session data the model does not see), setSessionName, setLabel.
- exec, getActiveTools, getAllTools, setActiveTools, setModel, setThinkingLevel.
- `events` (a bus shared between extensions) and getSettings.

ctx (per handler):
- `ui`: select, confirm, input, editor, notify, custom, widgets, status and footer. There is NO masked or secret input; a grep for password, secret or masked finds nothing.
- Also: cwd, isProjectTrusted, sessionManager.getBranch(), model, modelRegistry, signal, abort, compact, getContextUsage, getSystemPrompt.
- Command handlers additionally get newSession, fork, navigateTree, switchSession and reload.
- Tools additionally get `ctx.executeTool` and `ctx.tools`. Nested calls go through the same `tool_call` gates.

Tool definition fields:
- name, label, description, parameters (TypeBox schema), execute(id, params, signal, onUpdate, ctx).
- The result is `{content` (what the model sees), `details` (state and rendering data), `structuredContent`, `isError`, `terminate`, `usage}`.
- promptSnippet and promptGuidelines: the tool's text is added to the prompt only while the tool is active.
- prepareArguments (migrates arguments from old sessions), executionMode (parallel or sequential), defaultActive, outputSchema, renderCall and renderResult.
- `exposure`: direct, model-only, codemode, deferred (found through the built-in `tool_search`) or hidden. Tools cannot be unregistered, so they are hidden instead.
- Also: namespace, MCP-style `annotations` (readOnly, destructive, idempotent and openWorld hints), reachesTools, prepareLoadout.

State model: state is rebuilt from `ctx.sessionManager.getBranch()`, reading tool-result `details` on `session_start` and `session_tree`. Because of this, state branches correctly together with the conversation.

Lifecycle:
- Startup runs project_trust, then the factory (awaited), then session_start, then resources_discover.
- `/reload` (or `ctx.reload()`) emits session_shutdown(reload), throws away the extension runtime and loads a new one (the loader cache is keyed by generation), then emits session_start(reload).

3. SELF-EXTENSION FLOW
The extensions doc opens with "Pi can create extensions. Ask it to build one for your use case." The README says pi "skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package."

The mechanism is simple and has no special tooling:
- system-prompt.ts adds a `docs` section that points the model at its own README, docs/ and examples/. It maps topics to files (extensions -> docs/extensions.md, packages -> docs/packages.md, and so on) and tells the model to read those files in full before implementing anything.
- The model uses its ordinary write, edit and bash tools to write `~/.pi/agent/extensions/foo.ts` (or `.pi/extensions/`).
- It tests the result with `pi -e ./foo.ts` (a child pi process) or with `/reload`.
- A model-triggered reload works through a pattern (examples/extensions/reload-runtime.ts):
  - a `reload_runtime` tool sets a flag and returns `terminate: true`;
  - an `agent_settled` handler then sends `/reload-runtime`, and that command handler calls `ctx.reload()`.
  - Tools cannot reload directly, because reloading mid-run is forbidden.
- There is no packaging or publishing step; the user publishes to npm or git themselves.

4. PACKAGING AND DISTRIBUTION (docs/packages.md, pi-manifest.ts)
- A pi package is an ordinary npm package or git repo. The full manifest (`PiManifest`) is the `pi` key in package.json: `{extensions[], skills[], prompts[], themes[], changelogPath}` plus optional `image` and `video` for the gallery. Paths accept globs and `!` exclusions.
- Without a manifest, pi uses the conventional directories extensions/, skills/, prompts/ and themes/.
- The `keywords: ["pi-package"]` keyword lists the package in the gallery at https://pi.dev/packages. The gallery holds about 5,366 packages. Each shows its type, author, monthly downloads and last publish date, and the page can filter and sort and has a report form.
- Install sources:
  - `pi install npm:@x/y@1.0.0`
  - `git:github.com/x/y@v1`
  - an https URL
  - a local path
  - `-e` for a single run (cached in ~/.pi/agent/tmp/extensions)
- `--local` writes to the project settings. Exact versions and git tags or commits are pinned, and `pi update --extensions` reconciles installs.
- Dependencies:
  - Runtime dependencies go in `dependencies`; dev dependencies are not installed.
  - Host packages (pi-ai, pi-agent-core, pi-coding-agent, pi-tui, typebox) must be `peerDependencies: "*"`. Pi maps them to its own copies, and it warns if a package carries a physical copy.
  - Each package loads with its own module root.
- Per-package filters in settings: `{source, extensions:[...], skills:[], prompts:[...]}` with `!glob`, `+path` and `-path`. Filters can only narrow what a package offers, never widen it.
- Identity: npm packages are identified by name, git packages by repo URL without the ref, and local packages by absolute path, which prevents loading the same package twice.
- A package that fails to install at startup is skipped with a warning and retried on the next start.
- Package changelogs are shown after updates.

5. PERMISSIONS, SECURITY, SESSIONS
- Pi is deliberately YOLO: the blog calls permission prompts "security theater" and says pi "just gives in" (https://mariozechner.at/posts/2025-11-30-pi-coding-agent/). docs/security.md says safety comes only from an OS, container or VM boundary.
- The only built-in gate is project trust. Project `.pi/*` resources, project `.agents/skills` and project packages need a trust decision. The decision comes from an extension's `project_trust` handler, then a saved choice in ~/.pi/agent/trust.json, then the `defaultProjectTrust` setting (ask, always or never).
- Permission policies are left to extensions:
  - `tool_call` gates, as in permission-gate.ts and confirm-destructive.ts;
  - decisions based on annotations, such as Codex-style approvals from destructive and openWorld hints;
  - examples/extensions/sandbox, which wraps bash in @anthropic-ai/sandbox-runtime with filesystem and network allow and deny lists.
- Profiles: there is no first-class bot profile. examples/extensions/preset.ts defines named presets with {provider, model, thinkingLevel, tools[], instructions}. The subagent example defines agents as Markdown files with frontmatter {name, description, tools, model} and runs each in an isolated child pi process.
- Sessions:
  - Stored as JSONL trees: each entry has an id and a parent, and the active branch is the model's context.
  - `/tree` moves within a session file and `/fork` and `/clone` create new files. Branches you leave can be summarized, and compaction inserts a summary entry without deleting the originals.
  - Other features: steering and follow-up message queues, an RPC mode (JSONL over stdio) and an in-process SDK.

6. WHAT ANU SHOULD COPY
- Manifest: copy pi's `pi` manifest shape into an ANU package manifest. Add the types ANU's requirements need: `tools`, `plugins`, `mcpServers` and `bots`. A bot package would be a profile.json (persona, model, tools allowlist, skills, permissions, required secrets) plus its dependency list, which mirrors the preset and subagent frontmatter.
- Install semantics:
  - pinned exact versions;
  - identity by package name or repo URL without the ref;
  - filters that only narrow;
  - "failed install = warn and skip";
  - peer-dependency mapping for host libraries.
  - The registry server (port 8789) plays the role of npm plus pi.dev/packages, with its type, downloads, author and report-problem fields.
- Per-bot isolation: install into a per-bot or per-workspace root (pi gives each package its own module root) and apply the tool allowlist through an active-tool set (`setActiveTools`/`defaultActive`). Use `exposure: deferred` + `tool_search` so a bot with many extensions keeps its prompt small, which fits ANU's system-prompt minimalism rule.
- Self-extension:
  - Let the agent read the ANU extension docs on demand (pi's docs prompt section) and write extensions in its workspace.
  - It tests them in the sandbox with an `-e`-style one-off load.
  - A hot reload happens only at the settled boundary, through the request-flag pattern.
  - Publishing then becomes a conversation-consented action that pushes the package to the user's registry. Pi has no publish step, so ANU adds this.
- /goal: pi's `agent_before_settle {continue: true}` plus `appendEntry` are exactly the primitives for a persistent goal loop. At settle time, check the goal's done condition. If it is not met, append a progress entry and continue. Store goal state in session entries so it branches with the conversation.
- Branch-safe state: state rebuilt from the active branch (tool `details`, never global variables) is a pattern worth requiring of every ANU extension.
- Do NOT copy:
  - YOLO trust: ANU must keep the sandbox boundary, credentials owned by CES and the host-computer gate. Treat project trust as an install-time consent prompt only.
  - In-process loading of untrusted code: ANU should run third-party extensions inside the sandbox workspace process, never in the API or registry servers.
  - Ad hoc secret input: pi's `ctx.ui.input` is a plain text field. ANU's secure secret box has to be its own design: the value goes straight to CES and the model and transcript only ever see a reference.
