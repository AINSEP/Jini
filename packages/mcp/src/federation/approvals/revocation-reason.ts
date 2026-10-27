import type { ToolRefusalReason } from "../trust.js";
import type { ExternalMcpRevocationReason } from "./revocation.js";

/** Maps an admitted tool's refusal under the row's current grants to the revocation reason the
 *  gate reports. `refusalForAdmittedToolUnderCurrentGrants` produces `"remote-declares-not-read-only"`
 *  for a write tool with no write grant; it maps to "write-not-allowed" rather than collapsing into
 *  "tool-not-allowed", so the model is told the tool may not make changes.
 *  @complexity O(1). */
export function revocationReasonForToolRefusal(refusal: ToolRefusalReason | null): ExternalMcpRevocationReason | null {
  if (refusal === null) return null;
  return refusal === "remote-declares-not-read-only" ? "write-not-allowed" : "tool-not-allowed";
}
