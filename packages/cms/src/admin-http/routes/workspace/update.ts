import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { AdminWorkspaceResponse } from '@jini-ai/core/contracts/site/cms-workspace';

import { updateWorkspace, WorkspaceConflictError, WorkspaceNotFoundError, WorkspaceValidationError } from '../../../workspace/index.js';
import { toAdminWorkspaceResponse } from '../../http/workspace.js';
import { authorizeWorkspaceManage, workspaceRefusal, WORKSPACES_PATH, type WorkspaceAdminRouteDeps, type WorkspaceRoutePrincipal } from './deps.js';

/** This route's two writable PATCH fields — `undefined` means "leave unchanged". */
export interface WorkspaceUpdateInput { name: string | undefined; slug: string | undefined }

/** The two PATCH fields read off an untyped body in one place; an absent body changes nothing
 *  (the domain then refuses the empty update). @complexity O(1). */
export function parseWorkspaceUpdateBody({ rawBody }: { rawBody: unknown }, _optional: Record<string, never> = {}): WorkspaceUpdateInput {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return {
    name: body.name !== undefined ? String(body.name) : undefined,
    slug: body.slug !== undefined ? String(body.slug) : undefined,
  };
}

/** This route's typed domain errors as their wire refusal; anything else is returned unchanged for
 *  the host's opaque failure mapping. @complexity O(1). */
export function workspaceUpdateFailure({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof WorkspaceValidationError) return workspaceRefusal({ status: 400, error: error.message, code: 'VALIDATION_ERROR' });
  if (error instanceof WorkspaceConflictError) return workspaceRefusal({ status: 409, error: error.message, code: 'RESOURCE_CONFLICT', details: { field: 'slug' } });
  if (error instanceof WorkspaceNotFoundError) return workspaceRefusal({ status: 404, error: error.message, code: 'RESOURCE_NOT_FOUND' });
  return error;
}

/**
 * PATCH workspaces/:workspaceId — `UPDATE_WORKSPACE` (SPEC-044 REQ-04, AC-05). `:workspaceId` must
 * equal the caller's own workspace (INV-04, checked by the host's workspace port before
 * authorization, same as `get.ts`). Gated by `workspace.manage`. The parse passes the raw body through
 * and the field coercion runs in `handle` after the gate (coercing a hostile field can throw, and a
 * denied caller must get its 403 first), so validation (the domain's) still runs only after
 * authorization, as the hand-written route did.
 */
export const workspaceUpdateRoute = defineJsonRoute<unknown, { workspace: AdminWorkspaceResponse }, WorkspaceAdminRouteDeps, WorkspaceRoutePrincipal>({
  method: 'patch',
  path: `${WORKSPACES_PATH}/:workspaceId`,
  parse: (raw) => ok({ value: raw.body }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeWorkspaceManage({ authorize });
    const fields = parseWorkspaceUpdateBody({ rawBody: input });
    try {
      const { workspace } = await updateWorkspace({ deps: { repo: deps.workspaceRepo }, input: { id: deps.workspaceId, ...fields } });
      return ok({ value: { workspace: toAdminWorkspaceResponse({ workspace }) } });
    } catch (error) {
      throw workspaceUpdateFailure({ error });
    }
  },
});
