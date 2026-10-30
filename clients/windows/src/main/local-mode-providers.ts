import { app } from "electron";
import path from "node:path";

import type { DesktopCapabilityRegistry } from "@anu/electron-desktop/capability-registry";
import {
  LOCAL_MODE_CLI,
  LOCAL_MODE_PATHS,
  LOCAL_MODE_SESSION,
} from "@anu/electron-desktop/local-mode";
import { getSessionToken } from "@anu/electron-desktop/session-token-store";
import {
  resolveConfigDir,
  resolveDevCliInvocation,
  resolveEnvironmentName,
  resolveLockfilePaths,
  type CliInvocation,
} from "@anu/local-mode";

import { provisionCliRuntime, resolveCliRuntimePaths } from "./cli-installer";

const resolveCliInvocation = async (): Promise<CliInvocation> => {
  const override = process.env.VELLUM_CLI_PATH;
  if (override) {
    return { command: "bun", baseArgs: ["run", override] };
  }

  if (!app.isPackaged) {
    const repoRoot = path.resolve(app.getAppPath(), "..", "..");
    try {
      return resolveDevCliInvocation(repoRoot, import.meta.url);
    } catch {
      // Fall through to the packaged runtime.
    }
  }

  const runtime = provisionCliRuntime(
    resolveCliRuntimePaths(
      app.getPath("userData"),
      process.resourcesPath,
      app.getVersion(),
    ),
  );
  return {
    command: path.join(runtime.installDir, "vellum.exe"),
    baseArgs: [],
  };
};

export const installWindowsLocalModeProviders = (
  registry: DesktopCapabilityRegistry,
): void => {
  registry.provide(LOCAL_MODE_CLI, { resolveInvocation: resolveCliInvocation });
  registry.provide(LOCAL_MODE_PATHS, {
    configDir: resolveConfigDir(process.env),
    environment: resolveEnvironmentName(process.env),
    lockfilePaths: resolveLockfilePaths(process.env),
  });
  registry.provide(LOCAL_MODE_SESSION, { getToken: getSessionToken });
};
