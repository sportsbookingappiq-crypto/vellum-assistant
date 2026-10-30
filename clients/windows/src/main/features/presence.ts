import { app } from "electron";

import { installAvatarIpc } from "@anu/electron-desktop/avatar";
import type {
  CapabilityModule,
  DesktopCapabilityRegistry,
} from "@anu/electron-desktop/capability-registry";
import { installConnectivityProbe } from "@anu/electron-desktop/connectivity-probe";
import { installIdentityIpc } from "@anu/electron-desktop/identity";
import {
  configureLockfileWatcher,
  installLockfileWatcher,
} from "@anu/electron-desktop/lockfile-watcher";
import { installPowerEvents } from "@anu/electron-desktop/power-events";
import { configurePresenceRuntime } from "@anu/electron-desktop/presence-runtime";
import {
  installConnectivityIpc,
  installStatusIpc,
} from "@anu/electron-desktop/status";
import { resolveLockfilePaths } from "@anu/local-mode";

import { handle, on } from "../ipc.client";
import { installFeatureFlagsIpc, isFeatureEnabled } from "../feature-flags";
import log from "../logger";
import { current } from "../main-window";
import { installTaskbar } from "../taskbar";
import { installWindowsTray } from "../tray";

const presence: CapabilityModule<DesktopCapabilityRegistry> = {
  id: "presence",
  install: () => {
    configurePresenceRuntime({ ipc: { handle, on }, logger: log });
    installAvatarIpc();
    installIdentityIpc();
    installFeatureFlagsIpc();
    installPowerEvents();
    installStatusIpc();
    const retryProbe = installConnectivityProbe(
      resolveLockfilePaths(process.env),
    );
    installConnectivityIpc(retryProbe);
    configureLockfileWatcher(() => resolveLockfilePaths(process.env));
    const stopLockfileWatcher = installLockfileWatcher();
    app.once("before-quit", stopLockfileWatcher);
    installWindowsTray(isFeatureEnabled);
    installTaskbar({ getWindow: current });
  },
};

export default presence;
