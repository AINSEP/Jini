import type { JsonRouteAuthorize } from '@jini-ai/core/contracts/server';

/**
 * @file Shared guard for the `system/publish*` admin route specs (static-site publish status,
 * target descriptors, preview). Every publish route asks one permission on the `site-publish`
 * entity type; the host mounts them `guarded`, so a publishing credential answers from its grant.
 */

/** The fields of the authenticated principal the host ports read for these routes. */
export interface PublishSitePrincipal { id: string }

/**
 * Asks the host for one permission on `site-publish`; a mount without an authorizer is a wiring
 * bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePublish({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error('publish-site route has no authorizer');
  await authorize({ permission, entityType: 'site-publish' });
}
