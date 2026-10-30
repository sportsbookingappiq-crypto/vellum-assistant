# /goal research

## How current agent tools do /goal (research summary)

**Claude Code (official docs, v2.1.139+)**
- **Setting a goal:** `/goal <condition>` (up to 4,000 chars) sets the goal and starts a turn right away. Bare `/goal` shows the condition, elapsed time, turns evaluated, tokens spent and the evaluator's last reason. `/goal clear` (also stop/off/reset/cancel) removes it.
- **Scope and persistence:** One goal per session. It is restored on every resume route, with the turn count, timer and token baseline reset.
- **Done check:** It is a session-scoped prompt-based Stop hook. After each turn, a small fast model gets the condition plus the conversation and returns one of three verdicts: not met (its reason becomes guidance for the next turn), met, or impossible (the goal is cleared and a failed entry is recorded). The evaluator calls no tools, so the agent has to surface evidence in the transcript (for example "npm test exits 0").
- **Safety valves:**
  - If there is no tool use for several turns in a row, the loop stops and the goal stays set.
  - Errors the user must fix (auth, credits, context overflow, model unavailable) clear the goal. Transient errors retry 3 times and then pause.
  - Background work defers evaluation, with check-ins after 30 minutes that back off.
- **Budgets:** No budget flag. The user writes "or stop after 20 turns" into the condition.
- **Approvals:** "A goal doesn't change your permission mode." In manual mode it still asks. Auto mode removes per-tool prompts and /goal removes per-turn prompts.
- https://code.claude.com/docs/en/goal

