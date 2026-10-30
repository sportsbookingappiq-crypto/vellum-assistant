import { app } from "electron";

import { configureCommandPaletteWindow } from "@anu/electron-desktop/command-palette-window";
import { configureDictationOverlayWindow } from "@anu/electron-desktop/dictation-overlay-window";
import {
  configureFloatingWindows,
  createWindowRouteResolver,
} from "@anu/electron-desktop/floating-window";
import { configurePopoutWindows } from "@anu/electron-desktop/popout-window";
import { configureQuickInputWindow } from "@anu/electron-desktop/quick-input-window";
import {
  restoreBounds,
  track as trackWindowState,
} from "@anu/electron-desktop/window-state";

import { RENDERER_BASE_PROD, getDevRendererBase } from "./app-config";
import { handle, on } from "./ipc";
import { current, dispatchToMain, ensureVisible } from "./main-window";
import { createWindow } from "./windows";

const resolveRoute = createWindowRouteResolver(() =>
  app.isPackaged ? RENDERER_BASE_PROD : getDevRendererBase(),
);

configureFloatingWindows({
  createWindow,
  platform: "darwin",
  resolveRoute,
});
configureCommandPaletteWindow({
  currentMainWindow: current,
  dispatchToMain,
  ensureMainWindowVisible: ensureVisible,
  handle,
});
configureQuickInputWindow({
  createWindow,
  dispatchToMain,
  ensureMainWindowVisible: ensureVisible,
  handle,
  platform: "darwin",
  resolveRoute,
});
configureDictationOverlayWindow({ handle, on });
configurePopoutWindows({
  createWindow,
  handle,
  resolveRoute,
  restoreBounds,
  trackWindowState,
});
