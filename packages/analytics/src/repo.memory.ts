/**
 * Process-local in-memory AnalyticsSinkPort adapter for tests/development. One adapter is built
 * now; forwarding to an external collector is the plausible next adapter (ADR-006 rule-of-two).
 * Appends normalized hits without durability or rollup wiring; persistent tables belong to a
 * host's storage adapter. Tests inject this sink into ingestHit through AnalyticsSinkPort.
 */
import type { AnalyticsSinkCapabilities, AnalyticsSinkPort } from "./ports.js";
import type { NormalizedHit } from "./types.js";

/** Default number of rows `list()` returns when the caller does not request a specific count. */
const DEFAULT_LIST_LIMIT = 50;

/**
 * Hard ceiling on rows a single `list()` call can return, independent of what a caller requests.
 * The in-memory buffer itself is unbounded (no TTL/prune wired at this ingest-only stage — see
 * file header), so the read accessor is the one place that must not trust caller-supplied size
 * (resource-bounds discipline: a caller cannot force an unbounded array copy through this seam).
 */
const MAX_LIST_LIMIT = 500;

/**
 * Clamps a caller-requested `list()` size into `[1, MAX_LIST_LIMIT]`, substituting
 * {@link DEFAULT_LIST_LIMIT} for `undefined`/non-finite input (e.g. `NaN` from an unparsed query
 * string) rather than propagating it into `Array.prototype.slice`, where a `NaN` argument silently
 * degrades to unrelated (and confusing) slice behavior.
 *
 * @complexity O(1).
 */
function clampListLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT);
}

/**
 * Minimal process-local AnalyticsSinkPort. It promises no disk persistence; a host's durable
 * storage adapter owns that capability. Accept appends one hit; acceptBatch appends its rows.
 * @complexity O(1) amortized per accept; O(n) per n-hit batch.
 */
export class LocalBufferSink implements AnalyticsSinkPort {
  private hits: NormalizedHit[];

  constructor(_required: Record<string, never>, optional: { initialHits?: readonly NormalizedHit[] } = {}) {
    this.hits = [...(optional.initialHits ?? [])];
  }

  capabilities(_required: Record<string, never>): AnalyticsSinkCapabilities {
    // A process-local array does not survive restart. Previously durable=true was an
    // untrustworthy claim (ADR-046 INV-03); only a persistent host adapter earns that promise.
    return { durable: false, batch: true };
  }

  async accept({ hit }: { hit: NormalizedHit }): Promise<void> {
    this.hits.push(hit);
  }

  async acceptBatch({ hits }: { hits: readonly NormalizedHit[] }): Promise<void> {
    this.hits.push(...hits);
  }

  /** Test/inspection accessor. Returns a defensive copy so callers cannot mutate internal state. */
  all(_required: Record<string, never>): NormalizedHit[] {
    return [...this.hits];
  }

  /**
   * Returns the most recently accepted hits, newest first — the read side behind the admin
   * "recent hits" screen. This is a raw read over the in-memory buffer, NOT an aggregate/rollup
   * query (there is no rollup layer at this stage; see file header).
   *
   * @param optional.limit - Desired row count; clamped via {@link clampListLimit} to
   *   `[1, MAX_LIST_LIMIT]`, defaulting to {@link DEFAULT_LIST_LIMIT}.
   * @returns A newest-first defensive-copy slice; callers cannot mutate internal state.
   * @complexity O(limit) — a bounded tail slice plus reverse, not a scan of the full buffer.
   */
  async list(_required: Record<string, never>, optional: { limit?: number } = {}): Promise<NormalizedHit[]> {
    const limit = clampListLimit(optional.limit);
    return this.hits.slice(-limit).reverse();
  }
}
