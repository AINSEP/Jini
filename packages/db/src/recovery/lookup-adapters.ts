import type { DeepLinkRestorePointLookupPort } from "./deep-link.js";
import type { DisclosureWatermarkSourcePort, WatermarkBaseline } from "./disclosure.js";
import type { RestorePointListPort } from "../tools/restore-points.js";

/**
 * @file Admin-UI backend-gap closure (design-spec.md §4.8) — honest, disclosed stand-ins for two
 * Recovery ports this dispatch cannot back with a real implementation yet, plus one adapter that
 * IS real (backed by the same restore-points persistence Database's own routes use).
 */

/**
 * `DisclosureWatermarkSourcePort` stand-in that always reports the watermark baseline as
 * unavailable. This is the SAFE default per `disclosure.ts`'s own binding rule (never coerce
 * `"unknown"` to `0` when the baseline can't be established) — no per-restore-point,
 * per-category write-count tracker exists anywhere in this codebase yet (a real one would need to
 * diff `database_write_watermark` against each covered write path's own row-level attribution,
 * which is future work, not something safe to fabricate). Reporting `available: true` with a
 * stubbed-zero count would be the exact false-reassurance failure mode ADR-045's Failure modes
 * section names as this feature's highest-stakes UX risk — this class deliberately does not do
 * that.
 */
export class AlwaysUnavailableWatermarkSource implements DisclosureWatermarkSourcePort {
  async getBaseline(): Promise<WatermarkBaseline> {
    return { available: false };
  }

  async getCategoryCounts(): Promise<Record<string, number>> {
    return {};
  }
}

/**
 * `DeepLinkRestorePointLookupPort` adapter over the real restore-points list
 * (`database/restore-points.ts`'s `RestorePointListPort`, the same source Database's own
 * restore-points route reads). O(n) over the restore-points list per lookup — an accepted
 * complexity tradeoff (see this dispatch's Style Notes) given restore points are an
 * operator-curated, low-volume list, not a high-churn collection; `findById`-shaped storage would
 * be the fix if that assumption stops holding.
 */
export class RestorePointDeepLinkLookup implements DeepLinkRestorePointLookupPort {
  constructor(private readonly restorePoints: RestorePointListPort) {}

  async findRestorePointById(id: string): Promise<{ restorePointId: string; capturedAt: string } | null> {
    const items = await this.restorePoints.list();
    const match = items.find((row) => row.id === id);
    return match ? { restorePointId: match.id, capturedAt: match.createdAt } : null;
  }
}
