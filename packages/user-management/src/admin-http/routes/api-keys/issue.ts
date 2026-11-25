import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";

import type { issueApiKey } from "../../../identity/api-key-service.js";
import { toApiKeyIssueResponse, type AdminApiKeyIssueResponse } from "../../http/api-keys.js";
import { rejectUserError, userActorId, type UserRoutePrincipal } from "../users/shared.js";
import { API_KEY_ERRORS, apiKeyBody, type ApiKeyServicesFn } from "./shared.js";

type IssueArgs = Omit<Parameters<typeof issueApiKey>[0], "keySecret">;
type IssueInput = Pick<IssueArgs["input"], "principalId" | "label" | "policyIds" | "expiresAt">;

/** The host-bound issuance transition: `createApiKeyService({ keySecret }).issueApiKey`. */
export type BoundIssueApiKeyFn = (required: IssueArgs) => ReturnType<typeof issueApiKey>;

/** The deps this route reads. */
export interface ApiKeyIssueRouteDeps {
  workspaceId: string;
  apiKeyServices: ApiKeyServicesFn;
  /** The host binds its own key format once at composition (`createApiKeyService`). */
  issueApiKey: BoundIssueApiKeyFn;
}

/**
 * POST api-keys — `APIKEY_ISSUE` (api.spec §1, state.spec §3 `ISSUE_API_KEY`). Issues a key bound
 * to a grantless `kind='api_key'` principal, snapshotting the requested policies into a frozen,
 * machine-owned policy that a later `WRITE_POLICY_PERMISSION` can never widen (F-054-01).
 *
 * **This is the only response in the admin API that contains a live secret.** `rawKey` is produced
 * by `issueApiKey` in memory and returned once; the row it writes holds a scrypt digest of the
 * secret half only, so no subsequent read of any table can reproduce it (INV-05). Nothing in this
 * handler logs the response body.
 *
 * Gated by `apikey.manage` plus the INV-07 issuance clamp, both enforced inside `issueApiKey`.
 */
export const apiKeyIssueRoute = defineJsonRoute<IssueInput, { apiKey: AdminApiKeyIssueResponse }, ApiKeyIssueRouteDeps, UserRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/api-keys",
  parse: (raw) => {
    const body = apiKeyBody(raw);
    return ok({ value: { principalId: body?.principalId, label: body?.label, policyIds: body?.policyIds, expiresAt: body?.expiresAt } as IssueInput });
  },
  handle: async ({ input, deps, context }) => {
    try {
      const callerPrincipalId = userActorId({ context });
      const { apiKey, rawKey } = await deps.issueApiKey({
        deps: deps.apiKeyServices(),
        input: { workspaceId: deps.workspaceId, callerPrincipalId, principalId: input.principalId, label: input.label, policyIds: input.policyIds, expiresAt: input.expiresAt },
      });
      return ok({ value: { apiKey: toApiKeyIssueResponse({ apiKey, rawKey }) } });
    } catch (err) {
      return rejectUserError({ err, rungs: API_KEY_ERRORS });
    }
  },
}, { successStatus: 201 });
