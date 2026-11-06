/** Fixed access disclosures share the confirmation surface's trusted, single-use click gates. */
import { snapshotAccessApproval, type AccessApprovalDescription } from '@jini-ai/core';
import { buildConfirmationSurface } from './confirmation.js';
import type { SurfaceDetail } from './document.js';

/** Format the exact resource, scope, revision and before/after values without editable grants.
 * The shared structured-detail renderer escapes all caller-controlled labels and values.
 * @throws ToolInputError for a proposal outside the shared resource/byte bounds.
 * @complexity O(n) in disclosure bytes, with at most 128 resources; no I/O.
 */
export function accessApprovalDetails(
  { access }: { access: AccessApprovalDescription },
  _options = {},
): readonly SurfaceDetail[] {
  return snapshotAccessApproval({ access }).resources.flatMap(resource => [
    { label: 'Resource', value: { id: resource.id, name: resource.label, ...resource.scope, revision: resource.revision } },
    { label: resource.label, previous: resource.previous, value: resource.proposed },
  ]);
}

/** Build one fixed access card with the existing dwell, trusted-click and discovery protections.
 * Action params remain in the private frame script, never in the agent discovery mirror.
 * @throws ToolInputError for an oversized or empty access proposal.
 * @complexity O(n) in rendered disclosure bytes; no I/O or permission effects.
 */
export function buildAccessApprovalSurface(
  { access, ...spec }: Omit<Parameters<typeof buildConfirmationSurface>[0], 'details' | 'choices' | 'choicesParam'> & { access: AccessApprovalDescription },
  _options = {},
): ReturnType<typeof buildConfirmationSurface> {
  return buildConfirmationSurface({ ...spec, details: accessApprovalDetails({ access }) });
}
