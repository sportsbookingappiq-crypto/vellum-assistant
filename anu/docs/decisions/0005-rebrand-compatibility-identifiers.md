# 0005: Identifiers kept from Vellum after the ANU rebrand

Status: accepted.

## Context

The product is now called ANU. Every name a person or developer sees changed from Vellum to ANU: UI copy and i18n catalogs, app and window names, the CLI command, docs, assistant copy, workspace package names, and mobile bundle identifiers.

Many strings that contain `vellum` are not names. They are contracts with existing installs, with other services, or with the operating system. Renaming them would break running installs, stored data, or the wire protocol, so they were kept on purpose.

## Decision

### Renamed

- Workspace packages: `@vellumai/*` became `@anu/*`. `@vellumai/vellum-gateway` became `@anu/gateway`. The root package is `anu-workspace`. No `@vellumai/*` name in the root `bun.lock` came from the npm registry; all were workspace links.
- CLI command: `anu`. The `cli` package exposes both `anu` and `vellum` bins. The macOS and Linux apps install their PATH wrapper as `~/.local/bin/anu`.
- Product name in prose and UI: "ANU". "Vellum Assistant" and "Vellum AI" became "ANU".
- Bundle identifiers:
  - Android `applicationId` and `namespace`: `ai.anu.assistant` (sources moved to `ai/anu/assistant`).
  - Capacitor `appId`: `ai.anu.assistant`.
  - iOS: `ai.anu.assistant-ios` (plus `.dev`, `.staging`, and the `.VoiceActivity`, `.NotificationService`, `.Share` extensions). App group: `group.ai.anu.assistant-ios`.
  - Desktop (Electron) `appId`: `ai.anu.assistant-electron`. The mac helper: `ai.anu.assistant.mac-helper`.
- Documentation and marketing links: `www.vellum.ai/docs`, `/downloads`, `/community`, `/roadmap`, `/pricing`, `/skills`, and `docs.vellum.ai` now point at `anu.ai`. Contact addresses such as `support@vellum.ai` became `@anu.ai`.

- Files and directories whose product name is not a contract:
  - `.cursor/skills/vellum-*` became `.cursor/skills/anu-*` (editor helper skills; `name:` in each `SKILL.md` updated to match).
  - `assistant/docs/vellum-doctor.md` became `assistant/docs/anu-doctor.md`.
  - `assistant/docker/mousepad/90-vellum.gschema.override` became `90-anu.gschema.override` (the assistant Dockerfile copies it).
  - `scripts/vellum-runtime-tunnel.sh` became `scripts/anu-runtime-tunnel.sh`.
  - `clients/docs/src/app/docs/_components/what-is-vellum-content.tsx` became `what-is-anu-content.tsx`. The `what-is-vellum` route directory keeps its name because it is a public URL.

### Kept, and why

| Identifier | Examples | Why kept |
| --- | --- | --- |
| Environment variables | `VELLUM_WORKSPACE_DIR`, `VELLUM_ENVIRONMENT`, `VELLUM_PLATFORM_URL`, about 200 more `VELLUM_*` names | Set by installers, Docker images, CI secrets, and users' shells. |
| HTTP headers | `Vellum-Organization-Id`, `X-Vellum-Client-Id`, `x-vellum-actor-principal-id`, `x-vellum-api-clients` | Wire contract with the hosted platform and between gateway, daemon, and clients. |
| On-disk paths | `~/.vellum`, `~/.config/vellum`, `.vellum.lock.json`, `Library/Application Support/vellum-assistant`, packaged desktop `userData` directory (`Vellum`, `Vellum Staging`, ...; pinned by `pinPackagedUserDataDir` because the product name changed), dev `userData` names `Vellum Electron*`, Windows `%LOCALAPPDATA%\Vellum\bin` | Existing installs keep their data and CLI launcher. |
| Database names | Table, column, and migration names | Migrations run in order on existing databases. |
| IPC and protocol names | `vellum:*` IPC channels, `window.vellum` preload bridge, CDP domain `Vellum.*` (`Vellum.createTab`), `Symbol.for("vellum.plugin-api")` | Shared between processes that may run different builds. |
| Channel, provider, and cloud ids | Channel `vellum`, provider and connection `vellum`, `cloud: "vellum"`, `species: "vellum"` | Persisted in config, lockfiles, and the database. |
| Keychain and credential names | Credential service `vellum` (`credential/vellum/assistant_api_key`), iOS keychain service `ai.vocify-inc.vellum-assistant-ios.biometric-auth`, Android key alias prefix `vellum-biometric-` | Changing them orphans stored secrets. |
| URL schemes | `vellum://` (desktop deep links and workspace file links in assistant output), `vellum-assistant`, `vellum-assistant-dev`, `vellum-assistant-staging` (mobile OAuth and deep links) | OAuth redirect URIs are registered with the platform and WorkOS, and links already sent to users use them. A scheme change needs every handler and the server registrations updated together. |
| File type | `.vellum` bundle extension and UTI `com.vellum.app-bundle` | Existing exported files must still open. |
| Plugin API package | Plugins may import `@vellumai/plugin-api` and declare it as a peer dependency | Third-party plugins already published use it. The assistant serves the shim under both `@anu/plugin-api` and `@vellumai/plugin-api` and accepts either peer dependency. |
| npm registry names | Meta package `vellum` and its dependencies `@vellumai/*` in `meta/package.json`; `bun install -g vellum@latest` in `install.sh`, `anu upgrade`, and the desktop CLI installers | These are published packages on the public registry. The `@anu` scope and the `anu` package are not ours on npm, so installing them could pull someone else's code. |
| Windows CLI executable | `vellum.exe`, `vellum-daemon.exe`, internal `vellum-cli` binary in the macOS bundle | Packaging, process detection, and the Windows PATH launcher all match these names. |
| Skill ids | `vellum-oauth-integrations`, `vellum-skills-catalog`, and other `vellum-*` skill names | Persisted in workspaces and the skill catalog. |
| Docker images and GitHub repositories | `vellumai/vellum-assistant`, `github.com/vellum-ai/*` | Real registries and repositories the code pulls from. |
| C# and Swift type names | `Vellum.WindowsHelper`, `Vellum.PreviewHandler`, `VellumBridge` | Code identifiers that no user sees. |

