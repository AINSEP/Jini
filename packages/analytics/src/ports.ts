/** Only normalized records cross the storage boundary. */
import type { AnalyticsSiteConfig, NormalizedHit } from "./types.js";

export interface AnalyticsSinkCapabilities { readonly durable: boolean; readonly batch: boolean }
export interface AnalyticsSinkPort {
  capabilities(required: Record<string, never>): AnalyticsSinkCapabilities;
  accept(required: { hit: NormalizedHit }): Promise<void>;
  acceptBatch(required: { hits: readonly NormalizedHit[] }): Promise<void>;
  list(required: Record<string, never>, optional?: { limit?: number }): Promise<NormalizedHit[]>;
}
export interface AnalyticsConfigPort {
  get(required: { workspaceId: string }): Promise<AnalyticsSiteConfig>;
}
export interface AnalyticsHooks {
  beforeIngest(required: { hit: NormalizedHit }): Promise<NormalizedHit | null>;
}
export interface IngestDeps { sink: AnalyticsSinkPort; config: AnalyticsConfigPort }
/** Rejection is a policy outcome; unexpected adapter failures still propagate. */
export class AnalyticsPiiRejectedError extends Error {
  constructor({ message }: { message: string }, optional: { cause?: unknown } = {}) {
    super(message, optional);
  }
}
