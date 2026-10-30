import {
  DesktopCapabilityRegistry,
  installCapabilityModules,
  type CapabilityModuleExport,
} from "@anu/electron-desktop/capability-registry";

const modules = import.meta.glob<
  CapabilityModuleExport<DesktopCapabilityRegistry>
>("./features/*.ts", { eager: true });

export const desktopCapabilities = new DesktopCapabilityRegistry();

export const installMainFeatures = (): void =>
  installCapabilityModules(desktopCapabilities, modules);