**OpenAI Codex CLI (v0.128.0, Apr 30 2026, experimental, `[features] goals = true`)**
- **Commands:** `/goal <objective>`, `/goal`, `/goal pause|resume|clear`.
- **States:** pursuing, paused, achieved, unmet, budget_limited.
- **Storage:** A first-class per-thread object in app-server state. It survives compaction and restarts and is exposed as JSON-RPC `thread/goal/set|get|clear` plus `thread/goal/updated|cleared` notifications.
- **Model tools:** `get_goal`, `create_goal` (only when no goal exists) and `update_goal` (can only mark complete, and must give reasoning). Pause, resume, clear and budget belong to the user only.
- **Prompts:** `continuation.md` is injected at turn boundaries and tells the agent to split the goal into testable deliverables and verify each with evidence. `budget_limit.md` triggers a soft wrap-up near the token ceiling. The budget is advisory, so a single turn can overshoot.
- **Display:** The TUI footer shows elapsed time, tokens and state.
- **Caveat:** These details come from secondary sources and official docs lagged behind (issue #20536).
- https://codex.danielvaughan.com/2026/05/07/codex-cli-goal-command-persisted-long-horizon-workflows-pause-resume-budget/
- https://developers.openai.com/codex/changelog
- https://www.mindstudio.ai/blog/openai-codex-goal-command-autonomous-tasks

**Hermes Agent (Nous Research)**
- **Commands:** `/goal <text>`, `status`, `pause`, `resume` (resets the counter), `clear`.
- **Completion contract:** `/goal draft <text>` has the judge model expand a one-line goal into a contract with five fields (outcome, verification, constraints, boundaries, stop_when), which the user reviews. `/goal show` displays it.
- **Gates and subgoals:** `/goal gate add` adds shell gates that must exit 0 before the judge runs, which gives deterministic evidence. `/subgoal` adds extra criteria. `/goal wait <pid>` parks the loop on a background process (cap 30 minutes).
- **Storage:** `SessionDB.state_meta` under `goal:<session_id>`. It survives resume and compression.
- **Judge:** An auxiliary `goal_judge` task gets the goal and the last ~4 KB of the response, and returns JSON with a verdict (done, blocked, continue or wait) and a reason. It is designed to be conservative but fails open to "continue".
- **Budget and pausing:** Default 20 continuation turns (`goals.max_turns`), then auto-pause. A real user message takes priority over the queued continuation.
- **Display:** Status lines "Goal set", "Continuing toward goal (n/20)" plus the reason, "Goal achieved", "Goal paused", and "judged unachievable, paused".
- https://hermes-agent.nousresearch.com/docs/user-guide/features/goals

**pi (`@kky42/pi-hermes-goal` extension)**
- Hermes-style /goal built purely as an extension: a `turn_end` hook, a judge call that returns `{"done":bool}`, and a continuation sent as a normal user message.
- "No hidden tools, no system-prompt mutation."
- Default budget is 20 turns. 3 parse failures auto-pause. Ctrl+C pauses.
- This shows /goal can live entirely in a plugin.
- https://pi.dev/packages/@kky42/pi-hermes-goal

**Kimi Code CLI (v0.8.0, Jun 2026, experimental)**
- Goal = a stated end state. After each turn the agent decides: complete, blocked (with a reason), paused, or still active.
- `/goal next` queues a follow-up goal.
- No stop-limit flag: limits go in the goal text.
- I only saw this in a search snippet. Fetching the docs page returned 404.
- https://www.kimi.com/en/help/kimi-code/cli-goals

**Not found:** I found no shipped /goal in Cursor, opencode, Amp, Devin or Manus. Their nearest equivalents are background agents and task plans.

**What they all share:**
- A persistent objective attached to a session or thread.
- A judge that runs after each turn and is separate from the worker, with the verdict's reason fed back as guidance.
- A turn or token budget that leads to pause, not abort.
- User-only control of pause, resume and clear.
- Approvals are never relaxed by the goal.

## Recommended ANU /goal design

**Commands (chat composer and API)**
- `/goal <text>`: set or replace the goal and start a turn.
- `/goal`: show status.
- `/goal draft <text>`: the model proposes a contract and the user confirms it in a card.
- `/goal pause`, `/goal resume`, `/goal clear`.
- Arabic aliases accepted: هدف، إيقاف، استئناف، مسح.
- The agent may *propose* a goal, but only the user activates it, which is consent via conversation and fits Permission controls v2.

**Contract fields**
- objective
- verification (concrete evidence: a command result, a file existing, a page showing X)
- constraints / boundaries
- optional gates: shell checks run in the sandbox, which must exit 0 before the judge runs
- budget: maxTurns (default 20), maxTokens, maxWallMinutes (default 120), optional cost cap

**States**
- `drafting`, `pursuing`, `waiting_approval`, `waiting_secret`, `waiting_background`, `paused`, `achieved`, `blocked`, `budget_limited`, `cleared`.
- `waiting_approval` and `waiting_secret` are new and specific to ANU. A conversational approval request or a secret-box request suspends the loop and its clocks. Nothing is auto-approved, and the goal never widens the bot's permission profile.

**Done check**
- Run order after each turn:
  1. Gates run first, giving deterministic evidence.
  2. Then a judge call goes through `getConfiguredProvider` with a small model. It gets the contract, the last response, gate results and the recent tool-result summary, and returns JSON `{verdict: continue|done|blocked|wait, reason, progress: [{criterion, met, evidence}]}`.
- Unlike Hermes, ANU's judge should fail *closed*: 3 judge errors pause the goal.
- No-progress guard: 3 turns without tool use pause the goal.
- Achieved state requires the gates to pass and the judge to say done.
- Recommended implementation: a plugin with a turn-end hook plus continuation as a synthetic user message, as in pi. This needs no new non-skill tool and no system-prompt growth, and the plugin stays self-contained.
- If the model must read the goal, expose it through a skill rather than a core tool, unlike Codex's `update_goal`.
- I did not verify the turn-end hook path in assistant/src/plugins. Check it there before relying on it.

**Data model (ANU API Postgres; the sandbox mirrors the active goal in the workspace)**
- `goals`: id, user_id, bot_id, session_id or task_id, contract jsonb, state, turns_used, tokens_used, cost_used, started_at, ended_at, last_reason, budget jsonb, created_by (user or agent_proposal).
- `goal_events`: goal_id, turn, verdict, reason, progress jsonb, gate_results jsonb, tokens, at.
- Rule: one active goal per session.
- A goal can be promoted to a Task so it runs on the agents board without the chat open. This uses the same record with a `task_id`.

**API**
- `POST /sessions/:id/goal`
- `GET /sessions/:id/goal`
- `POST /goals/:id/{pause,resume,clear,confirm-draft}`
- `GET /goals/:id/events`
- SSE `goal.updated` on the existing session stream.

**Phone UI**
- **Pinned goal bar** in the chat. Collapsed it shows the objective, the state chip and turn n/max. Expanded it shows the criteria checklist with check marks and evidence links, the last reason, budget meters (turns, tokens, time), and Pause / Clear buttons.
- **Draft card:** editable fields with a Start button.
- **Push notifications** for achieved, blocked, budget_limited and waiting_approval/secret.
- **Agents board:** a goal badge on the bot's card.
- **Budget end:** a wrap-up turn ("summarize, do not start new work") and then a "Extend budget / Clear" sheet.
- **Resume:** restoring a session restores a goal that was not finished, with the counters reset, as Claude Code does.

**Bot profile defaults:** a per-bot `goal.defaults` (budget, judge model). A goal runs under exactly that bot's tools and permissions, so nothing leaks between bots.

---

## How current agent tools do /goal (research as of 2026-10-30)

**OpenAI Codex CLI** started this. `/goal` shipped as an experimental feature in v0.128.0 (Apr 2026), behind the `[features] goals = true` flag, and per one secondary source it became generally available in 0.133.0.
- **Commands:** `/goal <objective>` creates or replaces the goal, `/goal` shows it, and `/goal pause|resume|clear` control it.
- **Storage:** each thread has at most one goal, stored durably (one community gist says in SQLite). It survives compaction, crashes and restarts.
- **States:** pursuing (active), paused, achieved (complete), unmet, budget_limited.
- **Who controls what:** the model sees only three tools: `get_goal`, `create_goal` (only when no goal exists) and `update_goal` (only to mark it complete, with reasoning). Pause, resume, clear and budgets belong to the user or the system.
- **Continuation:** a `continuation.md` prompt is injected at turn boundaries. It tells the agent to split the goal into testable deliverables and check each one against evidence (files, command output, tests), never "proxy signals".
- **Budget:** token-based and soft. `budget_limit.md` tells the agent to stop real work and summarise progress, blockers and the next step.
- **App-server API:** `thread/goal/set|get|clear`, with `thread/goal/updated` notifications.
- **Display and caveats:** the TUI footer shows elapsed time, tokens and state. There is a known problem where the continuation prompt is lost after compaction (issue #19910).
- **Continuing:** Codex goes on only when the thread is idle, the goal is active and within budget, and no user input is pending. Interrupting pauses the goal.

**Hermes Agent (Nous Research)** describes its `/goal` as "the Ralph loop" and credits Codex as the inspiration.
- **Judge:** after every turn a separate auxiliary judge model (configurable) reads the goal and the last ~4 KB of the reply. It returns `done`, `blocked`, `continue` or `wait`. The judge is conservative about `done`, but if it errors the verdict counts as "continue".
- **Completion contract:** `/goal draft` turns a one-liner into a contract with the fields outcome, verification, constraints, boundaries and stop_when.
- **Subgoals:** `/subgoal` adds criteria in the middle of a run.
- **Quality gates:** `/goal gate add <cmd>` adds shell checks that run before the judge. A failing gate's output becomes the next continuation prompt. Each gate gets 3 retries and a 5-minute timeout, then the goal auto-pauses.
- **Waits:** `/goal wait <pid>` parks the goal on a background process.
- **Budget:** `goals.max_turns` defaults to 20, then the goal auto-pauses. `/goal resume` resets the counter.
- **Storage:** the goal is stored in `SessionDB.state_meta` under `goal:<session_id>` and survives resume.
- **User messages:** a real user message takes priority over the continuation loop.
- **Platforms:** one handler serves the CLI, TUI, desktop app and the messaging gateway. Only an admin can add gates over the gateway.

**Claude Code** has `/goal <condition>`, up to 4,000 characters. It is a session-scoped prompt Stop hook.
- **Evaluator:** after each turn a small fast model, which has no tools, judges the transcript. Verdicts are not-yet-met (its reason guides the next turn), met (clears and records "achieved") or impossible (clears and records "failed").
- **Status:** `/goal` shows the condition, run time, turns, tokens and the last reason. A "◎ /goal active" indicator is shown while it runs.
- **Permissions:** a goal does not change the permission mode. In manual mode the agent still asks before tools; auto mode is what makes it run unattended.
- **Stops and retries:** if several turns pass with no tool use, the loop stops and the goal is kept. Unrecoverable errors (auth, credit, context overflow) clear the goal. Errors that may pass on their own are retried 3 times, then the goal pauses.
- **Background work and resume:** running background work delays the check, with check-ins every 30 minutes that back off. Resuming the session restores the goal but resets the counters.

**Kimi Code** has an experimental goal mode (v0.8.0, June 2026) and a "Goal queue" (v0.11.0). The states are complete, blocked, paused and active. Headless exit codes are 0 for complete, 3 for blocked and 6 for paused.

I found no `/goal` in Cursor, Amp, Devin or opencode.

**What every tool converges on:**
- one goal per session, stored durably;
- auto-continue only when the session is idle;
- someone other than the worker decides when it is done (a judge model, the agent's own tool call plus evidence, or shell gates);
- a turn or token budget that ends in a summary, not an abort;
- the user always takes priority;
- the goal never widens permissions.

## Recommended ANU /goal design

**Commands** work the same in the chat composer and in the bot's goal sheet:
- `/goal <objective>` creates the goal or replaces it after a confirmation.
- `/goal` shows status.
- `/goal pause|resume|clear`.
- `/goal draft <one-liner>` has the model write a contract, which the user edits and then activates.
- `/subgoal <criterion>` adds a criterion.
- `/goal check add <cmd>` adds a quality gate (owner only; it runs in the sandbox).

The agent can propose a goal in conversation. It only becomes active when the user taps Activate, which is consent through conversation as Permission controls v2 requires.

**States:**
- draft
- active (waiting_user, a sub-state, covers a pending approval or secret request)
- paused (with a reason: user, budget, error, gate)
- achieved
- blocked
- cleared

**Completion uses three signals together:**
1. The agent claims completion through a skill-scoped `goal` tool (get / mark_complete with evidence). It is not a new core tool registration.
2. Any quality gates run in the sandbox and must pass.
3. An independent judge call through `getConfiguredProvider` (small-model profile) reads the contract, the evidence and the last turn. It returns met, not_met (with guidance), impossible or wait.

The goal moves to achieved only if the gates pass and the judge returns met. If the judge errors, the goal continues, capped by the budget. Inject the contract at every continuation as a user-role message, not in the system prompt (system prompt minimalism). Re-inject it after compaction to avoid the Codex #19910 drift.

**Budgets:** per goal there is a max number of turns (default 20), a token or cost ceiling and a wall-clock limit. When one runs out, inject a wrap-up prompt and set paused(budget). There is also a no-progress guard: 3 turns with no tool use pause the goal.

**Approvals:** the goal never widens permissions. A pending approval prompt or secure-secret request sets waiting_user and pushes a notification. The loop resumes after the user answers. The host-computer gate stays the only deterministic gate.

**Data model** (API Postgres; the sandbox runner drives the loop):
- `goals`: id, bot_id, session_id, user_id, objective, contract (jsonb with outcome, verification, constraints, boundaries, stop_when), subgoals[], gates[], status, status_reason, budget {max_turns, max_tokens, deadline}, turns_used, tokens_used, last_verdict {verdict, reason, at}, created_at, achieved_at.
- `goal_events`: goal_id, kind (turn, verdict, gate_result, pause, resume, evidence), payload, at.

At most one active goal per session. A session can have a queue of goals, as Kimi does.

**Endpoints:**
- `POST/GET/DELETE /sessions/:id/goal`
- `POST /goal/pause|resume`
- an SSE `goal.updated` event

**UI:**
- A goal pill above the chat shows the state, turns and budget, the judge's last reason, and Pause/Clear.
- A goal sheet shows the contract editor, subgoal checklist, gate results and a timeline from goal_events.
- The agents board gets a "Goals" column.
- Push notifications for achieved, blocked, budget, and waiting on you.

## Sources
- https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex
- https://codex.danielvaughan.com/2026/05/07/codex-cli-goal-command-persisted-long-horizon-workflows-pause-resume-budget/
- https://codex.danielvaughan.com/2026/05/01/codex-cli-goal-workflows-persistent-long-horizon-task-execution/
- https://gist.github.com/erbanku/13c9a83b4a7f0223f0a4ec1a29475515 (community notes on Codex internals; unverified)
- https://hermes-agent.nousresearch.com/docs/user-guide/features/goals
- https://code.claude.com/docs/en/goal
- https://www.kimi.com/code/docs/en/kimi-code/whats-new.html
- https://www.kimi.com/en/help/kimi-code/cli-goals (Kimi details come from search snippets; the page did not render)
