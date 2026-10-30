# Phone apps as thin clients

Last checked 2026-10-30, on branch `anu/rebrand-platform`.

The intended architecture is: phone app (UI only), then the ANU API (checks identity against the database with phone plus one-time code and sessions), then the sandbox server, then the harness in the sandbox. The phone runs no agent logic, makes no model calls, holds no secrets, and owns no data.

## Verdict

The iOS (`clients/ios`) and Android (`clients/android`) shells are Capacitor WebViews. They load a web build from `server.url` and add OS glue around it. Nothing native calls a model provider, runs agent logic or tools, embeds an API secret, or makes authorization decisions. The `/anu` screens in the WebView talk only to the ANU API (see "Simulated phone runs" below).

One native component talks to Vellum's hosted platform directly: **NativeAuth**, the WorkOS sign-in for the platform account. It is not used by the ANU flow, because `/anu` signs in with the ANU phone login, and a launch at `/anu` no longer starts the platform session (`clients/web/src/main.tsx`). It is still compiled into both apps.

## Audit

| File or area | What it does | Verdict |
| --- | --- | --- |
| iOS `NativeAuthPlugin.swift`, `WorkOSAuth.swift`; Android `NativeAuthPlugin.java`, `WorkOSAuth.java` | Platform-account sign-in: WorkOS PKCE in ASWebAuthenticationSession or Custom Tabs, then an exchange for a platform session token | **Flag.** Calls `https://api.workos.com` and `{platform}/_allauth/app/v1/...` directly. iOS only allows `www.vellum.ai`, `staging-assistant.vellum.ai`, and `dev-assistant.vellum.ai` (`NativeAuthPlugin.swift` around lines 51 to 67). It is a public PKCE client with no client secret, and ANU does not use it |
| `NativeBiometricPlugin.swift`; `NativeBiometricPlugin.java`, `BiometricTokenStore.java` | Keychain (`WhenPasscodeSetThisDeviceOnly`) and Keystore (`BIOMETRIC_STRONG`) token storage. `/anu` keeps its session token here, under the key `anu-session:<API origin>` | OK. It only stores the token; it decides nothing |
| `SelfHostedServer(s)*`, `MyViewController.swift`, `MainActivity.java`, `SafeWebChromeClient.java`, `ConnectDeepLink.java`, `AppDelegate.swift` | Choose and validate the WebView origin, guard navigation, pair flow | OK |
| Push: `ApnsEnvironmentPlugin`, `SenderNotificationPlugin`, `LocalNotificationCoordinator`, `NotificationCategories`, `SafeMessagingService`, `push/*`, `AndroidPushRegistrationPlugin`, notification channel and settings plugins | Register APNs and FCM tokens, render notifications | OK |
| iOS `NotificationService/` extension | Adds the sender avatar to a notification | OK |
| `Shared/AvatarCache.swift`, `push/AvatarCache.java` | Download the avatar URL named in a push payload (HTTPS only, hash check, size cap) | OK, minor: it fetches any host the payload names |
| `VoiceActivity/*`, `VoiceLiveActivityPlugin`, `VoiceAudioSessionPlugin`, `VoiceModeService`, `VoiceQuickSettingsTileService`, `VoiceDeepLink` | Live Activity, Dynamic Island, audio session, foreground service. Voice traffic stays in the WebView | OK |
| Widgets, `WidgetSnapshotPlugin`, `RecentChatsStore`, `RecentChatsPlugin` | Display a snapshot the web layer writes into the app group | OK, display cache only |
| `ShareExtension/`, `ShareInbox`, `ShareInboxPlugin` | Stage shared items for the WebView | OK, no network |
| `Intents/*`, deep links, `CommandURLProvenance` | Siri and App Intents become deep links | OK |
| `AppIconPlugin`, `NativeLaunchScreenPlugin`, `InstallReferrerPlugin`, `NativeFailureReport*` | Icon, launch screen, install attribution, failure records | OK |
| `Info.plist` | One URL scheme `$(BUNDLE_URL_SCHEME)`. No `NSAppTransportSecurity` key, so iOS allows HTTPS only | OK |
| `*.entitlements` | Push, `applinks:$(ASSOCIATED_DOMAIN)`, communication notifications, app group | OK |
| `AndroidManifest.xml`, `res/xml/network_security_config.xml` | App Links on `${vellumAppLinkHost}` (`/assistant/...` paths). Cleartext is allowed only for `localhost`, `127.0.0.1`, and `10.0.2.2` | OK |

No embedded secrets were found: no `sk-` or `AIza` keys and no private keys. The WorkOS client ID is fetched at run time, and it is public anyway.

