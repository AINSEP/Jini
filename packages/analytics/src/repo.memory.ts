/** Process-local recent-hit buffer; list returns an array copy and never promises durability. */
import type { AnalyticsSinkCapabilities, AnalyticsSinkPort } from "./ports.js";
import type { NormalizedHit } from "./types.js";

const DEFAULT_LIST_LIMIT = 50;

const MAX_LIST_LIMIT = 500;

function clampListLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT);
}

export class LocalBufferSink implements AnalyticsSinkPort {
  private hits: NormalizedHit[];

  constructor(_required: Record<string, never>, optional: { initialHits?: readonly NormalizedHit[] } = {}) {
    this.hits = [...(optional.initialHits ?? [])];
  }

  capabilities(_required: Record<string, never>): AnalyticsSinkCapabilities {

    return { durable: false, batch: true };
  }

  async accept({ hit }: { hit: NormalizedHit }): Promise<void> {
    this.hits.push(hit);
  }

  async acceptBatch({ hits }: { hits: readonly NormalizedHit[] }): Promise<void> {
    this.hits.push(...hits);
  }

  all(_required: Record<string, never>): NormalizedHit[] {
    return [...this.hits];
  }

  async list(_required: Record<string, never>, optional: { limit?: number } = {}): Promise<NormalizedHit[]> {
    const limit = clampListLimit(optional.limit);
    return this.hits.slice(-limit).reverse();
  }
}
