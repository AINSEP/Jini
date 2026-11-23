import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeCredentials, credentialErrorRows, credentialRouteInput, presentFields, withCredentialStoreErrors,
  type CredentialErrorClass, type CredentialRouteInput, type CredentialStoreErrorClasses,
} from "./credential-routes-shared.js";

/**
 * @file The Admin Access Tokens page's "Add custom provider" CRUD backend.
 *
 * `GET`/`POST` on the collection and `PUT`/`DELETE` on one credential set, all under
 * `/api/admin/v1/workspaces/:workspaceId/system/custom/credentials`. Deliberately a THIN adapter over
 * the host's custom-credential store — every validation, uniqueness and shape rule lives there; these
 * routes check auth, shape the request into the store's input, map its thrown errors to statuses, and
 * return the credential summary — never the sealed connection, a token, or a username. Structurally
 * mirrors `source-control-credentials.ts`.
 *
 * `custom-credentials.write` gates every verb, a dot-namespaced permission of its own (not reused from
 * a sibling feature); the seeded owner's wildcard grant authorizes it with no seed edit. When the host
 * has a cross-site project key store, the list additionally requires the owner's own session, and an
 * owner-session update may replace a shared key. Every write that can change which publish hosts a
 * credential works for re-checks those hosts (`prepareInvalidation`). Mounted `"direct"`.
 */

const PERMISSION = "custom-credentials.write";
const ENTITY_TYPE = "custom-credentials";
const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/system/custom/credentials";

/** The credential summary the store returns; only `id`/`scope` are read here, the rest is passed through. */
export interface CustomCredentialView { readonly id: string; readonly scope?: string }
/** The principal the host's authenticate port hands the spec; only `id` is read. */
export interface CredentialRoutePrincipal { readonly id: string }
/** One project key's cross-site usage. */
export interface CustomCredentialKeyUsage { readonly usedBy: readonly string[]; readonly usedByThisSite: boolean }
/** The host's cross-site project key store (absent on a host without one). */
export interface CustomCredentialProjectKeys {
  list(args: Record<string, never>): Promise<readonly (CustomCredentialKeyUsage & { readonly keyId: string })[]>;
  use(args: { keyId: string; use: true }): Promise<CustomCredentialKeyUsage>;
}
/** Re-check the publish hosts a credential change affects; `before`/`after` present only when known. */
export type CustomCredentialInvalidate = (change: { before?: CustomCredentialView; after?: CustomCredentialView }) => void;
/** Load what invalidation needs BEFORE the write; `undefined` when the host has nothing to invalidate. */
export type PrepareCustomCredentialInvalidation = () => Promise<CustomCredentialInvalidate | undefined>;

/** The custom store's error classes: the common four plus its optimistic-concurrency refusal. */
export interface CustomCredentialStoreErrorClasses extends CredentialStoreErrorClasses { readonly concurrentModification: CredentialErrorClass }

/** What every custom-credential route reads. */
interface CustomCredentialBaseDeps { workspaceId: string; storeErrors: CustomCredentialStoreErrorClasses }

/** The host copy for the shared-keys gate on the list (product wording stays with the host). */
export interface CustomCredentialListCopy { readonly sharedKeysSessionRequired: string; readonly sharedKeysOwnerRequired: string }