## Configuration: point a shell at ANU

`clients/web/capacitor.config.ts` reads `ANU_SERVER_URL` at `cap sync` or `cap copy` time. When it is set, it takes precedence over `VELLUM_SERVER_URL` and `VELLUM_ENVIRONMENT`:

- `server.url` is the URL's origin, and `server.appStartPath` is `/anu`.
- It must be `https:`. Loopback hosts (`localhost`, `127.0.0.1`, `10.0.2.2`) may use `http:`, and only then is `server.cleartext` turned on. Anything else fails the sync.

The host at `ANU_SERVER_URL` must serve a `clients/web` build made with `VITE_ANU_API_URL=<ANU API origin>`, and the ANU API must allow that origin in CORS. Without either variable, the existing environment logic is unchanged.

```bash
cd clients/web
VITE_ANU_API_URL=https://api.anu.example bun run build   # web build that a host serves
ANU_SERVER_URL=https://app.anu.example bunx cap sync android   # or ios
```

A launch whose first path is `/anu` skips the platform session boot (allauth session, lockfile, org, flags, assistants list, native platform login restore, and session replay). The `/anu` screens therefore need no platform login.

## Simulated phone runs

`cd anu && bun run mobile:e2e` (`scripts/mobile-e2e.ts`) needs the API, the sandbox, and the web dev server. It opens `/anu` in Chromium at 390x844 with an iPhone user agent and then a Pixel user agent. A stub of the Capacitor bridge reports `ios` or `android` and implements `NativeBiometric`, so the native token path runs. The run records every request.

Result on 2026-10-30: 44 of 44 checks passed, 22 per platform.

- Every data request (fetch, XHR, EventSource) went to `http://127.0.0.1:8787`. There were 32 on iOS and 28 on Android. The only other origin was the web host serving static assets. There were no requests to vellum.ai, model providers, or the sandbox on `:8788`.
  - Before the `main.tsx` change, `/anu` also called `/_allauth/browser/v1/auth/session` and `/assistant/__local/lockfile` on the web host.
- The correct code signs in. A wrong code is rejected with "4 attempts left" and `attempts=1` in the database. An expired code is rejected.
- The token is in the native store, not in `sessionStorage` or `localStorage`.
- With A's token, run inside the page: A's list does not contain B's task, and B's task, steps, and stop all return 404.
- An `#approval` task shows Approve, and approving finishes it (9 steps written by the sandbox). A `#slow` task stops from the Stop button.
- Sign out clears the native store, and the API then answers 401 for the old token.

The test phones are `+1 202 555 0160` to `0162`.

## Android build (no device)

The Android SDK command-line tools, `platforms;android-36`, and `build-tools;36.0.0` were installed in a scratch directory. With JDK 21, `ANU_SERVER_URL=http://10.0.2.2:3000 bunx cap sync android` and then `./gradlew assembleDebug` built `dev`, `staging`, and `production` debug APKs. Each is about 9.9 MB (724 entries).

Inspecting `app-dev-debug.apk`:

- `assets/capacitor.config.json` has `server.url` `http://10.0.2.2:3000`, `cleartext` true, and `appStartPath` `/anu`. The package is `ai.anu.assistant.dev`, minSdk 24, targetSdk 36.
- There are no API keys, private keys, or model-provider hosts. There is no `google-services.json`, so FCM push is inactive in this build.
- Platform strings remain:
  - In resources: `vellum_auth_host` is `dev-assistant.vellum.ai`, used by NativeAuth and App Links.
  - In dex: `https://api.workos.com/...`.

## iOS (static check only; cannot build on Linux)

`ANU_SERVER_URL=https://... bunx cap copy ios` writes `App/App/capacitor.config.json` with the same `server` block. That file is gitignored.

- `Info.plist` has no ATS exceptions, so the iOS shell needs an `https:` ANU host. A loopback `http:` URL works on Android but not on iOS without adding `NSAllowsLocalNetworking`.
- The entitlements reference `applinks:$(ASSOCIATED_DOMAIN)`, which is still a platform host. It is not needed for `/anu`.

## What remains for real devices

- Run on a real device or emulator, with an HTTPS ANU web host and API, CORS for that origin, and a real SMS sender.
- Confirm the Keychain and Keystore prompts behave with the `anu-session:` key.
- Decide whether to remove NativeAuth (WorkOS and vellum.ai) and the platform App Links and associated domains from ANU builds.
- Set or disable Sentry DSN and session replay for ANU builds. The simulated runs had no DSN.
- Use `ai.anu.*` bundle IDs and push credentials.
