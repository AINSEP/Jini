import { ToolInputError } from "@jini-ai/core";
import { defineJsonRoute, ok, routeReply } from "@jini-ai/core/contracts/server";
import type { JsonRouteAuthorize, RouteInputContext, RouteReply } from "@jini-ai/core/contracts/server";

/**
 * @file The Shared Keys "use a saved key" picker's backend (w4-routes K, RT-K1-adm-system-1):
 * `GET` lists the saved keys this site may copy, `POST` grants exactly one of them as a reference,
 * both on `/api/admin/v1/workspaces/:workspaceId/system/credential-copy`.
 *
 * Owner-only browser picker; one approval submits one reference to this server-bound site.
 *
 * The host mount owns the gates that run before the handler, in the hand-written order:
 * `Cache-Control: no-store` on every answer (`responseHeaders`), the session-credential 403
 * (`sessionCredentialOnly`) AHEAD of the workspace 404 (`authenticateBeforeWorkspace`), then the
 * principal read; and the redacted `copy-failed` 500 (`failure`). The handler owns the rest:
 * owner-only, RBAC (`system.write`), the host's optional instance admission, then the local-host
 * check — after authorization, so a remote non-owner learns nothing more than "owner-only".
 */

export const CREDENTIAL_COPY_PATH = "/api/admin/v1/workspaces/:workspaceId/system/credential-copy";

/** The principal the host's authenticate port hands the spec; only `id` is read. */
export interface CredentialCopyPrincipal { readonly id: string }

/** One saved key the picker may offer (the host's project-key row; only these fields are read). */
export interface CredentialCopyChoice {
  readonly keyId: string; readonly name: string; readonly kind: string;
  readonly siteName?: string; readonly locked?: string; readonly omittedCount?: number;
}

/** The host's cross-site project key store, as the picker uses it. */
export interface CredentialCopyProjectKeys {
  listChoices(required: Record<string, never>): Promise<readonly CredentialCopyChoice[]>;
  /** The permission that saving this key's kind needs; may throw `ToolInputError` (the 409). */
  permissionFor(required: { keyId: string }): Promise<string>;
  use(required: { keyId: string; use: true }): Promise<{ readonly keyId: string }>;
}

/** What both verbs read; every collaborator is read per request, as the hand-written route did. */
export interface CredentialCopyRouteDeps {
  workspaceId: string;
  /** The seeded owner's principal id. */
  ownerPrincipalId: () => Promise<string>;
  /** The host's optional instance admission for one permission; `true` when the host has none. */
  admitInstance: (args: { principalId: string; permission: string }) => Promise<boolean>;
  /** The project key store, or `undefined` on a host without one (answered as local-host-only). */
  projectKeys: () => CredentialCopyProjectKeys | undefined;
  /** Whether this request came from a browser on the host machine itself (sockets, Host, Origin). */
  isLocalRequest: (args: { context: CredentialCopyPrincipal }) => boolean;
}

interface CopyKey {
  kind: string; id: string; label: string; provider: null; worksFor: never[];
  siteName?: string; locked?: string; omittedCount?: number;
}
type ListBody = { sources: Array<{ siteId: "shared-keys"; name: "Shared Keys"; keys: CopyKey[] }> };
type GrantBody = { results: Array<{ kind: "reference"; id: string; status: "granted" }> };
type Refusal = RouteReply<{ reasonCode: string; message?: string }>;

const ownerOnly = (): Refusal => routeReply({ status: 403, body: { reasonCode: "owner-only" } });

/** RBAC (throws the host's 403) then the optional instance admission; a refusal reply or `undefined`.
 * @complexity O(1) plus the injected authorizers. */
async function authorizedCopy(
  { deps, authorize, actorId, permission = "system.write" }: { deps: CredentialCopyRouteDeps; authorize: JsonRouteAuthorize; actorId: string; permission?: string },
  _optional: Record<string, never> = {},
): Promise<Refusal | undefined> {
  await authorize({ permission });
  if (!await deps.admitInstance({ principalId: actorId, permission })) return ownerOnly();
  return undefined;
}

/** Every verb requires the seeded owner's session, existing RBAC and optional instance admission.
 * @returns The admitted principal and key store, or the refusal to answer.
 * @complexity O(1) plus the injected collaborators. */
