import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import {
  authorizeCredentials, credentialErrorRows, credentialRouteInput, presentFields, withCredentialStoreErrors,
  type CredentialRouteInput, type CredentialStoreErrorClasses,
} from "./credential-routes-shared.js";

/**
 * @file The Admin "Source control" credential CRUD backend plus the provider list its form renders.
 *
 * A thin HTTP adapter over the host's source-control credential store: every validation, uniqueness
 * and shape rule lives in that store, so each verb only authorizes, shapes the request into the
 * store's input, maps the store's thrown errors to statuses, and returns the credential summary —
 * never the sealed connection or a token. The store, its error classes, the provider loader and the
 * project-key attach are host collaborators injected per route.
 *
 * `source-control.credentials.write` gates every verb (entity type `source-control`), asked with no
 * `entityId` even on by-id verbs, as the hand-written routes asked it. Mounted `"direct"`.
 */

const PERMISSION = "source-control.credentials.write";
const ENTITY_TYPE = "source-control";
const BASE_PATH = "/api/admin/v1/workspaces/:workspaceId/system/source-control/credentials";
/** The git hosts this workspace's enabled plugins provide, with each one's credential form. */
const PROVIDERS_PATH = "/api/admin/v1/workspaces/:workspaceId/system/source-control/providers";

/** The credential summary the store returns; only `id`/`scope` are read here, the rest is passed through. */
export interface SourceControlCredentialView { readonly id: string; readonly scope?: string }

/** What every source-control route reads: its workspace and the host's store error classes. */
interface SourceControlBaseDeps { workspaceId: string; storeErrors: CredentialStoreErrorClasses }

/** One provider a plugin declares; `credential`/`i18n` are opaque form data the page renders. */
export interface SourceControlProviderDescriptor { readonly id: string; readonly label: string; readonly credential?: unknown; readonly i18n?: unknown }
/** The loaded provider registry: providers, switched-off hosts, and plugin load refusals. Logging the
 *  refusals stays the host loader's (it owns its log); this spec only copies them into the response
 *  so the page can say why a host is missing (see `providerList`). */
export interface SourceControlProviderRegistry {
  list(): readonly { readonly descriptor: SourceControlProviderDescriptor }[];
  readonly switchedOff?: Iterable<readonly [string, string]>;
  readonly refusals: readonly string[];
}
/** Host loader for this workspace's provider registry. */
export type SourceControlProvidersLoader = (args: { workspaceId: string }) => Promise<SourceControlProviderRegistry>;

export interface SourceControlProvidersRouteDeps extends SourceControlBaseDeps { loadSourceControlProviders: SourceControlProvidersLoader }
export interface SourceControlListRouteDeps extends SourceControlBaseDeps {
  listCredentials: (args: { workspaceId: string }) => Promise<readonly SourceControlCredentialView[]>;
}
/** The create input exactly as the store takes it: the body's raw values, validated by the store. */
export interface SourceControlCreateInput { workspaceId: string; label: unknown; connection: unknown; isDefault: unknown; scope: unknown }
export interface SourceControlCreateRouteDeps extends SourceControlBaseDeps {
  createCredential: (input: SourceControlCreateInput) => Promise<SourceControlCredentialView>;
  /** Whether a project store is attached (decides a create's default flag). */
  hasProjectStore: () => boolean;
  /** Attach a just-created project key to this site; the host makes it a no-op without project keys. */
  useProjectKey: (args: { keyId: string }) => Promise<void>;
}
export interface SourceControlUpdateRouteDeps extends SourceControlBaseDeps {
  updateCredential: (input: { workspaceId: string; id: string } & Record<string, unknown>) => Promise<SourceControlCredentialView>;
}
export interface SourceControlDeleteRouteDeps extends SourceControlBaseDeps {
  deleteCredential: (args: { workspaceId: string; id: string }) => Promise<void>;
}

const parse = (raw: Parameters<typeof credentialRouteInput>[0]["raw"]) => ok({ value: credentialRouteInput({ raw }) });
const rowsFor = ({ deps }: { deps: SourceControlBaseDeps }, _optional: Record<string, never> = {}) => credentialErrorRows({ classes: deps.storeErrors });
const authorizeSourceControl = ({ authorize }: { authorize: Parameters<typeof authorizeCredentials>[0]["authorize"] }, _optional: Record<string, never> = {}) =>
  authorizeCredentials({ authorize, permission: PERMISSION, entityType: ENTITY_TYPE });

