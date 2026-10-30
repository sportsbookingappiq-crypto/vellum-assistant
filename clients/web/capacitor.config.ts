import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize, KeyboardStyle } from "@capacitor/keyboard";
// The `/seeds` subpath (not the package index) is deliberate: Capacitor's
// node-based TS config loader transpiles one file at a time and cannot
// resolve the index's `.js`-suffixed runtime re-exports, while the seeds
// module is self-contained (type-only imports) and loads cleanly.
import { cloudAssistantHubUrl } from "@anu/environments/seeds";

// `server.url` is baked into native Capacitor config by `cap sync`, so
// whatever URL resolves here at sync time is what the archived mobile build
// ships with. Defaults to dev; set `VELLUM_ENVIRONMENT=production` before
// syncing a production mobile build.
//
// The environment-to-hub mapping (including the deliberate `/assistant`
// suffix) is shared with the CLI's remote-web edge via
// `@anu/environments`; see `cloudAssistantHubUrl` for the rationale.
const env = process.env.VELLUM_ENVIRONMENT ?? "dev";

const ENV_SERVER_URL = cloudAssistantHubUrl(env);

// `VELLUM_SERVER_URL` points the shell at a self-hosted assistant's own HTTPS
// origin, taking precedence over the environment-derived ANU Cloud URL. It
// must parse as an `https:` URL and `server.cleartext` stays false, so an
// invalid value fails `cap sync` loudly instead of baking a broken URL into a
// native build.
function resolveServerUrl(): string {
  const override = process.env.VELLUM_SERVER_URL?.trim();
  if (!override) {
    return ENV_SERVER_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error(
      `VELLUM_SERVER_URL is not a valid URL: ${JSON.stringify(override)}`,
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `VELLUM_SERVER_URL must use https: (got ${JSON.stringify(override)}); native builds require valid TLS.`,
    );
  }

  return override;
}

// `ANU_SERVER_URL` points the shell at a host serving the ANU web build
// (built with `VITE_ANU_API_URL` set to the ANU API origin) and opens it at
// `/anu`, the thin-client task screens. It wins over both settings above.
// It must be `https:`, except loopback hosts (`localhost`, `127.0.0.1`, and
// the Android emulator's `10.0.2.2`), which are allowed over `http:` for
// development and turn on `server.cleartext` for that build only.
const ANU_START_PATH = "/anu";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

function resolveAnuServer(): { url: string; cleartext: boolean } | null {
  const raw = process.env.ANU_SERVER_URL?.trim();
  if (!raw) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`ANU_SERVER_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(
      `ANU_SERVER_URL must use https: unless the host is loopback (got ${JSON.stringify(raw)}).`,
    );
  }
  return { url: parsed.origin, cleartext: parsed.protocol === "http:" };
}

const ANU_SERVER = resolveAnuServer();
const SERVER_URL = ANU_SERVER?.url ?? resolveServerUrl();

const SCHEME_NAMES: Record<string, string> = {
  production: "App",
  staging: "App Staging",
  dev: "App Dev",
};

const config: CapacitorConfig = {
  // NOTE: Capacitor's CLI requires Java-package form here because Android
  // uses this value as its application namespace. The real iOS bundle IDs are
  // set via `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project.
  appId: "ai.anu.assistant",
  appName: "ANU",
  webDir: "capacitor-shell",
  server: {
    url: SERVER_URL,
    cleartext: ANU_SERVER?.cleartext ?? false,
    ...(ANU_SERVER ? { appStartPath: ANU_START_PATH } : {}),
  },
  ios: {
    // Native iOS project lives as a peer to `clients/web/` at `clients/ios/`,
    // not nested inside the web app. This keeps the Capacitor shell
    // alongside the other client apps (`clients/web`, future `clients/...`)
    // rather than burying it inside the web tree.
    path: "../ios",
    // Map to `WKWebView.scrollView.contentInsetAdjustmentBehavior = .never`.
    // Without this, iOS WKWebView defaults to `.automatic` and pads the
    // scroll content by the safe-area insets itself, which has two
    // unwanted effects inside the Capacitor shell:
    //   1. `env(safe-area-inset-*)` resolves to 0 because, from the
    //      webview's perspective, it already sits inside the safe area.
    //      That makes the CSS safe-area padding on `<Layout>` /
    //      `<AssistantShell>` a no-op — the header and composer end up
    //      covered by the notch and home indicator.
    //   2. The surface colour on the header stops at the safe-area line
    //      instead of extending into the notch, leaving a transparent
    //      strip at the top.
    // Setting this to `never` lets the page own the inset compensation via
    // `env(safe-area-inset-*)`, which is what PRs #4821 and #4832 assume.
    contentInset: "never",
    scheme: SCHEME_NAMES[env] ?? "App",
  },
  android: {
    // Native Android project lives as a peer to `clients/web/` at
    // `clients/android/`, matching the iOS shell layout.
    path: "../android",
  },
  // The plugin owns keyboard avoidance on iOS: its `load()` removes the web
  // view's own keyboard notification observers and resizes the frame itself.
  // Pin both iOS knobs to the behavior the app already depends on so an
  // upstream default change cannot move them silently.
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_notification",
      // ANU Blue, the tint the Android `notification_icon_color` resource
      // gives the notifications the native push renderer posts.
      iconColor: "#2563EB",
    },
    Keyboard: {
      // `native` resizes the whole WKWebView frame above the keyboard, which
      // is what `src/hooks/use-visible-viewport.ts` measures against
      // (`innerHeight` and `visualViewport.height` shrink together). `body`,
      // `ionic`, and `none` leave the frame at full height and break that
      // keyboard-height derivation.
      resize: KeyboardResize.Native,
      // `DEFAULT` follows the device appearance. The plugin swizzles
      // `keyboardAppearance` on `WKContentView` and `UITextInputTraits`
      // process-wide to whatever is set here, so the soft keyboard tracks the
      // iOS Settings appearance and never the in-app light/dark/velvet theme.
      // No `style` value expresses "follow the in-app theme"; that needs a
      // runtime `Keyboard.setStyle()` call.
      style: KeyboardStyle.Default,
      // The iOS 26 keyboard is a transparent inset panel with rounded
      // corners. Under `resize: native` the shrunk web view is the view
      // controller's root view, so the unpainted UIWindow composites black
      // through the panel's margins and corners. `"dom"` paints the window
      // from the body's computed background (`--surface-base` on the iOS
      // shell, via the gated rule in `index.css`) at plugin load and on
      // every `keyboardWillShow`.
      // Caution: the plugin's DOM color parser handles `rgb()`/hex/
      // `transparent` and falls back to white for anything else. Today's
      // tokens compute to `rgb()`, but a token migration to `oklch()` or
      // `color()` would flash white behind the keyboard and must revisit
      // this setting.
      autoBackdropColor: "dom",
    },
  },
};

export default config;
