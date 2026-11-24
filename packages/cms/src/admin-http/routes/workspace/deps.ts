import type { JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

import type { WorkspaceRepoPort } from '../../../workspace/index.js';

/**
 * @file What the workspace admin route specs read (the workspace admin routes' own small deps).
 *
 * The specs never see a host's whole service-locator deps bag: a host builds this object from its
 * own composition at mount time. Session principal, the mount-path workspace check and the 403
 * body come from the host's route ports, not from here — see the folder README's Wiring section.
 */

/** The deps every workspace admin route spec reads: the boot-wired workspace id and its repository. */
export interface WorkspaceAdminRouteDeps {
  /** The one workspace this process serves; every by-id route resolves strictly against it. */
  workspaceId: string;
  workspaceRepo: WorkspaceRepoPort;
}

/** The fields of the authenticated principal the host ports hand these routes (the routes read none). */
export interface WorkspaceRoutePrincipal { id: string }

/** The collection path every workspace admin route hangs off. */
export const WORKSPACES_PATH = '/api/admin/v1/workspaces';

/** The one permission every workspace admin route is gated by. */
export const WORKSPACE_MANAGE_PERMISSION = 'workspace.manage';

/**
 * Ask the host to authorize `workspace.manage` at the route's chosen point (after the mount-path
 * workspace check, before any storage access). A spec mounted without an authorizer is a wiring
 * error, never an open route.
 * @throws Error when the host mounted the route without an authorize port; the host's refusal otherwise.
 * @complexity O(1) plus the host authorizer.
 */
export async function authorizeWorkspaceManage({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error('workspace admin route has no authorizer');
  await authorize({ permission: WORKSPACE_MANAGE_PERMISSION, entityType: 'workspace' });
}

/** A route refusal answered verbatim by the host at `status`. @complexity O(1). */
export function workspaceRefusal({ status, error, code, details }: { status: number; error: string; code?: string; details?: Record<string, unknown> }, _optional: Record<string, never> = {}): RouteRefusalError {
  const body: Record<string, unknown> = { error };
  if (code !== undefined) body.code = code;
  if (details !== undefined) body.details = details;
  return new RouteRefusalError({ status, body });
}
