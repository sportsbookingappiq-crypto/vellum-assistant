/**
 * Prefix-based secret patterns — sourced from the shared
 * `@anu/service-contracts/secret-detection` module, the single source
 * of truth for prefix-based secret detection across the daemon and clients.
 */

export {
  PREFIX_PATTERNS,
  REDACTION_PREFIX_PATTERNS,
  type SecretPrefixPattern,
} from "@anu/service-contracts/secret-detection";
