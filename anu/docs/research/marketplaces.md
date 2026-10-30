# Extension marketplace research

## Extension marketplace and registry research for ANU (sources cited inline)

### What existing ecosystems do

**Claude Code plugins** ([marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), [manifest](https://code.claude.com/docs/en/plugins/manifest-reference), [hosting](https://code.claude.com/docs/en/plugins/host-marketplace.md))
- **Catalog.** A catalog is `.claude-plugin/marketplace.json` with `name`, `owner` and `plugins[]`. Each entry has `name`, `source` and `description`.
- **Sources.** An entry's `source` can be a relative path, github, git-subdir, url, archive (pinned by `sha256`), npm or command.
- **Manifest.** `plugin.json` requires only `name`. Optional fields: displayName, version, author, license (SPDX), keywords, `dependencies` (name@marketplace with a semver range), `userConfig` (typed, with `sensitive: true` sending the value to the OS credential store), and the components skills/, commands, agents, hooks, mcpServers (including `.mcpb` bundles) and lsp. All component paths must stay inside the plugin root; `..` is rejected.
- **Secrets stay out of the prompt.** A sensitive value becomes a placeholder in skill and agent text and is only placed into MCP env or hook args.
- **Versions and updates.** If `version` is set, users stay on that version until it changes. If it is omitted, users follow commit SHAs. Auto-update is opt-in.
- **Rename, removal, uninstall.** A `renames` map handles renames and removals (an append-only history). `forceRemoveDeletedPlugins` uninstalls removed plugins remotely. Plugin data is deleted on uninstall unless `--keep-data` is passed.
- **Private catalogs.** These rely on the user's existing git credentials, or on `headers`/`headersHelper` for archive downloads. The user must accept the exact helper command at install, and a changed command is refused.
- **Name protection.** Names that pass as Anthropic's own are reserved.
- **Complete bots.** These map to a plugin that bundles agents, skills and MCP servers, plus a `settings.agent` default.

**MCP Registry** ([server.json](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md), [overview](https://github.com/dickhardt/registry))
- **Naming.** Names are reverse-DNS, for example `io.github.owner/server`. Namespace ownership is proven by GitHub OAuth or OIDC, a DNS challenge or an HTTP challenge.
- **server.json.** Fields include `version` and `packages[]`. Each package has a registryType (npm/pypi/oci/mcpb/...), an identifier, a transport, and a `fileSha256` for mcpb bundles. There are also `remotes[]` (http/sse) and environment variables with `isSecret` and `isRequired`.
- **API.** `/api/v0/servers` supports list, search and lookup by name. The registry stores metadata only; artifacts stay on npm, OCI and similar hosts.

**VS Code** ([manifest](https://code.visualstudio.com/api/references/extension-manifest), [publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [runtime security](https://code.visualstudio.com/docs/editor/extension-runtime-security), [MS blog](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace/))
- **Manifest.** Includes `publisher.name`, semver, `engines.vscode`, `extensionDependencies`, `extensionPack` (bundles), and `capabilities.untrustedWorkspaces`.
- **Signing and checks.** The Marketplace signs every package at publish, and the client verifies the signature at install. Packages get a Defender scan, secret scanning, sandbox dynamic analysis and periodic rescans.
- **Blocking and publisher trust.** A blocklist forces uninstall of malicious extensions. Publishers can be verified through a DNS TXT record.
- **Release channels.** Pre-release uses a flag, not semver tags.
- **Removal.** Unpublishing is reversible. Deleting is permanent and reserves the name.
- **Private distribution.** Done with a `.vsix` file.
- **Gap.** VS Code shows no fine-grained permissions at install. This is a known weakness we should not copy.

**Obsidian** ([submit](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin), [manifest](https://docs.obsidian.md/Reference/Manifest))
- The manifest has id, name, version, minAppVersion, author and isDesktopOnly.
- Release assets are `main.js` and `manifest.json` attached to a GitHub release whose tag equals the version.
- Review is automated, and GitHub linking proves ownership.
- Plugins run with full access and no permission model, so this is a cautionary example.

**Raycast** ([store prep](https://developers.raycast.com/basics/prepare-an-extension-for-store))
- Every extension and every update goes through a PR to one monorepo, with CI lint and build and human review.
- A lockfile is required.
- Keychain access is rejected, and so are external analytics. Binaries must be hash-checked.
- Changelog entries are stamped at merge.
- Significant changes need the original author's sign-off.

**OpenAI GPT Store** ([help](https://help-lb.openai.com/en/articles/8798878-building-and-publishing-a-gpt), [launch post](https://openai.com/blog/introducing-the-gpt-store))
- The "complete bot" is instructions, knowledge, capabilities and actions.
- A GPT must be shared with Everyone to appear in the store.
- Actions require a privacy policy URL.
- The builder profile needs a verified domain.
- Review is automated plus human, and blocked GPTs can be appealed.

**npm provenance** ([docs](https://docs.npmjs.com/generating-provenance-statements))
- A Sigstore-signed provenance attestation links the package to its source and CI build. A transparency log makes tampering detectable.
- The registry adds a publish attestation.
- Trusted publishing (OIDC) removes long-lived tokens.
- `npm audit signatures` verifies packages.
- Provenance does not mean the code is safe.

### Patterns to adopt
1. A package ID scoped to its namespace, with ownership proven.
2. Plain semver plus an immutable content digest. A version can never be republished, and the client checks the digest on install.
3. Dependencies as semver ranges, resolved into a per-bot lockfile.
4. Capabilities declared in the manifest and shown before install. Any increase in capabilities on update asks again.
5. Secrets declared and never placed in model-visible text.
6. Signing by the registry, with provenance for agent-built packages, plus a blocklist that forces uninstall.
7. Automated review: static checks, secret scan, sandbox run, and treating descriptions as untrusted text.
8. A renames/removals list.

### Recommended ANU package format (`anu.package.json`)
```json
{
  "schema": "anu.package/1",
  "id": "u.salem/weather-brief",
  "kind": "bot | skill | tool | plugin | mcp | prompt",
  "version": "1.2.0",
  "displayName": {"en": "Weather Brief", "ar": "موجز الطقس"},
  "description": {"en": "...", "ar": "..."},
  "author": {"name": "...", "verified": false},
  "license": "MIT",
  "engines": {"anu": ">=0.4.0"},
  "origin": "human | agent",
  "provenance": {"builtBy": "sandbox", "botId": "...", "sessionId": "...", "sourceDigest": "sha256:..."},
  "contents": {
    "skills": ["skills/*/SKILL.md"],
    "plugins": ["plugins/<name>/"],
    "mcpServers": {"weather": {"transport": "stdio", "command": "node", "args": ["${PKG_ROOT}/server.js"]}},
    "prompts": ["prompts/*.md"]
  },
  "bot": {
    "persona": "persona.md",
    "model": {"tier": "default"},
    "defaultPermissions": {"autonomy": "ask"}
  },
  "dependencies": {"u.anu/web-search": "^2.0.0"},
  "capabilities": {
    "network": ["api.open-meteo.com"],
    "filesystem": "workspace",
    "shell": false,
    "browser": false,
    "hostComputer": false,
    "schedules": true,
    "messaging": []
  },
  "secrets": [{"key": "OPENMETEO_KEY", "label": {"en": "API key"}, "required": false, "scope": "bot"}],
  "digest": "sha256:...",
  "signature": "registry-ed25519:..."
}
```
- A bot package is `kind: bot`. It declares `bot` and its `dependencies`, and other packages are pinned in its lockfile, much like a VS Code extensionPack.
- `secrets` are entered only through the Secret Box into CES. Packages get a CES handle (an env var injected by the sandbox at process start), never a value in skill or prompt text.
- Descriptions are rendered as data and never put into a system prompt.

### Registry API (port 8789; the API proxies it for the app)
- `GET /v1/packages?q=&kind=&cursor=`: search.
- `GET /v1/packages/{id}`: metadata and versions.
- `GET /v1/packages/{id}/{version}`: manifest, digest, signature and review status.
- `GET /v1/packages/{id}/{version}/tarball`: the package itself. The sandbox checks the digest and signature before unpacking.
- `POST /v1/packages`: multipart tarball plus manifest. The response is `pending_review`, and only the owner can see the package until it passes review.
- `POST /v1/packages/{id}/{version}/yank` and `GET /v1/blocklist`: the sandbox polls the blocklist and quarantines blocked packages.
- `GET /v1/renames`
- `POST /v1/resolve`: takes `{deps}` and returns a lockfile.
- **Scopes.** Packages are `private` (user only), `unlisted` or `public`. Public packages need review.
- **Auth.** Sandbox to registry uses a service token. The API uses user tokens. Agent-built packages can be published only through the API after the user confirms; the sandbox never publishes directly.

### Install-time permission UX
This fits Permission controls v2. Installing is a user action in the app, like the host-computer gate, not a new approval mode on assistant actions. Inside chat, an agent's proposal to install arrives as a card the user taps.

The install sheet shows:
1. Name, author, a verified badge or "Made by your bot", version, and review status.
2. Plain-language rows built from `capabilities`, for example "Can reach api.open-meteo.com" or "Cannot run shell commands". Risky rows are highlighted.
3. Required secrets, each with an "Add in Secret Box" button.
4. Dependencies to be installed.
5. Which bot it installs into. Installs are per bot only, with no global install.

On update, a diff screen appears only when capabilities, dependencies or secrets grow. Otherwise the update applies silently if the user turned auto-update on.

Uninstall happens from the bot's permissions screen. It removes the package from that bot's lockfile and deletes its data, and the CES secrets are offered for deletion.
