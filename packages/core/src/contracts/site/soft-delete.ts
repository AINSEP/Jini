/**
 * @file The soft-delete ("in the trash") predicate for records carrying a `deletedAt` stamp.
 *
 * Routing and the post store must use one predicate. This neutral contract avoids a
 * platform -> features/post dependency cycle for the same null check.
 */

/** True when a row is in the trash — the single predicate every trash-aware read below applies.
 *  Lives in `contracts/core/soft-delete.ts` so `platform/routing` can share it without importing this feature. */
/** True when a row is in the trash — the single predicate every trash-aware read applies. */
export function isTrashed(record: { readonly deletedAt?: string | null }): boolean {
  return record.deletedAt !== undefined && record.deletedAt !== null;
}
