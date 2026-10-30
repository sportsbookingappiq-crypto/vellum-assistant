# ANU handoff

Read this first, then `anu/AGENTS.md`. It records where the work stopped and what the owner decided, so the next agent can continue without the earlier conversation. Last updated 2026-10-30. Branch: `anu/rebrand-platform`.

## Owner decisions (binding)

Identity and scope:
- ANU is simply a personal AI agent that helps with any task. User-facing copy never says sandbox, harness, runtime, or workspace. An approval reads as the assistant asking.
- Focus on iOS, Android, and web. The desktop apps are out of scope. `clients/web` stays, because the phone apps load it. Do not touch `clients/macos`, `clients/linux`, or `clients/windows`.
- Architecture: phone app (thin client) -> API (identity against the database) -> sandbox -> harness. A fourth server, the extension registry, is planned.
- The harness stays the original, plus improvements and pi-style extensions. Arabic is first-class, with right-to-left layout, in light and dark.

Interface:
- Direct and chat-first, built on Grok bot and Cue by Manus. See `docs/design/phone-app.md` and `docs/research/`.
- Clean and simple, richer than the original, and not recognisably the original Vellum app.
- Agents page, chat sessions, and tasks are separate. A session is a chat, not a timeline.
- The logo appears only on the app icon and the launch screen, never in the app header.
- Browser and files are full separate windows reached from the conversation, not tabs.
- Users can create custom bots. Bot profiles live in the harness mechanisms, and each bot's tools, skills, and permissions are isolated from other bots.

Characters and logo:
- Base set: the first Frostlings plus `stellar` and `dendrite`. The later crystal set was rejected.
- Eyes: small eyes, no glint, large soft round pupils. Nothing that looks shocked.
- Stellar and Dendrite have no shards at their arm ends.
- Stellar's logo face is one normal eye and one `>` chevron eye, in the style of Cue's wink.
- Logo: the owner prefers variant A in `assets/brand/logo-cue-style.png`, the ANU wordmark above Stellar on white, but said it is still not close enough to Cue. Compare against the real Cue references again (cue.im and the Manus 2.0 launch image), and zoom Stellar in the way Cue does. Keep ANU's own wordmark and character, and do not copy Cue's artwork or letterforms. Keep Cue's images out of the repo.
- Splash: same composition on white, with ANU in black. Show the owner options and wait for a choice before applying icons.

## Where the work stopped

Everything below is committed and pushed. "Unfinished" means started and not completed or not reviewed.

| Area | State |
| --- | --- |
| API, sandbox, database, agents, chat sessions, bots API (`/v1/bots`, draft, duplicate) | Built and tested. Migrations 0001 to 0005 |
| Bot profile applied to the harness | Implemented per `docs/design/phone-app.md`. Live run with the harness not confirmed |
| Phone UI in `clients/web/src/domains/anu` | Unfinished. The build was stopped partway and never reviewed against the checklist in `docs/design/phone-app.md` section E |
| Bot characters | Unfinished. Shards, pupils, and the `>` chevron were being changed when stopped; avatar-catalog and web avatar tests pass. Regenerated assets and the gallery may lag the catalog: regenerate and look at them |
| App icons on iOS and Android | Wrong for now. They still show the rejected black snowflake on white. Replace them with the chosen logo |
| Web, desktop, and Chrome extension icons | Restored to the night-blue snowflake. Web needs the chosen logo; desktop stays as is |
| `assets/brand/screens/` | Older than the current UI |
| Extensions, registry, `/goal`, secret box, onboarding | Not built. No final spec exists |

Known failure: `clients/ios/scripts/__tests__/desktop-icon-ground.test.ts` fails. It ties the desktop icon ground to the iOS one, which no longer holds. Relax it when the final icon lands, since desktop is out of scope.

## Next steps, in order

1. Finish the characters: confirm catalog geometry, regenerate derived assets, view the gallery.
2. Produce logo options closer to Cue, get the owner's choice, then apply to iOS, Android, and web icons and the settings preview. Update `assets/brand/BRAND.md`, which still describes the black icon and all platforms.
3. Finish the phone UI against `docs/design/phone-app.md`, including every UX aspect below. Review it with screenshots of each screen in English and Arabic, light and dark, then refresh `assets/brand/screens/`. The design review used the taste skill: https://github.com/Leonxlnx/taste-skill (`references/app-screens.md`, `tells.md`, `critique.md`).
4. Write the extensions spec at `docs/design/extensions-and-goals.md` from `docs/research/`, picking from `docs/research/extensions-design-directions.md`, and have it reviewed for requirements, feasibility, and security. Then build it.
5. Standard sandbox environment for all agents: container or VM, network isolation, resource limits, shared image. Needs an owner decision on where it runs. Docker is not available on the development machine.
6. Remove NativeAuth and the platform App Links from ANU builds (owner has not answered yet; ask).
7. Owner decision pending: `SOUL.md` lines that may make the agent announce and then stop ("Talk before you work", the `checking.` example, the one sentence default).

### UX aspects the phone UI must cover

First-run onboarding, permission prompts, notification copy, empty states for every list, loading states, offline, errors with retry, rate-limited login, expired session, long-running work and stop, approval while the app is in the background, delete with undo, export and delete of account data, language switch, accessibility (labels, focus order, text scaling, contrast, reduced motion), haptics, keyboard and safe areas.

### Requirements for the extensions work

1. Extensions and a marketplace in the app. Kinds: skills, tools, plugins, MCP servers, prompts, and complete bots.
2. A fourth server, the extension registry (planned port 8789), connected to the sandbox. Sandboxes download from it, and the API lists and searches it.
3. pi-style self-extension: the agent writes, tests, and packages its own extensions and tools, and publishes only with the user's approval.
4. Each bot has its own isolated tools, skills, extensions, permissions, model, and persona.
5. Bot builder: from a description, the model builds the bot itself, downloading what exists and creating what is missing, then shows the result for confirmation.
6. `/goal` as a core feature: a persistent objective worked across turns until a done check passes, with progress and budgets.
7. Approval prompts, a per-bot permissions screen, and a secure secret box. A secret goes to the credential store and never enters model context, chat history, or logs. Must respect Permission controls v2 in the root `AGENTS.md`.
8. First-run onboarding: after first sign-up the model explains ANU in plain words, asks a few questions, and builds the user's first bot with the bot builder. Skip and redo are available.

Later, not now: a screenshot after every browser action, which needs a harness change.

## Running it

From `anu/`:

```bash
export PATH=$HOME/.local/node24/node-v24.22.0-linux-x64/bin:$HOME/.bun/bin:$PATH
bun run db:setup && bun run seed && bun run dev   # API 8787, sandbox 8788
```

Web: `cd clients/web && bun run dev` (port 3000), then open `/anu`. Node 18 is too old for this repo. Test phone numbers are in the `555-01xx` range, and the code comes back as `devCode` in dev and test. Requests per phone are rate limited, so a repeated test can need another seeded number.

Pushing: the pre-push hook needs `bun` on PATH. The anonymous Kilo key has a free-tier limit, so live harness runs can fail with `PROMOTION_MODEL_LIMIT_REACHED`. Harness fixes for the workspace path, denial text, and task framing were not fully measured live for that reason.