export interface CustomCredentialListRouteDeps extends CustomCredentialBaseDeps {
  listInventory: (args: { workspaceId: string }) => Promise<readonly CustomCredentialView[]>;
  projectKeys: () => CustomCredentialProjectKeys | undefined;
  ownerPrincipalId: () => Promise<string | undefined>;
  /** How this request authenticated (`"session"`, an API key…); `undefined` if the host never recorded it. */
  credentialKindOf: (principal: CredentialRoutePrincipal) => string | undefined;
  copy: CustomCredentialListCopy;
}
export interface CustomCredentialCreateRouteDeps extends CustomCredentialBaseDeps {
  createCredential: (input: { workspaceId: string } & Record<string, unknown>) => Promise<CustomCredentialView>;
  projectKeys: () => CustomCredentialProjectKeys | undefined;
  prepareInvalidation: PrepareCustomCredentialInvalidation;
}
export interface CustomCredentialUpdateRouteDeps extends CustomCredentialBaseDeps {
  describeCredential: (args: { workspaceId: string; id: string }) => Promise<CustomCredentialView | null | undefined>;
  updateCredential: (args: { input: { workspaceId: string; id: string } & Record<string, unknown>; allowSharedKeyReplacement: boolean }) => Promise<CustomCredentialView>;
  ownerPrincipalId: () => Promise<string | undefined>;
  credentialKindOf: (principal: CredentialRoutePrincipal) => string | undefined;
  prepareInvalidation: PrepareCustomCredentialInvalidation;
}
export interface CustomCredentialDeleteRouteDeps extends CustomCredentialBaseDeps {
  describeCredential: (args: { workspaceId: string; id: string }) => Promise<CustomCredentialView | null | undefined>;
  deleteCredential: (args: { workspaceId: string; id: string }) => Promise<void>;
  prepareInvalidation: PrepareCustomCredentialInvalidation;
}

const parse = (raw: RouteInputContext) => ok({ value: credentialRouteInput({ raw }) });
const rowsFor = ({ deps }: { deps: CustomCredentialBaseDeps }, _optional: Record<string, never> = {}) => credentialErrorRows({ classes: deps.storeErrors }, {
  extra: [{ type: deps.storeErrors.concurrentModification, status: 409, error: "CONCURRENT_MODIFICATION" }],
});
const authorizeCustom = ({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}) => authorizeCredentials({ authorize, permission: PERMISSION, entityType: ENTITY_TYPE });

/** With a project key store, the list exposes every site's shared keys: only the installation
 *  owner, signed in with a session (never a machine credential), may read it. @complexity O(1). */
async function assertSharedKeysViewer({ deps, principal }: { deps: CustomCredentialListRouteDeps; principal: CredentialRoutePrincipal | undefined }, _optional: Record<string, never> = {}): Promise<void> {
  if (!principal) throw new Error("custom credentials list reached with no authenticated principal");
  const kind = deps.credentialKindOf(principal);
  // A request that skipped the session middleware has no kind at all: a wiring bug, not a refusal.
  if (kind === undefined) throw new Error("custom credentials list reached with no credential kind");
  if (kind !== "session") rejectRoute({ status: 403, error: deps.copy.sharedKeysSessionRequired, code: "FORBIDDEN", details: { permission: PERMISSION, reason: "credential_kind_not_permitted" } });
  if (principal.id !== await deps.ownerPrincipalId()) rejectRoute({ status: 403, error: deps.copy.sharedKeysOwnerRequired });
}

/** Project rows carry this site's and other sites' usage; site rows pass through. @complexity O(c + k). */
async function inventoryWithUsage({ deps, keys }: { deps: CustomCredentialListRouteDeps; keys: CustomCredentialProjectKeys | undefined }, _optional: Record<string, never> = {}) {
  const [inventory, usages] = await Promise.all([deps.listInventory({ workspaceId: deps.workspaceId }), keys?.list({}) ?? Promise.resolve([])]);
  const usage = new Map(usages.map((key) => [key.keyId, key]));
  return inventory.map((credential) => {
    if (credential.scope !== "project") return credential;
    const key = usage.get(credential.id);
    return { ...credential, usedBy: key?.usedBy ?? [], usedByThisSite: key?.usedByThisSite ?? false };
  });
}

export const customCredentialListRoute = defineJsonRoute<CredentialRouteInput, { credentials: readonly CustomCredentialView[]; projectKeysAvailable?: true }, CustomCredentialListRouteDeps, CredentialRoutePrincipal>({
  method: "get",
  path: BASE_PATH,
  parse,
  handle: async ({ deps, authorize, context }) => {
    await authorizeCustom({ authorize });
    const keys = deps.projectKeys();
    if (keys) await assertSharedKeysViewer({ deps, principal: context });
    const credentials = await withCredentialStoreErrors({ run: () => inventoryWithUsage({ deps, keys }), rows: rowsFor({ deps }) });
    return ok({ value: { credentials, ...(keys ? { projectKeysAvailable: true as const } : {}) } });
  },
});

