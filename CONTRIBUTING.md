# Contributing

Bug fixes, features, tests, and docs are all welcome. This page covers setup, where code lives, and what makes a change easy to review.

## Before You Start

- **Bug reports and feature requests**: [open an issue](../../issues) with the provided template.
- **Security vulnerabilities**: report these privately, as described in [SECURITY.md](SECURITY.md).
- **Questions**: open an issue and say it is a question.

## Development Setup

### Getting Started

```bash
git clone https://github.com/<your-username>/vellum-assistant.git
cd vellum-assistant
./setup.sh    # installs Bun (if needed), installs deps, links packages, registers the global anu CLI
```

Verify your setup:

```bash
anu --version
```

### Running the Assistant Locally

```bash
anu hatch   # create a local assistant (once)
anu wake    # start it again later
anu client  # chat with it in the terminal
anu sleep   # stop it; data is kept
```

### Running the ANU Platform

The API and sandbox live in `anu/`. Setup, commands, and rules are in [`anu/README.md`](anu/README.md) and [`anu/AGENTS.md`](anu/AGENTS.md).

### Running Tests

Always pass a path to `bun test`: the full suite is too large to run unscoped.

```bash
# ANU platform (API and sandbox)
cd anu && bun test src

# Assistant
cd assistant && bun run test

# CLI
cd cli && bun run test

# Credential Executor
cd credential-executor && bun run test

# Gateway
cd gateway && bun run test
```

### Linting and Type Checking

```bash
# From any package directory (assistant/, cli/, gateway/)
bun run lint
bun run typecheck
```

### Using AI Coding Assistants

If you use Claude Code, see [.claude/README.md](.claude/README.md) for setup (shared slash commands, fast mode, typical workflow).

## Project Structure

| Directory | What it is |
|---|---|
| `anu/` | ANU platform: phone-login API, per-task sandbox, plan, and decisions |
| `assistant/` | Assistant runtime, also ANU's agent harness: memory, tools, skills, scheduling, integrations |
| `gateway/` | Public ingress: webhooks, API routes, OAuth callbacks |
| `cli/` | The `anu` CLI |
| `clients/` | End-user app surfaces (web, iOS, macOS/Electron) and the public docs site (`clients/docs/`) |
| `credential-executor/` | Isolated credential execution service |
| `packages/` | Shared internal packages |
| `skills/` | Skill definitions |

For deeper architectural context, see [ARCHITECTURE.md](ARCHITECTURE.md) and the domain-specific docs linked from it.

## Personalizing Your Assistant vs. Changing the Core

Before opening a PR, ask: **does this belong in everyone's assistant, or just mine?**

A lot of "new feature" ideas are really *personal customization*: for example, a morning briefing, a recurring cleanup, a custom routine, or stitching existing capabilities together. These belong in **your assistant's own workspace**, not in the shared runtime. You don't need to fork the repo or wait for a review to get them, just ask your assistant to build it for you!

### When a Core Change Is the Right Call

Adding or changing a **core tool** (anything under `assistant/src/tools/` registered in the tool manifest) ships to **every** user and is loaded into the agent's context on every turn. Always-loaded tools share a tight budget, so each one has to earn its place. Open a PR for core changes only when the change is:

- a **new primitive** that can't be expressed as a skill composed from existing tools, or
- a bug fix, performance, security, or developer-experience improvement to existing behavior, or
- there is an issue where maintainers agreed it will be broadly useful.

If you can build it as a skill in your own workspace, do that first. If you think a personal skill would genuinely benefit others, contribute it to [`skills/`](skills/) (see [`skills/AGENTS.md`](skills/AGENTS.md)) rather than adding a core tool. When in doubt, [open an issue](../../issues) before writing new core capabilities.

## Submitting a Pull Request

1. Fork the repo and create a branch from `main`.
2. Make your changes. Write tests where applicable.
3. Make sure CI passes locally: `bun run lint && bun run typecheck && bun run test` in the relevant package(s).
4. Open a PR against `main`. Fill out the PR template.
5. A maintainer reviews it.

### PR guidelines

- **Keep PRs focused.** One logical change per PR. Smaller PRs get reviewed faster.
- **PR titles** follow conventional commits format: `type(scope): description` (e.g., `feat(slack): add user token support`, `fix(cli): handle missing config`).
- **We assume AI was used.** That's fine. Include the prompt or plan you used in the PR description.
- **User-facing words follow [`docs/ANU-VOICE.md`](docs/ANU-VOICE.md).** No em dashes, and every error says what to do next.
- **Don't submit PRs against `release/*` branches.** These are for release management only.

### What makes a good contribution

- Fixes a bug you encountered while using the assistant
- Improves documentation or developer experience
- Adds test coverage for untested paths
- Implements a feature agreed in an issue
- Adds a broadly useful primitive or a reusable skill to [`skills/`](skills/)

### When to seek feedback

**Small changes (one PR, about 300 source lines or fewer):** go straight to a PR. The PR is the discussion.

**Large changes (several PRs, about 1,000 source lines or more):** open an issue before you start, describing the approach. It confirms that nobody else is working on the same area and that the approach fits [`anu/docs/PLAN.md`](anu/docs/PLAN.md).

## Code of Conduct

All participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
