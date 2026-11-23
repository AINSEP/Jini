import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { OutboxPort } from '@jini-ai/core/contracts/events';
import type { Clock, IdGenerator } from '@jini-ai/core/primitives';

import { createWorkspace, WorkspaceConflictError, WorkspaceValidationError } from '../../../workspace/index.js';
import { authorizeWorkspaceManage, workspaceRefusal, WORKSPACES_PATH, type WorkspaceAdminRouteDeps, type WorkspaceRoutePrincipal } from './deps.js';

/** The create route's own deps: the shared workspace deps plus what the create slice and its
 *  event delivery need. `flushOutbox` is the host's outbox runtime — it delivers whatever the
 *  create just enqueued to the host's subscribers; this package names no event bus. */
export interface WorkspaceCreateRouteDeps extends WorkspaceAdminRouteDeps {
  idGen: IdGenerator;
  clock: Clock;
  outbox: OutboxPort;
  /** Deliver the pending outbox rows now. A subscriber failure must stay inside it (the row is
   *  retained for retry); anything it throws becomes the host's opaque 500. */
  flushOutbox: () => Promise<unknown>;
}

/** The two create fields read off an untyped body in one place; an absent body or field is the
 *  empty string, so the domain's validation (not a crash) answers it. @complexity O(1). */
export function parseWorkspaceCreateBody({ rawBody }: { rawBody: unknown }, _optional: Record<string, never> = {}): { name: string; slug: string } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  return { name: String(body.name ?? ''), slug: String(body.slug ?? '') };
}

/** This route's typed domain errors as their wire refusal; anything else is returned unchanged for
 *  the host's opaque failure mapping. @complexity O(1). */
export function workspaceCreateFailure({ error }: { error: unknown }, _optional: Record<string, never> = {}): unknown {
  if (error instanceof WorkspaceValidationError) return workspaceRefusal({ status: 400, error: error.message, code: 'VALIDATION_ERROR' });
  if (error instanceof WorkspaceConflictError) return workspaceRefusal({ status: 409, error: error.message, code: 'RESOURCE_CONFLICT', details: { field: 'slug' } });
  return error;
}

/**
 * POST workspaces — `CREATE_WORKSPACE` (SPEC-044 REQ-01). The hybrid synchronous command and
 * outbox-flush path: the host mounts it behind its authenticated admin session, and it is gated by
 * `workspace.manage`, so unauthenticated callers never create workspace rows. The parse passes the raw
 * body through and the field coercion runs in `handle` after the gate (coercing a hostile field can
 * throw, and a denied caller must get its 403 first), so validation (the domain's) still runs only
 * after authorization; the flush runs after the create
 * commits and before the `201`, so a successful answer means the event was at least attempted.
 */
export const workspaceCreateRoute = defineJsonRoute<unknown, { id: string }, WorkspaceCreateRouteDeps, WorkspaceRoutePrincipal>(
  {
    method: 'post',
    path: WORKSPACES_PATH,
    parse: (raw) => ok({ value: raw.body }),
    handle: async ({ input, deps, authorize }) => {
      await authorizeWorkspaceManage({ authorize });
      const fields = parseWorkspaceCreateBody({ rawBody: input });
      try {
        const { id } = await createWorkspace({ deps: { idGen: deps.idGen, clock: deps.clock, repo: deps.workspaceRepo, outbox: deps.outbox }, input: fields });
        await deps.flushOutbox();
        return ok({ value: { id } });
      } catch (error) {
        throw workspaceCreateFailure({ error });
      }
    },
  },
  { successStatus: 201 },
);
