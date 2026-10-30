/**
 * Package names external plugins use to import the plugin API. Plugins
 * written before the ANU rebrand import `@vellumai/plugin-api` and declare it
 * in `peerDependencies`, so the host serves and recognizes both names.
 */
export const PLUGIN_API_PACKAGE = "@anu/plugin-api";
export const LEGACY_PLUGIN_API_PACKAGE = "@vellumai/plugin-api";
export const PLUGIN_API_PACKAGE_NAMES: readonly string[] = Object.freeze([
  PLUGIN_API_PACKAGE,
  LEGACY_PLUGIN_API_PACKAGE,
]);

/** The plugin-api peer range a manifest declares, under either name. */
export function pluginApiPeerRange(
  peers: Record<string, unknown> | undefined,
): unknown {
  if (!peers) {
    return undefined;
  }
  return peers[PLUGIN_API_PACKAGE] ?? peers[LEGACY_PLUGIN_API_PACKAGE];
}
