import { ipcRenderer } from "electron";

import type {
  BridgeCapabilityRegistry,
  CapabilityModule,
} from "@anu/electron-desktop/capability-registry";
import { createLocalModeBridge } from "@anu/electron-desktop/local-mode-bridge";
import type { VellumBridge } from "@anu/ipc-contract";

const localModeFeature: CapabilityModule<
  BridgeCapabilityRegistry<VellumBridge>
> = {
  id: "local-mode",
  install: (registry) => {
    registry.contribute("localMode", createLocalModeBridge(ipcRenderer));
  },
};

export default localModeFeature;
