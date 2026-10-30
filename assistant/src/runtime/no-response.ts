/**
 * Daemon door for the shared `<no_response/>` sentinel convention. The
 * definitions live in `@anu/service-contracts/no-response` so the
 * daemon, gateway, and clients parse identically; this module exists so
 * daemon-internal imports keep one stable path.
 */
export {
  containsNoResponseMarker,
  hasDeliverableAssistantText,
  isNoResponseOnlyText,
  isPotentialNoResponsePrefix,
  NO_RESPONSE_INLINE_RE,
  stripNoResponseMarkers,
} from "@anu/service-contracts/no-response";
