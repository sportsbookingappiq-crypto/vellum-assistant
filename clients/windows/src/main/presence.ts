import {
  createDesktopPresenceMonitor,
  IDLE_THRESHOLD_MS,
} from "@anu/electron-desktop/desktop-presence-monitor";

import log from "./logger";

export { IDLE_THRESHOLD_MS };

export const installPresenceMonitor = createDesktopPresenceMonitor(log);
