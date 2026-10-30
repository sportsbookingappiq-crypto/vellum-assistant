import { join } from "node:path";

import type { App } from "electron";

/**
 * Product name the packaged `userData` directory is named after. It predates
 * the ANU product name and stays fixed so existing installs keep their
 * settings, session, and provisioned CLI runtime.
 */
export const LEGACY_USER_DATA_PRODUCT_NAME = "Vellum";

/**
 * Pin a packaged build's `userData` to the legacy directory: the product name
 * with its `ANU` prefix swapped for {@link LEGACY_USER_DATA_PRODUCT_NAME},
 * plus a `-<channel>` suffix for non-production channels so side-by-side
 * installs never share a single-instance lock. Must run before `userData` is
 * first read.
 */
export function pinPackagedUserDataDir(
  app: Pick<App, "getName" | "getPath" | "setPath">,
  channel: string,
): void {
  const legacyName = app
    .getName()
    .replace(/^ANU(?=$|\s)/, LEGACY_USER_DATA_PRODUCT_NAME);
  const base = join(app.getPath("appData"), legacyName);
  app.setPath(
    "userData",
    channel === "production" ? base : `${base}-${channel}`,
  );
}
