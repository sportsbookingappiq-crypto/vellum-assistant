import { configureLockfileWatcher } from "@anu/electron-desktop/lockfile-watcher";
import { resolveLockfilePaths } from "@anu/local-mode";

configureLockfileWatcher(() => resolveLockfilePaths(process.env));

export * from "@anu/electron-desktop/lockfile-watcher";
