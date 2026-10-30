import { app, powerMonitor } from "electron";
import fs from "node:fs/promises";
import os from "node:os";

import type {
  CapabilityModule,
  DesktopCapabilityRegistry,
} from "@anu/electron-desktop/capability-registry";
import { installDiagnosticsIpc } from "@anu/electron-desktop/diagnostics";
import { installFeatureFlagsIpc } from "@anu/electron-desktop/feature-flags";
import {
  configureFeedback,
  installFeedbackIpc,
  type FeedbackDependencies,
} from "@anu/electron-desktop/feedback";
import {
  configureSentryMain,
  initSentryMain,
  setShareDiagnostics,
} from "@anu/electron-desktop/sentry";
import { getSessionToken } from "@anu/electron-desktop/session-token-store";
import {
  readSetting,
  writeSetting,
} from "@anu/electron-desktop/settings";

import { WINDOWS_RELEASE_INFO } from "../app-config";
import { handle, on } from "../ipc.client";
import { getLogFilePaths } from "../logger";

declare const __SENTRY_DSN_WINDOWS__: string;
const { commitSha, releaseChannel } = WINDOWS_RELEASE_INFO;

const feedback: FeedbackDependencies = {
  ipc: { handle },
  app,
  powerMonitor,
  os,
  readFile: (filePath, encoding) => fs.readFile(filePath, encoding),
  getVersionInfo: () => ({
    appName: app.getName(),
    version: app.getVersion(),
    commitSha,
    releaseChannel,
  }),
  getLogFilePaths,
  getFeatureFlags: () => readSetting("featureFlags"),
  hasSession: () => getSessionToken() !== null,
};

configureFeedback(feedback);

configureSentryMain({
  dsn:
    typeof __SENTRY_DSN_WINDOWS__ === "string"
      ? __SENTRY_DSN_WINDOWS__
      : "",
  environment: releaseChannel,
  release: commitSha,
  tags: () => ({
    process: "main",
    app_version: app.getVersion(),
    release_channel: releaseChannel,
    arch: process.arch,
    os_version: os.release(),
    electron: process.versions.electron ?? "unknown",
    packaged: String(app.isPackaged),
  }),
});

const diagnosticsFeature: CapabilityModule<DesktopCapabilityRegistry> = {
  id: "diagnostics",
  install: () => {
    initSentryMain();
    installFeatureFlagsIpc(
      { on },
      { write: (flags) => writeSetting("featureFlags", flags) },
    );
    installDiagnosticsIpc({ on }, setShareDiagnostics);
    installFeedbackIpc();
  },
};

export default diagnosticsFeature;