/** The page's provider rows; `credential`/`i18n` only when declared. Plugin load refusals are sent
 *  too: with them withheld, an installed-and-enabled plugin whose hosts were refused (e.g. a copy the
 *  trust gate rejects) left the page an empty list with no reason. They are plugin-naming sentences
 *  built for the operator, behind this route's own permission, and carry no credential.
 *  @complexity O(p + s + r). */
function providerList({ registry }: { registry: SourceControlProviderRegistry }, _optional: Record<string, never> = {}) {
  return {
    providers: registry.list().map(({ descriptor }) => ({
      id: descriptor.id,
      label: descriptor.label,
      ...(descriptor.credential !== undefined ? { credential: descriptor.credential } : {}),
      ...(descriptor.i18n !== undefined ? { i18n: descriptor.i18n } : {}),
    })),
    switchedOff: [...(registry.switchedOff ?? [])].map(([id, pluginId]) => ({ id, pluginId })),
    refusals: [...registry.refusals],
  };
}

export const sourceControlProvidersRoute = defineJsonRoute<CredentialRouteInput, ReturnType<typeof providerList>, SourceControlProvidersRouteDeps, unknown>({
  method: "get",
  path: PROVIDERS_PATH,
  parse,
  handle: async ({ deps, authorize }) => {
    await authorizeSourceControl({ authorize });
    const registry = await withCredentialStoreErrors({ run: () => deps.loadSourceControlProviders({ workspaceId: deps.workspaceId }), rows: rowsFor({ deps }) });
    return ok({ value: providerList({ registry }) });
  },
});

export const sourceControlListRoute = defineJsonRoute<CredentialRouteInput, { credentials: readonly SourceControlCredentialView[] }, SourceControlListRouteDeps, unknown>({
  method: "get",
  path: BASE_PATH,
  parse,
  handle: async ({ deps, authorize }) => {
    await authorizeSourceControl({ authorize });
    const credentials = await withCredentialStoreErrors({ run: () => deps.listCredentials({ workspaceId: deps.workspaceId }), rows: rowsFor({ deps }) });
    return ok({ value: { credentials } });
  },
});

/** The store input for a create. Only a project-bound create starts non-default (it is attached
 *  next); a site row, including every create where no project store is open, keeps the store's
 *  first-row auto-default. `scope`: "site" = only for this site; omitted = the project store. */
function createInput({ deps, body }: { deps: SourceControlCreateRouteDeps; body: Record<string, unknown> }, _optional: Record<string, never> = {}): SourceControlCreateInput {
  return {
    workspaceId: deps.workspaceId,
    label: body.label,
    connection: body.connection,
    isDefault: body.isDefault ?? (body.scope !== "site" && deps.hasProjectStore() ? false : undefined),
    scope: body.scope,
  };
}

export const sourceControlCreateRoute = defineJsonRoute<CredentialRouteInput, { credential: SourceControlCredentialView }, SourceControlCreateRouteDeps, unknown>({
  method: "post",
  path: BASE_PATH,
  parse,
  handle: async ({ input, deps, authorize }) => {
    await authorizeSourceControl({ authorize });
    const credential = await withCredentialStoreErrors({ rows: rowsFor({ deps }), run: async () => {
      const created = await deps.createCredential(createInput({ deps, body: input.body }));
      if (created.scope === "project") await deps.useProjectKey({ keyId: created.id });
      return created;
    } });
    return ok({ value: { credential } });
  },
}, { successStatus: 201 });

export const sourceControlUpdateRoute = defineJsonRoute<CredentialRouteInput, { credential: SourceControlCredentialView }, SourceControlUpdateRouteDeps, unknown>({
  method: "put",
  path: `${BASE_PATH}/:id`,
  parse,
  handle: async ({ input, deps, authorize }) => {
    await authorizeSourceControl({ authorize });
    const update = { workspaceId: deps.workspaceId, id: input.id, ...presentFields({ body: input.body, keys: ["label", "connection", "isDefault"] }) };
    const credential = await withCredentialStoreErrors({ run: () => deps.updateCredential(update), rows: rowsFor({ deps }) });
    return ok({ value: { credential } });
  },
});

export const sourceControlDeleteRoute = defineJsonRoute<CredentialRouteInput, undefined, SourceControlDeleteRouteDeps, unknown>({
  method: "delete",
  path: `${BASE_PATH}/:id`,
  parse,
  handle: async ({ input, deps, authorize }) => {
    await authorizeSourceControl({ authorize });
    // Idempotent: the store's delete is a no-op (not an error) for a missing row, so this answers
    // 204 always. A THROWN error (the repo itself unreachable) still needs an answer, not silence.
    await withCredentialStoreErrors({ run: () => deps.deleteCredential({ workspaceId: deps.workspaceId, id: input.id }), rows: rowsFor({ deps }) });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
