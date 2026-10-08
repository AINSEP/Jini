/** CMS permission checking preserves the CMS command denial contract. Generic registration wiring lives in the kernel. */
export {
  requireToolPermission,
  adaptLegacyAuthorize,
  type RequireToolPermissionRequired,
  type RequireToolPermissionOptional,
} from "@jini-ai/core";
export type { AuthorizationPort, AuthorizationRequired, AuthorizationOptional } from "../authorization.js";