### Functional endpoints left on vellum.ai

The code calls these services, so their URLs are unchanged:

- Platform API: `platform.vellum.ai`, `staging-platform.vellum.ai`, `dev-platform.vellum.ai`, `api.vellum.ai`. The base URL can already be overridden with `VELLUM_PLATFORM_URL`.
- Hosted web app, OAuth completion, and app links: `www.vellum.ai/assistant`, `www.vellum.ai/account`, `www.vellum.ai/connect`, `dev-assistant.vellum.ai`, `staging-assistant.vellum.ai`, `app.vellum.ai`, the `app://vellum.ai` origin, and iOS associated domains.
- Speech relay: `velay.vellum.ai` and its environments (override: `VELAY_BASE_URL`).
- Update feeds: `storage.googleapis.com/vellum-ai-*-releases`.
- Install script: `vellum.ai/install.sh`.
- Hosted assets: `www.vellum.ai/favicon.svg`, `og-cover-v2.jpg`, `storybook.vellum.ai`.
- Staff checks that match the `vellum.ai` email domain.

### Not rebranded

- Legal pages in `clients/docs` (terms of use, privacy policy, prohibited use) name the legal entity Vellum AI. They need ANU's own legal text, not a word swap.
- The LICENSE copyright line.

### Names kept as files and directories

These file names embed a kept identifier, so they keep `vellum` even though the code is ANU:

- Provider and channel ids: `assistant/src/providers/vellum/`, `vellum-managed*`, `vellum-speech-relay-connection`, `vellum-model-routing`, `vellum-connection-routing`, `vellum-mismatch-routing`, `vellum-provider`, `vellum-tts-socket`, `vellum-card-affinity`, `vellum-actor-trust`, `guardian-vellum-migration`, `clients/web/src/lib/backwards-compat/*vellum*`.
- Wire and IPC names: `gateway/src/http/vellum-signature.ts` (`Vellum-Signature`), `packages/electron-desktop/src/vellumapp-protocol.ts` (`vellumapp://`), `clients/web/src/runtime/vellum-commands.ts` (`window.vellum`), `clients/web/src/domains/chat/components/vellum-file-action-modal.tsx` (`vellum://` links), `gateway/src/http/routes/vellum-identity.ts` (staff email domain check).
- Global and package names: `assistant/src/vellum-assistant-namespace.d.ts` (`globalThis.vellumAssistant`), `meta/bin/vellum.js` (npm `vellum` package).
- Native projects: `clients/windows/native/*` (`Vellum.*` C# and C++ projects), `clients/macos/native/quicklook/Vellum*`, `clients/ios/**/Vellum*` Swift files, and their type names.
- Assets and fixtures: logo and icon images (`vellum_logo.xml`, `VellumLogo.imageset`, `VellumV.symbolset`, `vellum-logo*.svg`, `clients/web/src/components/ios-widget-previews/vellum-app-icon-mark.tsx`), and `fixtures/vellum-bundle-contract/*.vellum`.
- Deployed scripts: `packages/block-volume-bootstrap/scripts/vellum-block-volume-*.sh` are copied into the gateway, assistant, and credential-executor images under their current names. Rename them only with the image build and any provisioning that references them.
- Legal pages under `clients/docs/src/app/docs/(documentation)/vellum-terms-of-use/` and `what-is-vellum`, which are public URLs.

## Consequences

- Existing Vellum installs keep their data, credentials, and links. New installs carry ANU names wherever a person sees them.
- New mobile bundle identifiers are new apps in the App Store and Play Store. Signing, provisioning profiles, Firebase, and push credentials must be created for `ai.anu.*` before a release build.
- The desktop apps get a new `appId` and product name, so the window title, Dock name, and installer say ANU. Their data directory stays where it was.
- Publishing to npm under `@anu/*` needs the scope first. Until then the release workflows cannot publish the renamed packages, and the registry install path still installs Vellum's published `vellum` package.
- Moving the platform, relay, or update URLs to ANU-owned hosts is a separate change. It needs ANU-run services and the existing override variables.
