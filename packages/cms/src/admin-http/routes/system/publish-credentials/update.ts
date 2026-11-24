import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { presentFields, withCredentialStoreErrors, type CredentialRouteInput } from "../credential-routes-shared.js";
import {
  authorizePublishCredentials, parsePublishCredential, publishCredentialRows, PUBLISH_CREDENTIALS_BASE_PATH, verifyIfConnectionChanged,
  type DescribePublishCredential, type PreparePublishCredentialInvalidation, type PublishCredentialBaseDeps,
  type PublishCredentialVerification, type PublishCredentialView, type VerifyPublishCredential,
} from "./shared.js";

/** @file `PUT` a publish credential: forward only the supplied fields, re-check hosts on a `worksFor` change, verify a new connection. */

export interface PublishCredentialUpdateRouteDeps extends PublishCredentialBaseDeps {
  describeCredential: DescribePublishCredential;
  updateCredential: (input: { workspaceId: string; id: string } & Record<string, unknown>) => Promise<PublishCredentialView>;
  prepareInvalidation: PreparePublishCredentialInvalidation;
  verifyAfterSave: VerifyPublishCredential;
}

/** Each field forwarded only when supplied (omitted = unchanged; an explicit `null` survives). */
const UPDATE_FIELDS = ["label", "connection", "isDefault", "worksFor"] as const;

export const publishCredentialUpdateRoute = defineJsonRoute<CredentialRouteInput, { credential: PublishCredentialView; verification?: PublishCredentialVerification }, PublishCredentialUpdateRouteDeps, unknown>({
  method: "put",
  path: `${PUBLISH_CREDENTIALS_BASE_PATH}/:id`,
  parse: parsePublishCredential,
  handle: async ({ input, deps, authorize }) => {
    await authorizePublishCredentials({ authorize });
    const target = { workspaceId: deps.workspaceId, id: input.id };
    const value = await withCredentialStoreErrors({ rows: publishCredentialRows({ deps }), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const before = await deps.describeCredential(target);
      const credential = await deps.updateCredential({ ...target, ...presentFields({ body: input.body, keys: UPDATE_FIELDS }) });
      // Only a `worksFor` change moves the credential between publish hosts.
      if (before && input.body.worksFor !== undefined) invalidate({ before, after: credential });
      return { credential, ...(await verifyIfConnectionChanged({ body: input.body, id: credential.id, verify: deps.verifyAfterSave })) };
    } });
    return ok({ value });
  },
});
