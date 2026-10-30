import { ipcRenderer, webUtils } from "electron";

import type {
  BridgeCapabilityRegistry,
  CapabilityModule,
} from "@anu/electron-desktop/capability-registry";
import { createFileOpenPreloadBridge } from "@anu/electron-desktop/file-open-preload";
import type { VellumBridge } from "@anu/ipc-contract";

const module: CapabilityModule<BridgeCapabilityRegistry<VellumBridge>> = {
  id: "paths",
  install: (registry) => {
    const bridge = createFileOpenPreloadBridge({ ipcRenderer, webUtils });
    registry.contribute("fileOpen", bridge.fileOpen);
    registry.contribute("paths", bridge.paths);
  },
};

export default module;
