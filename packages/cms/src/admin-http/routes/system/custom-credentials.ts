import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import type { JsonRouteAuthorize, RouteInputContext } from "@jini-ai/core/contracts/server";

import {
  authorizeCredentials, credentialErrorRows, credentialRouteInput, presentFields, withCredentialStoreErrors,
  type CredentialErrorClass, type CredentialRouteInput, type CredentialStoreErrorClasses,
} from "./credential-routes-shared.js";

/**
 * @file The Admin Access Tokens page's "Add custom provider" create and delete backend.
 *
 * `POST` on the collection and `DELETE` on one credential set, both under
 * `/api/admin/v1/workspaces/:workspaceId/system/custom/credentials`. Deliberately a THIN adapter over
 * the host's custom-credential store — every validation, uniqueness and shape rule lives there; these
 * routes check auth, shape the request into the store's input, map its thrown errors to statuses, and
 * return the credential summary — never the sealed connection, a token, or a username. Structurally
 * mirrors `source-control-credentials.ts`. The collection `GET` and the by-id `PUT` are not specs here:
 * with a cross-site project key store they decide on how the request authenticated (owner session vs
 * machine credential), so they stay with the host until that is a port.
 *
 * `custom-credentials.write` gates every verb, a dot-namespaced permission of its own (not reused from
 * a sibling feature); the seeded owner's wildcard grant authorizes it with no seed edit. Every write
 * that can change which publish hosts a credential works for re-checks those hosts
 * (`prepareInvalidation`). Mounted `"direct"`.
 */

const PERMISSION = "custom-credentials.write";
const ENTITY_TYPE = "custom-credentials";
const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/system/custom/credentials";

/** The credential summary the store returns; only `id`/`scope` are read here, the rest is passed through. */
export interface CustomCredentialView { readonly id: string; readonly scope?: string }
/** The principal the host's authenticate port hands the spec; only `id` is read. */
export interface CredentialRoutePrincipal { readonly id: string }
/** One project key's cross-site usage (what attaching a key answers). */
export interface CustomCredentialKeyUsage { readonly usedBy: readonly string[]; readonly usedByThisSite: boolean }
/** The host's cross-site project key store (absent on a host without one); a create only attaches. */
export interface CustomCredentialProjectKeys {
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

export interface CustomCredentialCreateRouteDeps extends CustomCredentialBaseDeps {
  createCredential: (input: { workspaceId: string } & Record<string, unknown>) => Promise<CustomCredentialView>;
  projectKeys: () => CustomCredentialProjectKeys | undefined;
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
