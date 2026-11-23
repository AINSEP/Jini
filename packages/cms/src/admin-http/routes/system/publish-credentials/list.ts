import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import { withCredentialStoreErrors, type CredentialRouteInput } from "../credential-routes-shared.js";
import {
  authorizePublishCredentials, parsePublishCredential, publishCredentialRows, PUBLISH_CREDENTIALS_BASE_PATH,
  type PublishCredentialBaseDeps, type PublishCredentialView,
} from "./shared.js";

/** @file `GET` the workspace's publish credentials plus the host's publish execution mode. */

export interface PublishCredentialListRouteDeps extends PublishCredentialBaseDeps {
  listCredentials: (args: { workspaceId: string }) => Promise<readonly PublishCredentialView[]>;
  /** The host's publish execution mode, echoed so the panel can say where a publish runs. */
  executionMode: unknown;
  /** Queue an account-label heal for rows still missing one. Must never throw or reject (the host's
   *  scheduler guarantees it); per-registration state, so the host builds it once per mount. */
  triggerAccountLabelHeal: (credentials: readonly PublishCredentialView[]) => Promise<void>;
}

export const publishCredentialListRoute = defineJsonRoute<CredentialRouteInput, { credentials: readonly PublishCredentialView[]; executionMode: unknown }, PublishCredentialListRouteDeps, unknown>({
  method: "get",
  path: PUBLISH_CREDENTIALS_BASE_PATH,
  parse: parsePublishCredential,
  handle: async ({ deps, authorize }) => {
    await authorizePublishCredentials(authorize);
    const credentials = await withCredentialStoreErrors({ run: () => deps.listCredentials({ workspaceId: deps.workspaceId }), rows: publishCredentialRows(deps) });
    // Fired, never awaited, and only for the rows THIS call found: it can neither change nor delay
    // what the caller receives (the host's heal scheduler never throws or rejects, even if a heal does).
    void deps.triggerAccountLabelHeal(credentials);
    return ok({ value: { credentials, executionMode: deps.executionMode } });
  },
});
