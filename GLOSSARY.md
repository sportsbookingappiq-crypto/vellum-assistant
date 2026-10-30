# Glossary

The words ANU's code, docs, and product copy use, and what each one means. When a term here and a term in the code disagree, fix one of them. The docs site renders a copy of this page (`clients/docs/src/app/docs/_components/glossary-content.tsx`); change this file first, then that one.

For how to write with these words, see [`docs/ANU-VOICE.md`](docs/ANU-VOICE.md).

---

## ANU platform

These terms come from the platform in [`anu/`](anu/): a phone app, an API, a sandbox per task, and a harness inside it.

### Approval

A question the agent asks before a risky step, shown with Approve and Reject buttons. While it is open, the task's status is `awaiting_approval`. An approval ends `approved`, `rejected`, or `expired` (when the task stops or ends first). Inside the assistant runtime, consent for risky actions is asked in the conversation; see [Permission controls v2](#permission-controls-v2).

### Driver

The code that runs a task inside the sandbox. `scripted` is deterministic, for tests and demos; `kilo` plans and answers through Kilo Gateway without tools; `harness` boots the full assistant runtime. Set with `ANU_SANDBOX_DRIVER`.

### Goal

What the user wants done, in plain language, 1 to 4000 characters. A goal starts a task.

### Harness

The agent runtime that runs inside the sandbox. ANU's harness is the assistant runtime in [`assistant/`](assistant/).

### Result

How a task ends: a text answer and, when the agent can estimate it, a confidence between 0 and 1. The user reviews the steps and the result before acting on it.

### Sandbox

Where a task runs: its own workspace directory and worker process group, with an environment built from an allowlist that never holds platform secrets. Today this is process isolation in one container, not a boundary against hostile code, and it has no network isolation.

### Step

One entry in a task's timeline, numbered from 1 with no gaps. Each step has a kind: `plan`, `tool`, `observation`, `message`, `approval_request`, or `result`.

### Task

One goal being carried out. Its status moves from `queued` to `running`, may pause at `awaiting_approval`, and ends `succeeded`, `failed`, or `stopped`.

---

## Assistant runtime

These terms come from the assistant runtime, which ANU uses as its harness and which also runs on its own.

### App

An interactive tool the assistant builds for its guardian and keeps in its library, often for a recurring need or one that benefits from visuals. Unlike a widget, an app persists outside the conversation.

### Assistant

One running instance of the runtime, with its own name, identity, memory, and skills. In user-facing text, the process is "the assistant", never "the daemon".

### Avatar

The assistant's picture. It is chosen or generated at hatch and can change later.

### Channel

A medium through which a guardian or contact reaches the assistant: the ANU apps, Telegram, Slack, SMS, email, phone. One assistant can be reachable on many channels at once.

### Client

An application used to talk to the assistant: the desktop app, iOS and Android apps, web app, Chrome extension, or the `anu client` terminal UI. A client reaches the assistant through a channel.

### Contact

A person the guardian has allowed to talk to their assistant through a channel. Contacts never see the guardian's private information.

### Credential executor

The separate process that holds secrets (API keys, tokens, passwords) and uses them on the assistant's behalf, so the values never reach the model. Code: [`credential-executor/`](credential-executor/).

### Gateway

The server in front of the assistant that decides who may talk to it and with what access. It verifies identities, enforces access policy, and routes messages. The assistant cannot write to the gateway's data; only the guardian can.

### Guardian

The person who creates, owns, and is responsible for an assistant. The guardian grants permissions and is accountable for the assistant's actions. A guardian may also be a [user](#user) of the ANU platform, but the two roles are separate.

### Hatch

Create a new assistant: `anu hatch`. Used instead of "provision" or "sign up".

### Heartbeat

A periodic background check the assistant runs on its own: reread its notes, follow up on loose ends, look ahead for deadlines, and message the guardian only when something is worth saying. The checklist is `HEARTBEAT.md` in the workspace.

### Home

Where an assistant runs: the ANU platform, a self-hosted machine, a Docker container, or the desktop app. The home sets its network, security boundary, and resources. Distinct from a client, which is how the guardian reaches it.

### Memory

What the assistant knows about its guardian and their world, curated across conversations: preferences, people, commitments, history. It is filed in the workspace and pulled into later turns. Not a chat log. Design: [`assistant/docs/architecture/memory.md`](assistant/docs/architecture/memory.md).

### Permission controls v2

The consent model behind the `permission-controls-v2` flag. The only fixed approval gate is conversation-scoped access to the host computer. For everything else the assistant asks in the conversation, naming the action and its effect, instead of using per-tool rules or timed grants.

### Personal intelligence

The Constitution's term for an assistant with its own identity and memory that serves one guardian. In product copy, say "assistant".

### Personality

The assistant's voice, tone, and disposition, defined in `SOUL.md` in its workspace. The guardian can set it directly, and it changes as they work together.

### Schedule

A task the assistant runs at a set time without being asked.

### Self-host

Running an assistant on your own computer or infrastructure instead of the ANU platform.

### Skill

A capability the assistant loads on demand: a `SKILL.md` with instructions, and optionally tools. Skills can be bundled, installed from the catalog, or written in the workspace. In ANU, "skill" also covers the tools a skill adds.

### Species

The kind of assistant runtime. `vellum` is ANU's own runtime (the identifier is kept for existing installs); `openclaw` is another species the CLI can run. Chosen at hatch: `anu hatch [species]`.

### Teleport

Moving an assistant from one home to another, for example from the platform to a Docker container, with its identity and memory intact: `anu teleport`.

### Trust rules

Policies that let an assistant act without asking, or require approval. Under [permission controls v2](#permission-controls-v2), new flows use conversation consent instead of new trust rules.

### User

A person with an ANU platform account. "User" describes the account, not the relationship with an assistant, which is guardianship.

### ANU Doctor

A support tool for diagnosing a platform-hosted assistant. It keeps no memory between sessions, and it reaches a guardian's assistant only with that guardian's permission for each session. Details: [`assistant/docs/anu-doctor.md`](assistant/docs/anu-doctor.md).

### Widget

A UI element the assistant renders inside a conversation: a card, form, table, or confirmation. Widgets belong to the conversation; apps persist in the library.

### Workspace

The assistant's own persistent file system: notes, memory, skills, projects, and its identity files. Separate from the guardian's files.
