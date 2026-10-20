import type { ToolRefusalReason } from "../trust.js";
import type { ExternalMcpRevocationReason } from "./revocation.js";

/** Maps an admitted tool's refusal under the row's current grants to the revocation reason the
 *  gate reports. `refusalForAdmittedToolUnderCurrentGrants` no longer produces
 *  `"remote-declares-not-read-only"` (hints never refuse since G3), but the union still carries it,
 *  so the mapping keeps it rather than collapsing a write refusal into "tool-not-allowed".
 *  @complexity O(1). */
export function revocationReasonForToolRefusal(refusal: ToolRefusalReason | null): ExternalMcpRevocationReason | null {
  if (refusal === null) return null;
  return refusal === "remote-declares-not-read-only" ? "write-not-allowed" : "tool-not-allowed";
}
