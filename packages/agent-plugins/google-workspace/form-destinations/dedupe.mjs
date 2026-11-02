/**
 * @file Best-effort dedupe for the Google Sheets form destination: finds the rows whose
 * `_tovu_submission_id` cell holds a submission id, by reading that one column in bounded chunks.
 *
 * Exists because a retry (a lost answer, a replayed job) must not add the same submission twice,
 * and Google's append has no idempotency key. The delivery scans before every append and again
 * after an append whose outcome is unknown. The scan covers every row of the tab's grid, so
 * "not found" is a complete answer; a tab with more than {@link DEDUPE_LIMITS.maxScannedRows} data
 * rows is refused as `destination-limit` rather than appended to on an incomplete search.
 *
 * This is NOT exactly-once: a late append or another writer can still race the scan, and there
 * are no row reservations. Delivery is at-least-once with best-effort dedupe (documented in
 * `references/form-delivery.md`).
 */
import { DeliveryRefusal } from './delivery-result.mjs';

export const DEDUPE_LIMITS = Object.freeze({ maxScannedRows: 50_000, chunkRows: 5_000 });

/** Row numbers (1-based) in `[from, to]` of a chunk whose cell equals the id. @complexity O(rows). */
function matchesIn(values, from, submissionId) {
  return values.flatMap((row, offset) => (String(row?.[0] ?? '').trim() === submissionId ? [from + offset] : []));
}

/**
 * Every data row (row 2 onwards) whose id cell equals `submissionId`, in sheet order.
 * @param {{ readColumn: (input: { from: number, to: number }) => Promise<readonly (readonly unknown[])[]>, rowCount: number, submissionId: string }} required
 *   `readColumn` returns the id column's rows `from..to` (rows-major; Google omits trailing blanks).
 *   `rowCount` is the tab's grid row count, header included.
 * @returns {Promise<number[]>}
 * @throws {DeliveryRefusal} `destination-limit` (not retryable) when the tab has more data rows
 *   than the scan ceiling; nothing is read then.
 * @complexity O(rowCount / chunkRows) reads, O(rowCount) cells, each read ≤ chunkRows cells.
 */
export async function findSubmissionRows(required, _optional = {}) {
  const { readColumn, rowCount, submissionId } = required;
  if (rowCount - 1 > DEDUPE_LIMITS.maxScannedRows) throw new DeliveryRefusal({ code: 'destination-limit', retryable: false });
  const found = [];
  for (let from = 2; from <= rowCount; from += DEDUPE_LIMITS.chunkRows) {
    const to = Math.min(rowCount, from + DEDUPE_LIMITS.chunkRows - 1);
    found.push(...matchesIn(await readColumn({ from, to }), from, submissionId));
  }
  return found;
}
