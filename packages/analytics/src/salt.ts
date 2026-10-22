import { hkdfSync } from "node:crypto";

/** Both HKDF contexts are required so a host can preserve its existing derivation bytes. */
export interface AnalyticsSaltContext { extractionSalt: string | Uint8Array; infoPrefix: string }
export interface DailySaltRequired {
  rootKeySeed: string;
  workspaceId: string;
  utcDate: string;
  saltContext: AnalyticsSaltContext;
}
export interface AnalyticsHashPort {
  sha256(required: { parts: readonly (string | Uint8Array)[] }): string;
  deriveDailySalt(required: DailySaltRequired): Buffer;
}
/**
 * Re-derive per workspace/day; never persist the result beside analytics data. A copied/backed-up
 * analytics database alone must not reconstruct the salt, so hosts keep the root key outside it.
 * HKDF's extract-then-expand step derives independent, context-bound subkeys from one long-lived
 * secret (RFC 5869); Node provides it natively, avoiding an extra dependency. A plain HMAC digest
 * could work for a one-off hash but does not express this subkey derivation contract as directly.
 * The fixed non-secret extraction salt pins reproducible bytes; the root secret and workspace/date
 * info provide scope uniqueness. Hosts supply both salt and info prefix to preserve existing bytes.
 * @returns A 32-byte buffer, deterministic for the same root key, scope/date and contexts.
 * @throws RangeError for empty workspace, date or context, avoiding collapsed scope separation.
 * @complexity O(1) HKDF-SHA256 extract/expand over bounded inputs.
 */
export function deriveDailySalt(required: DailySaltRequired): Buffer {
  const { rootKeySeed, workspaceId, utcDate, saltContext } = required;
  if (!workspaceId) throw new RangeError("deriveDailySalt: workspaceId must not be empty");
  if (!utcDate) throw new RangeError("deriveDailySalt: utcDate must not be empty");
  if (!saltContext.infoPrefix || !saltContext.extractionSalt.length) throw new RangeError("deriveDailySalt: salt context must not be empty");
  return Buffer.from(hkdfSync("sha256", rootKeySeed, saltContext.extractionSalt,
    `${saltContext.infoPrefix}${workspaceId}:${utcDate}`, 32));
}
