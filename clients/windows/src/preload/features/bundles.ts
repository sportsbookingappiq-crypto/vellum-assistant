import { ipcRenderer } from "electron";

import type {
  BridgeCapabilityRegistry,
  CapabilityModule,
} from "@anu/electron-desktop/capability-registry";
import { createBundleConfirmBridge } from "@anu/electron-desktop/preload";
import type { VellumBridge } from "@anu/ipc-contract";

const bundlesFeature: CapabilityModule<BridgeCapabilityRegistry<VellumBridge>> =
  {
    id: "bundles",
    install: (registry) => {
      registry.contribute(
        "bundleConfirm",
        createBundleConfirmBridge(ipcRenderer),
      );
    },
  };

export default bundlesFeature;
