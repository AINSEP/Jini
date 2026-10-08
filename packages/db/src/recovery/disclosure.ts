/**
 * @file SPEC-019 C-305 / REQ-09-REQ-11 / INV-05 — the discarded-write-window disclosure
 * computation (ADR-045 §2, Step 2 of the restore ceremony).
 *
 * Purpose:
 * Never asserts a numeric count for a category outside the versioned `coveredCategories` constant
 * (INV-05) — a category not yet migrated onto the watermark chokepoint (ADR-041 §5's evolving
 * write-path inventory) simply never appears in the output, even if a caller-supplied count source
 * happens to have data for it (AC-17's `entries` case: Collections' write path is not yet
 * watermark-stamped, so it must never be disclosed as covered here regardless of what any count
 * source reports). Renders `"unknown"` — never `0` — for every covered category whenever the
 * watermark baseline itself could not be established, whether because `content.db` was entirely
 * unreadable (AC-19/EC-08) or because the specific restore point predates the
 * `watermarkAtCapture` column (EC-02) — a null baseline must never be silently treated as a
 * zero-baseline (matches SPEC-016 EC-06's identical rule).
 *
 * `result.partial` is always `true` — this disclosure is never claimed exhaustive (ADR-041 §5's
 * own "no exhaustiveness claim until the automated write-path inventory runs clean" carried
 * verbatim into this domain, ADR-045 §2).
 *
 * How it relates to the project:
 * `coveredCategories` is the single, auditable edit point ADR-PIPE-019's File Map names this file
 * for — a new category is added here only once its own write path is confirmed watermark-stamped,
 * never inferred from whatever a count source happens to return.
 */

export type CategoryCount = number | "unknown";

export interface WatermarkBaseline {
  available: boolean;
  watermarkAtCapture?: number | null;
  currentWatermark?: number;
}

export interface DisclosureWatermarkSourcePort {
  getBaseline(): Promise<WatermarkBaseline>;
  getCategoryCounts(): Promise<Record<string, number>>;
}

export interface ComputeDisclosureRequired {
  deps: { watermarkSource: DisclosureWatermarkSourcePort; coveredCategories: readonly string[] };
  input: { restorePointId: string };
}

export interface DisclosureResult {
  partial: true;
  watermarkBaselineAvailable: boolean;
  counts: Record<string, CategoryCount>;
}

/**
 * AC-16/AC-17/AC-19/EC-02/EC-08/INV-05 — computes the disclosure's per-category counts, restricted
 * to `coveredCategories` and rendered as `"unknown"` whenever the baseline isn't usable.
 *
 * @complexity O(coveredCategories.length) plus one `getBaseline()` call and, when the baseline is
 * usable, one `getCategoryCounts()` call.
 */
export async function computeDisclosure(
  required: ComputeDisclosureRequired,
  _optional: Record<string, never> = {}
): Promise<DisclosureResult> {
  const { deps } = required;

  const baseline = await deps.watermarkSource.getBaseline();
  const baselineUsable = baseline.available && baseline.watermarkAtCapture !== null && baseline.watermarkAtCapture !== undefined;

  const counts: Record<string, CategoryCount> = {};
  if (baselineUsable) {
    const rawCounts = await deps.watermarkSource.getCategoryCounts();
    for (const category of deps.coveredCategories) {
      counts[category] = rawCounts[category] ?? 0;
    }
  } else {
    for (const category of deps.coveredCategories) {
      counts[category] = "unknown";
    }
  }

  return {
    partial: true,
    watermarkBaselineAvailable: baseline.available,
    counts,
  };
}
