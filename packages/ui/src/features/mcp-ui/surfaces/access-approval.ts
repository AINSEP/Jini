/** Fixed access disclosures share the confirmation surface's trusted, single-use click gates. */
import { snapshotAccessApproval, type AccessApprovalDescription } from '@jini-ai/core';
import type { SurfaceDetail } from './document.js';

/** Show resource names and fixed before/after grants without opaque binding identifiers.
 * The access snapshot and confirmation exchange retain the exact scope and revision.
 * The shared structured-detail renderer escapes all caller-controlled labels and values.
 * @throws ToolInputError for a proposal outside the shared resource/byte bounds.
 * @complexity O(n) in disclosure bytes, with at most 128 resources; no I/O.
 */
export function accessApprovalDetails(
  { access }: { access: AccessApprovalDescription },
  { omitIds = [] }: { omitIds?: readonly string[] } = {},
): readonly SurfaceDetail[] {
  // `omitIds` is presentation only: a card that already states a resource's facts in its own details
  // leaves the repeat out. The snapshot the approval binds to is never filtered.
  return snapshotAccessApproval({ access }).resources.filter(resource => !omitIds.includes(resource.id)).flatMap(resource => [
    { label: 'Resource', value: resource.label },
    { label: resource.label, previous: resource.previous, value: resource.proposed },
  ]);
}
