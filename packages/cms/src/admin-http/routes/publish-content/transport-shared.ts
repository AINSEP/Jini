import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards and error mapping for the publish-content TRANSPORT route specs (peers,
 * destination). One copy, so a route cannot drift from the others on the exact refusal body.
 * The import/export half keeps its own `import-shared.ts`; the two halves share no helper.
 */

/** A publishing destination as it may leave the server. `masked` and `hasCredential` are the ONLY
 *  credential-shaped fields: no sealed material can ride on a value of this type, which is how the
 *  frozen peers contract keeps secrets out of every response body by construction. */
export interface PublishContentPeerView {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly remoteWorkspaceId: string;
  readonly masked: string | null;
  readonly hasCredential: boolean;
}

/** The principal fields these routes read: none beyond the host's own authorization (typed so the
 *  admin mount's session principal fits). */
export interface PublishRoutePrincipal { id: string }

/** A host-owned typed error class; the host injects the classes, the spec owns their status/code. */
export type PublishErrorClass = abstract new (...args: never[]) => Error;

/** One `catch` rung: which error class answers with which status and code. Order matters (first match wins). */
export interface PublishErrorMapping {
  readonly errorClass: PublishErrorClass;
  readonly status: number;
  readonly code: string;
}

/**
 * Refuses with the first matching rung's status, `{ error: <own message>, code }`; anything unmapped
 * is rethrown unchanged so the host's error port answers it with the route's redacted 500 copy
 * (a raw driver error's message is never echoed).
 * @complexity O(t) in the mapping table length.
 */
export function rejectPublishError({ err, mappings }: { err: unknown; mappings: readonly PublishErrorMapping[] }, _optional: Record<string, never> = {}): never {
  const mapping = mappings.find((candidate) => err instanceof candidate.errorClass);
  if (!mapping) throw err;
  return rejectRoute({ status: mapping.status, error: (err as Error).message, code: mapping.code });
}

/**
 * Asks the host for one `publish_content.*` permission. These routes act on no single entity, so no
 * `entityId` scope is sent. A mount without an authorizer is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePublishContent(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("publish-content admin route has no authorizer");
  await authorize({ permission, entityType });
}

/** A request body as a field bag; an absent body reads as empty. @complexity O(1). */
export function bodyRecord({ body }: { body: unknown }, _optional: Record<string, never> = {}): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}

/** A path segment; Express always fills it, the `?? ""` mirrors the host's own `readRouteParam`. @complexity O(1). */
export function routeParam({ params, name }: { params: Record<string, string | undefined>; name: string }, _optional: Record<string, never> = {}): string {
  return String(params[name] ?? "");
}
