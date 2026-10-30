/**
 * Public-URL validation and pair-link construction for the "Pair a device"
 * settings section. The implementations live in
 * `@anu/service-contracts/remote-web-pairing` and are shared with the
 * `anu pair` CLI flow, so both mints accept the same URLs and produce
 * the same pair links. This module re-exports them; the copy for a refused
 * address is shared with the other pairing surfaces from
 * `@/utils/pairing-address`.
 */

export {
  buildRemoteWebPairingUrl,
  isLoopbackPublicUrl as isLoopbackUrl,
  normalizePairingBaseUrl,
  resolvePublicBaseUrl,
  type PublicBaseUrlRejection,
  type PublicBaseUrlResult,
} from "@anu/service-contracts/remote-web-pairing";
