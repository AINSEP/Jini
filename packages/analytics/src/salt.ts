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
/** Re-derive per workspace/day; never persist the result beside analytics data. */
export function deriveDailySalt(required: DailySaltRequired): Buffer {
  const { rootKeySeed, workspaceId, utcDate, saltContext } = required;
  if (!workspaceId) throw new RangeError("deriveDailySalt: workspaceId must not be empty");
  if (!utcDate) throw new RangeError("deriveDailySalt: utcDate must not be empty");
  if (!saltContext.infoPrefix || !saltContext.extractionSalt.length) throw new RangeError("deriveDailySalt: salt context must not be empty");
  return Buffer.from(hkdfSync("sha256", rootKeySeed, saltContext.extractionSalt,
    `${saltContext.infoPrefix}${workspaceId}:${utcDate}`, 32));
}
