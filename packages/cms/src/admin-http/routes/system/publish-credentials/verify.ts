import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { withCredentialStoreErrors, type CredentialRouteInput } from "../credential-routes-shared.js";
import {
  authorizePublishCredentials, parsePublishCredential, publishCredentialRows, PUBLISH_CREDENTIALS_BASE_PATH,
  type DescribePublishCredential, type PublishCredentialBaseDeps, type PublishCredentialVerification, type VerifyPublishCredential,
} from "./shared.js";

/** @file `POST …/:id/verify`: re-run the saved credential's provider probe on demand. */

export interface PublishCredentialVerifyRouteDeps extends PublishCredentialBaseDeps {
  describeCredential: DescribePublishCredential;
  verifyAfterSave: VerifyPublishCredential;
}

export const publishCredentialVerifyRoute = defineJsonRoute<CredentialRouteInput, { verification: PublishCredentialVerification | undefined }, PublishCredentialVerifyRouteDeps, unknown>({
  method: "post",
  path: `${PUBLISH_CREDENTIALS_BASE_PATH}/:id/verify`,
  parse: parsePublishCredential,
  handle: async ({ input, deps, authorize }) => {
    await authorizePublishCredentials(authorize);
    // The lookup never decrypts; the ladder is for the verification's decrypt step, which (unlike the
    // provider probe itself) may throw — the same store-error mapping the save routes apply.
    const verification = await withCredentialStoreErrors({ rows: publishCredentialRows(deps), run: async () => {
      const existing = await deps.describeCredential({ workspaceId: deps.workspaceId, id: input.id });
      if (!existing) throw new RouteRefusalError({ status: 404, body: { error: "NOT_FOUND", detail: `no publish credential '${input.id}' in this workspace` } });
      return deps.verifyAfterSave({ id: existing.id });
    } });
    return ok({ value: { verification } });
  },
});
