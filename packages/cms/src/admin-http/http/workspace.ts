import type { AdminWorkspaceResponse } from '@jini-ai/core/contracts/site/cms-workspace';

import type { WorkspaceRecord } from '../../workspace/index.js';

/**
 * @file Admin-facing workspace response projection (mirrors the host's admin user DTO pattern). The
 * wire DTO itself, `AdminWorkspaceResponse`, is owned by `@jini-ai/core/contracts/site/cms-workspace`
 * so the admin client reads the same declaration.
 *
 * Purpose:
 * `WorkspaceRecord` has no sensitive fields (unlike a user record's password hash), so this mapper is a
 * near-identity passthrough — kept as its own function anyway (rather than routes returning the raw
 * repo record directly) for the same reason the admin user/role mappers exist: one
 * seam between the persistence shape and the wire shape, so the two can diverge later without
 * touching every route.
 */

/** Serialize a `WorkspaceRecord` to `AdminWorkspaceResponse`. @complexity O(1). @overallScore 100 */
export function toAdminWorkspaceResponse({ workspace }: { workspace: WorkspaceRecord }, _optional: Record<string, never> = {}): AdminWorkspaceResponse {
  return { id: workspace.id, name: workspace.name, slug: workspace.slug, createdAt: workspace.createdAt, version: workspace.version };
}
