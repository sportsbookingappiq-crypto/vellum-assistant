import { ipcRenderer } from "electron";

import type {
  BridgeCapabilityRegistry,
  CapabilityModule,
} from "@anu/electron-desktop/capability-registry";
import { createUpdateBridge } from "@anu/electron-desktop/preload";
import type { VellumBridge } from "@anu/ipc-contract";

const autoUpdateFeature: CapabilityModule<
  BridgeCapabilityRegistry<VellumBridge>
> = {
  id: "auto-update",
  install: (registry) => {
    registry.contribute("update", createUpdateBridge(ipcRenderer));
  },
};

export default autoUpdateFeature;