async function admitted(
  { deps, context, authorize }: { deps: CredentialCopyRouteDeps; context: CredentialCopyPrincipal | undefined; authorize: JsonRouteAuthorize | undefined },
  _optional: Record<string, never> = {},
): Promise<{ refusal: Refusal } | { actorId: string; projectKeys: CredentialCopyProjectKeys; authorize: JsonRouteAuthorize }> {
  if (!context || !authorize) throw new Error("credential copy was mounted without the admin authenticate/authorize ports");
  const actorId = context.id;
  if (actorId !== await deps.ownerPrincipalId()) return { refusal: ownerOnly() };
  const denied = await authorizedCopy({ deps, authorize, actorId });
  if (denied) return { refusal: denied };
  const projectKeys = deps.projectKeys();
  if (!projectKeys || !deps.isLocalRequest({ context })) return { refusal: routeReply({ status: 403, body: { reasonCode: "local-host-only" } }) };
  return { actorId, projectKeys, authorize };
}

function validCopyIds({ ids }: { ids: unknown }, _options: Record<string, never> = {}): boolean {
  return Array.isArray(ids) && ids.length >= 1 && ids.length <= 100 &&
    ids.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 512 && !/[\x00-\x1f\x7f]/.test(id));
}

/** The one selection a POST may carry: shared-keys source, exactly one id, no overwrite, no other keys.
 * @complexity O(k) body keys + O(n) ids. */
function selectedKeyId({ body }: { body: unknown }, _optional: Record<string, never> = {}): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some(key => !["sourceSiteId", "ids", "overwrite"].includes(key))) return undefined;
  const ids = record.ids as string[];
  if (record.sourceSiteId !== "shared-keys" || !validCopyIds({ ids }) || ids.length !== 1 || record.overwrite !== false) return undefined;
  return ids[0];
}

/** A saved key the store refused (gone, locked) is the 409 with its own plain words; anything else is
 * rethrown for the mount's redacted `copy-failed` 500.
 * @complexity O(1) plus `run`. */
async function withSavedKeyRefusal<T>({ run }: { run: () => Promise<T> }, _optional: Record<string, never> = {}): Promise<T | Refusal> {
  try { return await run(); } catch (error) {
    // Never serialize raw driver/crypto exceptions; logs receive only the shared redacted diagnostic.
    if (error instanceof ToolInputError) return routeReply({ status: 409, body: { reasonCode: "saved-key-refused", message: error.message } });
    throw error;
  }
}

const parse = (raw: RouteInputContext) => ok({ value: raw.body });

export const credentialCopyListRoute = defineJsonRoute<unknown, ListBody | Refusal, CredentialCopyRouteDeps, CredentialCopyPrincipal>({
  method: "get",
  path: CREDENTIAL_COPY_PATH,
  parse,
  handle: async ({ deps, context, authorize }) => ok({ value: await withSavedKeyRefusal({ run: async (): Promise<ListBody | Refusal> => {
    const admission = await admitted({ deps, context, authorize });
    if ("refusal" in admission) return admission.refusal;
    const rows = await admission.projectKeys.listChoices({});
    return { sources: [{ siteId: "shared-keys", name: "Shared Keys", keys: rows.map(row => ({
      kind: row.kind, id: row.keyId, label: row.name, provider: null, worksFor: [],
      ...(row.siteName ? { siteName: row.siteName } : {}), ...(row.locked ? { locked: row.locked } : {}),
      ...(row.omittedCount !== undefined ? { omittedCount: row.omittedCount } : {}),
    })) }] };
  } }) }),
});

export const credentialCopyGrantRoute = defineJsonRoute<unknown, GrantBody | Refusal, CredentialCopyRouteDeps, CredentialCopyPrincipal>({
  method: "post",
  path: CREDENTIAL_COPY_PATH,
  parse,
  handle: async ({ input, deps, context, authorize }) => ok({ value: await withSavedKeyRefusal({ run: async (): Promise<GrantBody | Refusal> => {
    const admission = await admitted({ deps, context, authorize });
    if ("refusal" in admission) return admission.refusal;
    const keyId = selectedKeyId({ body: input });
    if (keyId === undefined) return routeReply({ status: 400, body: { reasonCode: "invalid-request" } });
    const permission = await admission.projectKeys.permissionFor({ keyId });
    const denied = await authorizedCopy({ deps, authorize: admission.authorize, actorId: admission.actorId, permission });
    if (denied) return denied;
    const used = await admission.projectKeys.use({ keyId, use: true });
    return { results: [{ kind: "reference", id: used.keyId, status: "granted" }] };
  } }) }),
});
