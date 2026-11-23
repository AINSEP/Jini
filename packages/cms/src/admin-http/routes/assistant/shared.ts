import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { RouteRefusalError, rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards and error mapping for the assistant settings, credential and visitor-tools
 * admin route specs.
 *
 * The site-wide routes (public switch, site credential) ask the host's assistant permission on the
 * `assistant-settings` entity type; the execution-credential trio and the visitor-tools pair ask
 * nothing here (self-scoped by the session's principal, or authorized inside the host service).
 * Every error class these routes map is the host's, so each write route takes the host's ordered
 * mapping table; unmapped errors are rethrown so the host's error port answers its per-operation 500.
 */

/** The principal fields these routes read: only the id. */
export interface AssistantRoutePrincipal { id: string }

/** The entity type every RBAC-gated assistant route names. */
export const ASSISTANT_SETTINGS_ENTITY_TYPE = "assistant-settings";

/** One `catch` rung: which thrown error maps to which status, code and copy. */
export interface AssistantErrorMapping {
  readonly matches: (required: { err: unknown }, optional?: Record<string, never>) => boolean;
  readonly status: number;
  readonly code: string;
  /** Fixed caller copy instead of the error's own message (a host-worded refusal or operator hint). */
  readonly error?: string;
  /** Extra flat body fields after `error`/`code` (the visitor-tools 409's `reload: true`). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * Refuses with the first matching rung's status, code and copy; anything unmapped is rethrown
 * unchanged so the host's error port answers it as an unexpected (redacted) failure.
 * @complexity O(n) in the mapping table length, a small fixed list per route.
 */
export function rejectAssistantError(
  { err, mappings }: { err: unknown; mappings: readonly AssistantErrorMapping[] },
  _optional: Record<string, never> = {},
): never {
  const mapping = mappings.find((candidate) => candidate.matches({ err }));
  if (!mapping) throw err;
  const error = mapping.error ?? (err instanceof Error ? err.message : String(err));
  // `rejectRoute`'s body carries only error/code/details, so a rung with extra flat fields builds its body itself.
  if (mapping.extra) throw new RouteRefusalError({ status: mapping.status, body: { error, code: mapping.code, ...mapping.extra } });
  return rejectRoute({ status: mapping.status, error, code: mapping.code });
}

/**
 * Asks the host for its assistant permission on `assistant-settings`; these routes act on no single
 * entity, so no `entityId`. A mount without an authorizer is a wiring bug, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeAssistant(
  { authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("assistant admin route has no authorizer");
  await authorize({ permission, entityType: ASSISTANT_SETTINGS_ENTITY_TYPE });
}

/** The authenticated principal's id: the caller of a settings write, or the owner of a self-scoped row. @complexity O(1). */
export function assistantActorId({ context }: { context: AssistantRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("assistant admin route has no authenticated principal");
  return context.id;
}

/** A PUT body as the routes read it: a missing (or null) body is an empty patch. @complexity O(1). */
export function assistantBody(body: unknown): Record<string, unknown> {
  return (body ?? {}) as Record<string, unknown>;
}
