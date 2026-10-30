# @anu/cli

The `anu` command: create, run, talk to, back up, and delete ANU assistant instances. `anu --help` lists every command, grouped by task.

## Installation

From a checkout, `./setup.sh` at the repository root links `anu` onto your PATH. To run it without linking, use [Bun](https://bun.sh):

```bash
bun run ./src/index.ts <command> [options]
```

## Commands

### Lifecycle: `ps`, `sleep`, `wake`

Day-to-day process management for the assistant and gateway.

| Command     | Description                                                                            |
| ----------- | -------------------------------------------------------------------------------------- |
| `anu ps`    | List assistants and per-assistant process status (assistant, gateway PIDs and health). |
| `anu sleep` | Stop assistant and gateway processes. Directory-agnostic — works from anywhere.        |
| `anu wake`  | Start the assistant and gateway from the current checkout.                             |

```bash
# Start everything
anu wake

# Check what's running
anu ps

# Stop everything
anu sleep
```

> **Note:** `anu wake` requires a hatched assistant. Run `anu hatch` first, or launch the macOS app which handles hatching automatically.

### `hatch`

Provision a new assistant instance and bootstrap the ANU runtime on it.

```bash
anu hatch [species] [options]
```

#### Species

| Species    | Description                                    |
| ---------- | ---------------------------------------------- |
| `vellum`   | Default. Provisions the ANU assistant runtime. |
| `openclaw` | Provisions the OpenClaw runtime with gateway.  |

#### Options

| Option              | Description                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `-d`                | Detached mode. Start the instance in the background without watching startup progress.               |
| `--name <name>`     | Use a specific instance name instead of an auto-generated one.                                       |
| `--remote <target>` | Where to provision the instance. One of: `local`, `docker`, `vellum`, `custom`. Defaults to `local`. |

#### Remote Targets

- **`local`** -- Starts the local assistant and local gateway. Gateway source resolution order is: repo source tree, then installed `@anu/gateway` package.
- **`docker`** -- Starts the assistant, gateway, and credential service in Docker containers.
- **`vellum`** -- Hatches an assistant on the ANU platform.
- **`custom`** -- Recognized but not yet implemented.

#### Environment Variables

| Variable            | Required For | Description                                                                |
| ------------------- | ------------ | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Optional     | Used during setup when no Anthropic API key is already stored or prompted. |

#### Examples

```bash
# Hatch a local assistant (default)
anu hatch

# Hatch a Docker assistant
anu hatch --remote docker

# Hatch with a specific instance name
anu hatch --name my-assistant --remote docker
```

To self-host on a cloud VM (AWS, GCP, or any other provider), SSH into the machine and run `anu hatch` or `anu hatch --remote docker` from inside it. The CLI does not provision cloud instances for you.

### `terminal`

Open an interactive shell into a managed assistant container. Useful for debugging, inspecting state, or working alongside the assistant in a shared `tmux` session.

```bash
anu terminal [name] [options]
anu terminal attach <session> [name] [options]
anu terminal list [name] [options]
```

Only available for managed assistants (those running in an ANU Cloud container). Local assistants don't have a container to terminal into.

#### Subcommands

| Subcommand         | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| _(none)_           | Open an interactive shell session inside the container.            |
| `attach <session>` | Attach to an existing `tmux` session by name inside the container. |
| `list`             | List the `tmux` sessions currently running inside the container.   |

#### Options

| Option               | Description                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `[name]`             | Positional. Name of the assistant to target. Defaults to the active assistant set via `anu use`. |
| `--assistant <name>` | Explicit form of the assistant name. Equivalent to the positional argument.                      |

If no assistant is named and no active assistant is set, the CLI uses the only managed assistant in the lockfile -- or errors out if there's more than one. Use `anu ps` to see your assistants and `anu use <name>` to set the active one.

#### Examples

```bash
# Open a shell in the active managed assistant
anu terminal

# Target a specific assistant by name
anu terminal my-assistant
anu terminal --assistant my-assistant

# List running tmux sessions inside the container
anu terminal list

# Attach to a named tmux session
anu terminal attach my-session
anu terminal attach my-session my-assistant
```

This pairs well with the [`terminal-sessions` skill](https://github.com/vellum-ai/vellum-assistant/tree/main/skills/terminal-sessions), which lets the assistant create and manage its own `tmux` sessions. You can `anu terminal attach` into one of those sessions to watch the assistant work in real time -- for example, pairing on a long-running Claude Code run.

### `retire`

Delete a provisioned assistant instance. The cloud provider and connection details are automatically resolved from the saved assistant config (written during `hatch`).

```bash
anu retire <name>
```

The CLI looks up the instance by name in the production lockfile (`~/.vellum.lock.json`) or the env-scoped lockfile under `$XDG_CONFIG_HOME/vellum-<env>/lockfile.json` for non-production environments, then determines how to retire it based on the saved `cloud` field:

- **`gcp`** -- Deletes the GCP Compute Engine instance via `gcloud compute instances delete`.
- **`aws`** -- Terminates the AWS EC2 instance by looking up the instance ID from its Name tag.
- **`local`** -- Stops the local assistant (`anu sleep`) and removes the assistant's instance directory (`resources.instanceDir` in the lockfile; typically `~/.local/share/vellum/assistants/<name>/` for new hatches, or `~/.vellum/` for legacy entries).
- **`custom`** -- SSHs to the remote host to stop the assistant/gateway and remove the remote `~/.vellum` directory.

#### Examples

```bash
# Retire an instance (cloud type resolved from config)
anu retire my-assistant
```
