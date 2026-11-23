import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Helpers the AI Assistant admin route specs share: the path prefix, the principal shape the
 * host's authenticate port supplies, the assistant permission gate and the credential-error refusals.
 * The host owns the services, the permission name and the deployment-specific copy; these specs only
 * own the wire shape (paths, status codes, error codes, `{ data }` envelopes).
 */

/** Every AI Assistant admin route lives under this workspace-scoped prefix. */
export const ASSISTANT_ROUTE_PREFIX = "/api/admin/v1/workspaces/:workspaceId/assistant";

/** The fields of the authenticated principal these routes read. */
export interface AssistantRoutePrincipal { id: string }

/** The host's admin-assistant permission name (for example `admin.assistant.manage`). */
export interface AssistantPermissionDeps { adminAssistantPermission: string }

/** How the host classifies a credential service failure; anything else is an unexpected failure. */
export type AssistantCredentialErrorKind = "validation" | "secret-store-unconfigured";

/** The id of the principal the host authenticated. A missing principal is an unexpected failure (500).
 * @complexity O(1).
 */
export function assistantPrincipalId({ context }: { context: AssistantRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("assistant admin route has no authenticated principal");
  return context.id;
}

/** Authorize the assistant permission on `entityType`; a denial is the host port's 403 refusal.
 * @complexity O(1) plus the host authorizer.
 */
export async function authorizeAssistant(
  { authorize, permission, entityType }: { authorize: JsonRouteAuthorize | undefined; permission: string; entityType: string },
  _optional: Record<string, never> = {},
): Promise<void> {
  if (!authorize) throw new Error("assistant admin route has no authorizer");
  await authorize({ permission, entityType });
}

/** A classified credential failure as its wire refusal (400 validation, 503 unconfigured secret store);
 * an unclassified error is returned unchanged so the host's redacted 500 answers it.
 * @complexity O(1).
 */
export function credentialRefusal(
  { error, kind, validationCode, unconfiguredError }: {
    error: unknown; kind: AssistantCredentialErrorKind | undefined; validationCode: string; unconfiguredError: string;
  },
  _optional: Record<string, never> = {},
): unknown {
  if (kind === "validation") {
    return new RouteRefusalError({ status: 400, body: { error: error instanceof Error ? error.message : String(error), code: validationCode } });
  }
  if (kind === "secret-store-unconfigured") {
    return new RouteRefusalError({ status: 503, body: { error: unconfiguredError, code: "SECRET_STORE_UNCONFIGURED" } });
  }
  return error;
}

/** A body field that is present but not a string is a 400 with `code`; `undefined` means "leave alone".
 * Only the validator map's OWN entries count: a field named like an inherited member (`toString`,
 * `constructor`) is an ordinary field under the string-or-omitted rule, never a validator lookup.
 * Present-but-wrong-type is a REJECTION (a stray `{apiKey: 12345}`), never silently reinterpreted
 * as "the caller sent nothing", which would leave a bad request looking like a no-op success.
 * @throws {RouteRefusalError} for the first present non-string field.
 * @complexity O(fields).
 */
export function rejectNonStringFields(
  { body, code, exempt = {} }: { body: Record<string, unknown>; code: string; exempt?: Readonly<Record<string, { ok: (value: unknown) => boolean; message: string }>> },
  _optional: Record<string, never> = {},
): void {
  for (const [field, value] of Object.entries(body)) {
    const specific = Object.hasOwn(exempt, field) ? exempt[field] : undefined;
    const accepted = specific ? specific.ok(value) : value === undefined || typeof value === "string";
    if (!accepted) throw new RouteRefusalError({ status: 400, body: { error: specific ? specific.message : `${field} must be a string`, code } });
  }
}
