import { createIpcRegistrar } from "@anu/electron-desktop/ipc";

import { isAllowedOrigin, resolveAllowedOrigin } from "./app-origin";

export const { handle, handleSync, on } = createIpcRegistrar(
  resolveAllowedOrigin,
  isAllowedOrigin,
);
