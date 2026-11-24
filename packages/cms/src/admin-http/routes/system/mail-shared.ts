import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";

/**
 * @file Shared guards for the `system/mail-*` admin route specs (status, providers, DNS, test send,
 * activity): ask the host for one permission, and read the authenticated principal's id.
 */

/** The principal fields the mail routes read: only the id, as the actor of a send or a provider switch. */
export interface MailRoutePrincipal { id: string }

/**
 * Asks the host for one permission on `entityType` (`mail` for most routes, `domain-dns` for the DNS
 * pair). None of the mail routes names a single entity, so no `entityId` scope is passed. A mount
 * without an authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMail(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("mail admin route has no authorizer");
  await authorize({ permission, entityType });
}

/** The authenticated principal's id. A mount that authenticated nobody is a wiring bug, so it fails closed. @complexity O(1). */
export function mailActorId({ context }: { context: MailRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("mail admin route has no authenticated principal");
  return context.id;
}
