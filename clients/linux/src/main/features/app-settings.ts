import type {
  CapabilityModule,
  DesktopCapabilityRegistry,
} from "@anu/electron-desktop/capability-registry";
import {
  HOTKEY_SETTINGS,
  type HotkeySettingsProvider,
} from "@anu/electron-desktop/commands";
import {
  onSettingChange,
  readSetting,
  writeSetting,
} from "@anu/electron-desktop/settings";

const hotkeySettings: HotkeySettingsProvider = {
  read: () => ({ ...(readSetting("hotkeys") ?? {}) }),
  write: (hotkeys) => {
    writeSetting("hotkeys", hotkeys);
  },
  subscribe: (listener) => onSettingChange("hotkeys", listener),
};

const appSettingsFeature: CapabilityModule<DesktopCapabilityRegistry> = {
  id: "app-settings",
  install: (capabilities) => {
    capabilities.provide(HOTKEY_SETTINGS, hotkeySettings);
  },
};

export default appSettingsFeature;
