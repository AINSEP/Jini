import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { withCredentialStoreErrors, type CredentialRouteInput } from "../credential-routes-shared.js";
import {
  authorizePublishCredentials, parsePublishCredential, publishCredentialRows, PUBLISH_CREDENTIALS_BASE_PATH, verifyIfConnectionChanged,
  type PreparePublishCredentialInvalidation, type PublishCredentialBaseDeps, type PublishCredentialVerification, type PublishCredentialView,
  type VerifyPublishCredential,
} from "./shared.js";

/** @file `POST` a new publish credential: store, attach a project key, re-check hosts, verify. */

/** The create input exactly as the store takes it: the body's raw values, validated by the store. */
export interface PublishCredentialCreateInput { workspaceId: string; label: unknown; connection: unknown; isDefault: unknown; worksFor: unknown; scope: unknown }

export interface PublishCredentialCreateRouteDeps extends PublishCredentialBaseDeps {
  createCredential: (input: PublishCredentialCreateInput) => Promise<PublishCredentialView>;
  /** Whether a project store is attached (decides a create's default flag). */
  hasProjectStore: () => boolean;
  /** Attach a just-created project key to this site; a no-op on a host without project keys. */
  useProjectKey: (args: { keyId: string }) => Promise<void>;
  prepareInvalidation: PreparePublishCredentialInvalidation;
  verifyAfterSave: VerifyPublishCredential;
}

/** Only a project-bound create starts non-default (it is attached next); a site row, including
 *  every create where no project store is open, keeps the store's first-row auto-default.
 *  `scope`: "site" = only for this site; omitted = the project store when one is attached. */
function createInput({ deps, body }: { deps: PublishCredentialCreateRouteDeps; body: Record<string, unknown> }, _optional: Record<string, never> = {}): PublishCredentialCreateInput {
  return {
    workspaceId: deps.workspaceId,
    label: body.label,
    connection: body.connection,
    isDefault: body.isDefault ?? (body.scope !== "site" && deps.hasProjectStore() ? false : undefined),
    worksFor: body.worksFor,
    scope: body.scope,
  };
}

export const publishCredentialCreateRoute = defineJsonRoute<CredentialRouteInput, { credential: PublishCredentialView; verification?: PublishCredentialVerification }, PublishCredentialCreateRouteDeps, unknown>({
  method: "post",
  path: PUBLISH_CREDENTIALS_BASE_PATH,
  parse: parsePublishCredential,
  handle: async ({ input, deps, authorize }) => {
    await authorizePublishCredentials(authorize);
    const value = await withCredentialStoreErrors({ rows: publishCredentialRows(deps), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const credential = await deps.createCredential(createInput({ deps, body: input.body }));
      if (credential.scope === "project") await deps.useProjectKey({ keyId: credential.id });
      invalidate({ after: credential });
      // The store always requires a connection, so this always verifies; kept as the same explicit
      // check the update route makes so both read the same way.
      return { credential, ...(await verifyIfConnectionChanged({ body: input.body, id: credential.id, verify: deps.verifyAfterSave })) };
    } });
    return ok({ value });
  },
}, { successStatus: 201 });
