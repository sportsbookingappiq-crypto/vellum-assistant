/**
 * @anu/ces-client/credential-rpc
 *
 * Re-exports the credential RPC surface from `@anu/service-contracts` so
 * consumers that depend on `@anu/ces-client` can access the CES wire
 * protocol types through this package without a separate dependency on
 * `@anu/service-contracts`.
 *
 * Prefer importing directly from `@anu/service-contracts/credential-rpc`
 * for new code outside of the ces-client boundary.
 */

export * from "@anu/service-contracts/credential-rpc";
