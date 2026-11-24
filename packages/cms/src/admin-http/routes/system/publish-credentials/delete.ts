import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { withCredentialStoreErrors, type CredentialRouteInput } from "../credential-routes-shared.js";
import {
  authorizePublishCredentials, parsePublishCredential, publishCredentialRows, PUBLISH_CREDENTIALS_BASE_PATH,
  type DescribePublishCredential, type PreparePublishCredentialInvalidation, type PublishCredentialBaseDeps,
} from "./shared.js";

/** @file `DELETE` a publish credential (idempotent 204) and re-check the hosts it worked for. */

export interface PublishCredentialDeleteRouteDeps extends PublishCredentialBaseDeps {
  describeCredential: DescribePublishCredential;
  /** Delete inside the host's transaction; a no-op (not an error) for a missing row. */
  deleteCredential: (args: { workspaceId: string; id: string }) => Promise<void>;
  prepareInvalidation: PreparePublishCredentialInvalidation;
}

export const publishCredentialDeleteRoute = defineJsonRoute<CredentialRouteInput, undefined, PublishCredentialDeleteRouteDeps, unknown>({
  method: "delete",
  path: `${PUBLISH_CREDENTIALS_BASE_PATH}/:id`,
  parse: parsePublishCredential,
  handle: async ({ input, deps, authorize }) => {
    await authorizePublishCredentials({ authorize });
    const target = { workspaceId: deps.workspaceId, id: input.id };
    // Idempotent: a missing row answers 204. A THROWN error (the repo itself unreachable) is a
    // different case and still needs an answer, not a silent no-op.
    await withCredentialStoreErrors({ rows: publishCredentialRows({ deps }), run: async () => {
      const invalidate = await deps.prepareInvalidation();
      const before = await deps.describeCredential(target);
      await deps.deleteCredential(target);
      if (before) invalidate({ before });
    } });
    return ok({ value: undefined });
  },
}, { successStatus: 204 });
