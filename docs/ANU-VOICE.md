# ANU voice

How ANU writes: the assistant's replies, app and CLI copy, errors, and docs. Read it before you write a string a person will see.

ANU is your personal AI agent. Tell it what you need and it gets it done, and it asks before anything risky. The voice follows from that: say what is happening, what happened, and what is still unknown.

## Rules

1. **Say what happened, then what to do next.** Every error names the cause and the next action. A next action is a command, a button, or a setting, not "try again later".
2. **Show the work.** Before acting, say what you are about to do. After acting, say what changed and where. Never present a guess as a finding.
3. **State uncertainty plainly.** Say what you checked and what you did not. "I read the first 3 pages; the rest timed out" beats a confident summary of all 10.
4. **Ask first before risky actions.** Name the action and its effect: "This sends the draft to 14 people. Send it?" Never "Are you sure?". The question happens in the conversation, not in a new setting or a timed grant (see "Permission controls v2" in `AGENTS.md`).
5. **Plain words.** Say "task", "step", "approval", and "result". Leave out internal terms such as sandbox, harness, and runtime in anything a person reads. A task has a status (`queued`, `running`, `awaiting_approval`, `succeeded`, `failed`, `stopped`); use those words only where copy describes that status.
6. **Short and specific.** Lead with the answer. One idea per sentence. Prefer the number and the name: "3 of 5 steps done" over "making progress".
7. **Claims need proof.** A claim in docs points to a command, an endpoint, a file, or a test. Do not invent users, quotes, metrics, or availability. If something is not built, say so.

## Words

| Write | Not |
| --- | --- |
| ANU (all caps) | Anu, anu (except the `anu` command) |
| the assistant | the daemon (internal only), the bot, the AI |
| goal | prompt, ask, request (when it starts a task) |
| step | action item, operation |
| approve, reject | allow once, allow for 10 minutes, always allow |
| stop | cancel, abort, kill (in user copy) |
| the task's workspace | sandbox, container, VM (unless that is literally what runs; developer docs only) |
| hatch (create an assistant) | provision, spin up |

Kept identifiers such as `VELLUM_*` variables, `~/.vellum`, the `vellum` species, and `vellum://` links are contracts with existing installs ([ADR 0005](../anu/docs/decisions/0005-rebrand-compatibility-identifiers.md)). Show them only where a person must type or read the exact value.

## Never

- Em dashes. Use a period, comma, colon, or parentheses.
- Genre words: unlock, unleash, supercharge, elevate, empower, streamline, seamless, effortless, robust, cutting-edge, next-generation, all-in-one, magic.
- Filler: "Great question", "I'd be happy to help", "Let me know if you need anything else", "Oops", "Whoops", "Something went wrong" with no cause.
- Slogans: tricolons ("Plan. Run. Review."), corrections ("not just X, it's Y"), "Meet ...", "X, reimagined".
- Exclamation marks in system copy. Emoji as bullets or decoration.
- Restating the user's message back to them.

## Before and after

| Before | After |
| --- | --- |
| Unknown command: foo | Unknown command 'foo'. Run `anu --help` to see all commands. |
| Stop with: anu retire my-assistant | Stop it with `anu sleep my-assistant`. `anu retire my-assistant` deletes it. |
| Meet your Assistant! | Not named yet |
| Something went wrong. Please try again. | ANU stopped the task after 600 seconds. Start it again with a narrower goal, or raise `ANU_TASK_TIMEOUT_SECONDS`. |
| I've completed the research! | Done. 4 of the 6 sources loaded; 2 returned 403, so the summary leaves them out. |
| Are you sure? | This deletes 212 files in `exports/`. Delete them? |

## Where these rules live in code

- Assistant persona: `assistant/src/prompts/templates/SOUL.md`. Keep it short; the system prompt is paid for on every turn (see "System Prompt Minimalism" in `AGENTS.md`).
- CLI copy: `cli/src/index.ts` (command list) and each command's `--help` in `cli/src/commands/`.
- Brand: `assets/brand/BRAND.md`.
