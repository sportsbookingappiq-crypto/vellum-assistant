import {
  configureHotkeySettings,
  type HotkeySettingsProvider,
} from "@anu/electron-desktop/commands";

import {
  onSettingChange,
  readSetting,
  writeSetting,
} from "@anu/electron-desktop/settings";

const provider: HotkeySettingsProvider = {
  read: () => ({ ...(readSetting("hotkeys") ?? {}) }),
  write: (hotkeys) => {
    writeSetting("hotkeys", hotkeys);
  },
  subscribe: (listener) => onSettingChange("hotkeys", listener),
};

configureHotkeySettings(provider);

export * from "@anu/electron-desktop/commands";