/** The site's Access Tokens add action is its explicit yes; other sites still need their own yes. */
async function attachAddedProjectKey({ credential, keys }: { credential: CustomCredentialView; keys: CustomCredentialProjectKeys | undefined }, _optional: Record<string, never> = {}) {
  if (credential.scope !== "project" || !keys) return credential;
  const usage = await keys.use({ keyId: credential.id, use: true });
  return { ...credential, usedBy: usage.usedBy, usedByThisSite: usage.usedByThisSite };
}

export const customCredentialCreateRoute = defineJsonRoute<CredentialRouteInput, { credential: CustomCredentialView }, CustomCredentialCreateRouteDeps, CredentialRoutePrincipal>({
  method: "post",
  path: BASE_PATH,
  parse,
  handle: async ({ input, deps, authorize }) => {
    await authorizeCustom({ authorize });
    const { body } = input;
    const credential = await withCredentialStoreErrors({ rows: rowsFor({ deps }), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const created = await deps.createCredential({
        workspaceId: deps.workspaceId, label: body.label, category: body.category, baseUrl: body.baseUrl, connection: body.connection,
        // `scope`: "site" = only for this site; omitted = the project store when one is attached (the store decides).
        ...presentFields({ body, keys: ["additionalHosts", "worksFor", "scope"] }),
      });
      invalidate?.({ after: created });
      return attachAddedProjectKey({ credential: created, keys: deps.projectKeys() });
    } });
    return ok({ value: { credential } });
  },
}, { successStatus: 201 });

/** Only the owner's own session may replace a key shared across sites. @complexity O(1). */
async function isOwnerSession({ deps, principal }: { deps: CustomCredentialUpdateRouteDeps; principal: CredentialRoutePrincipal | undefined }, _optional: Record<string, never> = {}): Promise<boolean> {
  if (!principal || deps.credentialKindOf(principal) !== "session") return false;
  return principal.id === await deps.ownerPrincipalId();
}

/** Each field is forwarded only when the request supplied that key (omitted = unchanged).
 *  `username` is independent of `connection`; an explicit `null` (a clear) survives like a string. */
const UPDATE_FIELDS = ["label", "category", "baseUrl", "additionalHosts", "worksFor", "connection", "username"] as const;

export const customCredentialUpdateRoute = defineJsonRoute<CredentialRouteInput, { credential: CustomCredentialView }, CustomCredentialUpdateRouteDeps, CredentialRoutePrincipal>({
  method: "put",
  path: `${BASE_PATH}/:id`,
  parse,
  handle: async ({ input, deps, authorize, context }) => {
    await authorizeCustom({ authorize });
    const target = { workspaceId: deps.workspaceId, id: input.id };
    const credential = await withCredentialStoreErrors({ rows: rowsFor({ deps }), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const before = await deps.describeCredential(target);
      const allowSharedKeyReplacement = await isOwnerSession({ deps, principal: context });
      const after = await deps.updateCredential({ input: { ...target, ...presentFields({ body: input.body, keys: UPDATE_FIELDS }) }, allowSharedKeyReplacement });
      // Only a `worksFor` change moves the credential between publish hosts.
      if (before && input.body.worksFor !== undefined) invalidate?.({ before, after });
      return after;
    } });
    return ok({ value: { credential } });
  },
});

export const customCredentialDeleteRoute = defineJsonRoute<CredentialRouteInput, undefined, CustomCredentialDeleteRouteDeps, CredentialRoutePrincipal>({
  method: "delete",
  path: `${BASE_PATH}/:id`,
  parse,
  handle: async ({ input, deps, authorize }) => {
    await authorizeCustom({ authorize });
    const target = { workspaceId: deps.workspaceId, id: input.id };
    // Idempotent: the store's delete is a no-op (not an error) for a missing row, so this answers 204 always.
    await withCredentialStoreErrors({ rows: rowsFor({ deps }), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const before = await deps.describeCredential(target);
      await deps.deleteCredential(target);
      if (before) invalidate?.({ before });
    } });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
