import { externalMcpAccessSnapshot, externalMcpAdmissionRevision, readExternalMcpToolGrants, validateExternalMcpToolNames } from "./access.js";
import { externalMcpRecordHasStaticAccessToken, resolveExternalMcpOAuthStatus } from "./auth.js";

/**
 * The six pure row projections hosts hand to plugin and sign-in seams, as the original functions.
 * @agent-note Function calls only: no I/O, cache or state. Members are the exact exported functions (same identity), so a host may bind this object or the functions directly. The host passes one object to every seam that needs projections.
 */
export const hostedMcpProjections = {
  accessSnapshot: externalMcpAccessSnapshot,
  admissionRevision: externalMcpAdmissionRevision,
  readToolGrants: readExternalMcpToolGrants,
  validateToolNames: validateExternalMcpToolNames,
  oauthStatus: resolveExternalMcpOAuthStatus,
  hasStaticAccessToken: externalMcpRecordHasStaticAccessToken,
} as const;
